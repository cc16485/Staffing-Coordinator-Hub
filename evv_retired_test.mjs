// 2026-10-17 · the EVV correction form is retired (Samantha: "just have the policy that we call the client to confirm a
// caregivers time or arrival departure if they didnt clock out"). The two public pages older texts link to only say
// so: no script, no form, nothing saved or sent. No sender links to them any more.   node evv_retired_test.mjs
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 600)])
const DASH = /[—―]/
for (const f of ['evv-correction-form.html', 'evv-client-sign.html']) {
  const h = fs.readFileSync(f, 'utf8')
  ck(`${f} · no script, no form, no Supabase: it only explains`, !/<script|<form|<input|<textarea|<canvas|supabase|createClient/i.test(h), f)
  ck(`${f} · gives the office number`, /tel:4172348494/.test(h) && /\(417\) 234-8494/.test(h))
  ck(`${f} · no em dash, not indexed`, !DASH.test(h) && /noindex/.test(h))
}
ck('the caregiver page says the form is no longer used and to call the office', /We no longer use this form/.test(fs.readFileSync('evv-correction-form.html', 'utf8')))
ck('the client page asks nothing of the client', /There is nothing to sign/.test(fs.readFileSync('evv-client-sign.html', 'utf8')))
const FN = 'supabase/functions'
const senders = fs.readdirSync(FN).filter((d) => fs.existsSync(`${FN}/${d}/index.ts`)).filter((d) => /sc\.mo-care\.com\/evv-(correction-form|client-sign)/.test(fs.readFileSync(`${FN}/${d}/index.ts`, 'utf8')))
ck('no function sends a link to either page any more', senders.length === 0, senders)
const ct = fs.readFileSync(`${FN}/_shared/confirm-times.ts`, 'utf8')
ck('the call card never contacts anyone: no send, no fetch in its builder', !/fetch\(|ghlSend|contactForOutbound|textAdmin/.test(ct) && !DASH.test(ct))
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
