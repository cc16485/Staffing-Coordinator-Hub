// =============================================================================
// Partner revenue (Referral Partner Program, Samantha's step 2 requirement 2026-10-26: "estimated billed revenue; use
// actual AxisCare data wherever available, and clearly label anything estimated or unavailable"). Tracking only: this is
// what the families a partner referred have been billed for, never anything about paying the partner.
//
// The estimate, per referred client, from that client's AxisCare visits since the first shift:
//   · only COMPLETED visits count (clocked in and out, not removed), each capped at 24 hours
//   · Hourly visit: hours × that visit's charge rate. Daily or Fixed visit: its charge rate once
//   · a completed visit with no charge rate counts its hours, and the client is marked "no rate on some visits"
//   · AxisCare not readable for a client: that client is counted as unread, never as $0
// It is visits times rates, not invoices: discounts, credits and what was actually paid are not in it.
// =============================================================================
import { centralYmd } from './business-days.ts'

// deno-lint-ignore no-explicit-any
type Any = any
const s = (v: unknown) => String(v == null ? '' : v).trim()
const clockAt = (c: Any) => { const x = typeof c === 'string' ? c : (c && (c.time || c.date || c.at)) || ''; const t = Date.parse(x); return Number.isFinite(t) ? t : null }

/** the referred clients worth reading: credited to a program partner, started care, with an AxisCare id */
export function referredClients(leads: Any[], orgs: Any[]): Array<{ org_id: string; ax: string; from: string; lead_id: string }> {
  const prog = new Set((orgs || []).filter((o) => o && !o.archived && /^[A-Z0-9-]{3,20}$/.test(s(o.partner_code).toUpperCase())).map((o) => s(o.id)))
  const seen = new Set<string>(), out: Array<{ org_id: string; ax: string; from: string; lead_id: string }> = []
  for (const l of leads || []) {
    if (!l || l.spam || l.test || (l.archived && l.duplicate_of)) continue
    const org = s(l.referral_org_id), ax = s(l.axiscare_client_id), fs = s(l.first_shift_at)
    if (!prog.has(org) || !/^\d{1,12}$/.test(ax) || !fs) continue
    const t = Date.parse(fs); if (!Number.isFinite(t)) continue
    if (seen.has(ax)) continue
    seen.add(ax); out.push({ org_id: org, ax, from: centralYmd(t), lead_id: s(l.id) })
  }
  return out
}

/** one client's visits → completed hours and billed estimate */
export function billedFrom(visits: Any[], ax: string, from: string, to: string) {
  let hours = 0, billed = 0, done = 0, noRate = 0
  for (const v of visits || []) {
    if (!v || v.removed) continue
    if (v.client && s(v.client.id) && s(v.client.id) !== ax) continue
    const a = clockAt(v.clockIn), b = clockAt(v.clockOut)
    if (a == null || b == null || b <= a) continue
    const d = centralYmd(a); if (d < from || d > to) continue
    const h = Math.min(24, (b - a) / 36e5), rate = Number(v.chargeRate), type = s(v.type).toLowerCase()
    done++; hours += h
    if (!(rate > 0)) { noRate++; continue }
    billed += type === 'daily' || type === 'fixed' ? rate : h * rate
  }
  return { visits: done, hours: Math.round(hours * 4) / 4, billed: Math.round(billed * 100) / 100, no_rate_visits: noRate }
}

/** add each client's numbers into its partner's row */
export function byPartner(rows: Array<{ org_id: string; ax: string; result: ReturnType<typeof billedFrom> | null }>) {
  const out: Record<string, { clients: number; read: number; unread: number; visits: number; hours: number; billed: number; no_rate_clients: number }> = {}
  for (const r of rows) {
    const p = out[r.org_id] = out[r.org_id] || { clients: 0, read: 0, unread: 0, visits: 0, hours: 0, billed: 0, no_rate_clients: 0 }
    p.clients++
    if (!r.result) { p.unread++; continue }
    p.read++; p.visits += r.result.visits; p.hours += r.result.hours; p.billed = Math.round((p.billed + r.result.billed) * 100) / 100
    if (r.result.no_rate_visits) p.no_rate_clients++
  }
  return out
}
