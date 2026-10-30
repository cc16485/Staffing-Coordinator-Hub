/* CALMER SHIFT-NOTE FLAGS (2026-10-30, Samantha approved plan VGeWn63w7ue8WE7GS4ogJ6 "with your three recommendations.
   Build it switched off"). Switch ops_settings.calm_flags_live (Owners Hub Admin page). Pure parts here; care-notes uses
   them.
     · One open card per client and topic: a new flagged note about the same client and topic goes onto the card that
       is already open (its notes, newest first) instead of making another card. A fall or injury, signs of neglect or
       abuse, and medication always get their own card, every time.
     · The "3 in 2 weeks" pattern still turns the card red, but never texts (her decision 1). A note that is red on its
       own still texts the Client Care owner, as before.
     · "Normal for <client>": the Client Care owner or an owner marks a topic as usual for a client, with one line. The
       reader is told; a note that only shows the usual makes no card. Never for the three kinds above (decision 2: who
       may mark is the Hub's check; decision 3: no expiry).
     · A one-time cleanup the first time it runs on: open flags combine one per client and topic, and a topic with no new
       note in 7 days closes ("Quiet for a week"), never one of the three kinds above.
   Nothing here contacts anyone. */
// deno-lint-ignore-file no-explicit-any
export const ALWAYS_OWN = ['a fall or injury', 'signs of neglect or abuse', 'medication']
export const QUIET_DAYS = 7
export const calmOn = (st: any) => st?.calm_flags_live === true
export const combinable = (kind: string) => !!kind && !ALWAYS_OWN.includes(kind)
const ms = (v: unknown) => { const t = Date.parse(String(v ?? '')); return isNaN(t) ? 0 : t }
const first = (s: unknown) => String(s ?? '').trim().split(/\s+/)[0] || 'the client'
const dayOf = (iso: unknown) => { try { return new Date(String(iso)).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' }) } catch { return '' } }

/** The marks that are in force for one client: { kind: mark }. */
export function normalsFor(normals: any[], clientAx: string): Record<string, any> {
  const out: Record<string, any> = {}
  for (const n of normals || []) if (n && !n.removed_at && clientAx && String(n.client_ax ?? '') === clientAx && combinable(String(n.kind ?? ''))) out[String(n.kind)] = n
  return out
}
/** The lines the reader is told for a client (empty when nothing is marked). */
export function usualBlock(marks: Record<string, any>, clientFirst: string): string {
  const ks = Object.keys(marks)
  if (!ks.length) return ''
  return `\n\nWhat the office has marked as usual for ${clientFirst}:\n` + ks.map((k) => `- ${k}: ${String(marks[k].note || 'usual for them').slice(0, 200)}`).join('\n')
    + `\nA note that only shows one of these usual things is an ordinary day for that topic: answer none for it, unless the note says it is worse than usual or different from usual.`
}
/** The open card this note joins, or null. */
export function openTopicCard(items: any[], clientAx: string, kind: string): any {
  if (!clientAx || !combinable(kind)) return null
  return (items || []).filter((i) => i?.kind === 'care_note' && i?.status === 'open' && String(i?.client_ax ?? '') === clientAx && String(i?.flag_kind ?? '') === kind && i?.level !== 'unread')
    .sort((a, b) => ms(b.created_at) - ms(a.created_at))[0] || null
}
/** A card's notes; an older card that has none is one note, from its own fields. */
export function notesOf(card: any): any[] {
  if (Array.isArray(card?.notes) && card.notes.length) return card.notes
  const m = /"([\s\S]*?)"(?:\n|$)/.exec(String(card?.detail ?? ''))
  return [{ key: String(card?.id ?? ''), at: card?.created_at || '', day: card?.visit_day || dayOf(card?.created_at), caregiver: card?.caregiver || '',
    words: m ? m[1] : '', trigger: card?.trigger || '', why: card?.why || '', level: card?.level || 'yellow' }]
}
/** Yellow notes for a client in 14 days, counting each note on a combined card (the pattern rule). */
export function recentNotes(items: any[], clientAx: string, nowMs: number) {
  const since = nowMs - 14 * 864e5
  let flags = 0, yellows = 0
  for (const i of items || []) {
    if (i?.kind !== 'care_note' || !clientAx || String(i?.client_ax ?? '') !== clientAx) continue
    for (const n of notesOf(i)) if (ms(n.at) >= since) { flags++; if (n.level === 'yellow') yellows++ }
  }
  return { flags, yellows }
}
const rank = (l: string) => l === 'red' ? 2 : l === 'yellow' ? 1 : 0
/** The words of the card, rebuilt from its notes. */
export function detailOf(card: any): string {
  const ns = notesOf(card)
  return ns.slice(0, 12).map((n) => `${n.caregiver || 'The caregiver'} wrote after the ${n.day} visit:\n"${String(n.words || '(no care note)')}"`).join('\n\n')
    + (ns.length > 12 ? `\n\n(${ns.length - 12} older note${ns.length - 12 === 1 ? '' : 's'} on this card)` : '')
    + `\n\nWhy it's here: ${card.why || card.flag_kind}\nThis never contacts anyone by itself.`
}
export function titleOf(card: any): string {
  const ns = notesOf(card), lv = card.level === 'red' ? 'Red' : 'Yellow'
  if (ns.length < 2) return card.title || `${lv} flag: ${first(card.about)}'s ${ns[0]?.day || ''} visit, ${card.flag_kind}`
  const oldest = ns[ns.length - 1]
  return `${lv} flag: ${first(card.about)}, ${card.flag_kind}: ${ns.length} notes since ${String(oldest.day || dayOf(oldest.at)).replace(/^\w+, /, '')}`
}
/** The open card with one more note on it. level only ever goes up; due only ever comes sooner. */
export function addNote(card: any, note: any, o: { level: string; pattern: number; why: string; nowMs: number }): any {
  const ns = notesOf(card)
  if (ns.some((n) => n.key && n.key === note.key)) return null   // this visit is already on the card
  const level = rank(o.level) > rank(card.level) ? o.level : card.level
  const c = { ...card, notes: [note, ...ns].slice(0, 60), level, urgency: level === 'red' ? 'urgent' : card.urgency,
    pattern_count: Math.max(Number(card.pattern_count) || 0, o.pattern || 0), why: o.why || card.why, trigger: note.trigger || card.trigger,
    caregiver: note.caregiver || card.caregiver, caregiver_ax: note.caregiver_ax || card.caregiver_ax, caregiver_phone: note.caregiver_phone || card.caregiver_phone,
    visit_day: note.day || card.visit_day, family_line: note.family_line || card.family_line, last_note_at: note.at, last_activity_at: new Date(o.nowMs).toISOString() }
  if (level === 'red' && card.level !== 'red') {
    const soon = o.nowMs + 4 * 3600e3
    if (!ms(c.due) || ms(c.due) > soon) c.due = new Date(soon).toISOString()
  }
  c.title = titleOf(c); c.detail = detailOf(c)
  c.history = [...(Array.isArray(card.history) ? card.history : []), { at: new Date(o.nowMs).toISOString(), by: 'Shift-note reader', text: `Another note: ${note.caregiver || 'a caregiver'}, ${note.day}${level !== card.level ? ' (now ' + level + ')' : ''}` }].slice(-60)
  return c
}
/** The one-time cleanup: which cards absorb which, and which topics close for being quiet a week. */
export function cleanupPlan(items: any[], nowMs: number) {
  const open = (items || []).filter((i) => i?.kind === 'care_note' && i?.status === 'open' && i?.level !== 'unread' && combinable(String(i?.flag_kind ?? '')) && i?.client_ax)
  const groups = new Map<string, any[]>()
  for (const i of open) { const k = `${i.client_ax}|${i.flag_kind}`; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(i) }
  const keep: any[] = [], combined: Array<{ card: any; into: string }> = [], quiet: any[] = []
  const at = new Date(nowMs).toISOString()
  for (const cards of groups.values()) {
    const sorted = cards.slice().sort((a, b) => ms(b.created_at) - ms(a.created_at))
    const top = sorted[0]
    let notes: any[] = []
    for (const c of sorted) notes = notes.concat(notesOf(c))
    notes.sort((a, b) => ms(b.at) - ms(a.at))
    const level = sorted.some((c) => c.level === 'red') ? 'red' : 'yellow'
    const acts = sorted.flatMap((c) => Array.isArray(c.cn_actions) ? c.cn_actions : [])
    let s = { ...top, notes: notes.slice(0, 60), level, urgency: level === 'red' ? 'urgent' : 'normal', cn_actions: acts.length ? acts : top.cn_actions,
      due: new Date(Math.min(...sorted.map((c) => ms(c.due) || nowMs))).toISOString(), last_note_at: notes[0]?.at || top.created_at, last_activity_at: at }
    s.title = titleOf(s); s.detail = detailOf(s)
    if (sorted.length > 1) s.history = [...(Array.isArray(top.history) ? top.history : []), { at, by: 'Shift-note reader', text: `Combined ${sorted.length - 1} more open flag${sorted.length === 2 ? '' : 's'} about ${first(top.about)}'s ${top.flag_kind} into this card` }]
    for (const c of sorted.slice(1)) combined.push({ card: c, into: top.id })
    if (nowMs - ms(s.last_note_at) > QUIET_DAYS * 864e5) {
      const why = `Quiet for a week: no new notes about ${first(top.about)}'s ${top.flag_kind} since ${dayOf(s.last_note_at)}. Reopen it if it still needs a look.`
      s = { ...s, status: 'done', closed_at: at, closed_by: 'care-notes', resolution_code: 'quiet_week', close_note: why,
        history: [...(Array.isArray(s.history) ? s.history : []), { at, by: 'Shift-note reader', text: why }] }
      quiet.push(s)
    } else keep.push(s)
  }
  return { keep, combined, quiet, before: open.length }
}
/** The card one combined into, closed with where it went. */
export function closedInto(card: any, into: string, nowMs: number): any {
  const at = new Date(nowMs).toISOString(), why = 'Combined into one card for this client and topic'
  return { ...card, status: 'done', closed_at: at, closed_by: 'care-notes', resolution_code: 'combined', combined_into: into, close_note: why,
    history: [...(Array.isArray(card.history) ? card.history : []), { at, by: 'Shift-note reader', text: why }] }
}
