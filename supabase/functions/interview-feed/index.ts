// Supabase Edge Function: interview-feed (shared hub project)
// -----------------------------------------------------------------------------
// Augusta books caregiver interviews straight onto each care coordinator's
// Google Calendar. Coordinators paste their calendar's "Secret address in iCal
// format" into the CC Hub's Interviews tab (stored in app_data key
// 'interview_calendars': [{id, name, ics_url, keyword?}]). This function
// fetches each feed server-side (no CORS, URL never exposed to other users'
// browsers... it lives in shared app_data readable by hub users, acceptable
// for an internal tool), parses the VEVENTs and returns upcoming interviews.
//
// Auth: POST with a signed-in SHARED-project user's access token.
// Window: 7 days back to 30 days ahead. Filter: keyword (default "interview")
// in SUMMARY or DESCRIPTION; set keyword "" on a calendar to list everything.
// Deploy: supabase functions deploy interview-feed --no-verify-jwt --project-ref zngsgedlsxinbygwmxwn
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

type Ev = { uid: string; title: string; start: string; all_day: boolean; end?: string; location?: string; desc?: string }

function unfold(ics: string): string[] {
  // RFC5545 line folding: a line starting with space/tab continues the previous
  const out: string[] = []
  for (const raw of ics.split(/\r?\n/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length) out[out.length - 1] += raw.slice(1)
    else out.push(raw)
  }
  return out
}
const unesc = (s: string) => s.replace(/\\n/gi, ' · ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')

// "20260730T140000Z" -> ISO UTC; "20260730T090000" (with TZID) -> floating
// wall-clock "2026-07-30T09:00:00" (client shows it as-is); "20260730" -> date.
function parseDt(v: string): { s: string; allDay: boolean } {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/)
  if (!m) return { s: v, allDay: false }
  if (!m[4]) return { s: `${m[1]}-${m[2]}-${m[3]}`, allDay: true }
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? 'Z' : ''}`
  return { s: iso, allDay: false }
}

function parseIcs(ics: string, keyword: string): Ev[] {
  const lines = unfold(ics)
  const events: Ev[] = []
  // deno-lint-ignore no-explicit-any
  let cur: any = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue }
    if (line === 'END:VEVENT') {
      if (cur && cur.start) {
        const hay = ((cur.title || '') + ' ' + (cur.desc || '')).toLowerCase()
        if (!keyword || hay.includes(keyword)) events.push(cur)
      }
      cur = null; continue
    }
    if (!cur) continue
    const i = line.indexOf(':'); if (i < 0) continue
    const left = line.slice(0, i), val = line.slice(i + 1)
    const prop = left.split(';')[0].toUpperCase()
    if (prop === 'UID') cur.uid = val
    else if (prop === 'SUMMARY') cur.title = unesc(val)
    else if (prop === 'LOCATION') cur.location = unesc(val)
    else if (prop === 'DESCRIPTION') cur.desc = unesc(val).slice(0, 400)
    else if (prop === 'DTSTART') { const p = parseDt(val); cur.start = p.s; cur.all_day = p.allDay }
    else if (prop === 'DTEND') cur.end = parseDt(val).s
    else if (prop === 'RRULE') cur.rrule = true // recurring: keep the base only
    else if (prop === 'STATUS' && /CANCELLED/i.test(val)) cur.cancelled = true
  }
  return events.filter((e) => !('cancelled' in e && (e as { cancelled?: boolean }).cancelled))
}

const DAY = 864e5
function inWindow(e: Ev): boolean {
  const t = new Date(e.start).getTime()
  if (isNaN(t)) return false
  const now = Date.now()
  return t > now - 7 * DAY && t < now + 30 * DAY
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: u } = await admin.auth.getUser(jwt)
  if (!u?.user) return json({ error: 'sign in required' }, 401)

  const { data: row } = await admin.from('app_data').select('data').eq('key', 'interview_calendars').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const cals: any[] = Array.isArray(row?.data) ? row!.data : []
  if (!cals.length) return json({ calendars: [] })

  const results = await Promise.all(cals.map(async (c) => {
    const name = c.name || 'Coordinator'
    try {
      const r = await fetch(String(c.ics_url || ''), { headers: { 'User-Agent': 'cc-hub-interviews' } })
      if (!r.ok) return { id: c.id, name, error: 'calendar returned ' + r.status, events: [] }
      const kw = (c.keyword === '' ? '' : (c.keyword || 'interview')).toLowerCase()
      const events = parseIcs(await r.text(), kw).filter(inWindow)
        .sort((a, b) => a.start.localeCompare(b.start)).slice(0, 40)
      return { id: c.id, name, events }
    } catch (_e) { return { id: c.id, name, error: 'could not fetch calendar', events: [] } }
  }))

  return json({ calendars: results, generated_at: new Date().toISOString() })
})
