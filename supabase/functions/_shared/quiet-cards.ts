// =============================================================================
// quiet-cards.ts · FEWER CARDS FROM coverage-watch (Samantha 2026-10-22, after read-only 1069 found 105 cards in the Team
// Work pile: "stop EVV and Make it official cards", "coverage checks close themselves from AxisCare", "a weekly Make it
// official list"). Pure: no clock, no database, no network; coverage-watch asks this file. Everything waits behind
// the Settings > Tidier My Work switch (ops_settings.mywork_tidy_live, her call 2026-10-22: one switch for both halves) or
// ops_settings.quieter_cards_live; off, coverage-watch makes exactly the cards it made before.
//   · EVV review: no weekly card at all (EVV is retired since 2026-10-17).
//   · "Was it covered?": a case left as needs_outcome is looked at again in AxisCare on later runs (14 days back, the
//     same window as the first look); once AxisCare can say, the case closes from AxisCare and its card closes with it.
//   · "Make it official?": one card a week listing every suggestion instead of one card each; a schedule is suggested
//     once ever, whether it was on an old single card or an earlier week's list.
// No em dashes in any words a person reads.
// =============================================================================
// deno-lint-ignore-file no-explicit-any
export function quietOn(settings: any): boolean { return !!(settings && (settings.mywork_tidy_live === true || settings.quieter_cards_live === true)) }

/** the Monday (YYYY-MM-DD) of the week a Central calendar day falls in */
export function mondayOf(ymd: string): string {
  const d = new Date(String(ymd).slice(0, 10) + 'T12:00:00Z'), back = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}
export const weekCardId = (monday: string) => `ops_regular_week_${monday}`

/** the schedules already suggested: old single cards (ops_regular_s<id>) and every weekly list's sched_ids, any status */
export function suggestedBefore(items: any[]): Set<string> {
  const out = new Set<string>()
  for (const i of items || []) {
    const id = String(i?.id ?? '')
    const m = /^ops_regular_s(.+)$/.exec(id)
    if (m) out.add(m[1])
    if (/^ops_regular_week_/.test(id) && Array.isArray(i?.sched_ids)) for (const s of i.sched_ids) out.add(String(s))
  }
  return out
}

/** this week's one card, with the new suggestions added to it (null when there is nothing new to add).
 *  sugg: [{ sched, caregiver, client, weekday }] */
export function weekCard(existing: any, sugg: any[], monday: string, nowIso: string): any | null {
  const before = new Set((existing?.sched_ids ?? []).map(String))
  const add = (sugg || []).filter((s) => s && s.sched && !before.has(String(s.sched)))
  if (!add.length) return null
  const lines = [...(existing?.lines ?? []), ...add.map((s) => `${s.caregiver} has covered ${s.client}'s ${s.weekday} slot 3 times running`)]
  const md = new Date(monday + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
  return {
    ...(existing || {}),
    id: weekCardId(monday), kind: 'staffing', domain: 'scheduling_coverage', urgency: 'normal',
    status: existing?.status === 'open' || !existing ? 'open' : existing.status,
    title: `Make it official? ${lines.length} schedule${lines.length === 1 ? '' : 's'} this week (week of ${md})`,
    about: `${lines.length} regular${lines.length === 1 ? '' : 's'} to make official`,
    detail: 'The same caregiver has worked the last three of each of these open slots. If it is working for everyone, '
      + 'assign them as the regular in AxisCare and the slot stops being a weekly scramble:\n'
      + lines.map((l) => '• ' + l).join('\n'),
    lines, sched_ids: [...before, ...add.map((s) => String(s.sched))], week_start: monday,
    owner: existing?.owner ?? '', owner_name: existing?.owner_name ?? '',
    created_at: existing?.created_at ?? nowIso, created_by: 'ongoing-sweep', updated_at: nowIso,
  }
}

/** the "Was it covered?" cases to look at again: still needs_outcome, their card still open, the shift within the
 *  window, and an AxisCare visit to look at */
export function recheckCases(cases: any[], items: any[], oldest: string): any[] {
  const open = new Set((items || []).filter((i) => i && i.status === 'open').map((i) => String(i.id)))
  return (cases || []).filter((c) => c && c.status === 'needs_outcome' && open.has(`ops_covq_${c.id}`)
    && String(c.shift_date || '') >= oldest && !!c.axiscare_visit_id)
}
