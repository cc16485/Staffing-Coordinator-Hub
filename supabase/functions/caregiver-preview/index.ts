// =============================================================================
// caregiver-preview: the Caregiver Preview tab on every client profile (Samantha, 2026-10-24). Rules and wording:
// _shared/caregiver-preview.ts. Signed-in office staff only (requireStaff, OFFICE_ROLES).
//   POST {action:'get',     axiscare_client_id?, lead_id?, client_name?}   the draft, the approved version, the care plan's
//                                                                          summary now, the state, and what this person may approve
//   POST {action:'save',    ...key, about?, enjoys?, share_care?, hidden?}  a draft change (who and when recorded)
//   POST {action:'approve', ...key}                                        approve what this person may (second person for care)
//   POST {action:'draft', ...key}                                          the AI's draft introduction from the Life Story only
//                                                                          (_shared/life-story-draft.ts); returned, not saved.
//                                                                          Switch ops_settings.cgp_ai_draft_live (off: owners only)
//   POST ?test_draft=1  {sources:[{label,text}], first_name, family_names?} or {axiscare_client_id | lead_id}
//                       THE OWNER'S SERVER KEY ONLY (2026-10-24, her ask: "so you can run the real AI on test Life Stories
//                       and the real ones once we add them"): the same draft, with exactly what was sent, nothing saved,
//                       whatever the switch. For trying the real AI before coordinators get the button.
//   POST {action:'preview', ...key, version:'approved'|'draft'}            the shift page exactly as a caregiver would see it,
//                                                                          on a sample shift (no open shift needed); nothing saved
// The client is the AxisCare client, or the lead until they're in AxisCare (the draft follows them when they're added).
// Switch: ops_settings.caregiver_preview_live. Off: this works for practice, but shift pages and the Booking App still read
// the Family Circle's About as before. On: they read only the approved version here. Never sends anything to anyone.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import { opEvent } from '../_shared/events.ts'
import { careNow } from '../_shared/cara-skills.ts'
import { detailsView } from '../_shared/shift-offer.ts'
import { lifeSources, draftFromLifeStory } from '../_shared/life-story-draft.ts'
import { rowToProfile, familyWordsForOffice, QUESTIONS } from '../_shared/family-profile.ts'
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
  if (new URL(req.url).searchParams.get('test_draft') === '1') {
    if ((await jobCaller(req, false)) !== 'owner') return json({ error: 'not allowed' }, 401)
    const tb: Any = await req.json().catch(() => ({}))
    try {
      let srcs: Any[], first = S(tb?.first_name), family: string[] = (Array.isArray(tb?.family_names) ? tb.family_names : []).map(S).filter(Boolean)
      if (Array.isArray(tb?.sources)) srcs = tb.sources.slice(0, 6).map((x: Any) => ({ key: 'test', label: S(x?.label) || 'Life Story', text: S(x?.text).slice(0, 800), via: 'test', by: '', at: '' })).filter((x: Any) => x.text)
      else {
        const tax = /^\d+$/.test(S(tb?.axiscare_client_id)) ? S(tb.axiscare_client_id) : null, tlead = S(tb?.lead_id) || null
        const rows = async (key: string) => { const d = (await sb.from('app_data').select('data').eq('key', key).maybeSingle()).data?.data; return Array.isArray(d) ? d : [] }
        const profile = tax ? (await rows('client_profiles')).find((p: Any) => p?.id === 'cp_ax' + tax) ?? null : null
        const leads = await rows('leads')
        const lr = (tlead && leads.find((l: Any) => l?.id === tlead)) || (tax && leads.find((l: Any) => String(l?.axiscare_client_id ?? '') === tax)) || null
        srcs = lifeSources(profile, lr)
        if (!first) first = S(profile?.client_name || [lr?.client_first_name].filter(Boolean).join(' ')).split(' ')[0]
        family = [...family, S(lr?.first_name), S(lr?.last_name)].filter(Boolean)
      }
      const out = await draftFromLifeStory(srcs, first, Deno.env.get('ANTHROPIC_API_KEY') ?? '', fetch, family)
      await opEvent(sb, { job: 'caregiver-preview', verb: 'caregiver_preview_ai_test', item_id: 'test', area: 'clients', actor_name: 'Owner test (server key)', summary: `Test AI draft from a Life Story (${srcs.length} answers): ${out.ok ? 'drafted, nothing saved' : out.why}` })
      return json({ test: true, saved: false, first_name: first, sent: srcs.map((x: Any) => ({ label: x.label, text: x.text })), result: out })
    } catch (e) { return json({ error: String((e as Error)?.message ?? e).slice(0, 200) }, 500) }
  }
  const who = await requireStaff(sb, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  const b: Any = await req.json().catch(() => ({}))
  const action = S(b?.action || 'get')
  const ax = /^\d+$/.test(S(b?.axiscare_client_id)) ? S(b.axiscare_client_id) : null
  const lead = S(b?.lead_id) || null
  if (!ax && !lead) return json({ error: 'Which client? (no AxisCare client or lead given)' }, 400)
  const me = { name: who.name, email: who.email, roles: who.roles }
  try {
    const stAll = (await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()).data?.data ?? {}
    const live = stAll.caregiver_preview_live === true
    let { row, circle } = await load(ax, lead)
    const cl = ax ? await axClient(ax) : null
    const current = ax ? await careNow(sb, ax, cl) : null
    const clientName = S(b?.client_name) || S(row?.client_name) || [S(cl?.firstName), S(cl?.lastName)].filter(Boolean).join(' ') || null

    /* THE AI DRAFT (2026-10-24, Life Story step 2): from the Life Story only; nothing saved */
    if (action === 'draft') {
      if (stAll.cgp_ai_draft_live !== true && !(who.roles || []).includes('owner_admin')) return json({ error: 'Drafting from the Life Story is in practice: only owners can try it until it is switched on.' }, 403)
      const rows = async (key: string) => { const d = (await sb.from('app_data').select('data').eq('key', key).maybeSingle()).data?.data; return Array.isArray(d) ? d : [] }
      const profile = ax ? (await rows('client_profiles')).find((p: Any) => p?.id === 'cp_ax' + ax) ?? null : null
      const leads = await rows('leads')
      const leadRow = (lead && leads.find((l: Any) => l?.id === lead)) || (ax && leads.find((l: Any) => String(l?.axiscare_client_id ?? '') === ax)) || null
      const first = (clientName || '').split(' ')[0]
      const family = [S(leadRow?.first_name), S(leadRow?.last_name)].filter(Boolean)   /* the caller: never named in the introduction */
      const out = await draftFromLifeStory(lifeSources(profile, leadRow), first, Deno.env.get('ANTHROPIC_API_KEY') ?? '', fetch, family)
      await opEvent(sb, { job: 'caregiver-preview', verb: out.ok ? 'caregiver_preview_ai_draft' : 'caregiver_preview_ai_draft_none', item_id: ax ? 'ax:' + ax : 'lead:' + lead, area: 'clients', actor_name: who.name,
        summary: `${who.name} asked for an AI draft of the Caregiver Preview for ${clientName || 'a client'}: ${out.ok ? 'drafted (not saved)' : out.why}` })
      return json(out.ok ? { ok: true, draft: out } : { ok: false, why: out.why })
    }

    if (action === 'save') {
      const patch: Any = {}
      if ('about' in b) { const c = cleanAbout(b.about); if (!c.ok) return json({ error: c.error }, 400); patch.about = c.text }
      if ('enjoys' in b) { const c = cleanEnjoys(b.enjoys); if (!c.ok) return json({ error: c.error }, 400); patch.enjoys = c.items }
      if ('share_care' in b) patch.share_care = b.share_care === true
      if ('hidden' in b) patch.hidden = (Array.isArray(b.hidden) ? b.hidden : []).map(S).filter((k: string) => /^(help|needs|level|home):[\w.-]+$/.test(k)).slice(0, 40)
      if (b.ai_draft === true) patch.ai = true   /* saved from an AI draft: said so in the history */
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
      const v = await view(row, circle, current, me, live, cl, ax)
      return json({ ...v, approved: out.approved, note: out.why || null })
    }

    /* "USE THE FAMILY'S WORDS" (2026-10-25, family-profile.ts): copies the family's Booking App profile into this office draft.
       Her rule: the two profiles stay separate, so this is the only way the family's words reach the shift profile, and it is
       an ordinary draft that is approved as usual. The family's own profile is never touched from here. */
    if (action === 'use_family_words') {
      if (!ax) return json({ error: 'Which client?' }, 400)
      const fam = rowToProfile((await sb.from('family_client_profile').select('*').eq('axiscare_client_id', ax).maybeSingle()).data ?? null)
      if (!fam) return json({ error: 'The family hasn\'t written a profile yet.' }, 409)
      const wds = familyWordsForOffice(fam)
      const ca = cleanAbout(wds.about); if (!ca.ok) return json({ error: ca.error }, 400)
      const ce = cleanEnjoys(wds.enjoys); if (!ce.ok) return json({ error: ce.error }, 400)
      const out = applySave(row, circle, { about: ca.text, enjoys: ce.items }, me, nowIso(), { client_key: 'ax:' + ax, axiscare_client_id: ax, lead_id: row?.lead_id ?? null, client_name: clientName })
      const h = out.row.history; if (out.changed.length && Array.isArray(h) && h.length) h[h.length - 1] = { ...h[h.length - 1], what: h[h.length - 1].what + " (from the family's Booking App profile)" }
      if (out.changed.length || !row) {
        if (!(await write(out.row))) return json({ error: 'Not saved. Please try again.' }, 500)
        await opEvent(sb, { job: 'caregiver-preview', verb: 'caregiver_preview_draft', item_id: 'ax:' + ax, area: 'clients', actor_name: who.name,
          summary: `${who.name} copied the family's words into the Caregiver Preview draft for ${clientName || 'a client'} (approve to use on shifts)` })
      }
      ;({ row, circle } = await load(ax, lead))
      return json(await view(row, circle, current, me, live, cl, ax))
    }

    /* A FAMILY'S SUGGESTION (2026-10-25, app-profile.ts): the office marks it used or not used. It never changes the profile by
       itself: whoever uses it edits the draft and approves as usual. */
    if (action === 'suggestion_close') {
      if (!ax) return json({ error: 'Which client?' }, 400)
      const id = Number(b?.id), how = b?.used === true ? 'used' : 'not_used'
      if (!(id > 0)) return json({ error: 'Which suggestion?' }, 400)
      const { data, error } = await sb.from('client_profile_suggestions').update({ status: how, closed_at: nowIso(), closed_by: who.name })
        .eq('id', id).eq('axiscare_client_id', ax).eq('status', 'open').select('id, contact_name')
      if (error) return json({ error: 'Not saved. Please try again.' }, 500)
      if (!data?.length) return json({ error: 'Someone already handled that suggestion.' }, 409)
      await opEvent(sb, { job: 'caregiver-preview', verb: 'caregiver_preview_suggestion_' + how, item_id: 'ax:' + ax, area: 'clients', actor_name: who.name,
        summary: `${who.name} marked ${S(data[0].contact_name) || 'a family member'}'s suggestion for ${clientName || 'a client'} as ${how === 'used' ? 'used' : 'not used'}` })
      return json(await view(row, circle, current, me, live, cl, ax))
    }

    if (action === 'preview') {
      const version = b?.version === 'draft' ? 'draft' : 'approved'
      const info = version === 'draft' ? draftView(row, circle, current) : approvedView(row, circle, current)
      const sh = sampleShift(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }))
      const kase = { client: clientName || 'the client', client_city: S(cl?.residentialAddress?.city) || null, ...sh }
      return json({ ok: true, preview: true, sample: true, version, ...detailsView(kase, { name: '' }, 'open', info) })
    }

    if (action === 'get' || action === 'save') return json(await view(row, circle, current, me, live, cl, ax))
    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    console.error('caregiver-preview', String((e as Error)?.message ?? e))
    return json({ error: 'Something went wrong. Please try again in a minute.' }, 500)
  }
})

async function view(row: Any, circle: Any, current: Any, me: Any, live: boolean, cl: Any, ax: string | null = null) {
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
    /* 2026-10-25: open suggestions from families in the Booking App (oldest first); empty when there are none */
    /* 2026-10-25: the family's own Booking App profile (separate; shown here to read and, if wanted, copy) */
    family: ax ? await (async () => { const r = (await sb.from('family_client_profile').select('*').eq('axiscare_client_id', ax).maybeSingle()).data ?? null; const p = rowToProfile(r)
      return p ? { ...p, life: QUESTIONS.map((q) => ({ label: q.caregiver, text: p[q.key] })).filter((x) => x.text), updated_at: r.updated_at, updated_by: r.updated_by_name, history: (Array.isArray(r.history) ? r.history : []).slice(-10).reverse() } : null })() : null,
    suggestions: ax ? ((await sb.from('client_profile_suggestions').select('id, contact_name, text, created_at').eq('axiscare_client_id', ax).eq('status', 'open').order('created_at').limit(20)).data ?? []) : [],
  }
}
