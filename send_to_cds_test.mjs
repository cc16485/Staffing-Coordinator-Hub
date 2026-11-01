// send-to-cds: the REAL function against a fake database, a fake CDS and a fake GoHighLevel.
// CDS first; if CDS does not take them nothing else changes; then tag swap and workflows. node send_to_cds_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
let src = fs.readFileSync('supabase/functions/send-to-cds/index.ts', 'utf8')
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/^import \{ requireStaff, OFFICE_ROLES \} from .*$/m, 'const OFFICE_ROLES = []; const requireStaff = async () => globalThis.__who')
const tmp = path.join(process.cwd(), '_send_to_cds_under_test.ts'); fs.writeFileSync(tmp, src)
let handler; const env = { SUPABASE_URL: 'http://sb', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'ghl', CC_HANDOFF_SECRET: 's'.repeat(40) }
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
const M = await import(tmp); fs.unlinkSync(tmp)

let T, CALLS, CDS
const reset = () => {
  T = { app_data: { leads: [{ id: 'L1', first_name: 'Kim', last_name: 'Lee', relationship: 'Daughter', client_first_name: 'Ann', client_last_name: 'Lee', phone: '417-555-1234',
          client_city: 'Nixa', why_called: 'Mom has Medicaid, wants CDS', interest_notes: 'Call after 3', ghl_contact_id: 'ccC1', from_calls: [{ message_id: 'm1', at: '2026-11-01T15:00:00Z' }] },
        { id: 'L2', first_name: 'Bo', phone: '4175550000' }],
      ops_settings: { cds_handoff_stop_workflows: [{ id: 'wf-aaaaaaaa', name: 'New lead follow up' }, 'bad id!'] } },
    call_task_reading: [{ message_id: 'msgCall1', detail: { summary: 'Asked about CDS for her husband.' } }] }
  CALLS = []; CDS = { ok: true, added: true, id: 'x', name: 'Ann Lee' }
  globalThis.__who = { ok: true, name: 'Krystal Smith', email: 'krystal@mo-care.com', roles: ['care_coordinator'] }
}
const q = (table) => { const f = {}; const b = { select: () => b, eq: (k, v) => { f[k] = v; return b }, order: () => b, limit: () => b,
  maybeSingle: async () => table === 'app_data' ? { data: f.key in T.app_data ? { data: T.app_data[f.key] } : null } : { data: T[table].find((r) => r.message_id === f.message_id) || null } }; return b }
globalThis.__db = { from: q }
globalThis.fetch = async (url, o = {}) => {
  url = String(url); const body = o.body ? JSON.parse(o.body) : null; CALLS.push({ url, method: o.method || 'GET', body, headers: o.headers })
  const R = (j, s = 200) => new Response(JSON.stringify(j), { status: s })
  if (url.includes('cds-from-cc')) return CDS === 'down' ? R({ error: 'boom' }, 500) : R(body.check ? { ok: true, check: true } : CDS)
  if (url.includes('/conversations/messages/msgCall1')) return R({ message: { messageType: 'TYPE_CALL', contactId: 'ccC9', dateAdded: '2026-11-01T14:00:00Z' } })
  if (url.endsWith('/contacts/ccC9')) return R({ contact: { firstName: 'Pat', lastName: 'Ray', phone: '+14175559999' } })
  if (url.includes('/tags') || url.includes('/workflow/')) return R({})
  return R({}, 404)
}
const send = async (b) => { const r = await handler(new Request('http://x', { method: 'POST', body: JSON.stringify(b) })); return { s: r.status, j: await r.json() } }
const cdsCall = () => CALLS.find((c) => c.url.includes('cds-from-cc'))
const ghlCalls = () => CALLS.filter((c) => c.url.includes('leadconnectorhq') && c.method !== 'GET')

// ---------- a lead ----------
reset()
let r = await send({ lead_id: 'L1' })
ck('a lead: ok', r.s === 200 && r.j.ok && r.j.cds.added, r)
const b = cdsCall().body
ck('CDS gets the person who needs care, the caller, the call and the notes', b.cc_id === 'lead_L1' && b.first_name === 'Ann' && b.last_name === 'Lee' && b.caller_name === 'Kim Lee'
  && b.relationship === 'Daughter' && /Ann Lee \(their daughter\)/.test(b.who_needs_care) && b.town === 'Nixa' && b.summary === 'Mom has Medicaid, wants CDS' && b.notes === 'Call after 3'
  && b.call_at === '2026-11-01T15:00:00Z' && b.sent_by === 'Krystal Smith' && b.phone === '417-555-1234', b)
ck('the secret goes in the header, never the body', cdsCall().headers['x-cc-handoff'] === 's'.repeat(40) && !JSON.stringify(b).includes('ssss'))
const g = ghlCalls().map((c) => c.method + ' ' + c.url.replace('https://services.leadconnectorhq.com', '') + (c.body ? ' ' + JSON.stringify(c.body) : ''))
ck('GoHighLevel: "sent to cds" on, "lead" off, out of the listed workflow, nothing else', JSON.stringify(g) === JSON.stringify([
  'POST /contacts/ccC1/tags {"tags":["sent to cds"]}', 'DELETE /contacts/ccC1/tags {"tags":["lead"]}', 'DELETE /contacts/ccC1/workflow/wf-aaaaaaaa']), g)
ck('nothing is sent to anyone (no message, no conversation call)', !CALLS.some((c) => /conversations\/messages$|\/messages\b(?!\/msg)/.test(c.url) && c.method === 'POST'))
ck('every part reported', r.j.ghl.done.length === 3 && r.j.ghl.problems.length === 0 && r.j.ghl.workflows_listed === 1, r.j)

// ---------- CDS did not take them: nothing else changes ----------
reset(); CDS = 'down'
r = await send({ lead_id: 'L1' })
ck('CDS down: refused, says nothing changed', r.s === 502 && /Nothing was changed/.test(r.j.error) && /\(417\) 218-2888/.test(r.j.error), r)
ck('CDS down: GoHighLevel untouched', ghlCalls().length === 0, ghlCalls())

// ---------- already a CDS lead ----------
reset(); CDS = { ok: true, added: false, already: { kind: 'lead', name: 'Ann Lee' } }
r = await send({ lead_id: 'L1' })
ck('already on CDS Leads: reported, Caring Companions follow-up still stopped', r.j.ok && r.j.cds.already.kind === 'lead' && ghlCalls().length === 3, r.j)

// ---------- a GoHighLevel step fails ----------
reset()
const f0 = globalThis.fetch; globalThis.fetch = async (u, o) => String(u).includes('/workflow/') ? new Response('{}', { status: 422 }) : f0(u, o)
r = await send({ lead_id: 'L1' })
ck('a failed step is named, the rest still done', r.j.ok && r.j.ghl.problems.length === 1 && /workflow wf-aaaaaaaa: GoHighLevel answered 422/.test(r.j.ghl.problems[0]) && r.j.ghl.done.length === 2, r.j)
globalThis.fetch = f0

// ---------- a lead with no GoHighLevel contact ----------
reset()
r = await send({ lead_id: 'L2' })
ck('no contact: CDS still gets them, nothing to stop in GoHighLevel, said so', r.j.ok && ghlCalls().length === 0 && /nothing to stop/.test(r.j.ghl.none), r.j)

// ---------- a call with no lead ----------
reset()
r = await send({ message_id: 'msgCall1' })
const c = cdsCall().body
ck('a call: contact and the call reader summary', r.j.ok && c.cc_id === 'call_msgCall1' && c.first_name === 'Pat' && c.phone === '+14175559999' && c.summary === 'Asked about CDS for her husband.' && c.call_at === '2026-11-01T14:00:00Z', c)
ck('a call: tags on that call\'s contact', ghlCalls()[0].url.includes('/contacts/ccC9/tags'))

// ---------- the door ----------
reset(); globalThis.__who = { ok: false, status: 403, error: 'Office staff only.' }
ck('not office staff: refused', (await send({ lead_id: 'L1' })).s === 403 && !cdsCall())
reset(); ck('unknown lead: 404', (await send({ lead_id: 'nope' })).s === 404 && !cdsCall())
reset(); ck('no id: 400', (await send({ message_id: 'x' })).s === 400)
reset(); ck('check is owners only', (await send({ action: 'check' })).s === 403)
reset(); globalThis.__who.roles = ['owner_admin']; r = await send({ action: 'check' })
ck('check: CDS reachable, workflows listed (bad ids dropped)', r.j.cds.check === true && JSON.stringify(r.j.stop_workflows) === '["wf-aaaaaaaa"]', r.j)
reset(); env.CC_HANDOFF_SECRET = ''; ck('no secret: not set up, nothing sent', (await send({ lead_id: 'L1' })).s === 500 && !cdsCall()); env.CC_HANDOFF_SECRET = 's'.repeat(40)

let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '\n     ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
