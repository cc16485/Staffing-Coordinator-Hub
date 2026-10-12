// 650 · THE TEST BENCH for the call reader (her eight points, 2026-10-12). Made-up calls (no real person, no PHI), each
// with what an experienced Caring Companions coordinator would expect. Runs them through the DEPLOYED reader's owner-only
// test bench (nothing read from GoHighLevel, nothing stored) and scores each expectation.
//   SB_SERVICE=<the project's server key> node call_tasks_eval.mjs [--only id,id] [--out results.json]
const BASE = process.env.SB_FN_BASE || 'https://zngsgedlsxinbygwmxwn.supabase.co'
const KEY = process.env.SB_SERVICE || ''
const AT = '2026-10-13T15:00:00Z'   // Tuesday, October 13, 10:00 am Central
const MARGARET = { match: 'one', person_id: 'p-mh', name: 'Margaret Hill', roles: ['client'] }
const LISA = { match: 'one', person_id: 'p-lisa', name: 'Lisa Hill', roles: ['contact'] }
const TANYA = { match: 'one', person_id: 'p-tb', name: 'Tanya Brooks', roles: ['caregiver'] }
const NONE = { match: 'none' }
const T = (...lines) => lines.map((l, i) => `Speaker ${l.startsWith('O:') ? 0 : 1}: ${l.replace(/^[OC]: /, '')}`).join('\n')

export const SCENARIOS = [
  // 1 · existing clients and families
  { id: 'c1-more-hours', group: 'clients', who: LISA, caller: 'Lisa H.', direction: 'in',
    transcript: T('O: Caring Companions, this is Krystal.', 'C: Hi, it is Lisa, Margaret Hill\'s daughter. Mom is doing great with Tanya. We would like to add Saturdays, nine to one, starting next week.', 'O: Wonderful. Let me check with Tanya and our schedule, and I will call you back by Thursday.', 'C: Perfect, thank you.'),
    expect: { cards: [1, 1], areas: ['scheduling'], commit: ['we_agreed'], due: '2026-10-15' } },
  { id: 'c2-change-done-on-call', group: 'clients', who: MARGARET, caller: 'Margaret H.', direction: 'in',
    transcript: T('O: Caring Companions.', 'C: This is Margaret. Can Tanya come Thursday instead of Wednesday this week? I have a dentist Wednesday.', 'O: Yes, I just moved it in the system and I texted Tanya, she confirmed Thursday works.', 'C: Oh good, thank you dear.'),
    expect: { cards: [0, 0], decisions: ['done_on_call'] } },
  { id: 'c3-caregiver-preference-and-concern', group: 'clients', who: LISA, caller: 'Lisa H.', direction: 'in',
    transcript: T('O: Caring Companions, this is Krystal.', 'C: Lisa Hill again. The new caregiver Brianna was late twice last week, about forty minutes each time, and Mom was upset. Could we keep Tanya on every visit and not use Brianna anymore?', 'O: I am sorry. I will look into what happened with Brianna and see what we can do about keeping Tanya on all of Mom\'s visits.'),
    expect: { cards: [2, 3], areas: ['caregiver_performance', 'scheduling'] } },
  { id: 'c4-transport-considering', group: 'clients', who: MARGARET, caller: 'Margaret H.', direction: 'in',
    transcript: T('O: Caring Companions.', 'C: I have a doctor appointment Friday at two. I might need someone to drive me, but let me ask my daughter first if she can take me. If she cannot, I will call you back.', 'O: That sounds good, just let us know.'),
    expect: { cards: [0, 0], commit: ['caller_considering', 'caller_will'] } },
  { id: 'c5-fall-safety', group: 'clients', who: LISA, caller: 'Lisa H.', direction: 'in',
    transcript: T('O: Caring Companions.', 'C: Mom fell last night after the caregiver left. She has a big bruise on her arm and nobody told me until this morning. I want someone to call me back about what happened today.', 'O: I am so sorry. I will make sure someone calls you today.'),
    expect: { cards: [1, 2], areas: ['safety_incident'], urgency: ['now', 'today'] } },
  { id: 'c6-cancel-tomorrow', group: 'clients', who: MARGARET, caller: 'Margaret H.', direction: 'in',
    transcript: T('O: Caring Companions.', 'C: Please cancel tomorrow\'s visit, my son is taking me to see my sister.', 'O: No problem, I will take care of it and let Tanya know.'),
    expect: { cards: [1, 1], areas: ['scheduling'], urgency: ['now', 'today'] } },
  { id: 'c7-ending-service', group: 'clients', who: LISA, caller: 'Lisa H.', direction: 'in',
    transcript: T('O: Caring Companions, this is Krystal.', 'C: I wanted to let you know Mom is moving into assisted living on the 31st, so the 30th will be her last day with you. You have all been wonderful.', 'O: Thank you for telling us. We will take care of everything on our end.'),
    expect: { cards: [1, 3], areas: ['client_care', 'scheduling'] } },
  { id: 'c8-steve-like-pending', group: 'promises', who: { match: 'one', person_id: 'p-sa', name: 'Sam Avery', roles: ['client'] }, caller: 'Sam A.', direction: 'out',
    transcript: T('O: Hi Sam, it is Samantha returning your call.', 'C: Yes, my license expired. I need someone to take me to the DMV and help me get in. Could Angel fit a couple of hours in this week?', 'O: We will work it out.', 'C: I will call you tomorrow to confirm the day.'),
    expect: { cards: [1, 1], areas: ['scheduling'], commit: ['caller_will', 'awaiting_confirmation'] } },   // both say it is not settled yet
  // 2 · caregivers
  { id: 'g1-availability', group: 'caregivers', who: TANYA, caller: 'Tanya B.', direction: 'in',
    transcript: T('O: Caring Companions.', 'C: Hi, it is Tanya. Starting November first I cannot work Mondays anymore, I start a class.', 'O: Thanks for the heads up, we will plan for that.'),
    expect: { cards: [1, 1], areas: ['scheduling'] } },
  { id: 'g2-sick-no-case', group: 'urgency', who: TANYA, caller: 'Tanya B.', direction: 'in', call_at: '2026-10-13T12:05:00Z',
    transcript: T('O: Caring Companions.', 'C: It is Tanya, I am sick, I have a fever. I cannot make Margaret at nine this morning.', 'O: Feel better, we will find someone.'),
    expect: { cards: [1, 1], urgency: ['now'], titleIncludes: /call-off|cover|find/i } },
  { id: 'g3-sick-case-exists', group: 'workflows', who: TANYA, caller: 'Tanya B.', direction: 'in', call_at: '2026-10-13T12:20:00Z',
    context: { coverage: [{ client: 'Margaret Hill', calling_off: 'Tanya Brooks', shift_date: '2026-10-13', shift_time: '09:00-13:00', status: 'open', opened_at: '2026-10-13T12:06:00Z' }] },
    transcript: T('O: Caring Companions.', 'C: Tanya again, just checking you got my message that I cannot make Margaret this morning.', 'O: Yes, we got it, we are working on coverage.'),
    expect: { cards: [0, 0], decisions: ['already_in_workflow'] } },
  { id: 'g4-time-off', group: 'caregivers', who: TANYA, caller: 'Tanya B.', direction: 'in',
    transcript: T('O: Caring Companions.', 'C: Can I request December twenty-third through the twenty-seventh off? Family is visiting.', 'O: I will put the request in and let you know.'),
    expect: { cards: [1, 1], areas: ['scheduling'] } },
  { id: 'g5-payroll', group: 'caregivers', who: TANYA, caller: 'Tanya B.', direction: 'in',
    transcript: T('O: Caring Companions.', 'C: My paycheck is missing four hours from Saturday.', 'O: I am sorry, I will look into it and call you back tomorrow.'),
    expect: { cards: [1, 1], areas: ['payroll'], due: '2026-10-14', commit: ['we_agreed'] } },
  { id: 'g6-evv', group: 'caregivers', who: TANYA, caller: 'Tanya B.', direction: 'in',
    transcript: T('O: Caring Companions.', 'C: I forgot to clock out Friday at Margaret\'s, I left at five.', 'O: Okay, we need a correction form. I will send it to you; once you sign it we will fix the time.', 'C: Okay, I will sign it tonight.'),
    expect: { cards: [1, 2], areas: ['evv_timekeeping'] } },
  { id: 'g7-client-concern', group: 'caregivers', who: TANYA, caller: 'Tanya B.', direction: 'in',
    transcript: T('O: Caring Companions.', 'C: I am worried about Margaret. She has seemed confused the last few days and she is barely eating.', 'O: Thank you for telling us. Someone will follow up.'),
    expect: { cards: [1, 1], areas: ['client_care'], urgency: ['now', 'today'] } },
  { id: 'g8-three-unrelated', group: 'multi', who: TANYA, caller: 'Tanya B.', direction: 'in',
    transcript: T('O: Caring Companions.', 'C: Three things. My check is short two hours from last Tuesday. Also I need the Friday after Thanksgiving off. And Margaret\'s walker is broken, the wheel came off, she almost tripped this morning.', 'O: Got it. I will look at the hours, put in your day off, and we will get the walker taken care of.'),
    expect: { cards: [3, 3], areas: ['payroll', 'scheduling'], urgency: ['now', 'today'] } },
  // 3 · referral partners
  { id: 'r1-new-referral-no-lead', group: 'referrals', who: NONE, caller: 'Mercy Home Health', direction: 'in',
    transcript: T('O: Caring Companions, this is Krystal.', 'C: This is Dana, case manager at Mercy Home Health. I have a referral, John Park, Medicaid, needs about twenty hours a week. I will fax the referral this afternoon.', 'O: Thank you Dana, we will call the family today.'),
    expect: { cards: [1, 2], areas: ['referral_partner', 'family_enquiries'], urgency: ['now', 'today'] } },
  { id: 'r2-new-referral-lead-exists', group: 'workflows', who: NONE, caller: 'Mercy Home Health', direction: 'in',
    context: { leads: [{ first_name: 'John', last_name: 'Park', referral_source_name: 'Mercy Home Health', status: 'New', created_at: '2026-10-13T15:05:00Z' }] },
    transcript: T('O: Caring Companions, this is Krystal.', 'C: This is Dana at Mercy Home Health with a referral, John Park, Medicaid, about twenty hours a week.', 'O: Thanks Dana, I have entered him and we will reach out to the family.'),
    expect: { cards: [0, 1], decisions: ['already_in_workflow'] } },
  { id: 'r3-authorization-update', group: 'referrals', who: NONE, caller: 'Area Agency on Aging', direction: 'in',
    transcript: T('O: Caring Companions.', 'C: This is Rob from the Area Agency on Aging. Margaret Hill\'s authorization is going up to thirty hours a week starting November first. Can you send me an updated care plan?', 'O: Yes, we will send the updated plan.'),
    expect: { cards: [1, 2], areas: ['payer_programs'] } },
  { id: 'r4-info-answered', group: 'referrals', who: NONE, caller: 'Ozarks Health', direction: 'in',
    transcript: T('O: Caring Companions.', 'C: Quick question, do you serve Nixa and do you take VA?', 'O: Yes to both, we serve Nixa and we work with VA Community Care.', 'C: Great, that is all I needed.'),
    expect: { cards: [0, 0] } },
  { id: 'r5-promise-report', group: 'promises', who: NONE, caller: 'Mercy Home Health', direction: 'in',
    transcript: T('O: Caring Companions.', 'C: Dana at Mercy. Could you send me a short update on how John Park is doing before his review?', 'O: Sure, I will email you an update by Friday.'),
    expect: { cards: [1, 1], due: '2026-10-16', commit: ['we_agreed'] } },
  // 6 · existing workflows
  { id: 'w1-existing-card', group: 'workflows', who: LISA, caller: 'Lisa H.', direction: 'in',
    context: { ops: [{ id: 'ops_sat', about: 'Lisa Hill', status: 'open', created_by: 'Krystal Land', created_at: '2026-10-12T15:00:00Z', title: 'Add Saturday 9-1 for Margaret Hill' }] },
    transcript: T('O: Caring Companions.', 'C: Lisa again, any news on the Saturdays for Mom? If nine to one does not work, ten to two is fine too.'),
    expect: { cards: [0, 0], decisions: ['add_to_existing_card'] } },
  { id: 'w2-client-journey', group: 'workflows', who: { match: 'one', person_id: 'p-new', lead_id: 'L-new', name: 'Ruth Lane', roles: ['lead'] }, caller: 'Ruth L.', direction: 'in',
    context: { lead: { first_name: 'Ruth', last_name: 'Lane', status: 'Converted' }, journeys: [{ journey_id: 'j-new', client_name: 'Ruth Lane', status: 'open', target_start: '2026-10-20' }],
      steps: [{ journey_id: 'j-new', step_key: 'intake.payer', state: 'open', waiting_on: 'family' }] },
    transcript: T('O: Caring Companions.', 'C: This is Ruth Lane\'s son. You asked how Mom will pay. She has Medicaid, her number is on the card, I can read it to you.', 'O: Thank you, I will note that on her file.'),
    expect: { cards: [0, 1], decisions: ['already_in_workflow'] } },
  // nothing to do
  { id: 'n1-wrong-number', group: 'none', who: NONE, caller: 'Unknown', direction: 'in',
    transcript: T('O: Caring Companions.', 'C: Is this the pharmacy?', 'O: No, sorry, wrong number.'),
    expect: { cards: [0, 0] } },
  { id: 'n2-thank-you', group: 'none', who: LISA, caller: 'Lisa H.', direction: 'in',
    transcript: T('O: Caring Companions.', 'C: Just calling to say thank you, Tanya has been a blessing.', 'O: That is so kind, I will pass it on to her.'),
    expect: { cards: [0, 1] } },
]

function score(s, r) {
  const e = s.expect, out = []
  if (!r || r.error) return [{ ok: false, what: 'reading', got: r ? r.error : 'no answer' }]
  const tasks = r.reading.tasks, items = r.reading.detail.items, kinds = r.reading.detail.commitments.map((c) => c.kind)
  out.push({ ok: tasks.length >= e.cards[0] && tasks.length <= e.cards[1], what: `cards ${e.cards[0]}-${e.cards[1]}`, got: tasks.length })
  if (e.areas) out.push({ ok: e.areas.some((a) => tasks.some((t) => t.area === a) || items.some((i) => i.area === a)), what: 'area ' + e.areas.join('/'), got: [...new Set(items.map((i) => i.area))].join(',') })
  if (e.urgency) out.push({ ok: tasks.some((t) => e.urgency.includes(t.urgency)), what: 'urgency ' + e.urgency.join('/'), got: tasks.map((t) => t.urgency).join(',') })
  if (e.decisions) out.push({ ok: e.decisions.every((d) => items.some((i) => i.decision === d)), what: 'decision ' + e.decisions.join('+'), got: items.map((i) => i.decision).join(',') })
  if (e.commit) out.push({ ok: e.commit.some((k) => kinds.includes(k)), what: 'promise ' + e.commit.join('/'), got: kinds.join(',') })
  if (e.due) out.push({ ok: tasks.some((t) => t.due === e.due), what: 'due ' + e.due, got: tasks.map((t) => t.due).join(',') })
  if (e.titleIncludes) out.push({ ok: tasks.some((t) => e.titleIncludes.test(t.title)), what: 'title ' + e.titleIncludes, got: tasks.map((t) => t.title).join(' | ') })
  out.push({ ok: tasks.every((t) => t.owner && t.owner.name), what: 'every card has an owner', got: tasks.map((t) => t.owner && t.owner.name).join(',') })
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!KEY) { console.log('SB_SERVICE (the server key) is required'); process.exit(2) }
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean)
  const outFile = (process.argv.find((a) => a.startsWith('--out=')) || '').slice(6)
  const list = SCENARIOS.filter((s) => !only.length || only.includes(s.id))
  const all = []
  for (let i = 0; i < list.length; i += 5) {
    const batch = list.slice(i, i + 5).map((s) => ({ id: s.id, call_at: s.call_at || AT, direction: s.direction, seconds: 120, caller: s.caller, who: s.who, transcript: s.transcript, context: s.context || {}, staffing: 'Samantha Troutman' }))
    const r = await fetch(`${BASE}/functions/v1/call-tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY, apikey: KEY }, body: JSON.stringify({ eval: batch }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { console.log('bench answered', r.status, JSON.stringify(j).slice(0, 200)); process.exit(1) }
    for (const res of j.results) all.push({ s: list.find((x) => x.id === res.id), r: res })
  }
  let pass = 0, total = 0
  for (const { s, r } of all) {
    const sc = score(s, r); const ok = sc.every((x) => x.ok); total++; if (ok) pass++
    console.log(`${ok ? 'PASS' : 'MISS'}  ${s.id} [${s.group}]`)
    for (const x of sc.filter((x) => !x.ok)) console.log(`        expected ${x.what}, got ${x.got}`)
    if (r.reading) for (const t of r.reading.tasks) console.log(`        card: ${t.title}  (${t.area}, ${t.urgency}, ${t.due || 'no date'}, ${t.owner && t.owner.name})`)
  }
  console.log(`\n${pass}/${total} calls read as a coordinator would`)
  if (outFile) (await import('fs')).writeFileSync(outFile, JSON.stringify(all.map(({ s, r }) => ({ id: s.id, group: s.group, expect: { ...s.expect, titleIncludes: String(s.expect.titleIncludes || '') }, result: r, score: score(s, r) })), null, 1))
}
