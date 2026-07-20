// Supabase Edge Function: campaign-auto (shared hub project)
// -----------------------------------------------------------------------------
// The campaign autopilot. Runs daily (pg_cron). When Samantha's designed email
// library says an email is "due" (Early August, Q3 check-in, Thanksgiving...),
// it sends automatically to the right audience, no clicking:
//   monthly    -> open leads in the CC Hub
//   clients    -> active clients from AxisCare (fallback: converted leads)
//   caregivers -> the caregiver roster synced from AxisCare
// Referral-partner emails stay manual (relationship-timed, not calendar-timed).
//
// Safety rails: master switch + per-audience switches live in app_data
// 'campaign_settings' (default OFF). Each email sends at most once per year
// per audience (campaign_log is checked, manual sends count too). GHL
// do-not-disturb contacts are skipped. A summary email goes to Samantha after
// every autopilot run that sends anything.
//
// Library JSON is hosted at caring-companions.pages.dev/email-assets/library.json
// (generated from her design zip). Auth: ?token= like the other hub functions.
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const LIB_URL = 'https://caring-companions.pages.dev/email-assets/library.json'
const ASSETS = 'https://caring-companions.pages.dev/email-assets'
const LOGO = 'https://caring-companions.pages.dev/email-assets/cc-logo.png'
const ADMIN = 'samantha@mo-care.com'

// When each "when" phrase is due (MM-DD ranges, America/Chicago).
const WINDOWS: Record<string, [string, string]> = {
  'Early January': ['01-02', '01-08'], 'Late January': ['01-20', '01-26'],
  'Feb 7–13': ['02-07', '02-13'], 'Late February': ['02-20', '02-26'],
  'Early March': ['03-02', '03-08'], 'Mid March': ['03-12', '03-18'],
  'Early April': ['04-02', '04-08'], 'Late April': ['04-20', '04-26'],
  'May 4–10': ['05-04', '05-10'], 'Late May': ['05-20', '05-26'],
  'June 8–14': ['06-08', '06-14'], 'Mid–Late June': ['06-17', '06-23'],
  'June 30–July 3': ['06-30', '07-03'], 'Mid July': ['07-12', '07-18'],
  'Early August': ['08-02', '08-08'], 'Late August': ['08-20', '08-26'],
  'Early September': ['09-02', '09-08'], 'Late September': ['09-20', '09-26'],
  'Early–Mid October': ['10-05', '10-12'], 'Late October': ['10-20', '10-26'],
  'Nov 10–18': ['11-10', '11-18'], 'Around Nov 11': ['11-09', '11-12'],
  'Dec 15–22': ['12-15', '12-22'], 'Dec 27–31': ['12-27', '12-31'],
  'January · Q1': ['01-08', '01-15'], 'April · Q2': ['04-08', '04-15'],
  'July · Q3': ['07-08', '07-15'], 'October · Q4': ['10-08', '10-15'],
  'Nov 20–27': ['11-20', '11-27'], 'Dec 18–24': ['12-18', '12-24'],
  'Caregiver Appreciation Week': ['05-11', '05-17'],
  'Early November': ['11-02', '11-08'], 'Early December': ['12-02', '12-08'],
}

function rgba(hex: string, a: number) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
// deno-lint-ignore no-explicit-any
function blocksToHtml(e: any) {
  const ac = e.ac
  // deno-lint-ignore no-explicit-any
  return (e.blocks || []).map((b: any) => {
    if (b.t === 'p') return `<p style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:15.5px;line-height:1.75;color:#3d4b59;">${b.text}</p>`
    if (b.t === 'l') return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">` + (b.items || []).map((it: string) => `<tr><td style="vertical-align:top;width:26px;font-family:Arial,sans-serif;font-size:15.5px;color:${ac};font-weight:bold;">&bull;</td><td style="font-family:Arial,Helvetica,sans-serif;font-size:15.5px;line-height:1.7;color:#3d4b59;padding-bottom:8px;">${it}</td></tr>`).join('') + `</table>`
    if (b.t === 'tip') return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 22px;"><tr><td style="background:${rgba(ac, 0.10)};border-left:4px solid ${ac};border-radius:0 10px 10px 0;padding:16px 20px;"><div style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;color:${ac};margin-bottom:6px;">Good to know</div><div style="font-family:Arial,Helvetica,sans-serif;font-size:15.5px;line-height:1.6;color:#2c3e4f;font-weight:600;">${b.text}</div></td></tr></table>`
    if (b.t === 'q') return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 22px;"><tr><td style="border-left:4px solid ${ac};padding:6px 0 6px 22px;"><div style="font-family:Georgia,'Times New Roman',serif;font-size:19px;line-height:1.5;font-style:italic;color:#1c3f63;margin-bottom:10px;">${b.text}</div><div style="font-family:Arial,Helvetica,sans-serif;font-size:13.5px;font-weight:bold;color:${ac};">${b.by || ''}</div></td></tr></table>`
    if (b.t === 'rating') { const s = `<a href="${b.href}" style="font-family:Arial,sans-serif;font-size:30px;line-height:1;color:${ac};text-decoration:none;">&#9733;</a>`; return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 20px;"><tr><td align="center" style="background:${rgba(ac, 0.10)};border:1px solid ${rgba(ac, 0.22)};border-radius:13px;padding:22px 20px;"><div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#2c3e4f;margin-bottom:12px;">How would you rate your experience with us?</div><div style="font-size:0;line-height:0;margin-bottom:10px;">${s}&nbsp;&nbsp;${s}&nbsp;&nbsp;${s}&nbsp;&nbsp;${s}&nbsp;&nbsp;${s}</div><div style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;color:#8a97a4;">Tap a star, it only takes a moment</div></td></tr></table>` }
    return ''
  }).join('')
}
// deno-lint-ignore no-explicit-any
function buildEmailHTML(e: any) {
  const ac = e.ac
  const footer = e.footer || "You're receiving this because you've been in touch with Caring Companions about care for your family."
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e.subj}</title></head><body style="margin:0;padding:0;background:#e7e9ec;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;">${e.pre || ''}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e7e9ec;"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;"><tr><td style="height:6px;background:${ac};font-size:0;line-height:0;">&nbsp;</td></tr><tr><td align="center" style="background:#f7f2e8;padding:26px 20px 22px;border-bottom:1px solid #efe7d6;"><img src="${LOGO}" width="180" alt="Caring Companions In-Home Senior Care" style="display:inline-block;width:180px;max-width:60%;height:auto;"><div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.14em;text-transform:uppercase;color:#9aa7b4;margin-top:12px;">Quality Caregivers &middot; 24 &middot; 7 &middot; 365</div></td></tr><tr><td style="padding:0;background:${rgba(ac, 0.14)};"><img src="${ASSETS}/${e.banner}.jpg" width="600" alt="Caring Companions" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td></tr><tr><td style="padding:34px 40px 38px;"><div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;letter-spacing:0.1em;text-transform:uppercase;color:${ac};margin-bottom:12px;">${e.eye || ''}</div><h1 style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:29px;line-height:1.22;font-weight:600;color:#16334f;">${e.head}</h1>${blocksToHtml(e)}${e.cta ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:30px 0 8px;"><tr><td align="center"><a href="${e.cta.href}" style="display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;background:#1c3f63;text-decoration:none;padding:15px 34px;border-radius:10px;">${e.cta.label}</a></td></tr></table>` : ''}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;border-top:1px solid #ecebe6;"><tr><td style="padding-top:22px;"><div style="font-family:Georgia,'Times New Roman',serif;font-size:17px;font-style:italic;color:#516274;margin-bottom:3px;">${e.sign || 'With care,'}</div><div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#1c3f63;">The Caring Companions Team</div></td></tr></table></td></tr><tr><td align="center" style="background:#1c3f63;padding:26px 40px 28px;"><div style="font-family:Georgia,'Times New Roman',serif;font-size:18px;color:#ffffff;margin-bottom:6px;">Caring Companions In-Home Senior Care</div><div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#b6c5d6;">Serving Springfield &amp; Southwest Missouri since 2017<br><a href="tel:4172348494" style="color:#e7c87a;text-decoration:none;font-weight:bold;">(417) 234-8494</a> &middot; 1331 N Stewart Ave, Ste B, Springfield, MO 65802</div><div style="height:1px;background:rgba(255,255,255,0.14);margin:18px auto 14px;max-width:360px;font-size:0;line-height:0;">&nbsp;</div><div style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:1.6;color:#8298b0;">${footer}<br><a href="mailto:samantha@mo-care.com?subject=Please%20unsubscribe%20me" style="color:#a9bccf;">Unsubscribe</a> &middot; <a href="https://mo-care.com" style="color:#a9bccf;">mo-care.com</a></div></td></tr></table></td></tr></table></body></html>`
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const expected = Deno.env.get('HT_SUPPORT_TOKEN') ?? Deno.env.get('HT_ORDER_TOKEN')
  if (!expected || url.searchParams.get('token') !== expected) return json({ error: 'unauthorized' }, 401)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const ghlToken = Deno.env.get('GHL_TOKEN')
  const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
  if (!ghlToken || !ghlLocation) return json({ error: 'GHL not configured' }, 500)
  const sendH = { Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }

  const getKey = async (key: string) => {
    const { data } = await supabase.from('app_data').select('data').eq('key', key).maybeSingle()
    return Array.isArray(data?.data) ? data!.data : []
  }

  // 1. Settings (default: everything off)
  const settingsList = await getKey('campaign_settings')
  // deno-lint-ignore no-explicit-any
  const cfg: any = settingsList.find((x: any) => x.id === 'settings') ?? {}
  const sideMode = url.searchParams.get('probe') === '1' || !!url.searchParams.get('resolve')
  if (!cfg.enabled && !sideMode) return json({ ok: true, skipped: 'autopilot is off' })
  const audOn: Record<string, boolean> = { monthly: !!cfg.aud_monthly, clients: !!cfg.aud_clients, client_contacts: !!cfg.aud_client_contacts, caregivers: !!cfg.aud_caregivers }
  const cap = Number(cfg.daily_cap) > 0 ? Number(cfg.daily_cap) : 150

  // 2. Library + what's due today
  // deno-lint-ignore no-explicit-any
  const lib: any[] = await fetch(LIB_URL).then((r) => r.json()).catch(() => [])
  if (!lib.length) return json({ error: 'library unavailable' }, 500)
  const chicago = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) // YYYY-MM-DD
  const [year, mmdd] = [chicago.slice(0, 4), chicago.slice(5)]
  const log = await getKey('campaign_log')
  // deno-lint-ignore no-explicit-any
  const alreadySent = (key: string) => log.some((l: any) => l.key === key && String(l.at || '').startsWith(year))
  // deno-lint-ignore no-explicit-any
  const due = lib.filter((e: any) => {
    if (!audOn[e.aud]) return false
    const w = WINDOWS[e.when]
    if (!w) return false
    return mmdd >= w[0] && mmdd <= w[1] && !alreadySent(e.key)
  })
  if (!due.length && !sideMode) return json({ ok: true, due: 0, note: 'nothing due today' })

  // 3. Audiences
  const dedupe = (arr: { email: string; name: string }[]) => {
    const seen: Record<string, boolean> = {}
    return arr.filter((r) => { const k = r.email.toLowerCase(); if (!r.email.includes('@') || seen[k]) return false; seen[k] = true; return true })
  }
  // --- AxisCare is the source of truth for people ---
  const acKey2 = Deno.env.get('AXISCARE_API_KEY') ?? Deno.env.get('AXISCARE_TOKEN')
  const acSite2 = Deno.env.get('AXISCARE_SITE') ?? Deno.env.get('AXISCARE_SITE_NUMBER')
  const acH = { Authorization: `Bearer ${acKey2}`, Accept: 'application/json' }
  // deno-lint-ignore no-explicit-any
  const acList = async (path: string): Promise<any[]> => {
    if (!acKey2 || !acSite2) return []
    try {
      const r = await fetch(`https://${acSite2}.axiscare.com/api/${path}`, { headers: acH })
      const j = await r.json().catch(() => ({}))
      return j.clients ?? j.caregivers ?? j.contacts ?? j.data ?? (Array.isArray(j) ? j : [])
    } catch { return [] }
  }
  // deno-lint-ignore no-explicit-any
  const pick = (c: any) => ({
    email: String(c.personalEmail ?? c.email ?? c.workEmail ?? '').trim(),
    name: (c.name ?? `${c.firstName ?? c.first_name ?? ''} ${c.lastName ?? c.last_name ?? ''}`).trim(),
    status: String(c.status ?? c.statusLabel ?? c.status_label ?? '').trim(),
  })

  // Diagnostic probe: shape only, no personal values leave.
  if (url.searchParams.get('probe') === '1') {
    const cls = await acList('clients')
    // deno-lint-ignore no-explicit-any
    const statuses: Record<string, number> = {}
    for (const c of cls) { const st = pick(c).status || '(none)'; statuses[st] = (statuses[st] || 0) + 1 }
    const withEmail = cls.filter((c) => pick(c).email).length
    return json({ probe: true, clients: cls.length, withEmail, statuses, keysOfFirst: cls[0] ? Object.keys(cls[0]) : [] })
  }

  const leads = await getKey('leads')
  const audiences: Record<string, { email: string; name: string }[]> = { monthly: [], clients: [], client_contacts: [], caregivers: [] }
  // Leads: AxisCare people whose status looks like a lead/prospect; hub website leads added too.
  const acClients = await acList('clients')
  const acPicked = acClients.map(pick)
  const acLeads = acPicked.filter((c) => c.email && /lead|prospect|inquir|pending/i.test(c.status))
  // deno-lint-ignore no-explicit-any
  const hubLeads = leads.filter((l: any) => l.email && l.status !== 'Converted' && l.status !== 'Lost')
    // deno-lint-ignore no-explicit-any
    .map((l: any) => ({ email: l.email, name: `${l.first_name || ''} ${l.last_name || ''}`.trim() }))
  audiences.monthly = dedupe([...acLeads, ...hubLeads])
  // Clients: AxisCare people with an active-looking status (not leads, not inactive).
  audiences.clients = dedupe(acPicked.filter((c) => c.email && /active|current/i.test(c.status)))
  if (!audiences.clients.length) {
    audiences.clients = dedupe(acPicked.filter((c) => c.email && !/lead|prospect|inquir|pending|inactive|discharg|deceas|former/i.test(c.status)))
  }
  // Client contacts: family members attached to AxisCare clients (defensive across shapes).
  {
    const seen: { email: string; name: string }[] = []
    for (const c of acClients) {
      // deno-lint-ignore no-explicit-any
      const contacts: any[] = (c as any).contacts ?? (c as any).clientContacts ?? []
      for (const k of contacts) {
        const p = pick(k)
        if (p.email) seen.push({ email: p.email, name: p.name })
      }
    }
    const extra = await acList('clientContacts')
    for (const k of extra) { const p = pick(k); if (p.email) seen.push({ email: p.email, name: p.name }) }
    audiences.client_contacts = dedupe(seen)
  }
  // caregivers: roster table synced from AxisCare
  try {
    const { data: cgs } = await supabase.from('caregivers').select('*').eq('active', true)
    // deno-lint-ignore no-explicit-any
    audiences.caregivers = dedupe((cgs ?? []).filter((c: any) => c.email)
      // deno-lint-ignore no-explicit-any
      .map((c: any) => ({ email: c.email, name: c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim() })))
  } catch { audiences.caregivers = [] }

  // Hub helper: return an audience list without sending.
  const resolveAud = url.searchParams.get('resolve')
  if (resolveAud) {
    return json({ ok: true, audience: resolveAud, recipients: audiences[resolveAud] ?? [] })
  }

  // 4. Send
  const summary: string[] = []
  let totalSent = 0
  for (const e of due) {
    if (totalSent >= cap) break
    const recips = audiences[e.aud] || []
    const html = buildEmailHTML(e)
    let sent = 0, failed = 0
    for (const r of recips) {
      if (totalSent >= cap) break
      const parts = (r.name || '').split(/\s+/).filter(Boolean)
      try {
        const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
          method: 'POST', headers: sendH,
          body: JSON.stringify({ locationId: ghlLocation, email: r.email, ...(parts[0] ? { firstName: parts[0] } : {}), ...(parts.length > 1 ? { lastName: parts.slice(1).join(' ') } : {}) }),
        })
        const uj = await up.json().catch(() => ({}))
        const contactId = uj?.contact?.id ?? uj?.id ?? null
        if (!contactId) { failed++; continue }
        if (uj?.contact?.dnd === true) continue // respect do-not-disturb
        const sr = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
          method: 'POST', headers: sendH,
          body: JSON.stringify({ type: 'Email', contactId, subject: e.subj, html: html.replace(/\{first\}/g, parts[0] || 'there') }),
        })
        if (sr.ok) { sent++; totalSent++ } else failed++
      } catch { failed++ }
    }
    const item = { id: crypto.randomUUID(), at: new Date().toISOString(), key: e.key, subj: e.subj, source: 'Autopilot · ' + e.aud, sent, failed, auto: true }
    await supabase.rpc('upsert_app_data_item', { target_key: 'campaign_log', item })
    summary.push(`"${e.subj}" → ${e.aud}: ${sent} sent${failed ? ', ' + failed + ' failed' : ''}`)
  }

  // 5. Tell Samantha what happened
  if (summary.length) {
    try {
      const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
        method: 'POST', headers: sendH, body: JSON.stringify({ locationId: ghlLocation, email: ADMIN, firstName: 'Samantha' }),
      })
      const uj = await up.json().catch(() => ({}))
      const contactId = uj?.contact?.id ?? uj?.id ?? null
      if (contactId) {
        await fetch('https://services.leadconnectorhq.com/conversations/messages', {
          method: 'POST', headers: sendH,
          body: JSON.stringify({
            type: 'Email', contactId, subject: 'Campaign autopilot: ' + summary.length + ' email' + (summary.length > 1 ? 's' : '') + ' sent today',
            html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f2a36;line-height:1.7;max-width:600px"><p>Your campaign autopilot ran today:</p><ul>${summary.map((s) => `<li>${s}</li>`).join('')}</ul><p>Details are in the hub under 🎯 Campaigns → Recent sends. To pause everything, flip the autopilot switch off.</p></div>`,
          }),
        })
      }
    } catch { /* summary is best-effort */ }
  }
  return json({ ok: true, due: due.length, totalSent, summary })
})
