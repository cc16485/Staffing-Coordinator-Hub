// TEST PEOPLE (Samantha 2026-10-11, the practice run: "Pat Practice should have my phone number and email so I can see what
// happens"; "send everything to me"). The Admin page's short list (ops_settings.test_people { phones, emails }) of the owner's
// own phone and email. A person reachable ONLY at addresses on that list (every phone and email they have is on it, and they
// have at least one) gets their onboarding messages even while a switch is off; nobody else does. Only the message itself:
// never AxisCare, never anything else.
// deno-lint-ignore-file no-explicit-any
export function testLists(st: any): { phones: string[]; emails: string[] } {
  const t = st?.test_people && typeof st.test_people === 'object' ? st.test_people : {}
  const phones = (Array.isArray(t.phones) ? t.phones : []).map((x: unknown) => String(x).replace(/\D/g, '').slice(-10)).filter((x: string) => x.length === 10)
  const emails = (Array.isArray(t.emails) ? t.emails : []).map((x: unknown) => String(x).trim().toLowerCase()).filter((x: string) => x.includes('@'))
  return { phones, emails }
}
export function testPerson(st: any, p: { phone?: unknown; email?: unknown } | null | undefined): boolean {
  const { phones, emails } = testLists(st)
  if (!phones.length && !emails.length) return false
  const ph = String(p?.phone ?? '').replace(/\D/g, '').slice(-10), em = String(p?.email ?? '').trim().toLowerCase()
  if (!ph && !em) return false
  return (!ph || phones.includes(ph)) && (!em || emails.includes(em))
}
