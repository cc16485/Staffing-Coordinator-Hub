// =============================================================================
// agreement-sign · the PUBLIC door for signing the Client Care Agreement from home (874, Stage 3; Samantha 2026-10-17:
// "start stage 3"; her answers "Office picks each time", "6-digit code", "7 days", code "Any time").
// No Hub sign-in here: the link's secret (sent by the office, stored only as a hash) opens ONE agreement and nothing else,
// and only after a 6-digit code sent to the same phone or email the link went to. A good code opens a 2-hour session.
//   open   {t}                 is the link good? who is it for, and where can the code go (masked)
//   code   {t, via}            send a 6-digit code (any hour, her answer; at most 6 per link, 45 seconds apart)
//   verify {t, code}           5 tries per code, 10 minutes; a good code gives {s}, the session
//   get    {t, s}              the agreement to fill in (no other client data, nothing about the office)
//   save   {t, s, answers}     family answers only
//   sign   {t, s, ...}         the same family signature as the tablet (_shared/agreement-family-sign.ts), with the link
//                              and the code check recorded; then Needs Attention asks the office to countersign
// Nothing here changes AxisCare. The only messages it sends are the codes the person asks for.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { FIELDS, VERSION, DOC, PDF_SHA256, ESIGN_WORDS, INITIALS, OFFICE_KEYS, cleanAnswers } from '../_shared/client-agreement.ts'
import { familySign } from '../_shared/agreement-family-sign.ts'
import { CODE_MINUTES, CODE_TRIES, CODE_SENDS, CODE_GAP_SECONDS, SESSION_HOURS, SECRET_OK, sha256, secret, sixDigits, codeHash, maskPhone, maskEmail, codeMessages, sendFamily, raiseCountersignCard } from '../_shared/agreement-links.ts'

// deno-lint-ignore no-explicit-any
type Any = any
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const S = (v: unknown, n: number) => String(v ?? '').slice(0, n)
const ipOf = (req: Request) => S(req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0], 64).trim()
const agentOf = (req: Request) => S(req.headers.get('user-agent'), 200)
const FORM_INFO = { doc: DOC, version: VERSION, pdf_sha256: PDF_SHA256, esign_words: ESIGN_WORDS, initials: INITIALS,
  fields: Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, f.type])), office_keys: [...OFFICE_KEYS] }
const CALL = 'Please call Caring Companions at (417) 234-8494.'
/** Only what the family needs to fill in their agreement. */
const familyView = (r: Any) => ({ id: r.id, status: r.status, version: r.version, pdf_sha256: r.pdf_sha256, office: { answers: r.office?.answers ?? {} }, answers: r.answers ?? {} })

if (typeof Deno !== 'undefined' && Deno.serve) Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405)
  let b: Any = {}
  try { b = await req.json() } catch { return json({ error: 'Bad request.' }, 400) }
  const action = String(b?.action ?? '')
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  try {
    const t = String(b?.t ?? '')
    if (!SECRET_OK.test(t)) return json({ error: 'This link is not complete. Open it again from the text or email. ' + CALL, outcome: 'bad_link' }, 400)
    const { data: ls, error: le } = await db.from('client_agreement_links').select('*').eq('token_hash', await sha256(t)).limit(1)
    if (le) throw le
    const link = ls?.[0]
    if (!link) return json({ error: 'This link does not work. ' + CALL, outcome: 'bad_link' }, 404)
    const { data: ags, error: ae } = await db.from('client_agreements').select('*').eq('id', link.agreement_id).limit(1)
    if (ae) throw ae
    const r = ags?.[0]
    if (!r) return json({ error: 'This link does not work. ' + CALL, outcome: 'bad_link' }, 404)
    if (link.signed_at || (r.status !== 'draft' && r.status !== 'void')) return json({ ok: true, state: 'signed', outcome: 'signed' })
    if (link.revoked_at || r.status === 'void') return json({ error: 'This link was cancelled or replaced by a newer one. Use the newest text or email from us, or ' + CALL.toLowerCase(), outcome: 'cancelled' }, 410)
    if (Date.parse(link.expires_at) <= Date.now()) return json({ error: 'This link has expired. ' + CALL + ' We will send you a new one.', outcome: 'expired' }, 410)
    const now = new Date().toISOString()
    const upd = async (patch: Record<string, unknown>) => { const { error } = await db.from('client_agreement_links').update(patch).eq('id', link.id); if (error) throw error }
    const options = [link.to_phone ? { via: 'sms', to: maskPhone(link.to_phone) } : null, link.to_email ? { via: 'email', to: maskEmail(link.to_email) } : null].filter(Boolean)

    if (action === 'open') {
      if (!link.opened_at) await upd({ opened_at: now })
      return json({ ok: true, state: 'need_code', to_name: link.to_name, options, expires_at: link.expires_at })
    }

    if (action === 'code') {
      const via = b.via === 'email' ? 'email' : 'sms'
      if (!options.some((o: Any) => o.via === via)) return json({ error: 'That way is not on this link.' }, 400)
      if ((link.code_sends ?? 0) >= CODE_SENDS) return json({ error: 'Too many codes were sent for this link. ' + CALL, outcome: 'too_many' }, 429)
      if (link.code_sent_at && Date.now() - Date.parse(link.code_sent_at) < CODE_GAP_SECONDS * 1000) return json({ error: 'A code was just sent. Please wait a minute, then try again.', outcome: 'wait' }, 429)
      const code = sixDigits(), m = codeMessages(code)
      const sent = await sendFamily(db, { token: Deno.env.get('GHL_API_KEY') || '', locationId: Deno.env.get('GHL_LOCATION_ID') || '' },
        { channel: via, phone: link.to_phone ?? undefined, email: link.to_email ?? undefined, toName: link.to_name, sender: 'agreement-code', kind: 'requested_external', sms: m.sms, subject: m.subject, html: m.html })
      if (sent.outcome !== 'sent') return json({ error: 'We could not send the code. ' + CALL, outcome: 'not_sent' }, 502)
      await upd({ code_hash: await codeHash(link.id, code), code_channel: via, code_sent_at: now, code_expires_at: new Date(Date.now() + CODE_MINUTES * 60e3).toISOString(),
        code_sends: (link.code_sends ?? 0) + 1, code_tries: 0 })
      return json({ ok: true, outcome: 'sent', to: options.find((o: Any) => o.via === via)!.to })
    }

    if (action === 'verify') {
      const code = String(b.code ?? '').replace(/\D/g, '')
      if (!link.code_hash || !link.code_expires_at || Date.parse(link.code_expires_at) <= Date.now()) return json({ error: 'That code has expired. Tap "Send me a code" for a new one.', outcome: 'code_expired' }, 400)
      if ((link.code_tries ?? 0) >= CODE_TRIES) return json({ error: 'Too many tries. Tap "Send me a code" for a new one.', outcome: 'too_many' }, 429)
      if (code.length !== 6 || await codeHash(link.id, code) !== link.code_hash) {
        await upd({ code_tries: (link.code_tries ?? 0) + 1 })
        const left = CODE_TRIES - (link.code_tries ?? 0) - 1
        return json({ error: left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many tries. Tap "Send me a code" for a new one.', outcome: 'wrong' }, 400)
      }
      const s = secret()
      await upd({ code_hash: null, session_hash: await sha256(s), session_expires_at: new Date(Date.now() + SESSION_HOURS * 3600e3).toISOString(),
        verified_at: now, verified_via: link.code_channel, verified_to: link.code_channel === 'email' ? link.to_email : link.to_phone })
      return json({ ok: true, s, agreement: familyView(r), form: FORM_INFO, to_name: link.to_name })
    }

    // everything below needs the session the code opened
    const sOk = typeof b.s === 'string' && SECRET_OK.test(b.s) && link.session_hash && link.session_expires_at && Date.parse(link.session_expires_at) > Date.now() && await sha256(b.s) === link.session_hash
    if (!sOk) return json({ error: 'For your privacy, please confirm it is you again.', outcome: 'need_code' }, 401)

    if (action === 'get') return json({ ok: true, agreement: familyView(r), form: FORM_INFO, to_name: link.to_name })
    if (action === 'save') {
      const fam = cleanAnswers(b.answers || {}, 'family')
      if (fam.problems.length) return json({ error: 'Some answers are not right.', problems: fam.problems }, 422)
      const { data: did, error } = await db.from('client_agreements').update({ answers: fam.answers, updated_at: now }).eq('id', r.id).eq('status', 'draft').select('id')
      if (error) throw error
      return did?.length ? json({ ok: true, outcome: 'saved' }) : json({ error: 'This agreement was already signed.', outcome: 'stale' }, 409)
    }
    if (action === 'sign') {
      const [code, body] = await familySign(db, r, b, { ip: ipOf(req), agent: agentOf(req), where: { via_link: {
        link_id: link.id, sent_by: link.sent_by, sent_at: link.created_at, sent_to: options.map((o: Any) => o.to).join(' and '),
        code_via: link.verified_via, code_to: link.verified_via === 'email' ? maskEmail(link.verified_to) : maskPhone(link.verified_to), verified_at: link.verified_at } } })
      if (code === 200) {
        await upd({ signed_at: body.at, session_hash: null })
        await raiseCountersignCard(db, { agreementId: r.id, clientName: String(r.answers?.['client.client_s_name'] ?? b.answers?.['client.client_s_name'] ?? ''), signer: body.signer, ax: r.axiscare_client_id ?? '', leadId: r.lead_id ?? null })
      }
      return json(body, code)
    }
    return json({ error: 'Unknown action.' }, 400)
  } catch (e) {
    console.error('agreement-sign', action, e)
    return json({ error: 'Something went wrong. Try again, or ' + CALL.toLowerCase() }, 500)
  }
})
