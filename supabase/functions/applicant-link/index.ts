// =============================================================================
// applicant-link · private applicant links (Samantha "yes to all", 2026-10-04: https://claude.ai/artifact/MQgrEVdZ8Kr65LBLsha1Aq)
//   {action:'mint', kind:'start', offer_id}                 a signed-in office person (or the Training Platform's job
//   {action:'mint', kind:'orient', candidate_id, sessions}  offer, which forwards that person's Hub sign-in): a link
//                                                           that carries no personal details (_shared/applicant-links.ts)
//   {action:'open', kind, o|c, e, t}                        the page, with a link: who it is for, so the page can greet
//                                                           them and fill in what we already know (decision 1). A made-up,
//                                                           altered or expired link gets nothing.
//   {action:'book', c, e, t, session_id}                    the orientation page: the booking is saved under the person
//                                                           the link was made for (it can't be booked in someone else's
//                                                           name); with no link (the office's all-sessions link) it is
//                                                           saved as before, under "Unknown"
// Reads the job offer from the Training Platform through the existing server-only connection (OFFERS_PROJECT_URL /
// OFFERS_SERVICE_ROLE_KEY). Sends nothing.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { checkLink, makeOrientLink, makeStartLink, okId, type Kind } from '../_shared/applicant-links.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const S = (v: unknown, n = 120) => String(v ?? '').trim().slice(0, n)
const NOPE = { ok: false, error: 'This link is not valid or has run out. Please ask the office for a new one: (417) 234-8494.' }

// deno-lint-ignore no-explicit-any
async function offer(id: string): Promise<any | null> {
  const OF_URL = Deno.env.get('OFFERS_PROJECT_URL') ?? '', OF_KEY = Deno.env.get('OFFERS_SERVICE_ROLE_KEY') ?? ''
  if (!OF_URL || !OF_KEY) throw new Error('the job offers connection is not set up')
  const r = await fetch(`${OF_URL}/rest/v1/job_offers?id=eq.${encodeURIComponent(id)}&select=id,first_name,last_name,phone,email`, { headers: { apikey: OF_KEY, Authorization: `Bearer ${OF_KEY}` } })
  if (!r.ok) throw new Error('the Training Platform answered ' + r.status)
  const rows = await r.json()
  return Array.isArray(rows) && rows.length === 1 ? rows[0] : null
}
// deno-lint-ignore no-explicit-any
async function candidate(db: any, id: string): Promise<any | null> {
  const { data, error } = await db.from('app_data').select('data').eq('key', 'candidates').maybeSingle()
  if (error) throw new Error('Background & References could not be read')
  // deno-lint-ignore no-explicit-any
  return (Array.isArray(data?.data) ? data.data : []).find((c: any) => c && String(c.id) === id) ?? null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  // deno-lint-ignore no-explicit-any
  let b: any = {}
  try { b = await req.json() } catch { b = {} }
  const secret = Deno.env.get('HUB_JOB_SECRET') ?? ''
  if (secret.length < 32) return json({ ok: false, error: 'links are not set up' }, 500)
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  const action = S(b.action, 20)
  try {
    if (action === 'mint') {
      const staff = await requireStaff(db, req, OFFICE_ROLES)
      if (!staff.ok) return json({ ok: false, error: staff.error }, staff.status)
      if (b.kind === 'start') {
        const id = S(b.offer_id, 64)
        if (!okId('start', id)) return json({ ok: false, error: 'Which job offer?' }, 400)
        return json({ ok: true, url: await makeStartLink(secret, id) })
      }
      if (b.kind === 'orient') {
        const id = S(b.candidate_id, 12), sessions = String(b.sessions ?? '')
        if (!okId('orient', id) || !/^[A-Za-z0-9+/=_-]{0,8000}$/.test(sessions)) return json({ ok: false, error: 'Which candidate?' }, 400)
        if (!(await candidate(db, id))) return json({ ok: false, error: 'That candidate is not in Background & References.' }, 404)
        return json({ ok: true, url: await makeOrientLink(secret, id, sessions) })
      }
      return json({ ok: false, error: 'Unknown link kind.' }, 400)
    }
    if (action === 'open') {
      const kind: Kind = b.kind === 'orient' ? 'orient' : 'start'
      const id = kind === 'start' ? S(b.o, 64) : S(b.c, 12)
      if (!(await checkLink(secret, kind, id, b.e, b.t))) return json(NOPE, 401)
      if (kind === 'start') {
        const o = await offer(id)
        if (!o) return json(NOPE, 404)
        return json({ ok: true, first: S(o.first_name, 60), last: S(o.last_name, 60), phone: S(o.phone, 30), email: S(o.email, 160) })
      }
      const c = await candidate(db, id)
      if (!c) return json(NOPE, 404)
      return json({ ok: true, first: S(c.first, 60), last: S(c.last, 60), phone: S(c.phone, 30), email: S(c.email, 160), office: S(c.office || 'springfield', 30), candidate_id: id })
    }
    if (action === 'book') {
      const sessionId = S(b.session_id, 60)
      const { data: os } = await db.from('app_data').select('data').eq('key', 'orient_sessions').maybeSingle()
      // deno-lint-ignore no-explicit-any
      const session = (Array.isArray(os?.data) ? os.data : []).find((s: any) => s && String(s.id) === sessionId)
      if (!session) return json({ ok: false, error: 'That orientation session is not open any more. Please call (417) 234-8494.' }, 404)
      let row: Record<string, unknown> = { session_id: sessionId, first: 'Unknown', last: '', phone: '', candidate_id: null }
      if (b.c != null || b.t != null) {
        const id = S(b.c, 12)
        if (!(await checkLink(secret, 'orient', id, b.e, b.t))) return json(NOPE, 401)
        const c = await candidate(db, id)
        if (!c) return json(NOPE, 404)
        row = { session_id: sessionId, first: S(c.first, 60) || 'Unknown', last: S(c.last, 60), phone: S(c.phone, 30), candidate_id: id }
      }
      const { error } = await db.from('orient_bookings').insert([row])
      if (error) return json({ ok: false, error: 'Your booking could not be saved. Please call (417) 234-8494.' }, 500)
      return json({ ok: true })
    }
    return json({ ok: false, error: 'Unknown action.' }, 400)
  } catch (e) {
    return json({ ok: false, error: 'Something went wrong. Please call (417) 234-8494.', detail: String((e as Error).message ?? e).slice(0, 120) }, 500)
  }
})
