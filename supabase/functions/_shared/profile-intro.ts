// =============================================================================
// profile-intro: the caregiver's profile goes to the family before a caregiver who is new to them arrives.
// Samantha 2026-10-28: "Approved as written, including the 5 decisions as you suggested. Build it with the switch off and
// start the practice week." (the plan: https://claude.ai/artifact/6UCG72cozFDT31cZozVeLM)
//
// Who is new: a caregiver with no completed visit with that client in the last 12 months (her decision 4). A client with no
// completed visit with anyone in 12 months gets the "first visit" words; otherwise the "new caregiver" words.
// When: the day before the visit, 8 AM to 6 PM Central (decision 3). Assigned the same day: right away inside those hours.
//   No 8-to-6 time left before the visit starts: nothing is sent and the Care Coordinator gets a "call the family" card.
// Who: the Family Circle linked to the client's AxisCare id (exactly one), people still on the client's AxisCare contacts,
//   not stopped. Text to people with texting OK; email to anyone with an email (an email address is its own consent, the
//   same rule as the Introduce button). caregiver_intro_pref 'never' is respected; for a first visit intro_on_start decides,
//   the same as caregiver-intro.
// Once: per caregiver per client. The ledger (profile_intro_pairs) and the caregiver_intro_log (the Introduce button, the
//   call-in change text when it carried the profile link) both count, so a family never gets the same caregiver twice.
// Only a published profile is ever sent. Can't go (no profile, no linked circle, nobody to reach, or no time): a card on My
//   Work for the client's Care Coordinator, named and with what to do. No silent failures. 3 tries, 15 minutes apart, then a card.
// Practice (ops_settings.profile_intro_live not true): the day's run row lists what WOULD go and the cards it WOULD make.
//   Nothing is sent and no card is made.
// Off: no approval on record (ops_settings.profile_intro_approved).
// =============================================================================

// deno-lint-ignore no-explicit-any
type Any = any
export const START_HOUR = 8, END_HOUR = 18, LOOKBACK_DAYS = 365, MAX_TRIES = 3, RETRY_MIN = 15
export const OFFICE = '(417) 234-8494'
export const CARD_BASE = 'https://cc.mo-care.com/caregiver.html?id='

/* her approved words (2026-10-28). {first} {caregiver} {client} {when} {link}. Settings can replace either text. */
export const TEXT_FIRST = 'Hi {first}, this is Caring Companions. {caregiver} will be with {client} for the first visit on {when}. ' +
  'Here is a little about {cgfirst}, so it is never a stranger at the door: {link} Questions? Call us at ' + OFFICE + '.'
export const TEXT_NEW = 'Hi {first}, this is Caring Companions. {caregiver} will be with {client} on {when}. ' +
  '{cgfirst} has not been out to see {client} before, so here is a little about {cgfirst} first: {link} Questions? Call us at ' + OFFICE + '.'

const S = (v: unknown) => String(v ?? '').trim()
/* AxisCare's visit list answers 404 when nothing matches the dates (1164 found it on the weeks before the 2026-08 go-live).
   Only the first page's 404 means "no visits"; a 404 on a later page stays an error. */
export const emptyVisitAnswer = (status: number, page: number) => status === 404 && page === 0
export const pairKey = (client: unknown, cg: unknown) => `${S(client)}_${S(cg)}`
export function addDays(ymd: string, n: number): string {
  return new Date(Date.parse(ymd + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)
}
/** Central wall clock now, as 'YYYY-MM-DDTHH:MM' (AxisCare visit times are the visit's own wall clock) */
export function chiNow(now: Date): string {
  return now.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 16).replace(' ', 'T')
}
const naive = (v: unknown) => S(v).replace(' ', 'T').slice(0, 16)

/** "Thursday, Oct 30 at 9:00 AM" from a wall-clock visit start */
export function whenWords(start: string): string {
  const [d, t] = naive(start).split('T')
  const dt = new Date(d + 'T12:00:00Z')
  const day = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
  const [h, m] = (t || '00:00').split(':').map(Number)
  return `${day} at ${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}
/** "Sarah T.": never more of the last name than its first letter */
export function cardName(p: Any): string {
  const first = S(p?.preferred_name || p?.first_name)
  const li = S(p?.last_name).replace(/^[^A-Za-z]+/, '').charAt(0).toUpperCase()
  return first ? (li ? `${first} ${li}.` : first) : ''
}
const firstWord = (s: unknown) => S(s).split(/\s+/)[0] || ''
const nameKey = (s: unknown) => S(s).toLowerCase().replace(/[^a-z]/g, '')

/** the earliest 8-to-6 moment at or after now (wall clock) */
export function nextWindow(nowNaive: string): string {
  const [d, t] = nowNaive.split('T'), h = Number(t.slice(0, 2))
  if (h < START_HOUR) return `${d}T${String(START_HOUR).padStart(2, '0')}:00`
  if (h >= END_HOUR) return `${addDays(d, 1)}T${String(START_HOUR).padStart(2, '0')}:00`
  return nowNaive
}
/** 'wait' (not yet), 'due' (send now), 'no_time' (no 8-to-6 moment left before it starts), 'started' */
export function timing(start: string, nowNaive: string): 'wait' | 'due' | 'no_time' | 'started' {
  const st = naive(start)
  if (st <= nowNaive) return 'started'
  const sendDay = addDays(st.slice(0, 10), -1)
  const win = nextWindow(nowNaive)
  if (win >= st) return 'no_time'
  if (nowNaive.slice(0, 10) < sendDay) return 'wait'
  return win === nowNaive ? 'due' : 'wait'
}

/** does this contact want an intro for this reason (the same rule as caregiver-intro's wantsThis) */
export function wants(c: Any, reason: 'first_visit' | 'new_caregiver'): boolean {
  if (!c || c.stopped_at || c.axiscare_removed_at) return false
  if (reason === 'first_visit') return c.intro_on_start !== false
  return S(c.caregiver_intro_pref || 'new_only') !== 'never'
}
export const textable = (c: Any) => !!(c?.sms_consent === true && S(c.phone).replace(/\D/g, '').length >= 10)
export const emailable = (c: Any) => /.+@.+\..+/.test(S(c?.email))

export function fill(tpl: string, v: Record<string, string>): string {
  let s = tpl
  for (const [k, x] of Object.entries(v)) s = s.split('{' + k + '}').join(x)
  return s.replace(/\s{2,}/g, ' ').trim()
}
/** the words for one person. The client themself (a circle member who IS the client) hears "you" / "your". */
export function words(st: Any, reason: 'first_visit' | 'new_caregiver', p: { contact: Any; clientName: string; profile: Any; start: string }) {
  const cg = cardName(p.profile), cgfirst = firstWord(p.profile?.preferred_name || p.profile?.first_name) || 'them'
  const self = nameKey(p.contact?.name) && nameKey(p.contact?.name) === nameKey(p.clientName)
  const clientFirst = firstWord(p.clientName) || 'your loved one'
  const link = CARD_BASE + encodeURIComponent(S(p.profile?.id))
  const v = { first: firstWord(p.contact?.name) || 'there', caregiver: cg, cgfirst, client: self ? 'you' : clientFirst,
    when: whenWords(p.start), link }
  const tpl = reason === 'first_visit' ? (S(st?.profile_intro_text_first) || TEXT_FIRST) : (S(st?.profile_intro_text_new) || TEXT_NEW)
  const text = fill(tpl, v)
  const subject = `Meet ${cg}, coming ${whenWords(p.start).replace(/ at .*/, '')}`
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36">` +
    `<p>Hi ${esc(v.first)},</p>` +
    `<p><b>${esc(cg)}</b> will be with ${esc(self ? 'you' : clientFirst)} on <b>${esc(v.when)}</b>.</p>` +
    `<p>We would rather you know who is coming than wonder, so here is a little about ${esc(cgfirst)}, in ${esc(cgfirst)}'s own words:</p>` +
    `<p><a href="${esc(link)}" style="background:#0D365F;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;display:inline-block;font-weight:700">Meet ${esc(cgfirst)}</a></p>` +
    `<p>If there is anything you would like us to know before the visit, just call us at ${OFFICE}.</p>` +
    `<p style="color:#57606a">Caring Companions In-Home Senior Care<br>${OFFICE}</p></div>`
  return { text, subject, html, link }
}

export type Visit = { id: string; client: string; clientName: string; cg: string; cgName: string; start: string }
export type IntroDeps = {
  now: () => Date
  settings: () => Promise<Any>
  /** upcoming visits (today and tomorrow, Central), placeholders, removed and quiet clients already left out */
  visits: () => Promise<{ ok: boolean; rows: Visit[]; error?: string }>
  /** 12 months of completed visits: the caregiver-client pairs and the clients who had any */
  history: () => Promise<{ ok: boolean; pairs: Set<string>; clients: Set<string>; error?: string }>
  /** pairs already introduced some other way (the Introduce button, the call-in change text with the link), last 12 months */
  introduced: () => Promise<Set<string>>
  ledger: () => Promise<Map<string, Any>>
  saveLedger: (row: Any) => Promise<void>
  profileOf: (cgAx: string) => Promise<{ profile: Any | null; why: string }>
  circleOf: (clientAx: string) => Promise<{ circle: Any | null; contacts: Any[]; why: string }>
  coordinatorOf: (clientAx: string) => Promise<string | null>
  /** through the family door: ok = GoHighLevel took it; optedOut = an authority said no */
  send: (contact: Any, channel: 'sms' | 'email', msg: { text?: string; subject?: string; html?: string }) => Promise<{ ok: boolean; optedOut?: boolean; why?: string }>
  logIntro: (row: Any) => Promise<void>
  officeItem: (item: Any) => Promise<void>
  closeItem: (id: string, note: string) => Promise<void>
}

const CARD = {
  profile: (v: Visit, when: string) => ({ title: `Profile not ready: ${v.cgName} for ${v.clientName}`,
    detail: `${v.cgName} is with ${v.clientName} on ${when} for the first time. ${firstWord(v.cgName)}'s caregiver profile isn't published, so the family hasn't been sent it.`,
    next: `Publish ${firstWord(v.cgName)}'s profile (it goes out by itself within 15 minutes), or call the family.` }),
  circle: (v: Visit, when: string, why: string) => ({ title: `Family not linked: ${v.clientName}`,
    detail: `${v.cgName} is with ${v.clientName} on ${when} for the first time, but ${why}, so nobody can be sent ${firstWord(v.cgName)}'s profile.`,
    next: `Link the family on ${v.clientName}'s Family tab, or call them.` }),
  nobody: (v: Visit, when: string) => ({ title: `Nobody to send the profile to: ${v.clientName}`,
    detail: `${v.cgName} is with ${v.clientName} on ${when} for the first time. Nobody in the family has an email or texting OK on file.`,
    next: `Call the family to tell them ${firstWord(v.cgName)} is coming, and add an email if they'd like these.` }),
  no_time: (v: Visit, when: string) => ({ title: `Call the family: ${v.cgName} is new to ${v.clientName}`,
    detail: `${v.cgName} is with ${v.clientName} on ${when} for the first time, and there is no time left to send the profile between 8 AM and 6 PM before the visit.`,
    next: `Call the family before the visit and tell them ${firstWord(v.cgName)} is coming.` }),
  failed: (v: Visit, when: string, why: string) => ({ title: `Profile didn't go through: ${v.clientName}`,
    detail: `${v.cgName}'s profile for ${v.clientName}'s visit on ${when} didn't go through after ${MAX_TRIES} tries${why ? ` (${why})` : ''}.`,
    next: `Send it with "Introduce to a family" on ${firstWord(v.cgName)}'s profile, or call the family.` }),
}
export type CardKind = keyof typeof CARD

export async function profileIntro(d: IntroDeps, opts: { dry?: boolean } = {}) {
  const st = (await d.settings()) || {}, now = d.now(), nowIso = now.toISOString(), nowN = chiNow(now)
  const out = { live: false, checked: 0, new_pairs: 0, waiting: 0, sent: 0, failed: 0, opted_out: 0, not_wanted: 0,
    would: [] as Any[], cards: [] as Any[], problems: [] as string[] }
  const approval = st.profile_intro_approved
  if (!approval || typeof approval !== 'object') return { ...out, off: 'no approval on record' }
  const live = st.profile_intro_live === true && !opts.dry
  out.live = live
  const [vis, hist] = await Promise.all([d.visits(), d.history()])
  if (!vis.ok) out.problems.push("AxisCare's upcoming visits couldn't be read: " + S(vis.error))
  if (!hist.ok) out.problems.push("AxisCare's visit history isn't ready: " + S(hist.error))
  if (!vis.ok || !hist.ok) return out   // without both, a caregiver could look new who isn't: nothing goes, the run says why
  /* an empty answer is "no visits", so two guards keep a wrong AxisCare answer from passing as one */
  if (!hist.pairs.size) { out.problems.push("AxisCare's visit history came back empty, so every caregiver would look new"); return out }
  if (!vis.rows.length) out.problems.push('AxisCare shows no visits today or tomorrow')
  const [ledger, introduced] = await Promise.all([d.ledger(), d.introduced()])
  const done = (r: Any) => !!r && (['sent', 'opted_out', 'gave_up', 'not_wanted', 'no_time'].includes(r.status) || (!live && r.status === 'practice'))
  /* one decision per caregiver-client pair: their earliest upcoming visit */
  const first = new Map<string, Visit>()
  for (const v of [...vis.rows].sort((a, b) => naive(a.start).localeCompare(naive(b.start)))) {
    if (!v.client || !v.cg) continue
    const k = pairKey(v.client, v.cg); if (!first.has(k)) first.set(k, v)
  }
  for (const [k, v] of first) {
    out.checked++
    if (hist.pairs.has(k) || introduced.has(k)) continue
    const rec = ledger.get(k)
    if (done(rec)) continue
    out.new_pairs++
    const t = timing(v.start, nowN)
    if (t === 'started' || t === 'wait') { if (t === 'wait') out.waiting++; continue }
    const reason: 'first_visit' | 'new_caregiver' = hist.clients.has(v.client) ? 'new_caregiver' : 'first_visit'
    const when = whenWords(v.start)
    const base = { id: k, client_axiscare_id: v.client, caregiver_axiscare_id: v.cg, client_name: v.clientName, caregiver_name: v.cgName,
      visit_id: v.id, visit_start: naive(v.start), reason }
    const card = async (kind: CardKind, why = '') => {
      const c = kind === 'circle' ? CARD.circle(v, when, why) : kind === 'failed' ? CARD.failed(v, when, why) : CARD[kind](v, when)
      if (!live) { out.cards.push({ pair: k, kind, title: c.title, detail: c.detail }); return }   // practice: listed, not made
      if (rec?.card === kind && rec?.card_at) return   // the same card is already up
      const owner = await d.coordinatorOf(v.client)
      await d.officeItem({ id: `ops_pintro_${k}`, kind: 'profile_intro', domain: 'client_onboarding', status: 'open', urgency: 'today',
        owner: owner || null, title: c.title, about: v.clientName, who: v.clientName, detail: c.detail, next_action: c.next,
        source: { kind: 'profile_intro', client_axiscare_id: v.client, caregiver_axiscare_id: v.cg, visit_id: v.id },
        created_at: nowIso, first_at: nowIso, last_at: nowIso, last_activity_at: nowIso, created_by: 'caregiver profile check',
        opened_by: 'caregiver profile check', history: [{ at: nowIso, by: 'caregiver profile check', text: c.detail }] })
      await d.saveLedger({ ...(rec || {}), ...base, status: kind === 'no_time' ? 'no_time' : kind === 'failed' ? 'gave_up' : 'blocked',
        card: kind, card_at: nowIso, at: nowIso })
    }
    if (t === 'no_time') { await card('no_time'); continue }
    const pr = await d.profileOf(v.cg)
    if (!pr.profile) { await card('profile'); continue }
    const ci = await d.circleOf(v.client)
    if (!ci.circle) { await card('circle', ci.why); continue }
    const wanted = ci.contacts.filter((c) => wants(c, reason))
    if (ci.contacts.length && !wanted.length) {   // everybody said they don't want these: an answer, not a problem
      out.not_wanted++; if (live) await d.saveLedger({ ...base, status: 'not_wanted', at: nowIso }); continue
    }
    const reach = wanted.filter((c) => textable(c) || emailable(c))
    if (!reach.length) { await card('nobody'); continue }
    if (!live) {
      const w = words(st, reason, { contact: reach[0], clientName: v.clientName, profile: pr.profile, start: v.start })
      out.would.push({ pair: k, reason, client: v.clientName, caregiver: cardName(pr.profile), visit: naive(v.start),
        to: reach.map((c) => ({ name: S(c.name), text: textable(c), email: emailable(c) })), example: w.text })
      await d.saveLedger({ ...base, status: 'practice', at: nowIso }); continue
    }
    if (rec?.last_try && now.getTime() - Date.parse(rec.last_try) < RETRY_MIN * 60000) continue
    const reached: string[] = [], chans = new Set<string>(); let opted = 0, failed = 0; let why = ''
    for (const c of reach) {
      const w = words(st, reason, { contact: c, clientName: v.clientName, profile: pr.profile, start: v.start })
      let any = false
      for (const ch of [textable(c) ? 'sms' : '', emailable(c) ? 'email' : ''].filter(Boolean) as Array<'sms' | 'email'>) {
        let r: { ok: boolean; optedOut?: boolean; why?: string }
        try { r = await d.send(c, ch, ch === 'sms' ? { text: w.text } : { subject: w.subject, html: w.html }) }
        catch (e) { r = { ok: false, why: S((e as Error)?.message ?? e).slice(0, 160) } }
        if (r.ok) { any = true; chans.add(ch) } else if (r.optedOut) opted++; else { failed++; why = why || S(r.why) }
      }
      if (any) reached.push(S(c.name))
    }
    const tries = (Number(rec?.tries) || 0) + 1
    if (reached.length) {
      await d.saveLedger({ ...base, status: 'sent', tries, last_try: nowIso, sent_at: nowIso, sent_to: reached, card: null })
      await d.logIntro({ profile_id: pr.profile.id, caregiver_name: cardName(pr.profile), client_name: v.clientName, circle_id: ci.circle.id,
        sent_to: reached.join(', '), channel: chans.size === 2 ? 'both' : [...chans][0], reason, sent_by: 'automatic',
        client_axiscare_id: v.client, caregiver_axiscare_id: v.cg, visit_id: v.id, auto: true })
      if (rec?.card) await d.closeItem(`ops_pintro_${k}`, `Sent to ${reached.join(', ')}`)
      out.sent++; continue
    }
    if (!failed && opted) { await d.saveLedger({ ...base, status: 'opted_out', tries, last_try: nowIso }); out.opted_out++; continue }
    if (tries < MAX_TRIES) { await d.saveLedger({ ...(rec || {}), ...base, status: 'retry', tries, last_try: nowIso, why }); out.failed++; continue }
    await card('failed', why); out.failed++
  }
  return out
}
