// =============================================================================
// caregiver-preview: the Caregiver Preview tab on every client profile (Samantha, 2026-10-24). Rules and wording:
// _shared/caregiver-preview.ts. Signed-in office staff only (requireStaff, OFFICE_ROLES).
//   POST {action:'get',     axiscare_client_id?, lead_id?, client_name?}   the draft, the approved version, the care plan's
//                                                                          summary now, the state, and what this person may approve
//   POST {action:'save',    ...key, about?, enjoys?, share_care?, hidden?}  a draft change (who and when recorded)
//   POST {action:'approve', ...key}                                        approve what this person may (second person for care)
//   POST {action:'preview', ...key, version:'approved'|'draft'}            the shift page exactly as a caregiver would see it,
//                                                                          on a sample shift (no open shift needed); nothing saved
// The client is the AxisCare client, or the lead until they're in AxisCare (the draft follows them when they're added).
// Switch: ops_settings.caregiver_preview_live. Off: this works for practice, but shift pages and the Booking App still read
// the Family Circle's About as before. On: they read only the approved version here. Never sends anything to anyone.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { opEvent } from '../_shared/events.ts'
import { careNow } from '../_shared/cara-skills.ts'
import { detailsView } from '../_shared/shift-offer.ts'
import { cleanAbout, cleanEnjoys, approvedView, draftView, approvedIntro, draftIntro, stateOf, canApprove, applySave, applyApprove, sampleShift, APPROVER_ROLES } from '../_shared/caregiver-preview.ts'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const S = (v: unknown) => String(v ?? '').trim()
const nowIso = () => new Date().toISOString()
// deno-lint-ignore no-explicit-any
type Any = any

// deno-lint-ignore no-explicit-any
async function axClient(id: string | null): Promise<any | null> {
  if (!id) return null
  let token = ''; for (const n of ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  if (!token || !/^\d+$/.test(site)) return null
  try {
    const r = await fetch(`https://${site}.axiscare.com/api/clients/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01' } })
    if (!r.ok) return null
    const j: Any = await r.json().catch(() => ({})); return j?.results?.client ?? j?.results ?? null
  } catch { return null }
}

/** The record for this client: by AxisCare id first, then by lead (a draft written before they were in AxisCare). */
async function load(ax: string | null, lead: string | null): Promise<{ row: Any | null; circle: Any | null }> {
  let row: Any | null = null
  if (ax) row = (await sb.from('client_caregiver_profile').select('*').eq('axiscare_client_id', ax).limit(1).maybeSingle()).data ?? null
  if (!row && lead) row = (await sb.from('client_caregiver_profile').select('*').eq('lead_id', lead).limit(1).maybeSingle()).data ?? null
  if (row && ax && !row.axiscare_client_id) {   /* written on the lead; the client is in AxisCare now: it follows them */
    const upd = { axiscare_client_id: ax, client_key: 'ax:' + ax, updated_at: new Date().toISOString() }
    if (!(await sb.from('client_caregiver_profile').update(upd).eq('id', row.id)).error) row = { ...row, ...upd }
  }
  const circle = ax ? (await sb.from('care_circles').select('caregiver_about, caregiver_enjoys, caregiver_share_care').eq('axiscare_client_id', ax).eq('active', true).limit(1).maybeSingle()).data ?? null : null
  return { row, circle }
}
async function write(row: Any): Promise<boolean> {
  const { error } = row.id ? await sb.from('client_caregiver_profile').update(row).eq('id', row.id) : await sb.from('client_caregiver_profile').insert(row)
  if (error) console.error('caregiver-preview write', error.message)
  return !error
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const who = await requireStaff(sb, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  const b: Any = await req.json().catch(() => ({}))
  const action = S(b?.action || 'get')
  const ax = /^\d+$/.test(S(b?.axiscare_client_id)) ? S(b.axiscare_client_id) : null
  const lead = S(b?.lead_id) || null
  if (!ax && !lead) return json({ error: 'Which client? (no AxisCare client or lead given)' }, 400)
  const me = { name: who.name, email: who.email, roles: who.roles }
  try {
    const live = ((await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()).data?.data ?? {}).caregiver_preview_live === true
    let { row, circle } = await load(ax, lead)
    const cl = ax ? await axClient(ax) : null
    const current = ax ? await careNow(sb, ax, cl) : null
    const clientName = S(b?.client_name) || S(row?.client_name) || [S(cl?.firstName), S(cl?.lastName)].filter(Boolean).join(' ') || null

    if (action === 'save') {
      const patch: Any = {}
      if ('about' in b) { const c = cleanAbout(b.about); if (!c.ok) return json({ error: c.error }, 400); patch.about = c.text }
      if ('enjoys' in b) { const c = cleanEnjoys(b.enjoys); if (!c.ok) return json({ error: c.error }, 400); patch.enjoys = c.items }
      if ('share_care' in b) patch.share_care = b.share_care === true
      if ('hidden' in b) patch.hidden = (Array.isArray(b.hidden) ? b.hidden : []).map(S).filter((k: string) => /^(help|needs|level|home):[\w.-]+$/.test(k)).slice(0, 40)
      const out = applySave(row, circle, patch, me, nowIso(), { client_key: ax ? 'ax:' + ax : 'lead:' + lead, axiscare_client_id: ax ?? row?.axiscare_client_id ?? null, lead_id: lead ?? row?.lead_id ?? null, client_name: clientName })
      if (out.changed.length || !row) {   /* nothing new = nothing written */
        if (!(await write(out.row))) return json({ error: 'Not saved. Please try again.' }, 500)
        await opEvent(sb, { job: 'caregiver-preview', verb: 'caregiver_preview_draft', item_id: out.row.client_key, area: 'clients', actor_name: who.name,
          summary: `${who.name} ${out.changed.join(', ') || 'started'} on the Caregiver Preview for ${clientName || 'a client'} (draft)` })
      }
      ;({ row, circle } = await load(ax, lead))
    }

    if (action === 'approve') {
      if (!row) return json({ error: 'Nothing to approve yet. Save a draft first.' }, 409)
      const out = applyApprove(row, circle, current, me, nowIso())
      if (!out.approved.length) return json({ error: out.why || 'Nothing is waiting for approval.' }, 409)
      if (!(await write(out.row))) return json({ error: 'Not saved. Please try again.' }, 500)
      await opEvent(sb, { job: 'caregiver-preview', verb: 'caregiver_preview_approved', item_id: out.row.client_key, area: 'clients', actor_name: who.name,
        summary: `${who.name} approved ${out.approved.join(' and ')} on the Caregiver Preview for ${clientName || 'a client'}` })
      ;({ row, circle } = await load(ax, lead))
      const v = await view(row, circle, current, me, live, cl)
      return json({ ...v, approved: out.approved, note: out.why || null })
    }

    if (action === 'preview') {
      const version = b?.version === 'draft' ? 'draft' : 'approved'
      const info = version === 'draft' ? draftView(row, circle, current) : approvedView(row, circle, current)
      const sh = sampleShift(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }))
      const kase = { client: clientName || 'the client', client_city: S(cl?.residentialAddress?.city) || null, ...sh }
      return json({ ok: true, preview: true, sample: true, version, ...detailsView(kase, { name: '' }, 'open', info) })
    }

    if (action === 'get' || action === 'save') return json(await view(row, circle, current, me, live, cl))
    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    console.error('caregiver-preview', String((e as Error)?.message ?? e))
    return json({ error: 'Something went wrong. Please try again in a minute.' }, 500)
  }
})

async function view(row: Any, circle: Any, current: Any, me: Any, live: boolean, cl: Any) {
  const st = stateOf(row, circle, current), can = canApprove(row, circle, current, me)
  const dHidden: string[] = Array.isArray(row?.draft_hidden) ? row.draft_hidden : [], aKeys: string[] = Array.isArray(row?.approved_care_items) ? row.approved_care_items : []
  const { data: names } = await sb.from('staff_roles').select('person_id, role').eq('entity', 'cc_ihs').in('role', APPROVER_ROLES)
  const ids = [...new Set((names ?? []).map((x: Any) => x.person_id))]
  const people = ids.length ? ((await sb.from('persons').select('full_name, active').in('person_id', ids)).data ?? []).filter((p: Any) => p.active === true).map((p: Any) => S(p.full_name).split(' ')[0]) : []
  return {
    ok: true, live, client_key: row?.client_key ?? null, in_axiscare: !!cl,
    intro: { draft: draftIntro(row, circle), approved: approvedIntro(row, circle), carried: st.carried && !row?.intro_approved_at },
    care: {
      readable: !!current, draft_on: row?.draft_share_care === true, approved_on: row?.approved_share_care === true, review: st.care_review,
      items: (current ?? []).map((x: Any) => ({ ...x, draft: !dHidden.includes(x.key), approved: row?.approved_share_care === true && aKeys.includes(x.key) })),
      changed_by: row?.care_changed_by ?? null,
    },
    state: st, can: { edit: true, approve_intro: can.intro, approve_care: can.care, why: can.why },
    approvers: people,
    history: (Array.isArray(row?.history) ? row.history : []).slice(-10).reverse(),
  }
}
