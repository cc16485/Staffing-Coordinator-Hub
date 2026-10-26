// =============================================================================
// Community Ambassador applications (Samantha approved step 1, 2026-10-26). mo-care.com/ambassadors posts here through
// lead-intake with kind 'ambassador_application'. Her rules:
//   · an application is NEVER a lead: no family record, no acknowledgment text, no speed-to-lead clock
//   · it lands on the Referral Partner Desk as one referral_orgs item: type "Community Ambassador", status "applied"
//     (not linkable: the server only links a partner_code, and an applicant has none until an owner approves)
//   · healthcare, senior living or other regulated work is FLAGGED for the owners to decide, never moved automatically
//   · no OIG check, no mailing address (asked only when an approved ambassador requests printed materials)
//   · volunteer, unpaid, not employment: the applicant agrees to that; nothing here is about money
// =============================================================================

// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v == null ? '' : v).trim().slice(0, n)
const SHARE = { friends: 'Friends and family', neighbors: 'Neighbors', community: 'Church or community group', business: 'My business', social: 'Social media' } as const
const yes = (v: unknown) => v === true || /^(yes|true|on|1)$/i.test(S(v))

export type AppResult = { error: string } | { item: Any; flags: string[] }

/** Read and check one application. Returns the referral_orgs item to save, or what is missing. */
export function readApplication(body: Any, now = new Date().toISOString(), id = 'amb_' + crypto.randomUUID().slice(0, 12)): AppResult {
  const first = S(body.first_name, 60), last = S(body.last_name, 60)
  const email = S(body.email, 160).toLowerCase(), phone = S(body.phone, 30), town = S(body.town, 80)
  if (!first || !last) return { error: 'Please add your first and last name.' }
  if (!email && !phone) return { error: 'Please add an email or a mobile number so we can reach you.' }
  if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return { error: 'That email doesn\'t look right.' }
  if (!town) return { error: 'Please add your town.' }
  const ag = body.agree || {}
  if (!(yes(ag.adult) && yes(ag.guidelines) && yes(ag.volunteer) && yes(ag.privacy))) return { error: 'Please check each box to agree.' }
  const raw = Array.isArray(body.share) ? body.share : S(body.share, 200).split(',')
  const share = [...new Set(raw.map((x: unknown) => S(x, 20)).filter((x: string) => x in SHARE))] as (keyof typeof SHARE)[]
  const healthcare = yes(body.works_in_healthcare), where = S(body.healthcare_where, 120)
  const employee = yes(body.works_for_us)
  const flags: string[] = []
  if (healthcare) flags.push('healthcare')
  if (employee) flags.push('employee')
  const item = {
    id, name: `${first} ${last}`, type: 'Community Ambassador', program_track: 'ambassador', program_status: 'applied',
    email, phone, created_at: now, applied_at: now,
    application: {
      first_name: first, last_name: last, email, phone, town,
      share: share.map((k) => SHARE[k]),
      works_in_healthcare: healthcare, ...(healthcare && where ? { healthcare_where: where } : {}),
      works_for_us: employee,
      agreed: { adult: true, guidelines: true, volunteer_unpaid_not_employment: true, privacy: true, at: now },
      ...(S(body.partner_code, 20) ? { came_through_code: S(body.partner_code, 20).toUpperCase() } : {}),
      flags,
    },
  }
  return { item, flags }
}

/** the same person applying again (same email or same mobile on an applied or active ambassador): don't make a second record */
export function alreadyApplied(orgs: Any[], item: Any): Any | null {
  const d10 = (v: unknown) => { const d = S(v).replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : '' }
  const e = S(item.email).toLowerCase(), p = d10(item.phone)
  return (orgs || []).find((o) => o && !o.archived && o.program_track === 'ambassador'
    && ((e && S(o.email).toLowerCase() === e) || (p && d10(o.phone) === p))) || null
}

/** the owners' alert (never the applicant, never a Care Coordinator): who applied and what to look at */
export function ownerAlert(item: Any): { subject: string; html: string } {
  const a = item.application, esc = (t: string) => S(t, 400).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const flagWords = a.flags.length ? a.flags.map((f: string) => f === 'healthcare' ? 'works in healthcare or a regulated field' + (a.healthcare_where ? ' (' + a.healthcare_where + ')' : '') : 'works for Caring Companions').join('; ') : ''
  return {
    subject: 'New Community Ambassador application: ' + item.name + (a.flags.length ? ' (needs a look)' : ''),
    html: '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#16283a;">'
      + '<p><b style="font-size:18px;">' + esc(item.name) + '</b> applied to be a Community Ambassador.</p>'
      + '<p><b>Town:</b> ' + esc(a.town) + '<br><b>Would share with:</b> ' + esc(a.share.join(', ') || 'not said') + '</p>'
      + (flagWords ? '<p style="background:#FFF8EC;border-radius:10px;padding:12px 14px;"><b>For your review:</b> ' + esc(flagWords) + '.</p>' : '')
      + '<p>Nothing is active until an owner approves it on Referral Partners.</p>'
      + '<p><a href="https://cc.mo-care.com/#referrers" style="display:inline-block;background:#1F7A8C;color:#fff;font-weight:bold;padding:11px 22px;border-radius:9px;text-decoration:none;">Open Referral Partners &rarr;</a></p></div>',
  }
}

/** owner emails: staff_roles owner_admin, active persons (Samantha if none can be read) */
export async function ownerEmails(db: Any): Promise<string[]> {
  try {
    const { data: r } = await db.from('staff_roles').select('person_id').eq('entity', 'cc_ihs').eq('role', 'owner_admin')
    const ids = (r ?? []).map((x: Any) => String(x.person_id))
    if (ids.length) {
      const { data: p } = await db.from('persons').select('person_id, primary_email, active').in('person_id', ids)
      const out = (p ?? []).filter((x: Any) => x.active !== false).map((x: Any) => S(x.primary_email, 160).toLowerCase()).filter(Boolean)
      if (out.length) return [...new Set(out)] as string[]
    }
  } catch { /* fall through */ }
  return ['samantha@mo-care.com']
}
