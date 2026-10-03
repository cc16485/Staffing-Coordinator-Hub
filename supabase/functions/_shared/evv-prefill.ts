// 427 · PRE-FILLED, VISIT-LINKED EVV CORRECTION FORM (Samantha, 2026-10-03: "go").
// -----------------------------------------------------------------------------
// The two texts that already carry the EVV form link (the person-tapped "Text <caregiver> the EVV form" on the missed
// clock-in page, and the clock-out reminder) now send a link that opens the form already filled in for that visit:
// https://sc.mo-care.com/evv-correction-form.html?t=<token>
//
// PRIVACY: the link carries ONLY a random token (no name, phone, email, client or date). The token points at one row
// in public.evv_prefill (staff-only table; the public cannot read it). The form asks the database for the few words it
// shows (evv_prefill_get), and the signed form is saved by evv_submit_prefilled, which links it to the caregiver,
// client and AxisCare visit FROM THE ROW, never from anything the browser sends. One use; 7 days.
//
// NOTHING NEW IS SENT. These helpers only make the link. If the row can't be made, the text goes out exactly as
// before with the plain (blank) form link, so a database hiccup never stops the caregiver getting the form.
// deno-lint-ignore-file no-explicit-any

export const EVV_FORM_PLAIN = 'sc.mo-care.com/evv-correction-form'
export const EVV_FORM_URL = 'https://sc.mo-care.com/evv-correction-form.html'
export const PREFILL_DAYS = 7

export type Prefill = {
  visit_id: string; caregiver_axiscare_id: string; client_axiscare_id?: string | null
  caregiver_name: string; client_first: string; client_last?: string | null
  visit_date: string; scheduled_in?: string | null; scheduled_out?: string | null
  actual_in?: string | null; actual_out?: string | null; which_missing: 'in' | 'out' | 'both'
}

const hm = (s: unknown): string | null => { const m = String(s ?? '').match(/^(\d{1,2}):(\d{2})/); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null }
const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/** "Ruth A." : first name and last initial, the most the form ever shows about a client. */
export function clientDisplay(first: unknown, last: unknown): string {
  const f = clip(first, 40), l = clip(last, 40)
  return (f + (l ? ' ' + l.charAt(0).toUpperCase() + '.' : '')).trim() || 'your client'
}

/** The link for a token. Only the token, nothing else, ever goes in the address. */
export const prefillUrl = (token: string) => `${EVV_FORM_URL}?t=${encodeURIComponent(token)}`

/** Swap the plain form link in a message for the pre-filled one. The rest of the wording is untouched; a message
    without the plain link is returned as it was (nothing is added). */
export function withPrefillLink(message: string, url: string | null): string {
  if (!url) return message
  return message.replace(/(?:https?:\/\/)?sc\.mo-care\.com\/evv-correction-form(?:\.html)?/, url)
}

/** Create the pre-fill row (server side, service key). Returns the link, or null if it could not be made. */
export async function makePrefill(sb: any, p: Prefill, createdBy: string): Promise<{ token: string; url: string } | null> {
  try {
    if (!p.visit_id || !p.caregiver_axiscare_id || !/^\d{4}-\d{2}-\d{2}$/.test(String(p.visit_date))) return null
    const token = crypto.randomUUID()
    const row = {
      token, created_by: clip(createdBy, 120),
      expires_at: new Date(Date.now() + PREFILL_DAYS * 864e5).toISOString(),
      axiscare_visit_id: clip(p.visit_id, 80), caregiver_axiscare_id: clip(p.caregiver_axiscare_id, 40),
      client_axiscare_id: p.client_axiscare_id ? clip(p.client_axiscare_id, 40) : null,
      caregiver_name: clip(p.caregiver_name, 80) || 'Caregiver',
      client_display: clientDisplay(p.client_first, p.client_last),
      client_name: [clip(p.client_first, 40), clip(p.client_last, 40)].filter(Boolean).join(' ') || null,
      visit_date: p.visit_date,
      scheduled_in: hm(p.scheduled_in), scheduled_out: hm(p.scheduled_out),
      actual_in: hm(p.actual_in), actual_out: hm(p.actual_out),
      which_missing: ['in', 'out', 'both'].includes(p.which_missing) ? p.which_missing : 'in',
    }
    const r = await sb.from('evv_prefill').insert(row)
    if (r?.error) { console.warn('evv prefill not made (plain form link used):', r.error.message || r.error); return null }
    return { token, url: prefillUrl(token) }
  } catch (e) { console.warn('evv prefill not made (plain form link used):', String(e)); return null }
}

/** AxisCare clockIn / clockOut record -> "HH:MM" on the Chicago clock (naive times are already local). */
export function axisHm(c: unknown): string | null {
  const t = c && typeof c === 'object' ? String((c as any).time ?? '') : (typeof c === 'string' ? c : '')
  if (!t) return null
  if (!/Z$|[+-]\d{2}:?\d{2}$/.test(t)) return hm(t.slice(11, 16))
  const d = new Date(t)
  return Number.isFinite(d.getTime())
    ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(d)
    : null
}
