// 883 helper: builds the "Call <client> to confirm <caregiver>'s times" cards with the SAME builder the server uses
// (_shared/confirm-times.ts), so a card made at install looks exactly like one made by the watcher.
// stdin: { now, owner, visits: [{ ...CftVisit, source, extra }] }   stdout: [item, ...]
import { confirmTimesItem } from './supabase/functions/_shared/confirm-times.ts'
let raw = ''; for await (const c of process.stdin) raw += c
const inp = JSON.parse(raw || '{}')
const out = (inp.visits || []).map((v) => {
  const { source, extra, detail_prefix, ...visit } = v
  const it = confirmTimesItem(visit, { owner: inp.owner, now: inp.now, source, extra })
  if (detail_prefix) it.detail = detail_prefix + ' ' + it.detail
  return it
})
process.stdout.write(JSON.stringify(out))
