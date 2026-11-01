// =============================================================================
// send-to-cds · "Send to Caring CDS" on a lead or a call (Samantha 2026-11-01)
// =============================================================================
// Her words: "We have many people calling our Caring Companions In-Home Senior Care number 417-234-8494 but are
// interested in the CDS program, so we need to be able to send leads to the CDS subaccount - and make sure they don't
// get the lead follow up that happens in the Caring Companions In-Home Senior Care subaccount in ghl". Her picks: a
// person clicks (the Hub only hints "Sounds like CDS"); she adds the GoHighLevel workflow filters herself from a list.
//
//   send {lead_id} | {message_id}   1. CDS first: the person, the call summary and the notes go to the CDS project
//                                      (cds-from-cc, header x-cc-handoff = CC_HANDOFF_SECRET). CDS alerts its own office,
//                                      adds the CDS GoHighLevel contact and a note. If CDS did not take them, NOTHING
//                                      else happens, so nobody loses Caring Companions follow-up without CDS having them.
//                                   2. Caring Companions GoHighLevel contact: tag "lead" off, tag "sent to cds" on, and
//                                      out of each workflow listed in ops_settings.cds_handoff_stop_workflows.
//                                   Every part is reported; a part that failed says so (the Hub shows it and offers
//                                   Try again, which is safe: CDS adds a person once).
//   check                           installer only: is CDS reachable with the secret, which workflows will be stopped.
//
// Office roles only, from the person's own Hub sign-in. Never texts, emails or calls anyone. The Hub itself closes the
// lead as "Referred to Caring CDS" after this answers, the same way the Leads board always has.
// Deploy: supabase functions deploy send-to-cds --project-ref zngsgedlsxinbygwmxwn --no-verify-jwt (the staff check is
// done here, like call-to-lead).
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const GHL = 'https://services.leadconnectorhq.com'
const CDS_URL = 'https://siivpekcaryeyttszwav.supabase.co/functions/v1/cds-from-cc'
export const TAG_OFF = 'lead', TAG_ON = 'sent to cds'
const H = (tok: string, v = '2021-07-28') => ({ Authorization: `Bearer ${tok}`, Version: v, Accept: 'application/json', 'Content-Type': 'application/json' })
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const okId = (s: string) => /^[A-Za-z0-9_-]{1,64}$/.test(s)
// deno-lint-ignore no-explicit-any
type Any = any

/** What CDS gets about a Caring Companions lead: the person who needs care when we know them, else the caller. */
export function fromLead(l: Any, sentBy: string): Any {
  const cf = clip(l.client_first_name, 60), cl = clip(l.client_last_name, 60)
  const caller = [clip(l.first_name, 60), clip(l.last_name, 60)].filter(Boolean).join(' ')
  const self = /^(self|myself|client|themselves)$/i.test(clip(l.relationship, 40))
  return {
    cc_id: 'lead_' + clip(l.id, 70), first_name: cf || clip(l.first_name, 60), last_name: cf ? cl : clip(l.last_name, 60),
    phone: clip(l.phone, 30) || clip(l.client_phone, 30), email: clip(l.email, 120),
    caller_name: caller, relationship: self ? '' : clip(l.relationship, 40),
    who_needs_care: self ? 'Themselves' : cf ? [cf, cl].filter(Boolean).join(' ') + (l.relationship ? ' (their ' + clip(l.relationship, 30).toLowerCase() + ')' : '') : '',
    county: clip(l.client_county || l.county, 60), town: clip(l.client_city, 60),
    call_at: clip((Array.isArray(l.from_calls) && l.from_calls.length ? l.from_calls[l.from_calls.length - 1]?.at : '') || l.created_at, 40),
    summary: clip(l.why_called, 600), notes: clip(l.interest_notes, 1500), sent_by: clip(sentBy, 80),
  }
}

/** What CDS gets about a call that has no lead: the GoHighLevel contact and the call reader's summary. */
export function fromCall(id: string, ct: Any, at: string, summary: string, sentBy: string): Any {
  return { cc_id: 'call_' + id, first_name: clip(ct.firstName, 60), last_name: clip(ct.lastName, 60), phone: clip(ct.phone, 30), email: clip(ct.email, 120),
    caller_name: [clip(ct.firstName, 60), clip(ct.lastName, 60)].filter(Boolean).join(' '), call_at: clip(at, 40), summary: clip(summary, 1500), sent_by: clip(sentBy, 80) }
}

/** The workflows to take them out of: ops_settings.cds_handoff_stop_workflows, ids only. */
export function stopList(ops: Any): string[] {
  const v = ops && ops.cds_handoff_stop_workflows
  return (Array.isArray(v) ? v : []).map((x: Any) => String(x && typeof x === 'object' ? x.id : x)).filter((x: string) => /^[A-Za-z0-9-]{8,64}$/.test(x)).slice(0, 40)
}

async function cds(secret: string, body: Any): Promise<Any> {
  try {
    const r = await fetch(CDS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cc-handoff': secret }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j?.ok) return { ok: false, error: (j && j.error) ? 'CDS said: ' + clip(j.error, 160) : `CDS answered ${r.status}` }
    return j
  } catch { return { ok: false, error: 'could not reach CDS' } }
}

async function ghlCleanup(tok: string, contactId: string, stop: string[]): Promise<{ done: string[]; problems: string[] }> {
  const done: string[] = [], problems: string[] = []
  const step = async (what: string, url: string, method: string, body?: unknown) => {
    try {
      const r = await fetch(url, { method, headers: H(tok), ...(body ? { body: JSON.stringify(body) } : {}) })
      if (r.ok || (method === 'DELETE' && r.status === 404)) done.push(what)
      else problems.push(what + `: GoHighLevel answered ${r.status}`)
    } catch { problems.push(what + ': could not reach GoHighLevel') }
  }
  const c = `${GHL}/contacts/${encodeURIComponent(contactId)}`
  await step('tag "' + TAG_ON + '" added', c + '/tags', 'POST', { tags: [TAG_ON] })
  await step('tag "' + TAG_OFF + '" taken off', c + '/tags', 'DELETE', { tags: [TAG_OFF] })
  for (const w of stop) await step('out of workflow ' + w, c + '/workflow/' + encodeURIComponent(w), 'DELETE')
  return { done, problems }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const who = await requireStaff(db, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  const body: Any = await req.json().catch(() => ({}))
  const tok = Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || ''
  const secret = Deno.env.get('CC_HANDOFF_SECRET') || ''
  if (secret.length < 32) return json({ error: 'Sending to Caring CDS is not set up on the server yet.' }, 500)
  const { data: opsRow } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  const stop = stopList(opsRow?.data)

  if (body.action === 'check') {
    if (!who.roles.includes('owner_admin')) return json({ error: 'Owners only.' }, 403)
    return json({ ok: true, cds: await cds(secret, { check: true }), ghl: !!tok, stop_workflows: stop })
  }

  let person: Any, contactId = ''
  if (body.lead_id) {
    const leadId = clip(body.lead_id, 80)
    const { data: row } = await db.from('app_data').select('data').eq('key', 'leads').maybeSingle()
    const lead = (Array.isArray(row?.data) ? row!.data : []).find((l: Any) => l && String(l.id) === leadId)
    if (!lead) return json({ error: 'That lead was not found.' }, 404)
    person = fromLead(lead, who.name)
    contactId = clip(lead.ghl_contact_id, 64)
  } else {
    const id = clip(body.message_id, 64)
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return json({ error: 'Which lead or call? (none was sent)' }, 400)
    if (!tok) return json({ error: 'GoHighLevel is not set up on the server.' }, 500)
    const m = await fetch(`${GHL}/conversations/messages/${encodeURIComponent(id)}`, { headers: H(tok, '2021-04-15') })
    if (!m.ok) return json({ error: m.status === 404 ? 'GoHighLevel could not find that call.' : `GoHighLevel answered ${m.status} for that call.` }, 502)
    const msg: Any = ((await m.json().catch(() => ({}))) as Any)?.message ?? {}
    if (msg.messageType && msg.messageType !== 'TYPE_CALL') return json({ error: 'That message is not a call.' }, 400)
    contactId = clip(msg.contactId, 64)
    let ct: Any = {}
    if (okId(contactId)) { try { const r = await fetch(`${GHL}/contacts/${encodeURIComponent(contactId)}`, { headers: H(tok) }); if (r.ok) ct = (await r.json())?.contact || {} } catch { /* blank */ } }
    const { data: rd } = await db.from('call_task_reading').select('detail').eq('message_id', id).order('read_at', { ascending: false }).limit(1).maybeSingle()
    person = fromCall(id, ct, String(msg.dateAdded || ''), String(rd?.detail?.summary || ''), who.name)
  }

  /* 1. CDS first */
  const got = await cds(secret, person)
  if (!got.ok) return json({ ok: false, error: 'CDS did not take them: ' + got.error + '. Nothing was changed. Try again, or call CDS at (417) 218-2888.' }, 502)
  const out: Any = { ok: true, cds: { added: got.added === true, already: got.already || null, name: got.name || person.first_name || '' } }

  /* 2. Caring Companions GoHighLevel */
  if (!tok) out.ghl = { done: [], problems: ['GoHighLevel is not set up on the server, so their Caring Companions follow-up was not stopped there'] }
  else if (!okId(contactId)) out.ghl = { done: [], problems: [], none: 'No Caring Companions GoHighLevel contact on file, so there was nothing to stop there.' }
  else out.ghl = await ghlCleanup(tok, contactId, stop)
  out.ghl.contact_id = okId(contactId) ? contactId : ''
  out.ghl.workflows_listed = stop.length
  return json(out)
})
