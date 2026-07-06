// Supabase Edge Function: lead-intake (shared hub project)
// Public webhook: the website's "request care" form posts here and the
// submission becomes a lead in the CC Hub's pipeline, with the follow-up
// clock already started. Deployed with --no-verify-jwt (forms can't sign in),
// gated instead by a token in the URL: ?token=cclead_...
// Accepts JSON or normal form posts. Creates leads only — can't read anything.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = new URL(req.url)
  const expected = Deno.env.get('LEAD_INTAKE_TOKEN')
  if (!expected || url.searchParams.get('token') !== expected) return json({ error: 'unauthorized' }, 401)

  // deno-lint-ignore no-explicit-any
  let body: Record<string, any> = {}
  const ct = req.headers.get('content-type') || ''
  try {
    if (ct.includes('application/json')) body = await req.json()
    else {
      const form = await req.formData()
      for (const [k, v] of form.entries()) body = { ...body, [k]: String(v) }
    }
  } catch { return json({ error: 'could not read the submission' }, 400) }

  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = body[k]
      if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 500)
    }
    return ''
  }
  // Tolerant field mapping — website builders name fields all kinds of ways.
  let first = pick('first_name', 'firstName', 'fname')
  let last = pick('last_name', 'lastName', 'lname')
  const fullName = pick('name', 'full_name', 'fullName')
  if (!first && fullName) { const parts = fullName.split(/\s+/); first = parts[0]; last = parts.slice(1).join(' ') }
  const phone = pick('phone', 'phone_number', 'mobile', 'tel')
  const email = pick('email', 'email_address')
  if (!first && !phone && !email) return json({ error: 'submission had no name, phone or email' }, 400)
  const notes = [
    pick('message', 'notes', 'comments', 'situation', 'how_can_we_help', 'description'),
    pick('care_for', 'who_needs_care') ? 'Care for: ' + pick('care_for', 'who_needs_care') : '',
    pick('city') ? 'City: ' + pick('city') : '',
    pick('best_time', 'preferred_contact_time') ? 'Best time: ' + pick('best_time', 'preferred_contact_time') : '',
  ].filter(Boolean).join('\n')

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
  const lead = {
    id: crypto.randomUUID(),
    first_name: first || '(website lead)',
    last_name: last,
    phone,
    email,
    source: 'Website',
    status: 'New',
    interest_notes: notes || 'Website form submission (no message left).',
    follow_up_due: today, // the clock starts the moment they reach out
    created_at: new Date().toISOString(),
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'leads', item: lead })
  if (error) return json({ error: error.message }, 500)
  return json({ status: 'lead created', id: lead.id })
})
