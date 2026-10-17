// =============================================================================
// client-agreement · the Client Care Agreement signed on a tablet, Stage 1 (Samantha 2026-10-16: "Yes, start building
// stage 1: the tablet form, finger signature and signed PDF saved in the Hub").
// The office opens the client in the Hub, sets the level and rate, and hands the tablet over. The family fills in the
// client, POA and Contacts & Permissions, picks their choices, taps the six initials, then signs with a finger and their
// typed name. The office countersigns on the same tablet, and the signed PDF (the real agreement pages with everything
// written in, plus an electronic signature record page) is saved in the private bucket client-agreements.
// Stage 1 changes nothing in AxisCare and sends nothing to anyone; every action needs a signed-in office user.
// Actions: start · get · list · save · sign · countersign · open · void
// Stage 2 (872, Samantha 2026-10-16 "yes start stage 2"): contacts · contacts_apply · contacts_todo. After the agreement is
// countersigned, an office person reviews the signed Contacts & Permissions and approves them into AxisCare responsible
// parties 1-3 (incl. HIPAA and Medical Decisions from the signed agreement) and the Hub Family Circle, every AxisCare
// write read back and logged. Only on that click; nothing is texted or emailed. _shared/agreement-contacts.ts.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { logOpen, clientSubject } from '../_shared/doc-log.ts'
import { FIELDS, VERSION, DOC, PDF_SHA256, BUCKET, ESIGN_WORDS, INITIALS, OFFICE_KEYS, cleanAnswers, readyToSign, initialsOf, signatureOk, initialsComplete, centralDate, stampPlan, type Answers } from '../_shared/client-agreement.ts'
import { MASTER_PATH } from '../_shared/client-agreement-map.ts'
import { signedAgreementPdf } from '../_shared/agreement-pdf.ts'
import { contactsFrom, withEdits, planContacts, rpBody, memberRow, todoFor, badState, nameKey } from '../_shared/agreement-contacts.ts'

// deno-lint-ignore no-explicit-any
type Any = any
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cc-via, x-cc-employee',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const S = (v: unknown, n: number) => String(v ?? '').slice(0, n)
const ipOf = (req: Request) => S(req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0], 64).trim()
const agentOf = (req: Request) => S(req.headers.get('user-agent'), 200)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const AX = /^[0-9]{1,12}$/
const ADDENDA = ['va', 'guide']
const pngBytes = (dataUrl: string) => Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0))
const stampOf = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')

/* ---------- AxisCare (Stage 2): responsible parties only, the same calls family-circles makes ---------- */
const AC_VERSION = '2023-10-01'
const tt = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())
async function axis(method: string, path: string, body?: unknown): Promise<{ status: number; json: Any }> {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  if (!token || !/^\d+$/.test(site)) return { status: 0, json: { errors: ['AxisCare credentials not set'] } }
  try {
    const r = await fetch(`https://${site}.axiscare.com${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
      'Content-Type': 'application/json', 'X-AxisCare-Api-Version': AC_VERSION }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, json: await r.json().catch(() => ({})) }
  } catch (e) { return { status: 0, json: { errors: [String((e as Error).message ?? e)] } } }
}
const okS = (s: number) => s >= 200 && s < 300
const axErr = (r: { status: number; json: Any }) => {
  const e = r.json?.errors; const m = Array.isArray(e) ? e.filter(Boolean).join('; ') : (e && typeof e === 'object' ? Object.values(e).join('; ') : '')
  return (r.status === 403 ? 'AxisCare refused: this connection may not change responsible parties' : r.status ? 'AxisCare answered ' + r.status : 'AxisCare could not be reached') + (m ? ' (' + String(m).slice(0, 240) + ')' : '')
}
const listOf = (v: Any): Any[] => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : [])
const axYes = (v: unknown): boolean | null => (v === true || v === 1 || v === '1') ? true : (v === false || v === 0 || v === '0') ? false : null
function slotView(p: Any) {
  const phones = (Array.isArray(p?.phones) ? p.phones : []).filter((x: Any) => tt(x?.number))
  const mob = phones.find((x: Any) => /mobile/i.test(String(x?.type ?? ''))) ?? phones[0]
  const a = p?.address ?? {}
  return { list_number: Number(p?.listNumber) || null, name: tt(p?.name), relationship: tt(p?.relationship) || null,
    phone: mob ? tt(mob.number) : null, email: tt(p?.email) || null, address: [a.line1, a.city, a.state, a.zip].map(tt).filter(Boolean).join(', ') || null,
    hipaa_authorized: axYes(p?.hipaaDisclosureAuthorization), can_make_medical_decisions: axYes(p?.canMakeMedicalDecisions) }
}
async function axisLog(db: Any, c: { client: string; outcome: string; summary: string; detail?: string | null; by: string }) {
  try { await db.rpc('axiscare_change_record', { p_kind: 'responsible_party', p_subject: 'client', p_client: c.client, p_caregiver: null, p_outcome: c.outcome,
    p_summary: c.summary.slice(0, 200), p_detail: c.detail ? c.detail.slice(0, 300) : null, p_by: c.by || 'unknown', p_via: 'client-agreement' }) } catch { /* best effort */ }
}

/** What the tablet page needs to draw the form: the field keys and kinds, the six initials, the consent words. */
export const FORM_INFO = {
  doc: DOC, version: VERSION, esign_words: ESIGN_WORDS, initials: INITIALS,
  fields: Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, f.type])),
  office_keys: [...OFFICE_KEYS],
}

/** The row as the Hub may see it: no signature images, no file paths beyond whether a PDF exists. */
function view(r: Any) {
  return {
    id: r.id, client_ax: r.axiscare_client_id, status: r.status, version: r.version, office: r.office, answers: r.answers,
    signer: r.client_sign ? { name: r.client_sign.typed_name, role: r.client_sign.role, at: r.client_sign.at } : null,
    office_signer: r.office_sign ? { name: r.office_sign.typed_name, at: r.office_sign.at } : null,
    has_pdf: !!r.signed_pdf_path, contacts_review: r.contacts_review ?? null, created_at: r.created_at, signed_at: r.signed_at, countersigned_at: r.countersigned_at, void_reason: r.void_reason,
  }
}

if (typeof Deno !== 'undefined' && Deno.serve) Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405)
  let b: Any = {}
  try { b = await req.json() } catch { return json({ error: 'Bad request.' }, 400) }
  const action = String(b?.action ?? '')
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  try {
    const who = await requireStaff(db, req, OFFICE_ROLES)
    if (!who.ok) return json({ error: who.error }, who.status)
    const row = async (id: unknown) => {
      if (!UUID.test(String(id || ''))) return null
      const { data, error } = await db.from('client_agreements').select('*').eq('id', String(id)).limit(1)
      if (error) throw error
      return data?.[0] || null
    }

    if (action === 'form') return json({ ok: true, form: FORM_INFO })

    if (action === 'list') {
      const ax = S(b.client_ax, 12)
      if (!AX.test(ax)) return json({ error: 'Which client?' }, 400)
      const { data, error } = await db.from('client_agreements').select('*').eq('axiscare_client_id', ax).order('created_at', { ascending: false }).limit(20)
      if (error) throw error
      return json({ ok: true, agreements: (data || []).map(view) })
    }

    if (action === 'start') {
      const ax = S(b.client_ax, 12)
      if (!AX.test(ax)) return json({ error: 'Which client?' }, 400)
      const { answers, problems } = cleanAnswers(b.office || {}, 'office')
      if (problems.length) return json({ error: 'Some office answers are not right.', problems }, 422)
      const addenda = (Array.isArray(b.addenda) ? b.addenda : []).map(String).filter((x: string) => ADDENDA.includes(x))
      const start_date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.start_date || '')) ? String(b.start_date) : null
      const { data, error } = await db.from('client_agreements').insert({
        axiscare_client_id: ax, doc: DOC, version: VERSION, pdf_sha256: PDF_SHA256, status: 'draft',
        office: { answers, addenda, start_date, by: who.name }, answers: {}, created_by: who.email,
      }).select('*')
      if (error) throw error
      return json({ ok: true, outcome: 'saved', agreement: view(data[0]), form: FORM_INFO })
    }

    if (action === 'get') {
      const r = await row(b.id)
      if (!r) return json({ error: 'Agreement not found.' }, 404)
      return json({ ok: true, agreement: view(r), form: FORM_INFO })
    }

    if (action === 'save' || action === 'office') {
      const r = await row(b.id)
      if (!r) return json({ error: 'Agreement not found.' }, 404)
      if (r.status !== 'draft') return json({ error: 'This agreement is already signed. Start a new one to change it.', outcome: 'stale' }, 409)
      if (action === 'office') {
        const { answers, problems } = cleanAnswers(b.office || {}, 'office')
        if (problems.length) return json({ error: 'Some office answers are not right.', problems }, 422)
        const office = { ...r.office, answers, by: who.name }
        const { error } = await db.from('client_agreements').update({ office, updated_at: new Date().toISOString() }).eq('id', r.id).eq('status', 'draft')
        if (error) throw error
        return json({ ok: true, outcome: 'saved' })
      }
      const { answers, problems } = cleanAnswers(b.answers || {}, 'family')
      if (problems.length) return json({ error: 'Some answers are not right.', problems }, 422)
      const { error } = await db.from('client_agreements').update({ answers, updated_at: new Date().toISOString() }).eq('id', r.id).eq('status', 'draft')
      if (error) throw error
      return json({ ok: true, outcome: 'saved' })
    }

    if (action === 'sign') {
      const r = await row(b.id)
      if (!r) return json({ error: 'Agreement not found.' }, 404)
      if (r.status !== 'draft') return json({ error: 'This agreement is already signed.', outcome: 'stale' }, 409)
      if (b.consent !== true) return json({ error: 'Please tick the box to agree to sign electronically.', field: 'consent' }, 400)
      const fam = cleanAnswers(b.answers || {}, 'family')
      if (fam.problems.length) return json({ error: 'Some answers are not right.', problems: fam.problems }, 422)
      const all: Answers = { ...(r.office?.answers || {}), ...fam.answers }
      const signer = { name: S(b.signer?.name, 80).trim().replace(/\s+/g, ' '), role: S(b.signer?.role, 20), relationship: S(b.signer?.relationship, 40).trim() }
      const problems = [...readyToSign(all, signer), ...initialsComplete(b.initials, signer.role === 'representative')]
      if (!signatureOk(b.signature)) problems.push({ field: 'signature', error: 'Please sign with your finger in the box.' })
      if (problems.length) return json({ error: 'A few things are still needed before signing.', problems }, 422)
      const at = new Date().toISOString()
      const path = `sig/${r.axiscare_client_id}/${r.id}-client-${stampOf(at)}.png`
      const up = await db.storage.from(BUCKET).upload(path, pngBytes(b.signature), { contentType: 'image/png', upsert: false })
      if (up.error) throw up.error
      const taps = Object.fromEntries(Object.entries(b.initials || {}).filter(([k]) => k in INITIALS || k === 'poa').map(([k, v]) => [k, S(v, 40)]))
      const client_sign = { typed_name: signer.name, role: signer.role, relationship: signer.relationship || null, initials_text: initialsOf(signer.name), initials_taps: taps,
        at, ip: ipOf(req), agent: agentOf(req), consent: true, consent_words: ESIGN_WORDS, signature_path: path, version: VERSION, pdf_sha256: PDF_SHA256,
        on_staff_session: { name: who.name, email: who.email, person_id: who.person_id } }
      const { data: did, error } = await db.from('client_agreements').update({ answers: fam.answers, client_sign, status: 'signed', signed_at: at, updated_at: at })
        .eq('id', r.id).eq('status', 'draft').select('id')
      if (error) throw error
      if (!did?.length) return json({ error: 'This agreement changed while you were signing. Open it again.', outcome: 'stale' }, 409)
      return json({ ok: true, outcome: 'signed', at })
    }

    if (action === 'countersign') {
      const r = await row(b.id)
      if (!r) return json({ error: 'Agreement not found.' }, 404)
      if (r.status !== 'signed') return json({ error: r.status === 'countersigned' ? 'Already countersigned.' : 'The client signs first.', outcome: 'stale' }, 409)
      if (!signatureOk(b.signature)) return json({ error: 'Please sign in the box.', field: 'signature' }, 400)
      const at = new Date().toISOString()
      const sigPath = `sig/${r.axiscare_client_id}/${r.id}-office-${stampOf(at)}.png`
      const up = await db.storage.from(BUCKET).upload(sigPath, pngBytes(b.signature), { contentType: 'image/png', upsert: false })
      if (up.error) throw up.error
      const office_sign = { typed_name: who.name, email: who.email, person_id: who.person_id, at, ip: ipOf(req), agent: agentOf(req), signature_path: sigPath }

      const [master, csig] = await Promise.all([db.storage.from(BUCKET).download(MASTER_PATH), db.storage.from(BUCKET).download(r.client_sign.signature_path)])
      if (master.error || csig.error) throw (master.error || csig.error)
      const cs = r.client_sign, all: Answers = { ...(r.office?.answers || {}), ...(r.answers || {}) }
      const plan = stampPlan(all, { initials: cs.initials_text, signedAt: cs.at, signerName: cs.typed_name, representative: cs.role === 'representative', officeName: who.name, officeAt: at })
      const tapLine = Object.entries(cs.initials_taps || {}).map(([k, v]) => `${k === 'poa' ? 'POA' : k + ' of 6'}: ${centralDate(String(v)).long}`).join('\n')
      const record = [
        ['Agreement', `Client Care Agreement, ${VERSION}`], ['Agreement id', r.id], ['AxisCare client', r.axiscare_client_id],
        ['Master document SHA-256', PDF_SHA256],
        ['Signed by', `${cs.typed_name}${cs.role === 'representative' ? ` (on behalf of the client${cs.relationship ? ', ' + cs.relationship : ''})` : ' (the client)'}`],
        ['Signed at', `${centralDate(cs.at).long} (${cs.at} UTC)`], ['Signer device', `${cs.ip || 'not recorded'} · ${cs.agent || 'not recorded'}`],
        ['Electronic signature consent', `"${cs.consent_words}"`], ['Initials taps', tapLine || 'none'],
        ['Signed on the tablet of', `${cs.on_staff_session?.name || ''} (${cs.on_staff_session?.email || ''})`],
        ['Countersigned by', `${who.name} (${who.email}), Caring Companions`], ['Countersigned at', `${centralDate(at).long} (${at} UTC)`],
        ['Countersigner device', `${office_sign.ip || 'not recorded'} · ${office_sign.agent || 'not recorded'}`],
      ]
      let bytes: Uint8Array
      try {
        bytes = await signedAgreementPdf({ master: new Uint8Array(await master.data.arrayBuffer()), plan, clientSigPng: new Uint8Array(await csig.data.arrayBuffer()), officeSigPng: pngBytes(b.signature), record, at })
      } catch (e) {
        console.error('client-agreement pdf', e)
        return json({ error: 'The signed PDF could not be made. Nothing was lost: try Countersign again, and tell Samantha if it keeps happening.' }, 500)
      }
      const pdfPath = `signed/${r.axiscare_client_id}/${r.id}-${stampOf(at)}.pdf`
      const upd = await db.storage.from(BUCKET).upload(pdfPath, bytes, { contentType: 'application/pdf', upsert: false })
      if (upd.error) throw upd.error
      const { data: did, error } = await db.from('client_agreements').update({ office_sign, signed_pdf_path: pdfPath, status: 'countersigned', countersigned_at: at, updated_at: at })
        .eq('id', r.id).eq('status', 'signed').is('signed_pdf_path', null).select('id')
      if (error) throw error
      if (!did?.length) return json({ error: 'Someone else countersigned this a moment ago. Open it again.', outcome: 'stale' }, 409)
      return json({ ok: true, outcome: 'countersigned', at })
    }

    if (action === 'open') {
      const r = await row(b.id)
      if (!r?.signed_pdf_path) return json({ error: 'No signed PDF yet.' }, 404)
      const logged = await logOpen(db, { subject: clientSubject(r.axiscare_client_id, null), doc: 'client_agreement', path: r.signed_pdf_path, who, ip: ipOf(req) })
      if (!logged) return json({ error: 'Could not record who opened it, so it was not opened. Try again.' }, 500)
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(r.signed_pdf_path, 300)
      if (error || !data?.signedUrl) throw error || new Error('no url')
      return json({ ok: true, url: data.signedUrl, expires_in: 300 })
    }

    if (action === 'void') {
      const r = await row(b.id)
      if (!r) return json({ error: 'Agreement not found.' }, 404)
      if (r.status === 'countersigned' || r.status === 'void') return json({ error: r.status === 'void' ? 'Already set aside.' : 'A countersigned agreement is kept as signed. Start a new one if something changed.' }, 409)
      const why = S(b.reason, 300).trim()
      if (why.length < 5) return json({ error: 'Say why (a few words).', field: 'reason' }, 400)
      const { error } = await db.from('client_agreements').update({ status: 'void', void_reason: `${why} (${who.name})`, updated_at: new Date().toISOString() }).eq('id', r.id).in('status', ['draft', 'signed'])
      if (error) throw error
      return json({ ok: true, outcome: 'saved' })
    }

    /* ---------- Stage 2: review the signed contacts, approve them into AxisCare and the Family Circle ---------- */
    if (action === 'contacts' || action === 'contacts_apply' || action === 'contacts_todo') {
      const r = await row(b.id)
      if (!r) return json({ error: 'Agreement not found.' }, 404)
      if (r.status !== 'countersigned') return json({ error: 'The contacts can be reviewed once the agreement is signed and countersigned.' }, 409)
      const review: Any = r.contacts_review && typeof r.contacts_review === 'object' ? r.contacts_review : {}
      review.people = review.people ?? {}; review.todo = review.todo ?? {}
      const contacts = contactsFrom(r.answers), ax = String(r.axiscare_client_id), now = new Date().toISOString()
      const keep = async () => { const { error } = await db.from('client_agreements').update({ contacts_review: review, updated_at: now }).eq('id', r.id); if (error) throw error }

      if (action === 'contacts_todo') {
        const key = S(b.key, 40), valid = new Set(contacts.flatMap((c) => todoFor(c).map((x) => x.key)))
        if (!valid.has(key)) return json({ error: 'That is not on this checklist.' }, 400)
        if (b.done === true) review.todo[key] = { by: who.email, at: now }; else delete review.todo[key]
        await keep(); return json({ ok: true, review })
      }

      const all = await axis('GET', `/api/clients/${ax}/responsibleParties`)
      if (!okS(all.status) && all.status !== 404) return json({ error: 'Could not read AxisCare, so nothing was changed: ' + axErr(all) }, 502)
      const axList = listOf(all.json?.results?.responsibleParties ?? all.json?.results ?? []).filter((p: Any) => tt(p?.name))
      const slots = axList.map((p: Any) => ({ list_number: Number(p.listNumber), name: tt(p.name) }))
      const slotRaw = (n: number | null) => axList.find((p: Any) => Number(p?.listNumber) === n) ?? null
      const { data: circs, error: ce } = await db.from('care_circles').select('id, client_name').eq('active', true).eq('axiscare_client_id', ax)
      if (ce) throw ce
      if ((circs ?? []).length > 1) return json({ error: 'Two Family Circles are linked to this client. Fix that on the client profile first.' }, 409)
      let circle: Any = circs?.[0] ?? null
      const { data: mem0 } = circle ? await db.from('circle_contacts').select('*').eq('circle_id', circle.id) : { data: [] }
      const members: Any[] = mem0 ?? []

      if (action === 'contacts') {
        const plans = planContacts(contacts, slots, members, r.id)
        return json({ ok: true, client_ax: ax, circle: circle ? { id: circle.id } : null, review,
          contacts: contacts.map((c) => { const pl = plans[c.n], m = pl.hub.member_id ? members.find((x) => String(x.id) === pl.hub.member_id) : null
            return { ...c, plan: pl, bad_state: badState(c), todo: todoFor(c),
              axiscare_now: pl.axiscare.slot && pl.axiscare.action === 'update' ? slotView(slotRaw(pl.axiscare.slot)) : null,
              hub_now: m ? { name: m.name, phone: m.phone, email: m.email, sms_consent: m.sms_consent === true, stopped: !!m.stopped_at } : null } }) })
      }

      // contacts_apply: only the people the office approved, each with any typo fixes
      const asks: Any[] = Array.isArray(b.people) ? b.people.slice(0, 4) : []
      if (!asks.length) return json({ error: 'Pick who to approve.' }, 400)
      const edited: Any[] = [], results: Any[] = []
      for (const c of contacts) {
        const ask = asks.find((p) => Number(p?.n) === c.n)
        if (!ask) continue
        if (review.people[c.n]?.outcome === 'done') { results.push({ n: c.n, outcome: 'already_done' }); continue }
        if (ask.include === false) { review.people[c.n] = { outcome: 'left_out', by: who.email, at: now }; results.push({ n: c.n, outcome: 'left_out' }); continue }
        const e = withEdits(c, ask.edits)
        if (e.problems.length) { results.push({ n: c.n, outcome: 'problems', problems: e.problems }); continue }
        edited.push({ c: e.contact, changed: e.changed })
      }
      if (edited.length && !circle) {
        const cname = tt(r.answers?.['client.client_s_name']) || 'Client ' + ax
        const { data: made, error: me } = await db.from('care_circles').insert({ client_name: cname }).select('id, client_name')
        if (me || !made?.[0]) throw me || new Error('no circle')
        const { data: link, error: le } = await db.rpc('family_circle_link', { p_circle_id: String(made[0].id), p_axiscare_client_id: ax, p_staff: who.email, p_how: 'client_agreement' })
        if (le || link?.outcome !== 'linked') return json({ error: 'A Family Circle could not be linked to this client (' + (le?.message || link?.outcome || 'no answer') + '). Nothing was sent.' }, 409)
        circle = made[0]
      }
      // plan with the fixed names, against the other people AxisCare and the circle already hold
      const plans = planContacts(edited.map((x) => x.c), slots, members, r.id)
      let hasPrimary = members.some((m) => m.is_primary === true)
      for (const { c, changed } of edited) {
        const pl = plans[c.n], rec: Any = { by: who.email, at: now, changed, axiscare: { action: pl.axiscare.action, slot: pl.axiscare.slot, why: pl.axiscare.why ?? null } }
        let v: Any = null
        if (pl.axiscare.slot) {
          const what = `responsible party ${pl.axiscare.slot} ${pl.axiscare.action === 'add' ? 'added' : 'updated'} from the signed Client Care Agreement`
          const w = await axis('PUT', `/api/clients/${ax}/responsibleParties/${pl.axiscare.slot}`, rpBody(c, slotRaw(pl.axiscare.slot)))
          if (!okS(w.status)) { rec.axiscare.outcome = 'refused'; rec.axiscare.detail = axErr(w); await axisLog(db, { client: ax, outcome: 'refused', summary: what, detail: axErr(w), by: who.email }) }
          else {
            const back = await axis('GET', `/api/clients/${ax}/responsibleParties/${pl.axiscare.slot}`)
            v = okS(back.status) ? slotView(back.json?.results ?? back.json) : null
            if (!v || nameKey(v.name) !== nameKey(c.name)) { v = null; rec.axiscare.outcome = 'unconfirmed'; rec.axiscare.detail = 'AxisCare accepted it but the read-back did not show it yet'; await axisLog(db, { client: ax, outcome: 'sent', summary: what, detail: rec.axiscare.detail, by: who.email }) }
            else {
              const same = v.hipaa_authorized === c.hipaa && v.can_make_medical_decisions === c.medical
              rec.axiscare.outcome = same ? 'confirmed' : 'saved_differently'
              if (!same) rec.axiscare.detail = 'AxisCare holds the HIPAA or Medical Decisions answer differently: check the client in AxisCare'
              await axisLog(db, { client: ax, outcome: same ? 'sent_confirmed' : 'sent', summary: what, detail: rec.axiscare.detail ?? null, by: who.email })
            }
          }
        } else rec.axiscare.outcome = 'hub_only'
        const hubRow: Any = memberRow(c, v, { agreementId: r.id, by: who.email, at: now })
        let hubErr: Any = null, memberId = pl.hub.member_id
        if (memberId) { const { error } = await db.from('circle_contacts').update(hubRow).eq('id', memberId as never); hubErr = error }
        else {
          const { data: ins, error } = await db.from('circle_contacts').insert({ circle_id: circle.id, ...hubRow, is_primary: !hasPrimary }).select('id')
          hubErr = error; memberId = ins?.[0]?.id ?? null; if (!error && !hasPrimary) hasPrimary = true
        }
        rec.hub = hubErr ? { action: pl.hub.action, outcome: 'failed', detail: String(hubErr.message || hubErr).slice(0, 200) } : { action: pl.hub.action, outcome: 'saved', member_id: memberId ? String(memberId) : null }
        const axOk = ['confirmed', 'saved_differently', 'hub_only'].includes(rec.axiscare.outcome)
        rec.outcome = axOk && !hubErr ? 'done' : 'needs_another_try'
        review.people[c.n] = rec; results.push({ n: c.n, ...rec })
      }
      review.last_by = who.email; review.last_at = now
      await keep()
      return json({ ok: true, results, review })
    }

    return json({ error: 'Unknown action.' }, 400)
  } catch (e) {
    console.error('client-agreement', action, e)
    return json({ error: 'Something went wrong. Try again, and tell Samantha if it keeps happening.' }, 500)
  }
})
