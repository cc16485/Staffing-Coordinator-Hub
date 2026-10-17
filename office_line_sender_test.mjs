// Every Hub text names its sender: Missouri texts go out from the office line (417) 234-8494, Oklahoma texts keep the
// Oklahoma number. Samantha 2026-10-17: "We REALLY want to make sure that everything calls and texts are being sent out
// from 417-234-8494" (texts were going out from Krystal's 647-4127). node office_line_sender_test.mjs
import fs from 'fs'; import path from 'path'
const FN = 'supabase/functions'; const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 500)])
const of = await import(path.join(process.cwd(), FN, '_shared/office-from.ts'))
const sp = await import(path.join(process.cwd(), FN, '_shared/send-problems.ts'))

ck('the office line is (417) 234-8494', of.MO_FROM === '+14172348494')
ck('a text with no sender gets the office line', of.officeSms({ message: 'hi' }).fromNumber === '+14172348494')
ck('an Oklahoma sender is kept', of.officeSms({ message: 'hi', fromNumber: '+14055001758' }).fromNumber === '+14055001758')
ck('Missouri applicants: the office line is named', of.fromFor('MO', {}).fromNumber === '+14172348494' && of.fromFor(undefined, {}).fromNumber === '+14172348494')
const ok = of.fromFor('OK', { ok_from_number: '4055001758' })
ck('Oklahoma applicants: still the Oklahoma number', ok.fromNumber === '+14055001758')
ck('Oklahoma with no number: still refused, never sent from 417', !of.fromFor('OK', {}).fromNumber && of.fromFor('OK', {}).refuse)
ck('smsBody for Missouri now names the office line', of.smsBody(of.fromFor('MO', {}), { message: 'x' }).fromNumber === '+14172348494')

// the shared send helper (used by ~50 functions)
const SENT = []; const fake = async (url, o) => { SENT.push(JSON.parse(o.body)); return new Response('{}', { status: 200 }) }
const db = { rpc: async () => ({ data: null, error: null }), from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }
await sp.ghlSendChecked(db, {}, 't', { channel: 'sms', contactId: 'C1' }, { message: 'hello' }, fake)
ck('a text through ghlSendChecked goes out from the office line', SENT[0]?.type === 'SMS' && SENT[0]?.fromNumber === '+14172348494', SENT[0])
await sp.ghlSendChecked(db, {}, 't', { channel: 'sms', contactId: 'C1' }, { message: 'hello', fromNumber: '+14055001758' }, fake)
ck('an Oklahoma text through ghlSendChecked keeps its number', SENT[1]?.fromNumber === '+14055001758', SENT[1])
await sp.ghlSendChecked(db, {}, 't', { channel: 'email', contactId: 'C1' }, { subject: 's', html: 'h' }, fake)
ck('emails are unchanged (no phone number on an email)', SENT[2]?.type === 'Email' && !('fromNumber' in SENT[2]), SENT[2])

// every text the functions send directly names the office line
const files = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name)
  if (e.isDirectory()) walk(p); else if (p.endsWith('.ts') && !/_t\.ts$|test/.test(p)) files.push(p) } }
walk(FN)
const bare = []
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8')
  s.split('\n').forEach((l, i) => { if (/type: ?['"]SMS['"]\s*,/.test(l) && !/fromNumber/.test(l)) bare.push(`${f}:${i + 1}`) })
}
ck('no direct text send without a named sender', bare.length === 0, bare)
for (const f of ['ops-escalate', 'coverage-run', 'team-ask', 'kind-tell', 'applicant-invite', 'send-candidate-message', 'reference-send']) {
  const s = fs.readFileSync(`${FN}/${f}/index.ts`, 'utf8')
  ck(`${f}: imports the office line`, /import \{ MO_FROM \} from '\.\.\/_shared\/office-from\.ts'/.test(s))
}
ck('no em dash added', !fs.readFileSync(`${FN}/_shared/office-from.ts`, 'utf8').includes('—'))

let fails = 0; for (const [n, okk, note] of res) { console.log((okk ? 'PASS  ' : 'FAIL  ') + n + (okk ? '' : '  ' + note)); if (!okk) fails++ }
console.log(`\n${res.length - fails}/${res.length} passed`); process.exit(fails ? 1 : 0)
