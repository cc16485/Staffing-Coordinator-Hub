// ai-draft-careplan (2026-10-14): the visit builds on the draft the phone calls started, and the plan has a narrative.
// The REAL function against a fake sign-in and a fake AI. node ai_draft_careplan_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 600)])
let SENT = null
globalThis.__sb = { auth: { getUser: async () => ({ data: { user: { id: 'u', app_metadata: globalThis.__meta ?? { hub_access: ['care_coordinator'] } } }, error: null }) } }
globalThis.fetch = async (url, o) => { SENT = JSON.parse(o.body)
  return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'submit_care_plan_draft', input: { adl_needs: 'Shower help', narrative: 'Margaret is 85.' } }] }), { status: 200 }) }
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_ANON_KEY: 'a', ANTHROPIC_API_KEY: 'k' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_adc_'))
try {
  const src = fs.readFileSync(path.join(F, 'ai-draft-careplan/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__sb')
  fs.writeFileSync(path.join(tmp, 'a.ts'), src); await import(path.join(tmp, 'a.ts'))
  const call = async (b) => { const r = await handler(new Request('https://x/f', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify(b) })); return { status: r.status, j: await r.json() } }
  let r = await call({ transcript_text: 'Visit notes', client_name: 'Margaret', earlier: { fields: { adl_needs: 'Standby showering' }, narrative: 'From the call.' } })
  const msg = SENT.messages[0].content
  ck('the call draft goes to the AI as what the phone calls already told us, to keep, add to and correct', /What the phone calls already told us[\s\S]*Standby showering[\s\S]*From the call\./.test(msg) && /Visit notes/.test(msg), msg.slice(0, 400))
  ck('the plan now asks for a narrative', SENT.tools[0].input_schema.required.includes('narrative'))
  ck('the answer comes back as before, with the narrative', r.status === 200 && r.j.narrative === 'Margaret is 85.', r.j)
  r = await call({ transcript_text: 'Visit notes', client_name: 'Margaret' })
  ck('with no call draft it works exactly as before', !/phone calls already told us/.test(SENT.messages[0].content) && r.status === 200)
  globalThis.__meta = {}; SENT = null
  r = await call({ transcript_text: 'Visit notes', client_name: 'Margaret' })
  ck('760b: a sign-in with no hub list is refused (403) and nothing goes to the AI', r.status === 403 && SENT === null, r.status)
  globalThis.__meta = { hub_access: ['staffing'] }
  r = await call({ transcript_text: 'Visit notes', client_name: 'Margaret' })
  ck('a sign-in without the Care Coordinator Hub is refused (403)', r.status === 403 && SENT === null, r.status)
  globalThis.__meta = undefined
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
