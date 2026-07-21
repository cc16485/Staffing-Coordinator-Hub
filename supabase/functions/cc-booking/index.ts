// Supabase Edge Function: cc-booking (shared hub project)
// -----------------------------------------------------------------------------
// Powers the consultation scheduler on mo-care.com/book.html.
//
//   GET  ?token=...&action=slots   -> open time slots for the next N days
//   POST ?token=...                -> book a slot (name/phone/email/type/start)
//
// Availability = office hours (hub -> Bookings -> Settings, app_data key
// "booking_settings") minus busy blocks pulled live from each coordinator's
// Google Calendar (their "Secret address in iCal format" URL, pasted in the
// hub, never in chat) minus consultations already booked (app_data key
// "consult_bookings", which the Care Coordinator Hub's Bookings tab reads).
//
// Deploy (CLI): supabase functions deploy cc-booking --no-verify-jwt
// Uses the existing HT_ORDER_TOKEN secret; no new secrets needed.
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// ---------- timezone helpers (no libraries; Intl does the work) ----------
function tzOffsetMs(tz: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(utcMs))
  const o: Record<string, string> = {}
  for (const p of parts) o[p.type] = p.value
  const asUtc = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute, +o.second)
  return asUtc - utcMs
}
function localToUtc(tz: string, y: number, mo: number, d: number, hh: number, mm: number): number {
  const guess = Date.UTC(y, mo - 1, d, hh, mm)
  let utc = guess - tzOffsetMs(tz, guess)
  const off2 = tzOffsetMs(tz, utc)
  if (guess - off2 !== utc) utc = guess - off2
  return utc
}
function localParts(tz: string, utcMs: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(new Date(utcMs))
  const o: Record<string, string> = {}
  for (const p of parts) o[p.type] = p.value
  return { y: +o.year, mo: +o.month, d: +o.day, hh: +o.hour % 24, mm: +o.minute, wd: o.weekday }
}

// ---------- settings ----------
const DEFAULT_SETTINGS = {
  timezone: 'America/Chicago',
  slot_minutes: 30,
  lead_hours: 3,      // minimum notice before a slot can be taken
  days_ahead: 14,
  // 0=Sun ... 6=Sat; each day is a list of [start,end] windows in local time
  hours: { 1: [['09:00', '16:00']], 2: [['09:00', '16:00']], 3: [['09:00', '16:00']], 4: [['09:00', '16:00']], 5: [['09:00', '16:00']] } as Record<string, string[][]>,
  calendars: [] as { name: string; url: string }[],
}
type Settings = typeof DEFAULT_SETTINGS

// ---------- iCal busy times ----------
function parseIcsDate(raw: string, params: string, tz: string): { ms: number; allDay: boolean } | null {
  if (/VALUE=DATE(;|$)/.test(params) || /^\d{8}$/.test(raw)) {
    const m = raw.match(/^(\d{4})(\d{2})(\d{2})$/)
    if (!m) return null
    return { ms: localToUtc(tz, +m[1], +m[2], +m[3], 0, 0), allDay: true }
  }
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/)
  if (!m) return null
  if (m[7] === 'Z') return { ms: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)), allDay: false }
  const tzm = params.match(/TZID=([^;:]+)/)
  const zone = tzm ? tzm[1] : tz
  try {
    return { ms: localToUtc(zone, +m[1], +m[2], +m[3], +m[4], +m[5]), allDay: false }
  } catch {
    return { ms: localToUtc(tz, +m[1], +m[2], +m[3], +m[4], +m[5]), allDay: false }
  }
}

// Expands one VEVENT (including simple DAILY/WEEKLY RRULEs) into [start,end]
// busy blocks inside the window. All-day events are treated as free time --
// Google marks birthdays/holidays all-day and they shouldn't kill a whole day.
function expandEvent(fields: Record<string, { params: string; value: string }>, tz: string, winStart: number, winEnd: number): number[][] {
  const ds = fields['DTSTART']; if (!ds) return []
  const start = parseIcsDate(ds.value, ds.params, tz); if (!start || start.allDay) return []
  const de = fields['DTEND']
  const end = de ? parseIcsDate(de.value, de.params, tz) : null
  const dur = end && end.ms > start.ms ? end.ms - start.ms : 30 * 60000
  if (/TRANSPARENT/.test(fields['TRANSP']?.value ?? '')) return [] // marked "free" in the calendar

  const exdates = new Set<number>()
  for (const key of Object.keys(fields)) {
    if (!key.startsWith('EXDATE')) continue
    for (const v of fields[key].value.split(',')) {
      const p = parseIcsDate(v.trim(), fields[key].params, tz)
      if (p) exdates.add(p.ms)
    }
  }

  const rrule = fields['RRULE']?.value ?? ''
  if (!rrule) {
    if (start.ms < winEnd && start.ms + dur > winStart) return [[start.ms, start.ms + dur]]
    return []
  }
  const rp: Record<string, string> = {}
  for (const part of rrule.split(';')) { const [k, v] = part.split('='); if (k && v) rp[k] = v }
  const freq = rp['FREQ']
  if (freq !== 'DAILY' && freq !== 'WEEKLY') {
    // monthly/yearly recurrences are almost never real work blocks; skip
    if (start.ms < winEnd && start.ms + dur > winStart) return [[start.ms, start.ms + dur]]
    return []
  }
  const interval = Math.max(1, parseInt(rp['INTERVAL'] || '1', 10))
  let until = winEnd
  if (rp['UNTIL']) { const u = parseIcsDate(rp['UNTIL'], '', tz); if (u) until = Math.min(until, u.ms + dur) }
  const count = rp['COUNT'] ? parseInt(rp['COUNT'], 10) : Infinity
  const dayMs = 86400000
  const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
  const byday = (rp['BYDAY'] || '').split(',').filter(Boolean).map((s) => s.replace(/^[+-]?\d+/, ''))
  const out: number[][] = []
  let n = 0
  // walk day by day from the series start; cheap and good enough for a 2-week window
  for (let t = start.ms; t < until && n < count && out.length < 200; t += dayMs * (freq === 'DAILY' ? interval : 1)) {
    const wdIdx = new Date(t + tzOffsetMs(tz, t)).getUTCDay()
    if (freq === 'WEEKLY') {
      const weeksFromStart = Math.floor((t - start.ms) / (dayMs * 7))
      if (weeksFromStart % interval !== 0) continue
      const wanted = byday.length ? byday : [WD[new Date(start.ms + tzOffsetMs(tz, start.ms)).getUTCDay()]]
      if (!wanted.includes(WD[wdIdx])) continue
    }
    n++
    if (exdates.has(t)) continue
    if (t < winEnd && t + dur > winStart) out.push([t, t + dur])
  }
  return out
}

async function fetchBusy(settings: Settings, winStart: number, winEnd: number): Promise<number[][]> {
  const busy: number[][] = []
  await Promise.all((settings.calendars || []).slice(0, 6).map(async (cal) => {
    if (!cal?.url || !/^https:\/\//.test(cal.url)) return
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 8000)
      const res = await fetch(cal.url, { signal: ctrl.signal })
      clearTimeout(timer)
      if (!res.ok) return
      const text = await res.text()
      // unfold wrapped lines, then walk VEVENTs
      const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/)
      let fields: Record<string, { params: string; value: string }> | null = null
      for (const line of lines) {
        if (line === 'BEGIN:VEVENT') { fields = {}; continue }
        if (line === 'END:VEVENT') {
          if (fields) busy.push(...expandEvent(fields, settings.timezone, winStart, winEnd))
          fields = null; continue
        }
        if (!fields) continue
        const ci = line.indexOf(':'); if (ci < 0) continue
        const head = line.slice(0, ci); const value = line.slice(ci + 1)
        const si = head.indexOf(';')
        const name = si < 0 ? head : head.slice(0, si)
        const params = si < 0 ? '' : head.slice(si + 1)
        const key = name.startsWith('EXDATE') ? 'EXDATE' + Object.keys(fields).filter((k) => k.startsWith('EXDATE')).length : name
        if (['DTSTART', 'DTEND', 'RRULE', 'TRANSP'].includes(name) || name.startsWith('EXDATE')) fields[key] = { params, value }
      }
    } catch { /* one broken calendar shouldn't take bookings down */ }
  }))
  return busy
}

// ---------- availability ----------
function overlaps(aS: number, aE: number, blocks: number[][]): boolean {
  for (const [bS, bE] of blocks) if (aS < bE && aE > bS) return true
  return false
}

// deno-lint-ignore no-explicit-any
async function computeSlots(supabase: any) {
  const { data: setRow } = await supabase.from('app_data').select('data').eq('key', 'booking_settings').maybeSingle()
  const stored = Array.isArray(setRow?.data) ? setRow.data.find((x: { id?: string }) => x?.id === 'settings') : null
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(stored || {}) }
  if (!settings.hours || !Object.keys(settings.hours).length) settings.hours = DEFAULT_SETTINGS.hours

  const now = Date.now()
  const minStart = now + (settings.lead_hours || 0) * 3600000
  const winEnd = now + (settings.days_ahead || 14) * 86400000

  const { data: bkRow } = await supabase.from('app_data').select('data').eq('key', 'consult_bookings').maybeSingle()
  const bookings = (Array.isArray(bkRow?.data) ? bkRow.data : []).filter((b: { status?: string }) => b?.status !== 'cancelled')
  const booked: number[][] = bookings
    .map((b: { start?: string; end?: string }) => [Date.parse(b.start || ''), Date.parse(b.end || b.start || '')])
    .filter((p: number[]) => Number.isFinite(p[0]))
    .map((p: number[]) => [p[0], Number.isFinite(p[1]) && p[1] > p[0] ? p[1] : p[0] + (settings.slot_minutes || 30) * 60000])

  const busy = (await fetchBusy(settings, now, winEnd)).concat(booked)

  const tz = settings.timezone
  const slotMs = (settings.slot_minutes || 30) * 60000
  const days: { date: string; label: string; slots: { iso: string; label: string }[] }[] = []
  const WD_NUM: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

  for (let dayOff = 0; dayOff <= (settings.days_ahead || 14); dayOff++) {
    const probe = now + dayOff * 86400000
    const lp = localParts(tz, probe)
    const windows = settings.hours[String(WD_NUM[lp.wd] ?? -1)] || []
    if (!windows.length) continue
    const slots: { iso: string; label: string }[] = []
    for (const [ws, we] of windows) {
      const [sh, sm] = ws.split(':').map(Number); const [eh, em] = we.split(':').map(Number)
      const wStart = localToUtc(tz, lp.y, lp.mo, lp.d, sh, sm)
      const wEnd = localToUtc(tz, lp.y, lp.mo, lp.d, eh, em)
      for (let t = wStart; t + slotMs <= wEnd; t += slotMs) {
        if (t < minStart) continue
        if (overlaps(t, t + slotMs, busy)) continue
        const sp = localParts(tz, t)
        const h12 = sp.hh % 12 === 0 ? 12 : sp.hh % 12
        slots.push({ iso: new Date(t).toISOString(), label: h12 + ':' + String(sp.mm).padStart(2, '0') + (sp.hh < 12 ? ' AM' : ' PM') })
      }
    }
    if (slots.length) {
      const dateStr = lp.y + '-' + String(lp.mo).padStart(2, '0') + '-' + String(lp.d).padStart(2, '0')
      const label = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(probe))
      days.push({ date: dateStr, label, slots })
    }
  }
  return { timezone: tz, slot_minutes: settings.slot_minutes || 30, days, settings }
}

// ---------- GHL email pipe (same pattern as cc-feedback) ----------
async function ghlEmail(to: string, firstName: string, subject: string, html: string): Promise<boolean> {
  const ghlToken = Deno.env.get('GHL_TOKEN')
  const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
  if (!ghlToken || !ghlLocation) return false
  try {
    const h = { Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
    const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method: 'POST', headers: h,
      body: JSON.stringify({ locationId: ghlLocation, email: to, firstName }),
    })
    const contactId = (await up.json().catch(() => ({})))?.contact?.id
    if (!contactId) return false
    const sr = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
      method: 'POST', headers: h,
      body: JSON.stringify({ type: 'Email', contactId, subject, html }),
    })
    return sr.ok
  } catch { return false }
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = new URL(req.url)
  const expected = Deno.env.get('HT_ORDER_TOKEN') ?? Deno.env.get('HT_SUPPORT_TOKEN')
  if (!expected || url.searchParams.get('token') !== expected) return json({ error: 'unauthorized' }, 401)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  if (req.method === 'GET') {
    if (url.searchParams.get('action') !== 'slots') return json({ error: 'unknown action' }, 400)
    const { timezone, slot_minutes, days } = await computeSlots(supabase)
    return json({ timezone, slot_minutes, days })
  }
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // deno-lint-ignore no-explicit-any
  let b: Record<string, any> = {}
  try { b = await req.json() } catch { return json({ error: 'bad payload' }, 400) }
  const s = (v: unknown, n = 300) => String(v ?? '').trim().slice(0, n)

  const name = s(b.name, 120)
  const phone = s(b.phone, 40)
  const email = s(b.email, 200)
  const type = s(b.type) === 'home' ? 'home' : 'phone'
  const startIso = s(b.start, 40)
  const notes = s(b.notes, 1500)
  const startMs = Date.parse(startIso)
  if (!name || !phone || !Number.isFinite(startMs)) return json({ error: 'name, phone, and a time are required' }, 400)

  // re-check the slot is still open (someone else may have grabbed it)
  const { days, timezone, slot_minutes } = await computeSlots(supabase)
  const stillOpen = days.some((d) => d.slots.some((sl) => Date.parse(sl.iso) === startMs))
  if (!stillOpen) return json({ error: 'slot_taken' }, 409)

  const endMs = startMs + slot_minutes * 60000
  const item = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    name, phone, email, type, notes,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    status: 'confirmed',
    source: 'book.html',
    seen: false,
  }
  const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'consult_bookings', item })
  if (error) return json({ error: error.message }, 500)

  const whenLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(startMs)) + ' (Central)'
  const typeLabel = type === 'home' ? 'Free in-home visit' : 'Phone consultation'

  // office notification (best effort — the booking is already saved)
  await ghlEmail('samantha@mo-care.com', 'Samantha',
    '📅 New consultation booked: ' + name + ', ' + whenLabel,
    '<div style="font-family:Arial,sans-serif;font-size:15px;color:#16283a;line-height:1.6;">'
    + '<p style="font-size:17px;margin:0 0 10px;"><b>' + typeLabel + '</b></p>'
    + '<p><b>When:</b> ' + whenLabel + '</p>'
    + '<p><b>Name:</b> ' + esc(name) + '<br><b>Phone:</b> ' + esc(phone) + (email ? '<br><b>Email:</b> ' + esc(email) : '') + '</p>'
    + (notes ? '<p><b>Notes:</b><br>' + esc(notes) + '</p>' : '')
    + '<p style="color:#55677a;font-size:13px;">Saved to the Care Coordinator Hub &rarr; Grow &rarr; Bookings. It also blocks that time on the public scheduler.</p></div>')

  // confirmation to the family
  let confirmed = false
  if (email) {
    confirmed = await ghlEmail(email, name.split(' ')[0] || name,
      'You’re booked: ' + typeLabel + ', ' + whenLabel,
      '<div style="font-family:Arial,sans-serif;font-size:15px;color:#16283a;line-height:1.7;">'
      + '<p>Hi ' + esc(name.split(' ')[0] || name) + ',</p>'
      + '<p>You’re all set. Here are the details of your free consultation with Caring Companions:</p>'
      + '<p style="background:#EAF4F6;border-radius:10px;padding:14px 18px;"><b>' + typeLabel + '</b><br><b>' + whenLabel + '</b>'
      + (type === 'home' ? '<br>We’ll come to the address you share when we confirm by phone.' : '<br>A care coordinator will call you at ' + esc(phone) + '.') + '</p>'
      + '<p>There’s nothing to prepare and nothing to sign. If you need to change the time, just call or text <a href="tel:14172348494">(417) 234-8494</a>.</p>'
      + '<p>Warmly,<br>Caring Companions In-Home Senior Care<br>1331 N Stewart Ave Ste B, Springfield, MO</p></div>')
  }
  return json({ ok: true, id: item.id, when: whenLabel, confirmed })
})
