// applicant-office.ts (2026-10-16, Oklahoma hiring plan build step 1). Which office (MO or OK) a person's LATEST job
// application belongs to, by the same rule as public.ok_applicant_hold (ok_messages_808.sql): last 10 phone digits or the
// email, newest application first. Used by outreach-check so the Training Platform's job-offer can refuse Oklahoma offers.
// No imports, read only.
/** The office of this person's LATEST application, matched by the last 10 phone digits or the email, newest first: the
    ok_applicant_hold rule. 'MO' when there is no application (an existing employee) or it is not Oklahoma. Read only. */
// deno-lint-ignore no-explicit-any
export async function applicantOffice(db: any, phone: unknown, email: unknown): Promise<{ office: 'MO' | 'OK'; error?: string }> {
  const d = String(phone ?? '').replace(/\D/g, '').slice(-10), e = String(email ?? '').trim().toLowerCase()
  const dd = d.length === 10 ? d : '', ee = e.includes('@') && !/[,()]/.test(e) ? e : ''
  if (!dd && !ee) return { office: 'MO' }
  const ors = [...(dd ? [`phone.ilike.%${dd.slice(0, 3)}%${dd.slice(3, 6)}%${dd.slice(6)}%`] : []), ...(ee ? [`email.ilike.${ee}`] : [])].join(',')
  const r = await db.from('job_applicants').select('office,phone,email,created_at').or(ors).order('created_at', { ascending: false }).limit(50)
  if (r.error) return { office: 'MO', error: r.error.message }
  // deno-lint-ignore no-explicit-any
  const hit = (r.data || []).find((a: any) => (dd && String(a.phone ?? '').replace(/\D/g, '').slice(-10) === dd) || (ee && String(a.email ?? '').trim().toLowerCase() === ee))
  return { office: hit?.office === 'OK' ? 'OK' : 'MO' }
}
