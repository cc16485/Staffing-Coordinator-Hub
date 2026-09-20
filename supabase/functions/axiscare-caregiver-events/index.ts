// =============================================================================
// axiscare-caregiver-events — RECEIVE → LOG RAW EVIDENCE → NOTHING ELSE
// =============================================================================
// Her B1.1 order (2026-09-20): the smallest possible caregiver webhook
// receiver, for the observation/proof phase only. It records what AxisCare
// actually sends (the spec documents the event names but NO payload), so the
// eventual Hire Connect design can key on PROVEN payload shapes.
//
// This function performs NO business behavior of any kind: no Hire Connect
// item, no identity write, no applicant/intake update, no overlay write, no
// task, no notification, no SMS/email, no GHL action, no matching, no
// lifecycle mutation, no compliance action. Its single write is the raw
// evidence item in app_data `caregiver_event_log` (fail-closed key map row
// added by the deploy script). Undocumented payload fields are captured as
// evidence, never interpreted into behavior.
//
// Deployed --no-verify-jwt: AxisCare is an external caller (same as the
// client webhook). Authorization header values are redacted in the log.
// =============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const stamp = new Date().toISOString()
  let raw = ''
  try { raw = await req.text() } catch { /* evidence of a body we could not read is itself evidence */ }
  // deno-lint-ignore no-explicit-any
  let parsed: any = null
  try { parsed = JSON.parse(raw) } catch { /* non-JSON stays raw */ }

  const headers: Record<string, string> = {}
  for (const [k, v] of req.headers) {
    if (/axiscare|signature|event|webhook|content-type|user-agent|x-request|x-forwarded|authorization/i.test(k))
      headers[k] = /authorization/i.test(k) ? '(present, redacted)' : v
  }

  const evType = parsed?.event ?? parsed?.type ?? parsed?.eventType ?? parsed?.topic ?? null
  const cgId = parsed?.caregiver?.id ?? parsed?.data?.caregiver?.id ?? parsed?.caregiverId
    ?? parsed?.data?.id ?? null
  const evId = parsed?.eventId ?? parsed?.event_id ?? parsed?.id ?? parsed?.uuid ?? null

  const item = {
    id: 'cge_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    received_at: stamp,
    method: req.method,
    url_query: new URL(req.url).search || '',
    headers,
    raw_event_type: evType != null ? String(evType) : null,
    caregiver_id_if_present: cgId != null ? String(cgId) : null,
    event_id_if_present: evId != null ? String(evId) : null,
    raw_body: raw.slice(0, 60000),
    body_truncated: raw.length > 60000,
  }
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    await sb.rpc('upsert_app_data_item', { target_key: 'caregiver_event_log', item })
  } catch (_e) { /* evidence loss is reported by reconciliation, never by failing the sender */ }

  /* Always answer 200 fast: a proof-phase receiver must never trigger the
     sender's retry storm or make AxisCare mark the endpoint dead. */
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
