// =============================================================================
// family-form · SEND TO FAMILY, the PUBLIC door (Samantha 2026-10-28). No Hub sign-in: the link's secret (stored only as a
// hash) opens ONE piece for ONE client, and only after a 6-digit code to the same phone or email, exactly like signing the
// agreement from home (agreement-sign).
//   open   {t}                 is the link good, which piece, who for, where the code can go (masked)
//   code   {t, via}            a 6-digit code (at most 6 per link, 45 seconds apart)
//   verify {t, code}           5 tries, 10 minutes; a good code gives {s}, a 2-hour session, and what the page needs
//   submit {t, s, ...}         payment: checked, the numbers SEALED (FAMILY_PAY_KEK), a card for the Billing owner
//                              circle:  what to keep, change, remove or add; a card for the office only when something changed
//                              guide:   "Yes, call me about it" (a card) or "Not now"
// The page never gets other people's numbers back: only the circle check shows the circle's names, phones and emails, to the
// person the office chose, after the code. Nothing here changes AxisCare or the Family Circle by itself.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { CODE_MINUTES, CODE_TRIES, CODE_SENDS, CODE_GAP_SECONDS, SESSION_HOURS, SECRET_OK, sha256, secret, sixDigits, codeHash, maskPhone, maskEmail, sendFamily } from '../_shared/agreement-links.ts'
import { seal } from '../_shared/step1-crypto.ts'
import { ownerFor } from '../_shared/send-problems.ts'
import { PIECE_NAME, PAY_WORDS, CARD_FEE, codeMessages, cleanPayment, cleanCircle, circleSummary, cleanGuide, payLabel, reachOf, cardId, raiseCard } from '../_shared/family-send.ts'

// deno-lint-ignore no-explicit-any
type Any = any
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const S = (v: unknown, n: number) => String(v ?? '').slice(0, n)
const ipOf = (req: Request) => S(req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0], 64).trim()
const CALL = 'Please call Caring Companions at (417) 234-8494.'
const firstOf = (n: unknown) => String(n ?? '').trim().split(/\s+/)[0] || ''

async function circlePeople(db: Any, ax: string) {
  const { data: cs } = await db.from('care_circles').select('id').eq('axiscare_client_id', ax).limit(1)
  if (!cs?.[0]) return []
  const { data: ps } = await db.from('circle_contacts').select('*').eq('circle_id', cs[0].id)
  return (ps || []).filter((c: Any) => !c.axiscare_removed_at && !c.stopped_at)
}
async function pieceData(db: Any, l: Any) {
  if (l.piece === 'payment') return { words: PAY_WORDS, card_fee: CARD_FEE }
  if (l.piece === 'circle') return { people: (await circlePeople(db, l.client_ax)).map((c: Any) => { const r = reachOf(c)!; return { id: r.id, name: r.name, relationship: r.relationship, phone: r.phone, email: r.mail } }) }
  return {}
}

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
    const { data: ls, error: le } = await db.from('family_sends').select('*').eq('token_hash', await sha256(t)).limit(1)
    if (le) throw le
    const l = ls?.[0]
    if (!l) return json({ error: 'This link does not work. ' + CALL, outcome: 'bad_link' }, 404)
    if (l.done_at) return json({ ok: true, state: 'done', piece: l.piece, outcome: 'done' })
    if (l.revoked_at) return json({ error: 'This link was cancelled or replaced by a newer one. Use the newest text or email from us, or ' + CALL.toLowerCase(), outcome: 'cancelled' }, 410)
    if (Date.parse(l.expires_at) <= Date.now()) return json({ error: 'This link has expired. ' + CALL + ' We will send you a new one.', outcome: 'expired' }, 410)
    const now = new Date().toISOString()
    const upd = async (patch: Record<string, unknown>) => { const { error } = await db.from('family_sends').update(patch).eq('id', l.id); if (error) throw error }
    const options = [l.to_phone ? { via: 'sms', to: maskPhone(l.to_phone) } : null, l.to_email ? { via: 'email', to: maskEmail(l.to_email) } : null].filter(Boolean)
    const head = { piece: l.piece, piece_name: PIECE_NAME[l.piece as keyof typeof PIECE_NAME], to_name: l.to_name, client_first: firstOf(l.client_name), expires_at: l.expires_at }

    if (action === 'open') {
      if (!l.opened_at) await upd({ opened_at: now })
      return json({ ok: true, state: 'need_code', ...head, options })
    }
    if (action === 'code') {
      const via = b.via === 'email' ? 'email' : 'sms'
      if (!options.some((o: Any) => o.via === via)) return json({ error: 'That way is not on this link.' }, 400)
      if ((l.code_sends ?? 0) >= CODE_SENDS) return json({ error: 'Too many codes were sent for this link. ' + CALL, outcome: 'too_many' }, 429)
      if (l.code_sent_at && Date.now() - Date.parse(l.code_sent_at) < CODE_GAP_SECONDS * 1000) return json({ error: 'A code was just sent. Please wait a minute, then try again.', outcome: 'wait' }, 429)
      const code = sixDigits(), m = codeMessages(code)
      const sent = await sendFamily(db, { token: Deno.env.get('GHL_API_KEY') || Deno.env.get('GHL_TOKEN') || '', locationId: Deno.env.get('GHL_LOCATION_ID') || '' },
        { channel: via, phone: l.to_phone ?? undefined, email: l.to_email ?? undefined, toName: l.to_name, sender: 'family-form-code', kind: 'requested_external', sms: m.sms, subject: m.subject, html: m.html })
      if (sent.outcome !== 'sent') return json({ error: 'We could not send the code. ' + CALL, outcome: 'not_sent' }, 502)
      await upd({ code_hash: await codeHash(l.id, code), code_channel: via, code_sent_at: now, code_expires_at: new Date(Date.now() + CODE_MINUTES * 60e3).toISOString(), code_sends: (l.code_sends ?? 0) + 1, code_tries: 0 })
      return json({ ok: true, outcome: 'sent', to: options.find((o: Any) => o.via === via)!.to })
    }
    if (action === 'verify') {
      const code = String(b.code ?? '').replace(/\D/g, '')
      if (!l.code_hash || !l.code_expires_at || Date.parse(l.code_expires_at) <= Date.now()) return json({ error: 'That code has expired. Tap "Send me a code" for a new one.', outcome: 'code_expired' }, 400)
      if ((l.code_tries ?? 0) >= CODE_TRIES) return json({ error: 'Too many tries. Tap "Send me a code" for a new one.', outcome: 'too_many' }, 429)
      if (code.length !== 6 || await codeHash(l.id, code) !== l.code_hash) {
        await upd({ code_tries: (l.code_tries ?? 0) + 1 })
        const left = CODE_TRIES - (l.code_tries ?? 0) - 1
        return json({ error: left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many tries. Tap "Send me a code" for a new one.', outcome: 'wrong' }, 400)
      }
      const s = secret()
      await upd({ code_hash: null, session_hash: await sha256(s), session_expires_at: new Date(Date.now() + SESSION_HOURS * 3600e3).toISOString(), verified_at: now, verified_via: l.code_channel })
      return json({ ok: true, s, ...head, data: await pieceData(db, l) })
    }

    const sOk = typeof b.s === 'string' && SECRET_OK.test(b.s) && l.session_hash && l.session_expires_at && Date.parse(l.session_expires_at) > Date.now() && await sha256(b.s) === l.session_hash
    if (!sOk) return json({ error: 'For your privacy, please confirm it is you again.', outcome: 'need_code' }, 401)
    if (action !== 'submit') return json({ error: 'Unknown action.' }, 400)
    const done = async (result: Any) => {
      const { data: did, error } = await db.from('family_sends').update({ done_at: now, result, session_hash: null }).eq('id', l.id).is('done_at', null).select('id')
      if (error) throw error
      return !!did?.length
    }
    const who = l.to_name, client = l.client_name || 'the client'
    const practice = l.sent_by === 'desktop-proof'   // the Desktop step's proof: saved and sealed like a real one, but no card

    if (l.piece === 'payment') {
      const c = cleanPayment(b)
      if (!c.ok) return json({ error: 'Some answers need a fix.', problems: c.problems }, 422)
      const kek = Deno.env.get('FAMILY_PAY_KEK') || ''
      if (!kek) return json({ error: 'We could not save this right now. ' + CALL }, 503)
      const id = crypto.randomUUID()
      const sealed = await seal(kek, id, JSON.stringify(c.secret))
      const { error: pe } = await db.from('family_payments').insert({ id, send_id: l.id, client_ax: l.client_ax, client_name: l.client_name, ...c.row, sealed, signed_at: now,
        ip: ipOf(req), agent: S(req.headers.get('user-agent'), 200) })
      if (pe) { if (String(pe.code) === '23505') return json({ ok: true, state: 'done', piece: l.piece, outcome: 'done' }); throw pe }
      await done({ method: c.row.method, last4: c.row.last4 })
      // an older form for this client that still holds numbers is replaced: erase it now
      await db.from('family_payments').update({ sealed: null, erased_at: now, erased_why: 'replaced' }).eq('client_ax', l.client_ax).neq('id', id).not('sealed', 'is', null)
      const label = payLabel(c.row)
      if (!practice) await raiseCard(db, await ownerFor(db, 'billing'), { id: cardId('pay', l.id), kind: 'family_payment', domain: 'billing', sensitive: true, ax: l.client_ax, who: client,
        title: `Payment form back from ${who}: enter it in AxisCare`, detail: `${label} for ${client}, signed ${new Date(now).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. Open the client, Payer tab, Send to family.`,
        next: 'Show the numbers, type them into AxisCare, then press "Entered in AxisCare". They erase themselves in 7 days either way.' })
      return json({ ok: true, state: 'done', piece: 'payment', label, signed_at: now, words: PAY_WORDS })
    }
    if (l.piece === 'circle') {
      const known = (await circlePeople(db, l.client_ax)).map((x: Any) => String(x.id))
      const c = cleanCircle(b, known)
      if (!c.ok) return json({ error: 'Some answers need a fix.', problems: c.problems }, 422)
      await done(c.result)
      if (c.result.changes && !practice) await raiseCard(db, await ownerFor(db, 'client_care'), { id: cardId('circle', l.id), kind: 'family_circle_check', domain: 'client_care', ax: l.client_ax, who: client,
        title: `Family Circle changes from ${who}`, detail: `For ${client}: ${circleSummary(c.result)}`.slice(0, 900), next: 'Update Family & Contacts (and AxisCare if a responsible party changed), then close this.' })
      return json({ ok: true, state: 'done', piece: 'circle', changes: c.result.changes })
    }
    if (l.piece === 'guide') {
      const g = cleanGuide(b); if (!g) return json({ error: 'Pick an answer.' }, 422)
      await done(g)
      if (g.answer === 'call_me' && !practice) await raiseCard(db, await ownerFor(db, 'client_care'), { id: cardId('guide', l.id), kind: 'family_guide_call', domain: 'client_care', ax: l.client_ax, who: client,
        title: `${who} wants a call about Medicare GUIDE`, detail: `For ${client}.${g.best_time ? ' Best time: ' + g.best_time + '.' : ''} They read the GUIDE page from Send to family.`, next: 'Call them back and walk through whether GUIDE fits.' })
      return json({ ok: true, state: 'done', piece: 'guide', answer: g.answer })
    }
    return json({ error: 'Unknown piece.' }, 400)
  } catch (e) {
    console.error('family-form', action, String(e).slice(0, 300))
    return json({ error: 'Something went wrong. Try again, or ' + CALL.toLowerCase() }, 500)
  }
})
