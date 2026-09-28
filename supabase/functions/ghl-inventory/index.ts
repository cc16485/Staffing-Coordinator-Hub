// Supabase Edge Function: ghl-inventory (shared hub project) · READ ONLY · 2026-09-27
// -----------------------------------------------------------------------------
// Step 0 · 0c: GoHighLevel workflows send texts and emails on their own, started by things our code does (inbound
// webhooks, tags, new contacts). They honor GoHighLevel's Do Not Disturb but cannot see the Hub's opt-out record.
// This lists what GoHighLevel has, so each workflow can be reviewed: every workflow (name, live/draft, last change)
// and which of the tags our code adds exist in GoHighLevel. No contact, message or person is read; nothing is changed.
// Server-only: the exact service key, or a service-role sign-in the platform has verified (sign-in check ON).
// -----------------------------------------------------------------------------
const OUR_TAGS = ['lead', 'coverage-asked', 'confirm-asked', 'timekeeper-asked', 'active client', 'inactive client',
  'active employee', 'inactive employee', 'client', 'client-contact', 'caregiver', 'referral-partner',
  'HomeTogether Hire - Caregiver', 'HomeTogether Hire - Family']
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const tok = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  let role: unknown = null
  try { const b = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); role = JSON.parse(atob(b + '='.repeat((4 - b.length % 4) % 4))).role } catch { /* not a JWT */ }
  if (!((svc && tok === svc) || role === 'service_role')) return json({ error: 'server only' }, 401)

  const token = Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', location = Deno.env.get('GHL_LOCATION_ID') ?? ''
  if (!token || !location) return json({ error: 'GHL not configured' }, 500)
  const h = { Authorization: `Bearer ${token}`, Version: '2021-07-28', Accept: 'application/json' }
  const out: Record<string, unknown> = {}
  try {
    const r = await fetch(`https://services.leadconnectorhq.com/workflows/?locationId=${encodeURIComponent(location)}`, { headers: h })
    const j = await r.json().catch(() => ({}))
    // deno-lint-ignore no-explicit-any
    out.workflows = r.ok ? (j?.workflows ?? []).map((w: any) => ({ name: String(w.name ?? ''), status: String(w.status ?? ''), updated: String(w.updatedAt ?? w.updated_at ?? '').slice(0, 10) }))
                         : { error: `GoHighLevel answered ${r.status}` + (r.status === 401 || r.status === 403 ? ' (this key may not be allowed to read workflows)' : '') }
  } catch { out.workflows = { error: 'could not reach GoHighLevel' } }
  try {
    const r = await fetch(`https://services.leadconnectorhq.com/locations/${encodeURIComponent(location)}/tags`, { headers: h })
    const j = await r.json().catch(() => ({}))
    // deno-lint-ignore no-explicit-any
    const have = new Set((j?.tags ?? []).map((t: any) => String(t.name ?? '').toLowerCase()))
    out.tags = r.ok ? OUR_TAGS.map((t) => ({ tag: t, exists: have.has(t.toLowerCase()) })) : { error: `GoHighLevel answered ${r.status}` }
    out.tag_count = r.ok ? have.size : null
  } catch { out.tags = { error: 'could not reach GoHighLevel' } }
  return json({ ok: true, ...out })
})
