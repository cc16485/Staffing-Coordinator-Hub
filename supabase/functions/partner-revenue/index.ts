// =============================================================================
// partner-revenue · the billed-revenue estimate for the owners' Program view (Referral Partner Program, 2026-10-26).
// A signed-in OWNER only (Samantha, Zachary). POST {} → for each program partner: referred clients who started care,
// completed visits and hours, and the billed estimate from AxisCare visits (rules: _shared/partner-revenue.ts).
//   ?auth_check=1   says who the caller is, does nothing
// Read only: AxisCare is only read, nothing is saved, nothing is sent. Tracking only, nothing about paying partners.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff } from '../_shared/staff-auth.ts'
import { axVisitsReader, chiDay } from '../_shared/packet-visits.ts'
import { referredClients, billedFrom, byPartner } from '../_shared/partner-revenue.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const MAX_CLIENTS = 80

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const url = new URL(req.url)
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } })
  const who = await requireStaff(db, req, ['owner_admin'])
  if (!who.ok) return json({ error: who.status === 403 ? 'Only Samantha or Zachary can see billed revenue.' : who.error }, who.status)
  if (url.searchParams.get('auth_check') === '1') return json({ ok: true, who: who.email })

  const read = async (key: string) => { const { data } = await db.from('app_data').select('data').eq('key', key).maybeSingle(); return Array.isArray(data?.data) ? data!.data : [] }
  let leads: unknown[] = [], orgs: unknown[] = []
  try { [leads, orgs] = await Promise.all([read('leads'), read('referral_orgs')]) } catch { return json({ error: 'Could not read the Hub records.' }, 500) }

  const all = referredClients(leads as never[], orgs as never[]), clients = all.slice(0, MAX_CLIENTS), today = chiDay(0)
  const visitsOf = axVisitsReader()
  const rows: Array<{ org_id: string; ax: string; result: ReturnType<typeof billedFrom> | null }> = []
  for (const c of clients) {
    const vs = await visitsOf(c.ax, c.from, today)
    rows.push({ org_id: c.org_id, ax: c.ax, result: vs ? billedFrom(vs, c.ax, c.from, today) : null })
  }
  return json({ at: new Date().toISOString(), through: today, partners: byPartner(rows), clients: clients.length, more_than_read: all.length - clients.length,
    basis: 'completed AxisCare visits since each client\'s first shift, times each visit\'s charge rate; not invoices or payments' })
})
