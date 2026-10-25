// ghl-voice-probe (1114): owner only; three GETs to GoHighLevel, nothing else; finds the office number and the Voice AI agents.
// node ghl_voice_probe_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1200)])
let CALLS = [], MODE = 'ok'
globalThis.fetch = async (url, o) => { url = String(url); CALLS.push({ url, method: (o && o.method) || 'GET', version: o?.headers?.Version })
  if (MODE === 'scopes' && /voice-ai|phone-system/.test(url)) return new Response(JSON.stringify({ message: 'The token is not authorized for this scope.' }), { status: 401 })
  if (/\/locations\//.test(url)) return new Response(JSON.stringify({ location: { name: 'Caring Companions', phone: '+14172348494', timezone: 'America/Chicago' } }), { status: 200 })
  if (/phone-system\/numbers\/location/.test(url)) return new Response(JSON.stringify({ numbers: [{ phoneNumber: '+14172348494', friendlyName: 'Office', capabilities: { voice: true, sms: true }, type: 'local', isDefaultNumber: true }, { phoneNumber: '+14175550000', capabilities: { voice: true } }] }), { status: 200 })
  if (/voice-ai\/agents/.test(url)) { if (o?.headers?.Version === '2021-04-15' && MODE === 'v2') return new Response('{"message":"bad version"}', { status: 400 })
    return new Response(JSON.stringify({ agents: [{ id: 'ag1', agentName: 'Receptionist', inboundNumber: '+14172348494', voiceId: 'v1' }] }), { status: 200 }) }
  return new Response('{}', { status: 404 }) }
const ENV = { GHL_TOKEN: 'pit-xyz', GHL_LOCATION_ID: 'loc1' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
await import(path.join(FN, 'ghl-voice-probe/index.ts'))
const jwt = (role) => 'x.' + Buffer.from(JSON.stringify({ role })).toString('base64') + '.y'
const call = async (role) => { const r = await handler(new Request('https://x/', { method: 'POST', headers: { Authorization: 'Bearer ' + jwt(role) }, body: '{}' })); return [r.status, await r.json()] }
let [s, j] = await call('anon')
ck('a public caller is refused, and GoHighLevel is never asked', s === 403 && !CALLS.length)
;[s, j] = await call('service_role')
ck('owner: the office number (417) 234-8494 is found on the location, with voice', s === 200 && j.numbers.office_found === true && j.numbers.list[0].is_office && j.numbers.list[0].capabilities.voice === true, j.numbers)
ck('owner: the business phone and time zone are read', j.location.business_phone_is_office === true && j.location.timezone === 'America/Chicago', j.location)
ck('owner: the Voice AI agents are listed, with whether one is on the office number', j.agents.count === 1 && j.agents.list[0].name === 'Receptionist' && j.agents.list[0].on_office_number === true, j.agents)
ck('READ ONLY: only GET requests, only to GoHighLevel, three of them', CALLS.length === 3 && CALLS.every((c) => c.method === 'GET' && c.url.startsWith('https://services.leadconnectorhq.com/')), CALLS)
CALLS = []; MODE = 'v2'; ;[s, j] = await call('service_role')
ck('the Voice AI version header: if the first is refused, the other is tried (still GET only)', j.agents.status === 200 && CALLS.filter((c) => /voice-ai/.test(c.url)).length === 2 && CALLS.every((c) => c.method === 'GET'), CALLS)
CALLS = []; MODE = 'scopes'; ;[s, j] = await call('service_role')
ck('a missing permission is reported with its status and message, never hidden', j.numbers.status === 401 && /not authorized/.test(j.numbers.error) && j.agents.status === 401 && j.numbers.office_found === false, j)
for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`)
