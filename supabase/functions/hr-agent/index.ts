// =============================================================================
// hr-agent · THE HR AGENT, IN PRACTICE (HR Agent build step 4, Samantha 2026-10-18: "start step 4 now")
// =============================================================================
// Once a morning it reads attendance (app_data attendance_events), the missed-notes job's counted misses (missed_notes)
// and kind words about caregivers (kind_words), applies the approved HR Agent Rulebook (_shared/hr-agent-rules.ts) and
// saves each new case in hr_cases: recognition, a coaching opportunity, a recurring concern for Zach, or serious.
// PRACTICE until ops_settings.hr_agent_live === true: cases are saved with practice = true for Samantha and Zach to mark
// "agree" or "disagree" on the HR page. Nothing is texted, emailed or assigned, and nothing is written anywhere else.
// Live mode is build step 10 (coaching tasks and Zach's alerts are built in steps 5 and 7; until then live saves the
// same cases with practice = false and still sends nothing). Caregivers only; never clients or families.
//
//   (schedule / owner key)   the morning run · ?dry=1 counts what it would save and saves nothing · ?auth_check=1
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { findCases, settingsFrom } from '../_shared/hr-agent-rules.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
const arr = (x: any): any[] => (Array.isArray(x) ? x : [])

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  const q = new URL(req.url).searchParams
  if (q.get('auth_check') === '1') return json({ ok: true, caller })
  const dry = q.get('dry') === '1'
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })
  const now = Date.now()
  try {
    const key = async (k: string) => (await db.from('app_data').select('data').eq('key', k).maybeSingle()).data?.data
    const [ops, settings, events, roster] = await Promise.all([key('ops_settings'), key('settings'), key('attendance_events'), key('caregivers')])
    const live = (ops || {}).hr_agent_live === true
    const since = new Date(now - 120 * 864e5).toISOString().slice(0, 10)
    const mn = await db.from('missed_notes').select('id,axiscare_caregiver_id,caregiver_name,shift_date,status,counts').eq('counts', true).gte('shift_date', since)
    const kw = await db.from('kind_words').select('id,quote,who,about_role,status,link,said_on,created_at').eq('status', 'kind').eq('about_role', 'caregiver').gte('created_at', since)
    const pr = await db.from('hr_cases').select('id,axiscare_caregiver_id,rule,kind,status,review,created_at').gte('created_at', since)
    if (mn.error || kw.error || pr.error) throw new Error('read failed: ' + (mn.error || kw.error || pr.error)?.message)
    const names: Record<string, string> = {}
    for (const c of arr(roster)) { const id = String(c?.axiscare_id || '').trim(); if (id) names[id] = [c.first, c.last].filter(Boolean).join(' ') }
    const found = findCases({ now, events: arr(events), missedNotes: arr(mn.data), kindWords: arr(kw.data), prior: arr(pr.data), names, settings: settingsFrom((settings || {}).attendance, ops) })
    const byKind: Record<string, number> = {}
    for (const c of found) byKind[c.kind] = (byKind[c.kind] || 0) + 1
    const out = { live, dry, found: found.length, by_kind: byKind, saved: 0 }
    if (!dry && found.length) {
      const rows = found.map((c) => ({ ...c, practice: !live, status: 'open' }))
      const { error, count } = await db.from('hr_cases').upsert(rows, { onConflict: 'id', ignoreDuplicates: true, count: 'exact' })
      if (error) throw new Error('save failed: ' + error.message)
      out.saved = count ?? rows.length
    }
    if (!dry) await beat(db, true, JSON.stringify(out))
    return json({ ok: true, ...out })
  } catch (e) {
    if (!dry) await beat(db, false, String((e as Error)?.message || e))
    return json({ error: String((e as Error)?.message || e).slice(0, 300) }, 500)
  }
})

// deno-lint-ignore no-explicit-any
async function beat(db: any, ok: boolean, note: string) {
  try {
    await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats',
      item: { id: 'hb_hr-agent', automation: 'hr-agent', at: new Date().toISOString(), ok, note: String(note).slice(0, 300) } })
  } catch { /* never blocks */ }
}
