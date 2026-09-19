/* routing.ts — the Playbook reader. SHADOW MODE (Step 3 of the architecture
   build).

   op_routing (app_data) is the "Who Handles What" page in the CC hub: one row
   per area — Responsible, Notified now, Notified daily, Escalated to. This
   module reads it and answers "who would the playbook notify?".

   NOTHING HERE SENDS ANYTHING. Senders keep their hardcoded lists and call
   shadowRoute() alongside the real send; the comparison lands in op_events as
   a 'routing_shadow' row. Only after that record shows the playbook agreeing
   with reality does any sender switch from its hardcoded list to routeFor().

   Fail-loud: when production interrupts people but the playbook has no row
   (or an empty Notified-now), a single ops item per area appears in the hub
   pointing at the Who Handles What page. It is created once and never
   re-opened, so closing it is respected. */

// deno-lint-ignore-file no-explicit-any
type SB = any

export type Route = {
  area: string
  found: boolean
  resp: string[]
  backup: string[]
  now: string[]
  daily: string[]
  esc: string
  esc_when: string
}

export async function routeFor(sb: SB, area: string): Promise<Route> {
  const empty: Route = { area, found: false, resp: [], backup: [], now: [], daily: [], esc: '', esc_when: '' }
  try {
    const { data } = await sb.from('app_data').select('data').eq('key', 'op_routing').maybeSingle()
    const rows: any[] = Array.isArray(data?.data) ? data.data : []
    const r = rows.find((x: any) => String(x?.id || '') === area)
    if (!r) return empty
    const arr = (v: unknown) => Array.isArray(v) ? v.map((s) => String(s)).filter(Boolean) : []
    return {
      area, found: true,
      resp: arr(r.resp), backup: arr(r.backup), now: arr(r.now), daily: arr(r.daily),
      esc: String(r.esc || ''), esc_when: String(r.esc_when || ''),
    }
  } catch {
    return empty
  }
}

/* Row values are stable keys (emails, seat keys, duty keys). The shadow log
   is read by humans, so keys fold back to names here. The duty keys mean:
   resolve through duty_windows at send time — Staffing window holder, else
   After Hours window holder, else Samantha. Resolution itself stays unbuilt
   until routing leaves shadow; the LABEL just tells the truth about intent. */
export function routeLabel(v: string): string {
  const s = String(v || '')
  if (s === 'duty:staffing') return 'whoever is on duty (Staffing)'
  if (s === 'duty:after_hours') return 'whoever is on duty (After-hours)'
  if (s === 'staffing_coordinator') return 'Staffing Coordinator'
  if (s.includes('@')) { const n = s.split('@')[0]; return n.charAt(0).toUpperCase() + n.slice(1) }
  return s
}

export async function shadowRoute(sb: SB, o: {
  area: string
  channel: string
  production: string[]   // who was ACTUALLY notified (phones or names)
  case_id?: string
  note?: string
}): Promise<Route> {
  const r = await routeFor(sb, o.area)
  try {
    await sb.from('op_events').insert({
      actor_email: '', actor_name: 'system', verb: 'routing_shadow',
      item_id: String(o.case_id || ''), area: o.area,
      summary: (`[shadow] ${o.channel}: production notified `
        + (o.production.join(', ') || 'nobody')
        + ' · playbook notify-now says '
        + (r.found ? (r.now.map(routeLabel).join(', ') || 'nobody') : 'NO ROW FOR THIS AREA')
        + (o.note ? ' · ' + o.note : '')).slice(0, 400),
      data: { channel: o.channel, production: o.production, would_now: r.now,
              would_daily: r.daily, esc: r.esc, found: r.found },
    })
  } catch { /* the record is an observer, never a dependency */ }

  /* Production interrupted somebody and the playbook could not have said who.
     That gap must be a visible piece of work, not a silent fallback. */
  if (!r.found || (!r.now.length && o.production.length)) {
    try {
      const { data: oi } = await sb.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
      const rows: any[] = Array.isArray(oi?.data) ? oi.data : []
      const already = rows.some((x: any) => String(x?.id || '') === `ops_unrouted_${o.area}`)
      if (!already) {
        await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
          id: `ops_unrouted_${o.area}`, kind: 'request',
          title: `Who Handles What has no answer for "${o.area}"`,
          about: 'Routing',
          detail: `A ${o.channel} notification fired, but the Who Handles What page `
            + (r.found ? 'lists nobody under "Notified now"' : 'has no saved row')
            + ` for this area — so its notifications stay hardcoded. Open Who Handles What, fill in the row, and save.`,
          next_action: 'Open Who Handles What and complete this area’s row.',
          domain: 'office_ops', status: 'open', urgency: 'normal',
          owner: '', owner_name: '', created_at: new Date().toISOString(),
          due: new Date(Date.now() + 72 * 3600000).toISOString(),
          created_by: 'routing-shadow', opened_by: 'system',
        } })
      }
    } catch { /* it will be visible on a later run */ }
  }
  return r
}
