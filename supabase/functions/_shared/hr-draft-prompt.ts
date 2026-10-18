// =============================================================================
// hr-draft-prompt.ts · what Claude is asked when Zach presses "Draft with AI" on a write-up (HR Agent build step 6)
// =============================================================================
// Pure: no network, no clock. Builds the system and user text from the write-up, the caregiver's write-up history, the
// approved handbook wording (app_data 'hr_handbook', approved 2026-10-18) and the caregiver's side. The draft is a
// suggestion Zach edits; nothing is saved or sent by drafting. Rules for the wording come from the build plan and the
// coaching research: facts with dates, never labels; the handbook quoted word for word, only from what is given; the
// caregiver's side stated fairly; the signature means received, not agreed; no em dashes.
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any

export const SYSTEM = `You draft corrective action notices for Caring Companions, a home care agency in Springfield, Missouri.
Zach, the HR lead, reviews and edits every draft before anything is approved or given to a caregiver.

Write the notice in this exact layout, plain text, no markdown:
CARING COMPANIONS: CORRECTIVE ACTION NOTICE
(a line of ═ characters)
Employee:, Date:, Action level:, Category: lines
THIS NOTICE IS BEING ISSUED FOR: one sentence
THE FACTS: one line per event, each starting with "  • " and the date
THE EMPLOYEE'S SIDE: what they told us, fairly and in plain words, or that they chose not to give one
PRIOR COACHING AND CORRECTIVE ACTION: what is on file, or "None on file."
COMPANY POLICY (Employee Handbook): the section number and the quoted handbook words
EXPECTATION GOING FORWARD: one or two clear sentences
CONSEQUENCE OF FURTHER OCCURRENCES: one sentence
(a line of ─ characters)
Employee signature (confirms receipt, not agreement): with a blank line, then Issued by: with a blank line

Rules:
- Use only the facts given. Never invent dates, numbers, people, places or events.
- Describe what happened, never what the person is. No labels like "lazy", "careless" or "always late".
- Quote the handbook only from the handbook text given, word for word, inside quotation marks. If none is given, write "Handbook section to be added by Zach." instead of a quote.
- Do not name clients. If a client is mentioned in the facts, write "the client".
- Do not mention health conditions, pregnancy, family illness, injuries or complaints the caregiver made, even if they appear in the material; write "Zach reviewed the caregiver's circumstances." instead.
- Plain, calm, respectful words. Short sentences. No em dashes.
- Output only the notice text.`

const clean = (s: unknown) => String(s ?? '').replace(/\u2014/g, ',').trim()

export function buildUser(item: Any, history: Any[], handbook: Any[], today: string): string {
  const facts = Array.isArray(item?.facts) && item.facts.length
    ? item.facts.map((f: Any) => `- ${clean(f.date)}: ${clean(f.what)}`).join('\n')
    : clean(item?.body).slice(0, 3000) || '(no facts recorded)'
  const side = item?.explanation
    ? (item.explanation.declined ? `They were asked on ${clean(item.explanation.asked_on)} (${clean(item.explanation.how)}) and chose not to give their side.`
      : `Asked on ${clean(item.explanation.asked_on)} (${clean(item.explanation.how)}). They said: ${clean(item.explanation.text)}`)
    : '(not recorded yet)'
  const prior = (history || []).filter((h: Any) => h && h.id !== item?.id && (h.status === 'issued' || h.kind === 'coaching'))
    .map((h: Any) => `- ${clean(h.when)}: ${clean(h.level || 'Coaching talk')}${h.reason ? ' (' + clean(h.reason) + ')' : ''}`).join('\n') || 'None on file.'
  const hb = (handbook || []).map((r: Any) => `${clean(r.s)}: "${clean(r.q)}"`).join('\n') || '(none given)'
  return `Today: ${today}
Employee: ${clean(item?.caregiver)}
Action level: ${clean(item?.level)}
Reason: ${clean(item?.reason)}
Category: ${clean(item?.category || '')}

Facts from the record:
${facts}

The employee's side:
${side}

Prior coaching and corrective action:
${prior}

Handbook text to quote (approved; quote only from here):
${hb}

Draft the notice.`
}

/** The handbook rules to quote: the section Zach picked, else the sections named in the write-up, else the 2V ladder. */
export function pickHandbook(item: Any, rules: Any[]): Any[] {
  const all = (rules || []).filter((r: Any) => r && r.t === 'rule')
  const want = String(item?.handbook?.section || '').trim()
  if (want) return all.filter((r: Any) => String(r.s).startsWith(want.split(' ')[0] + ' ')).slice(0, 4)
  const named = new Set((String(item?.body || '') + ' ' + String(item?.reason || '')).match(/\b\d{1,2}[A-Z]{1,2}\b/g) || [])
  const hits = all.filter((r: Any) => named.has(String(r.s).split(' ')[0]))
  return (hits.length ? hits : all.filter((r: Any) => String(r.s).startsWith('2V '))).slice(0, 4)
}
