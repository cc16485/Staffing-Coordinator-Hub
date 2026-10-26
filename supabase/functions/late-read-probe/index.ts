// =============================================================================
// late-read-probe: run test sentences through Cara's LIVE running-late reader (Samantha, 2026-10-24: "Build a small
// owner-only test so you can run my nine sentences through Cara's live reader, read only. Show me the results before
// anything else.")
// =============================================================================
// Owner script only (the service key); never for browsers. It calls readLate, the exact function the live running-late
// watcher (late-watch) uses on caregivers' texts, replies and call transcripts, once per sentence and situation. It reads
// and writes nothing in the Hub, AxisCare or GoHighLevel, and sends nothing. Desktop 1111 puts it in place, runs it once
// and removes it.
// POST { sentences: string[], shift: "HH:MM" (Chicago, today), before_min?: number, after_min?: number }
//   each sentence is read twice: sent before the shift (before_min ahead of it, default 30), and as a reply after the
//   shift started (after_min past it, default 7: what a reply to the missed clock-in text looks like).
// =============================================================================
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'Content-Type': 'application/json' } })
export function roleOf(auth: string | null): string {
  try { const t = String(auth || '').replace(/^Bearer\s+/i, ''); return String(JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))?.role || '') } catch { return '' }
}
/* the live reader, loaded without starting late-watch's own server (its module ends in Deno.serve) */
// deno-lint-ignore no-explicit-any
const realServe = (Deno as any).serve
// deno-lint-ignore no-explicit-any
;(Deno as any).serve = () => {}
const LW = await import('../late-watch/index.ts')
// deno-lint-ignore no-explicit-any
;(Deno as any).serve = realServe

/** Today (Chicago) at HH:MM, as a real instant. */
export function chiTodayAt(hhmm: string, now = Date.now()): number {
  const day = new Date(now).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
  const naive = (d: Date) => Date.parse(d.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T') + 'Z')
  const off = naive(new Date(now)) - now
  return Date.parse(`${day}T${hhmm}:00Z`) - off
}

Deno.serve(async (req) => {
  if (roleOf(req.headers.get('authorization')) !== 'service_role') return json({ error: 'owner script only' }, 403)
  // deno-lint-ignore no-explicit-any
  const b: any = await req.json().catch(() => ({}))
  const sentences = (Array.isArray(b.sentences) ? b.sentences : []).map(String).filter(Boolean).slice(0, 20)
  if (!sentences.length) return json({ error: 'no sentences' }, 400)
  const shift = /^\d\d:\d\d$/.test(String(b.shift || '')) ? String(b.shift) : '08:00'
  const start = chiTodayAt(shift)
  const before = Math.min(120, Math.max(1, Number(b.before_min) || 30)), after = Math.min(90, Math.max(1, Number(b.after_min) || 7))
  const out: Record<string, unknown>[] = []
  for (const s of sentences) {
    const row: Record<string, unknown> = { sentence: s }
    for (const [label, at] of [['before', start - before * 60e3], ['reply', start + after * 60e3]] as const) {
      const r = await LW.readLate(start, [{ at, body: s }])
      row[label] = { kind: r.kind, sure: r.sure, eta: r.eta != null ? LW.chiClock(r.eta) : null, quote: r.quote ?? null, failed: r.failed, error: r.error ?? null, tries: r.tries ?? null, sent_at: LW.chiClock(at) }
    }
    out.push(row)
  }
  return json({ read_only: true, shift: LW.chiClock(start), model: 'the live running-late reader (late-watch readLate)', results: out })
})
