// =============================================================================
// NO PRN HIRE LEFT UNLINKED (Samantha, 2026-10-28: "can we make sure a caregiver doesn't accidentally not get tagged in the
// hub, it should be obvious if that's what they applied for"; her pick: link automatically when sure).
// =============================================================================
// Once a day, every PRN Team hire not yet linked to their AxisCare caregiver record is matched against AxisCare:
//   SURE      exactly one ACTIVE AxisCare caregiver has their phone (mobile or home) or email, that caregiver isn't linked to
//             anyone else, and no other unlinked PRN hire matches them too. The hire is linked (the same linkCore the
//             office's "Link them" uses, which checks it all again) and tagged PRN TEAM in AxisCare (markCore, read back).
//   NOT SURE  a Needs Attention card says why, with the next step: two possible matches, a match that is inactive in
//             AxisCare, the matching caregiver is already linked to someone else, or no AxisCare caregiver with their phone
//             or email after 7 days on the team.
//   THE OTHER WAY  an active AxisCare caregiver tagged PRN TEAM who isn't on the Hub's PRN list gets a card too.
// A name alone is never enough. Only decisions here (no reads or writes). Switch ops_settings.prn_autolink_live (off:
// worked out and counted, nothing linked, tagged or carded).
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown) => String(v ?? '').trim()
export const d10 = (v: unknown) => { const d = S(v).replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : '' }
const em = (v: unknown) => S(v).toLowerCase()
export const WAIT_DAYS = 7

export type Hire = { applicant_id: string; first: string; last: string; phone: string; email: string; team: string; since: string }
export type AxRow = { id: string; first: string; last: string; active: boolean; mobile: string; phone: string; home?: string; email: string; classes?: string[] }
export type Card = { id: string; title: string; detail: string; who: string }
export type Plan = { link: { applicant_id: string; axiscare_id: string; how: 'phone' | 'email'; name: string }[]; cards: Card[]; waiting: string[]; seen: number }

const nm = (h: { first: string; last: string }) => [h.first, h.last].filter(Boolean).join(' ') || 'A PRN hire'
const TEAM: Record<string, string> = { cna: 'PRN CNA Team', caregiver: 'PRN Caregiver Team' }
const phonesOf = (g: AxRow) => [g.mobile, g.phone, g.home].map(d10).filter(Boolean)
const isPrnTag = (label: string) => /\bprn\b/i.test(label)

/** today: 'YYYY-MM-DD' (Central). linkedIds: AxisCare ids already on a pay track. */
export function planLinks(hires: Hire[], ax: AxRow[], linkedIds: Set<string>, today: string): Plan {
  const plan: Plan = { link: [], cards: [], waiting: [], seen: hires.length }
  const matchOf = (h: Hire, g: AxRow): 'phone' | 'email' | null => {
    const p = d10(h.phone), e = em(h.email)
    if (p && phonesOf(g).includes(p)) return 'phone'
    if (e && e.includes('@') && em(g.email) === e) return 'email'
    return null
  }
  const days = (iso: string) => { const a = Date.parse(S(iso).slice(0, 10) + 'T12:00:00Z'), b = Date.parse(today + 'T12:00:00Z'); return Number.isFinite(a) ? Math.round((b - a) / 864e5) : 999 }
  for (const h of hires) {
    const hits = ax.map((g) => ({ g, how: matchOf(h, g) })).filter((x) => x.how)
    const active = hits.filter((x) => x.g.active), free = active.filter((x) => !linkedIds.has(x.g.id))
    const who = nm(h), team = TEAM[h.team] || 'PRN Team'
    if (free.length === 1 && active.length === 1) {
      const g = free[0].g
      const shared = hires.some((o) => o.applicant_id !== h.applicant_id && matchOf(o, g))
      if (!shared) { plan.link.push({ applicant_id: h.applicant_id, axiscare_id: g.id, how: free[0].how!, name: who }); continue }
      plan.cards.push({ id: 'prn_link_' + h.applicant_id, who, title: `${who} (${team}) isn't linked: another PRN hire has the same phone or email`,
        detail: `Two PRN hires match one AxisCare caregiver (${nm(g)}), so neither was linked. Check which one it is in AxisCare, then open their caregiver page and use Link them.` })
      continue
    }
    if (active.length > 1) {
      plan.cards.push({ id: 'prn_link_' + h.applicant_id, who, title: `${who} (${team}) isn't linked: ${active.length} AxisCare caregivers match`,
        detail: `${active.map((x) => nm(x.g)).join(', ')} all have ${who}'s phone or email in AxisCare, so nothing was linked. Fix the duplicate in AxisCare, then open the right caregiver page and use Link them.` })
      continue
    }
    if (active.length === 1) {
      plan.cards.push({ id: 'prn_link_' + h.applicant_id, who, title: `${who} (${team}) isn't linked: their AxisCare record is linked to someone else`,
        detail: `${nm(active[0].g)} in AxisCare has ${who}'s phone or email but is already linked to another PRN hire. Check both in AxisCare.` })
      continue
    }
    if (hits.length) {
      plan.cards.push({ id: 'prn_link_' + h.applicant_id, who, title: `${who} (${team}) isn't linked: their AxisCare record is inactive`,
        detail: `${nm(hits[0].g)} in AxisCare has ${who}'s phone or email but is not Active. Once they are Active in AxisCare they are linked automatically.` })
      continue
    }
    if (days(h.since) >= WAIT_DAYS) {
      plan.cards.push({ id: 'prn_link_' + h.applicant_id, who, title: `${who} (${team}) isn't in AxisCare yet`,
        detail: `${who} joined the ${team} ${days(h.since)} days ago, but no AxisCare caregiver has their phone or email. Add them in AxisCare (or fix their phone or email there); the Hub links them the next morning.` })
    } else plan.waiting.push(who)
  }
  /* the other way: tagged PRN in AxisCare, not on the Hub's list (and not being linked now) */
  const linkingNow = new Set(plan.link.map((l) => l.axiscare_id))
  for (const g of ax) {
    if (!g.active || linkedIds.has(g.id) || linkingNow.has(g.id)) continue
    const tag = (g.classes || []).find(isPrnTag); if (!tag) continue
    if (hires.some((h) => matchOf(h, g))) continue   /* already carded above with its reason */
    plan.cards.push({ id: 'prn_tag_' + g.id, who: nm(g), title: `${nm(g)} is tagged ${tag} in AxisCare but isn't on the Hub's PRN list`,
      detail: `The Hub only treats someone as PRN when they are on its PRN list, which their PRN offer in the Hub starts. If ${nm(g)} belongs on a PRN team, send their PRN offer from their application; if not, take ${tag} off in AxisCare.` })
  }
  return plan
}
