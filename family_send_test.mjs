// SEND TO FAMILY (Samantha 2026-10-28: "build it with your picks: Billing owner enters payment forms, no 3-digit code unless
// AxisCare needs it, start with the four pieces"). The REAL _shared/family-send.ts, family-send (office) and family-form (the
// family's link) against a fake database and fake GoHighLevel, with the REAL seal. Fake data only.   node family_send_test.mjs
import fs from 'fs'; import path from 'path'; import crypto from 'crypto'
const res = []; const ck = (n, c, d) => res.push([n, !!c, c ? '' : String(JSON.stringify(d ?? null)).slice(0, 900)])
const FN = 'supabase/functions'
const tmpFiles = []
const write = (rel, src) => { const p = path.join(process.cwd(), FN, rel); fs.writeFileSync(p, src); tmpFiles.push(p); return p }
process.on('exit', () => { for (const f of tmpFiles) try { fs.unlinkSync(f) } catch { /* */ } })

// stubs for what reaches the network or the real auth
write('_shared/_fs_out.ts', "export const maySend = () => ({ allowed: !globalThis.__night })\nexport const contactForOutbound = async (db, ghl, person, kind, o) => { globalThis.__gate.push({ kind, ...o, person }); return globalThis.__optout ? null : { contactId: 'c1' } }\n")
write('_shared/_fs_sp.ts', "export const ghlSendChecked = async (db, h, sender, to, body) => { globalThis.__sent.push({ sender, to, body }); return !globalThis.__ghlFail }\nexport const reportSendProblem = async () => {}\nexport const ownerFor = async (db, d) => d === 'billing' ? 'billie@mo-care.com' : 'krystal@mo-care.com'\n")
write('_shared/_fs_auth.ts', "export const OFFICE_ROLES = ['owner_admin','care_coordinator','staffing_coordinator']\nexport const requireStaff = async () => { const w = globalThis.__who; if (!w) return { ok: false, status: 401, error: 'Sign in first.' }; return { ok: true, person_id: 'p', name: w.name, email: w.email, roles: w.roles } }\n")
write('_shared/_fs_job.ts', "export const jobCaller = async () => globalThis.__cron ? 'cron' : null\n")
const links = fs.readFileSync(`${FN}/_shared/agreement-links.ts`, 'utf8').replace("'./outreach.ts'", "'./_fs_out.ts'").replace("'./send-problems.ts'", "'./_fs_sp.ts'")
write('_shared/_fs_links.ts', links)
write('_shared/_fs_shared.ts', fs.readFileSync(`${FN}/_shared/family-send.ts`, 'utf8').replace("'./agreement-links.ts'", "'./_fs_links.ts'"))
const swap = (s) => s.replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace("'../_shared/staff-auth.ts'", "'../_shared/_fs_auth.ts'").replace("'../_shared/job-auth.ts'", "'../_shared/_fs_job.ts'").replace("'../_shared/send-problems.ts'", "'../_shared/_fs_sp.ts'")
  .replace("'../_shared/agreement-links.ts'", "'../_shared/_fs_links.ts'").replace("'../_shared/family-send.ts'", "'../_shared/_fs_shared.ts'")
const F = await import(path.join(process.cwd(), FN, '_shared/_fs_shared.ts'))

// ── the rules ──
ck('card check: a real test Visa passes, one digit off fails', F.luhnOk('4111111111111111') && !F.luhnOk('4111111111111112'))
ck('brands: Visa, Mastercard (51 and 2-series), Amex, Discover; unknown is none', F.brandOf('4111111111111111') === 'Visa' && F.brandOf('5555555555554444') === 'Mastercard' && F.brandOf('2223003122003222') === 'Mastercard'
  && F.brandOf('378282246310005') === 'Amex' && F.brandOf('6011111111111117') === 'Discover' && F.brandOf('9999999999999999') === '')
ck('routing check digit: a real routing number passes, a changed digit fails', F.routingOk('101000019') && F.routingOk('011000015') && !F.routingOk('101000018') && !F.routingOk('000000000') && !F.routingOk('12345'))
const jan = new Date('2026-10-28T15:00:00Z')
ck('expiration: this month and later pass; last month, junk and 30 years out fail', F.expOk('10/26', jan) && F.expOk('08/29', jan) && !F.expOk('09/26', jan) && !F.expOk('13/27', jan) && !F.expOk('01/56', jan))
const cardIn = { method: 'card', holder_name: 'Linda Sample', card_number: '4111 1111 1111 1111', exp: '08/29', zip: '65804', invoice_email: 'linda@example.com', all_future: true, signer_name: 'Linda Sample', agree: true }
let c = F.cleanPayment(cardIn, jan)
ck('a good card: kept in the clear = brand, last 4, expiration, ZIP; sealed = the number only', c.ok && c.row.brand === 'Visa' && c.row.last4 === '1111' && c.row.exp === '08/29' && c.row.zip === '65804'
  && JSON.stringify(c.secret) === '{"number":"4111111111111111"}' && !JSON.stringify(c.row).includes('41111111'), c)
c = F.cleanPayment({ ...cardIn, card_number: '4111111111111112', exp: '01/20', zip: '658' }, jan)
ck('a wrong card, an expired date and a short ZIP each say what to fix', !c.ok && c.problems.length === 3 && /card number/.test(c.problems[0]), c)
c = F.cleanPayment({ ...cardIn, cvv: '123' }, jan)
ck('her pick: the 3-digit code is refused, never kept', !c.ok && c.problems.some((p) => /3-digit code/.test(p)))
c = F.cleanPayment({ ...cardIn, all_future: false, agree: false, signer_name: 'Linda' }, jan)
ck('the future-invoices box, the authorize box and a first and last name are required', !c.ok && c.problems.length === 3, c)
const bankIn = { method: 'bank', holder_name: 'Linda Sample', bank_type: 'checking', routing: '101000019', account: '000123456789', phone: '(417) 555-0142', zip: '65804', all_future: true, signer_name: 'Linda Sample', agree: true }
c = F.cleanPayment(bankIn, jan)
ck('a good bank account: checking, last 4 of the account; sealed = routing and account', c.ok && c.row.bank_type === 'checking' && c.row.last4 === '6789' && c.row.phone === '4175550142' && c.secret.routing === '101000019' && c.secret.account === '000123456789', c)
c = F.cleanPayment({ ...bankIn, routing: '101000018', bank_type: '' }, jan)
ck('a bad routing number explains where to find it; checking or savings is required', !c.ok && /bottom left of a check/.test(c.problems[0]) && c.problems.length === 2, c)
ck('the authorization words are hers from the GHL form (Thursday, ends when services stop)', /charge my credit card or bank account for the invoice every Thursday/.test(F.PAY_WORDS) && /ends automatically when services stop/.test(F.PAY_WORDS))
ck('no long dashes in anything the family reads', !/[–—]/.test(F.PAY_WORDS + F.CARD_FEE + JSON.stringify(F.linkMessages({ piece: 'payment', toName: 'Linda Sample', clientName: 'Dorothy Sample', url: 'u', expires: 'Tue, Nov 4' }))))
const m = F.linkMessages({ piece: 'payment', toName: 'Linda Sample', clientName: 'Dorothy Sample', url: 'https://cc.mo-care.com/family-form.html#t=X', expires: 'Tue, Nov 4' })
ck('the text: Hi Linda, the payment form for Dorothy\'s care, the link, until when, the office number', /^Hi Linda, this is Caring Companions\. Here is the payment form for Dorothy's care/.test(m.sms) && m.sms.includes('#t=X') && /Tue, Nov 4/.test(m.sms) && /\(417\) 234-8494/.test(m.sms), m.sms)
ck('who can get it: no consent to texts and no email says so; STOP says so; AxisCare-removed is left out', F.reachOf({ id: 1, name: 'A B', phone: '4175550100', sms_consent: false }).why.includes('no to texts')
  && /STOP/.test(F.reachOf({ id: 2, name: 'A B', phone: '4175550100', sms_consent: true, stopped_at: 'x' }).why) && F.reachOf({ id: 3, axiscare_removed_at: 'x' }) === null && F.reachOf({ id: 4, name: 'Jan M', relationship: 'Neighbor' }).why.includes('No phone or email'))
let cc = F.cleanCircle({ people: [{ id: 'a', name: 'Mark Sample', what: 'change', phone: '417-555-0199' }, { id: 'b', name: 'Rob', what: 'remove' }, { id: 'zz', what: 'remove' }], add: [{ name: 'Jan Miller', relationship: 'Neighbor', phone: '4175550111' }], note: 'Mark moved' }, ['a', 'b'])
ck('circle check: a change, a removal, someone new and a note; a person not in this circle is ignored', cc.ok && cc.result.changes === 4 && cc.result.people.length === 2 && /Mark Sample: phone 4175550199/.test(F.circleSummary(cc.result)) && /add Jan Miller \(Neighbor\)/.test(F.circleSummary(cc.result)), cc)
cc = F.cleanCircle({ add: [{ name: 'Jan', phone: '12' }] }, [])
ck('...a new person needs a last name, and a real phone number', !cc.ok && cc.problems.length === 2, cc)
ck('GUIDE: only "call me" or "not now"', F.cleanGuide({ answer: 'call_me', best_time: 'mornings' }).best_time === 'mornings' && F.cleanGuide({ answer: 'x' }) === null)

// ── the fake database ──
let T, APP, TICK = 0
const uuid = () => crypto.randomUUID()
const reset = () => {
  T = { care_circles: [{ id: 'circ1', axiscare_client_id: '290', client_name: 'Dorothy Sample' }],
    circle_contacts: [{ id: 'linda', circle_id: 'circ1', name: 'Linda Sample', relationship: 'Daughter', phone: '4175550142', email: 'linda@example.com', sms_consent: true, is_primary: true },
      { id: 'mark', circle_id: 'circ1', name: 'Mark Sample', relationship: 'Son', phone: '4175550177', sms_consent: true },
      { id: 'jan', circle_id: 'circ1', name: 'Jan Miller', relationship: 'Neighbor' },
      { id: 'rob', circle_id: 'circ1', name: 'Rob Sample', phone: '4175550188', sms_consent: true, stopped_at: '2026-10-01' },
      { id: 'gone', circle_id: 'circ1', name: 'Old Contact', phone: '4175550100', sms_consent: true, axiscare_removed_at: '2026-09-01' },
      { id: 'other', circle_id: 'circ2', name: 'Someone Else', phone: '4175550155', sms_consent: true }],
    family_sends: [], family_payments: [], family_payment_reveals: [] }
  APP = { ops_settings: { family_send_live: false }, ops_items: [] }
  globalThis.__sent = []; globalThis.__gate = []; globalThis.__night = false; globalThis.__optout = false; globalThis.__ghlFail = false; globalThis.__cron = false
  globalThis.__who = { name: 'Samantha Test', email: 'samantha@mo-care.com', roles: ['owner_admin'] }
}
const UNIQ = { family_sends: ['token_hash'], family_payments: ['send_id'] }
const match = (x, f) => f.every(([op, c, v]) => op === 'eq' ? String(x[c]) === String(v) : op === 'neq' ? String(x[c]) !== String(v) : op === 'is' ? (x[c] ?? null) === v
  : op === 'not_is' ? (x[c] ?? null) !== v : op === 'lt' ? String(x[c]) < String(v) : true)
const q = (t) => { const st = { f: [], op: 'select', ret: false }
  const rows = () => (T[t] || []).filter((x) => match(x, st.f))
  const fin = () => {
    if (t === 'app_data') { const k = st.f.find(([, c]) => c === 'key')[2]; return { data: k in APP ? { data: APP[k] } : null, error: null } }
    if (st.op === 'insert') {
      const r = { id: uuid(), created_at: new Date(Date.now() + (++TICK)).toISOString(), reveals: 0, code_sends: 0, code_tries: 0, ...st.row }
      for (const u of UNIQ[t] || []) if (T[t].some((x) => x[u] === r[u])) return { data: null, error: { code: '23505', message: 'dup' } }
      if (t === 'family_sends' && T[t].some((x) => x.client_ax === r.client_ax && x.piece === r.piece && !x.revoked_at && !x.done_at)) return { data: null, error: { code: '23505', message: 'one live' } }
      T[t].push(r); return { data: [r], error: null } }
    if (st.op === 'update') { const hit = rows(); for (const x of hit) Object.assign(x, st.row); return { data: hit, error: null } }
    const out = rows(); if (st.ord) out.sort((x, y) => String(x[st.ord[0]]).localeCompare(String(y[st.ord[0]])) * (st.ord[1] ? -1 : 1)); return { data: out, error: null } }
  const b = { select() { st.ret = true; return b }, eq(c, v) { st.f.push(['eq', c, v]); return b }, neq(c, v) { st.f.push(['neq', c, v]); return b }, is(c, v) { st.f.push(['is', c, v]); return b },
    not(c, _o, v) { st.f.push(['not_is', c, v]); return b }, lt(c, v) { st.f.push(['lt', c, v]); return b }, order(c, o) { st.ord = [c, o && o.ascending === false]; return b }, limit() { return b },
    insert(row) { st.op = 'insert'; st.row = row; return b }, update(row) { st.op = 'update'; st.row = row; return b },
    single() { const r = fin(); return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] : r.data, error: r.error }) },
    maybeSingle() { const r = fin(); return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] || null) : r.data, error: r.error }) },
    then(ok, no) { return Promise.resolve(fin()).then(ok, no) } }; return b }
globalThis.__db = { from: q, rpc: (fn, x) => { if (fn === 'upsert_app_data_item') { const L = APP[x.target_key] = APP[x.target_key] || []; const i = L.findIndex((y) => y.id === x.item.id); if (i > -1) L[i] = x.item; else L.push(x.item) } return Promise.resolve({ error: null }) } }
const KEK = Buffer.from(crypto.randomBytes(32)).toString('base64')
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_API_KEY: 'g', GHL_LOCATION_ID: 'l', FAMILY_PAY_KEK: KEK }
const handlers = {}
for (const name of ['family-send', 'family-form']) {
  globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handlers[name] = h } }
  const p = write(`${name}/_t.ts`, swap(fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8')))
  await import(p + '?' + Math.random())
}
const call = async (name, body, headers = {}) => { const r = await handlers[name](new Request('https://x/functions/v1/' + name, { method: 'POST', headers: { 'user-agent': 'TestPhone', ...headers }, body: JSON.stringify(body) })); return { s: r.status, j: await r.json() } }
const office = (b) => call('family-send', b), fam = (b) => call('family-form', b)
const tokOf = () => { const sms = globalThis.__sent.filter((x) => x.sender === 'family-send').map((x) => x.body.message || x.body.html).join(' '); const m = /#t=([A-Za-z0-9_-]+)/.exec(sms); return m && m[1] }
const setCode = async (sendId, code) => { const s = T.family_sends.find((x) => x.id === sendId); const h = crypto.createHash('sha256').update(sendId + ':' + code).digest('hex'); Object.assign(s, { code_hash: h, code_expires_at: new Date(Date.now() + 6e5).toISOString(), code_tries: 0 }) }

// ── the office ──
reset(); globalThis.__who = null
let r = await office({ action: 'list', client_ax: '290' }); ck('no sign-in: refused', r.s === 401)
reset(); r = await office({ action: 'list', client_ax: '290' })
ck('list: this circle only, main contact first; STOP and no-way-to-reach say why; AxisCare-removed and other circles left out; numbers masked',
  r.s === 200 && r.j.people.map((p) => p.name).join(',') === 'Linda Sample,Jan Miller,Mark Sample,Rob Sample' && r.j.people[0].main && /No phone or email/.test(r.j.people[1].why) && /STOP/.test(r.j.people[3].why)
  && r.j.people[0].phone === '(417) ***-0142' && !JSON.stringify(r.j).includes('4175550142') && !JSON.stringify(r.j).includes('linda@example.com'), r.j)
ck('...switch off: only an owner can send; the Billing owner is named', r.j.live === false && r.j.can_send === true && r.j.billing_owner === 'billie@mo-care.com')
globalThis.__who = { name: 'Krystal Test', email: 'krystal@mo-care.com', roles: ['care_coordinator'] }
r = await office({ action: 'send', client_ax: '290', piece: 'payment', contact_id: 'linda', channels: ['sms'] })
ck('switch off: a coordinator can\'t send yet, and nothing goes out', r.s === 403 && r.j.outcome === 'off' && !globalThis.__sent.length && !T.family_sends.length)
APP.ops_settings.family_send_live = true
r = await office({ action: 'send', client_ax: '290', piece: 'payment', contact_id: 'other', channels: ['sms'] })
ck('someone from another client\'s circle is refused', r.s === 409 && r.j.outcome === 'not_in_circle')
r = await office({ action: 'send', client_ax: '290', piece: 'payment', contact_id: 'jan', channels: ['sms'] })
ck('someone with no phone or email is refused with the reason', r.s === 409 && /Jan Miller: No phone or email/.test(r.j.error))
r = await office({ action: 'send', client_ax: '290', piece: 'payment', contact_id: 'rob', channels: ['sms'] })
ck('someone who replied STOP is refused', r.s === 409 && /STOP/.test(r.j.error))
r = await office({ action: 'send', client_ax: '290', piece: 'payment', contact_id: 'mark', channels: ['email'] })
ck('a way they can\'t get (Mark has no email) is refused', r.s === 400)
globalThis.__night = true
r = await office({ action: 'send', client_ax: '290', piece: 'payment', contact_id: 'linda', channels: ['sms'] })
ck('outside 8am to 6pm: held, says so, and the link is closed (nothing half-sent)', r.s === 409 && /8am and 6pm/.test(r.j.message) && T.family_sends[0].revoked_at && /held/.test(T.family_sends[0].revoked_by) && !globalThis.__sent.length, r.j)
globalThis.__night = false
r = await office({ action: 'send', client_ax: '290', piece: 'payment', contact_id: 'linda', channels: ['sms'], client_name: 'Dorothy Sample' })
const S1 = T.family_sends.find((x) => !x.revoked_at), t1 = tokOf()
ck('coordinator sends the payment form to Linda by text: family audience, a person pressed it, 7 days, only the hash kept', r.s === 200 && r.j.outcome === 'sent' && globalThis.__gate.some((g) => g.audience === 'family' && g.humanInitiated === true && g.kind === 'reactive_external')
  && t1 && S1.token_hash !== t1 && (Date.parse(S1.expires_at) - Date.now()) > 6.9 * 864e5 && S1.sent_by === 'krystal@mo-care.com' && !JSON.stringify(r.j).includes(t1), r.j)
ck('...the text links to cc.mo-care.com/family-form.html with the secret after #', /https:\/\/cc\.mo-care\.com\/family-form\.html#t=/.test(globalThis.__sent[0].body.message))
r = await office({ action: 'send', client_ax: '290', piece: 'payment', contact_id: 'linda', channels: ['sms'] })
const t2 = tokOf.call(null) && /#t=([A-Za-z0-9_-]+)/.exec(globalThis.__sent.at(-1).body.message)[1]
ck('sending the same piece again replaces the old link', T.family_sends.filter((x) => x.piece === 'payment' && !x.revoked_at).length === 1 && /replaced/.test(S1.revoked_by))
r = await fam({ action: 'open', t: t1 }); ck('the replaced link says so', r.s === 410 && r.j.outcome === 'cancelled')

// ── the family: payment ──
const S2 = T.family_sends.find((x) => x.piece === 'payment' && !x.revoked_at)
r = await fam({ action: 'open', t: 'x'.repeat(10) }); ck('a broken link: not complete', r.s === 400)
r = await fam({ action: 'open', t: t2 })
ck('open: which piece, for Linda, Dorothy\'s first name, the code goes to a masked phone; nothing else', r.s === 200 && r.j.piece === 'payment' && r.j.to_name === 'Linda Sample' && r.j.client_first === 'Dorothy'
  && r.j.options.length === 2 && r.j.options[0].to === '(417) ***-0142' && !JSON.stringify(r.j).includes('290') && S2.opened_at, r.j)
r = await fam({ action: 'submit', t: t2, s: 'y'.repeat(43), ...cardIn }); ck('no code checked: nothing is accepted', r.s === 401)
r = await fam({ action: 'code', t: t2, via: 'sms' })
ck('a code is texted to the same phone', r.s === 200 && globalThis.__sent.at(-1).sender === 'family-form-code' && /Your Caring Companions code is \d{6}/.test(globalThis.__sent.at(-1).body.message))
r = await fam({ action: 'verify', t: t2, code: '000000' }); ck('a wrong code: tries left', r.s === 400 && /tries left/.test(r.j.error))
await setCode(S2.id, '123456')
r = await fam({ action: 'verify', t: t2, code: '123 456' }); const s2 = r.j.s
ck('the right code opens a session with the authorization words and the card fee', r.s === 200 && s2 && /every Thursday/.test(r.j.data.words) && /3%/.test(r.j.data.card_fee))
r = await fam({ action: 'submit', t: t2, s: s2, ...cardIn, card_number: '4111111111111112' })
ck('a wrong card number comes back to fix, nothing saved', r.s === 422 && /card number/.test(r.j.problems[0]) && !T.family_payments.length)
r = await fam({ action: 'submit', t: t2, s: s2, ...cardIn })
const P1 = T.family_payments[0]
ck('signed: the card is SEALED (no number anywhere in the clear), last 4 kept, the link is done', r.s === 200 && r.j.label === 'Visa ending 1111' && P1 && /^v1\./.test(P1.sealed)
  && !JSON.stringify(P1).replace(P1.sealed, '').includes('4111111111111111') && !JSON.stringify(T.family_sends).includes('4111111111111111') && S2.done_at && !S2.session_hash, P1)
const card = APP.ops_items.find((x) => x.kind === 'family_payment')
ck('...a card for the Billing owner on My Work: "Payment form back from Linda Sample: enter it in AxisCare", last 4 only', card && card.owner === 'billie@mo-care.com' && /Payment form back from Linda Sample: enter it in AxisCare/.test(card.title)
  && /Visa ending 1111/.test(card.detail) && !JSON.stringify(card).includes('41111111') && card.client_ax === '290', card)
r = await fam({ action: 'open', t: t2 }); ck('the link can\'t be used again', r.j.state === 'done')

// ── the office: show, entered ──
r = await office({ action: 'list', client_ax: '290' })
const pv = r.j.sends.find((x) => x.piece === 'payment' && x.payment)?.payment
ck('the Hub card sees the form with last 4 only, still locked, when it erases itself', pv && pv.last4 === '1111' && pv.locked === true && pv.erase_by && !JSON.stringify(r.j).includes('4111111111111111'), pv)
ck('...a care coordinator can press Show', r.j.can_show === true)
globalThis.__who = { name: 'Stacy Staffing', email: 'stacy@mo-care.com', roles: ['staffing_coordinator'] }
r = await office({ action: 'list', client_ax: '290' }); ck('...a staffing coordinator can\'t', r.j.can_show === false)
r = await office({ action: 'show', payment_id: P1.id }); ck('a staffing coordinator\'s Show is refused, nothing logged', r.s === 403 && !T.family_payment_reveals.length)
globalThis.__who = { name: 'Billie Billing', email: 'billie@mo-care.com', roles: ['staffing_coordinator'] }
r = await office({ action: 'list', client_ax: '290' }); ck('...but the Billing owner can, whatever their role', r.j.can_show === true)
globalThis.__who = { name: 'Krystal Test', email: 'krystal@mo-care.com', roles: ['care_coordinator'] }
r = await office({ action: 'show', payment_id: P1.id })
ck('a care coordinator\'s Show: the full number, once, for 5 minutes; logged with who', r.s === 200 && r.j.number === '4111111111111111' && r.j.seconds === 300 && T.family_payment_reveals.length === 1 && T.family_payment_reveals[0].by_email === 'krystal@mo-care.com' && P1.reveals === 1, r.j)
r = await office({ action: 'entered', payment_id: P1.id })
ck('"Entered in AxisCare": the numbers are erased for good, who and when kept, the card closes', r.s === 200 && P1.sealed === null && P1.erased_why === 'entered' && P1.entered_by === 'Krystal Test' && APP.ops_items.find((x) => x.kind === 'family_payment').status === 'done')
r = await office({ action: 'show', payment_id: P1.id }); ck('...after that, Show says they were erased', r.s === 410 && /already erased/.test(r.j.error))

// ── the hourly erase ──
globalThis.__who = { name: 'Samantha Test', email: 'samantha@mo-care.com', roles: ['owner_admin'] }
r = await office({ action: 'send', client_ax: '290', piece: 'payment', contact_id: 'linda', channels: ['sms'] })
const S3 = T.family_sends.find((x) => x.piece === 'payment' && !x.revoked_at && !x.done_at), t3 = /#t=([A-Za-z0-9_-]+)/.exec(globalThis.__sent.at(-1).body.message)[1]
await setCode(S3.id, '222222'); r = await fam({ action: 'verify', t: t3, code: '222222' })
r = await fam({ action: 'submit', t: t3, s: r.j.s, ...bankIn })
const P2 = T.family_payments.find((x) => x.method === 'bank')
ck('a bank account: sealed routing and account, "Checking account ending 6789"', r.s === 200 && r.j.label === 'Checking account ending 6789' && P2.sealed && !JSON.stringify(P2).replace(P2.sealed, '').includes('000123456789'))
P2.signed_at = new Date(Date.now() - 8 * 864e5).toISOString()
r = await office({ action: 'sweep' }); ck('the hourly job needs its own secret', r.s === 401)
globalThis.__cron = true; r = await office({ action: 'sweep' }); globalThis.__cron = false
const card2 = APP.ops_items.find((x) => x.id === F.cardId('pay', S3.id))
ck('7 days without "Entered": erased by the job, the card turns urgent and says to send a new form', r.j.erased === 1 && P2.sealed === null && P2.erased_why === 'seven_days' && card2.urgency === 'urgent' && /send Linda Sample a new payment form/.test(card2.next_action), card2)

// ── the circle check and GUIDE ──
r = await office({ action: 'send', client_ax: '290', piece: 'circle', contact_id: 'mark', channels: ['sms'] })
const S4 = T.family_sends.find((x) => x.piece === 'circle'), t4 = /#t=([A-Za-z0-9_-]+)/.exec(globalThis.__sent.at(-1).body.message)[1]
ck('the circle check text: who we keep in touch with about Dorothy\'s care', /who we keep in touch with about Dorothy's care/.test(globalThis.__sent.at(-1).body.message))
await setCode(S4.id, '333333'); r = await fam({ action: 'verify', t: t4, code: '333333' })
ck('...after the code: the circle\'s people (not STOP, not AxisCare-removed, not another client\'s)', r.j.data.people.map((p) => p.name).join(',') === 'Linda Sample,Mark Sample,Jan Miller', r.j.data)
r = await fam({ action: 'submit', t: t4, s: r.j.s, people: [{ id: 'linda', what: 'keep' }, { id: 'mark', name: 'Mark Sample', what: 'change', email: 'mark@example.com' }], add: [], note: '' })
const cc1 = APP.ops_items.find((x) => x.kind === 'family_circle_check')
ck('a change: saved, and a card for the client care owner to update Family & Contacts (nothing changed by itself)', r.s === 200 && r.j.changes === 1 && cc1 && cc1.owner === 'krystal@mo-care.com' && /Mark Sample: email mark@example.com/.test(cc1.detail)
  && !T.circle_contacts.find((x) => x.id === 'mark').email, cc1)
r = await office({ action: 'send', client_ax: '290', piece: 'guide', contact_id: 'linda', channels: ['email'] })
const S5 = T.family_sends.find((x) => x.piece === 'guide'), t5 = /#t=([A-Za-z0-9_-]+)/.exec(globalThis.__sent.at(-1).body.html)[1]
ck('GUIDE by email: the subject names the program', globalThis.__sent.at(-1).body.subject === 'Medicare GUIDE: respite for families living with dementia')
await setCode(S5.id, '444444'); r = await fam({ action: 'verify', t: t5, code: '444444' })
r = await fam({ action: 'submit', t: t5, s: r.j.s, answer: 'call_me', best_time: 'after 3pm' })
ck('"Yes, call me about it": a card to call back, with the best time', r.s === 200 && /Linda Sample wants a call about Medicare GUIDE/.test(APP.ops_items.find((x) => x.kind === 'family_guide_call')?.title) && /after 3pm/.test(APP.ops_items.find((x) => x.kind === 'family_guide_call')?.detail))
r = await office({ action: 'list', client_ax: '290' })
ck('the Hub history shows every send newest first, with what came back for the circle and GUIDE', r.j.sends[0].piece === 'guide' && r.j.sends[0].result.answer === 'call_me' && r.j.sends.some((x) => x.piece === 'circle' && x.result.changes === 1))
r = await office({ action: 'cancel', id: S5.id }); ck('a finished link can\'t be cancelled', r.s === 409)
// the Desktop step's proof: a send row it makes itself (sent_by 'desktop-proof') signs and seals like a real one, with no card
const before = APP.ops_items.length, ptok = 'P'.repeat(43)
T.family_sends.push({ id: uuid(), client_ax: '290', client_name: 'Practice Client', piece: 'payment', contact_id: uuid(), token_hash: crypto.createHash('sha256').update(ptok).digest('hex'), to_name: 'Practice Person',
  to_phone: '4175550100', channels: ['sms'], sent: {}, sent_by: 'desktop-proof', created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 864e5).toISOString(), code_sends: 0, code_tries: 0 })
const PS = T.family_sends.at(-1); await setCode(PS.id, '555555'); r = await fam({ action: 'verify', t: ptok, code: '555555' })
r = await fam({ action: 'submit', t: ptok, s: r.j.s, ...cardIn })
ck('the Desktop proof: signed and sealed, and no card on anyone\'s My Work', r.s === 200 && T.family_payments.some((x) => x.send_id === PS.id && /^v1\./.test(x.sealed)) && APP.ops_items.length === before)

// ── nothing for the browser ──
const sql = fs.readFileSync('family_send.sql', 'utf8')
ck('the tables are server only (RLS on, no browser privileges); the reveal log is append-only; the switch is added OFF', /revoke all on public.family_sends, public.family_payments, public.family_payment_reveals from anon, authenticated/.test(sql)
  && /family_payment_reveals_keep before update or delete/.test(sql) && /"family_send_live": false/.test(sql) && !/family_send_live": true/.test(sql))
ck('erased means erased: the database refuses numbers and an erase date together, or neither', /check \(\(sealed is null\) = \(erased_at is not null\)\)/.test(sql))
ck('no 3-digit card code column anywhere', !/cvv|cvc|security_code/i.test(sql))

for (const [n, ok, d] of res) console.log((ok ? '✓ ' : '✗ ') + n + (ok ? '' : '\n     ' + d))
const pass = res.filter((x) => x[1]).length
console.log(`${pass}/${res.length} passed`)
process.exitCode = pass === res.length ? 0 : 1
