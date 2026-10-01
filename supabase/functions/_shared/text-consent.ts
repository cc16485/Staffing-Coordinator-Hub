/**
 * Applicant text rules shared by the Hub's candidate senders (2026-10-01, Samantha: "fix the training platform texts"
 * / "yes to both"). One answer for "may we text this person?" (their LATEST application's yes/no to texts; no
 * application on file, e.g. an Augusta hire or an existing employee, is not affected), the 8am–6pm Central text
 * window, and the opt-out line every text carries.
 */
// deno-lint-ignore no-explicit-any
export async function latestTextConsent(db: any, phone: unknown): Promise<{ ok: boolean; why?: string }> {
  const d = String(phone ?? '').replace(/\D/g, '').slice(-10)
  if (d.length !== 10) return { ok: false, why: 'no usable phone number' }
  // deno-lint-ignore no-explicit-any
  let data: any[] | null = null
  try {
    const r = await db.from('job_applicants').select('phone, sms_consent, created_at')
      .ilike('phone', '%' + d.slice(-4)).order('created_at', { ascending: false }).limit(50)
    if (r.error) return { ok: false, why: 'could not check their application' }
    data = r.data
  } catch { return { ok: false, why: 'could not check their application' } }   // fail closed: no text
  const latest = (data ?? []).find((r: { phone?: string }) => String(r.phone ?? '').replace(/\D/g, '').slice(-10) === d)
  return latest && latest.sms_consent === false ? { ok: false, why: 'they did not agree to texts on their application' } : { ok: true }
}
export const inTextHours = (now: Date = new Date()) => {
  const h = Number(now.toLocaleString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false })) % 24
  return h >= 8 && h < 18
}
export const withStop = (t: string) => /\bSTOP\b/.test(t) ? t : t.trimEnd() + ' Reply STOP to opt out.'
