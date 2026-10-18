// =============================================================================
// hr-draft · "Draft with AI" for a write-up (HR Agent build step 6, Samantha 2026-10-18: "build step 6")
// =============================================================================
// Samantha or Zach (owner_admin, checked with their own sign-in) sends { id } of a write-up. This reads that write-up,
// the caregiver's history and the approved handbook wording, asks Claude for a draft notice (_shared/hr-draft-prompt.ts)
// and returns the text. It saves nothing and sends nothing: Zach reads it in the write-up window, edits it, and only his
// save changes the write-up (which the audit trail records). Claude is covered by the signed Anthropic BAA.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { requireStaff } from '../_shared/staff-auth.ts'
import { SYSTEM, buildUser, pickHandbook } from '../_shared/hr-draft-prompt.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
const arr = (x: any): any[] => (Array.isArray(x) ? x : [])

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })
  const who = await requireStaff(admin, req, ['owner_admin'])
  if (!who.ok) return json({ error: who.status === 403 ? 'Only Samantha or Zach can draft a write-up.' : who.error }, who.status)
  const body = await req.json().catch(() => ({}))
  if (body?.auth_check) return json({ ok: true })
  const id = String(body?.id ?? '').trim()
  if (!id) return json({ error: 'Which write-up? Open it and try again.' }, 400)
  const key = async (k: string) => (await admin.from('app_data').select('data').eq('key', k).maybeSingle()).data?.data
  const [list, rules] = await Promise.all([key('discipline_actions'), key('hr_handbook')])
  const item = arr(list).find((a) => a && String(a.id) === id)
  if (!item) return json({ error: 'That write-up is not on file. Reload the page and try again.' }, 404)
  const cg = String(item.axiscare_caregiver_id || item.ax_caregiver_id || '')
  const same = (a: { axiscare_caregiver_id?: string; ax_caregiver_id?: string; caregiver?: string }) =>
    cg ? String(a.axiscare_caregiver_id || a.ax_caregiver_id || '') === cg : String(a.caregiver || '').toLowerCase() === String(item.caregiver || '').toLowerCase()
  const history = arr(list).filter((a) => a && a.id !== item.id && same(a)).map((a) => ({ id: a.id, status: a.status, level: a.level, reason: a.reason, when: String(a.issued_at || a.created_at || '').slice(0, 10) }))
  if (cg) {
    const { data: co } = await admin.from('hr_coaching').select('topic,status,held_on').eq('axiscare_caregiver_id', cg).eq('status', 'done')
    for (const c of arr(co)) history.push({ id: 'c', status: 'done', kind: 'coaching', level: 'Coaching talk', reason: c.topic, when: String(c.held_on || '') } as never)
  }
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'The AI key is not set on the server. Tell Claude.' }, 500)
  const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'long', day: 'numeric' })
  try {
    const client = new Anthropic({ apiKey })
    const msg = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      // deno-lint-ignore no-explicit-any
      ...({ fallbacks: 'default' } as any),
      output_config: { effort: 'medium' },
      system: SYSTEM,
      messages: [{ role: 'user', content: buildUser(item, history, pickHandbook(item, arr(rules)), today) }],
    })
    if (msg.stop_reason === 'refusal') return json({ error: 'The AI would not draft this one. Write it by hand.' }, 422)
    // deno-lint-ignore no-explicit-any
    const text = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').replace(/\u2014/g, ',').trim()
    if (!text) return json({ error: 'The AI returned nothing. Try again, or write it by hand.' }, 502)
    return json({ ok: true, draft: text, by: who.email })
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'The AI is busy. Try again in a minute.' }, 429)
    if (e instanceof Anthropic.APIError) return json({ error: 'The AI did not answer (' + e.status + '). Try again, or write it by hand.' }, 502)
    return json({ error: 'The draft did not work: ' + String((e as Error)?.message || e).slice(0, 200) }, 500)
  }
})
