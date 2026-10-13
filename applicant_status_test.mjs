// TRACK 2c (Samantha 2026-10-11): where one person is, from application to Approved to Work: done, current, submitted, signed
// or outstanding, missing, next and who. A stage is done only on a record that says so. node applicant_status_test.mjs
import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname)
const M = await import(path.join(ROOT, 'supabase/functions/_shared/applicant-status.ts'))
const M2 = await import(path.join(ROOT, 'supabase/functions/_shared/step1-documents.ts'))
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 500)])
const S = (x) => M.applicantStatus(x), states = (s) => s.stages.map((x) => x.state[0]).join('')
const app = { id: 'a1', created_at: '2026-10-01T15:00:00Z', screen_grade: 'A', position: 'Caregiver' }
const offerNew = (x = {}) => ({ id: 'o1', onboarding_path: 'new', offer_sent_at: '2026-10-05T15:00:00Z', offer_expires_at: '2026-10-12T15:00:00Z', ...x })
const signed = { offer_signed_at: '2026-10-06T15:00:00Z', pd_signed_at: '2026-10-06T15:05:00Z' }
const sigs = (n) => Object.fromEntries(M.STEP1_FORMS.slice(0, n).map(([k]) => [k, { at: '2026-10-07T15:00:00Z' }]))

let s = S({}); ck('nothing on file: nothing is done; the application is current', states(s) === 'cttttttttttt' && s.next.owner === 'the applicant', s)
s = S({ app: { id: 'a1', created_at: '2026-10-01T15:00:00Z' } }); ck('applied, no screening answers yet: application done, prescreening current', states(s).startsWith('dc') && /screening/.test(s.next.title))
s = S({ app }); ck('screened, not booked: booking is current; the applicant books (follow-ups automatic)', states(s).startsWith('ddc') && /book an interview/.test(s.next.title) && s.next.owner === 'the applicant')
s = S({ app, bookings: [{ status: 'booked', starts_at: '2026-10-14T15:00:00Z', created_at: '2026-10-02T15:00:00Z' }] }); ck('booked: the interview is current, with its time, owned by the interviewer', states(s).startsWith('dddc') && /The interview, Oct 14/.test(s.next.title) && s.next.owner === 'the interviewer', s.next)
s = S({ app, bookings: [{ status: 'noshow', starts_at: '2026-10-14T15:00:00Z' }] }); ck('a no-show: never counted as interviewed; rebook or close, by the office', states(s).startsWith('dddc') && /missed the interview/.test(s.next.title) && s.stages[3].note === 'Did not come to the interview')
s = S({ app, bookings: [{ status: 'done', starts_at: '2026-10-14T15:00:00Z' }] }); ck('interviewed, no decision: the office decides offer, pool or not hiring', states(s).startsWith('ddddc') && /Decide/.test(s.next.title) && s.next.owner === 'the office')
s = S({ app: { ...app, status: 'pool' }, bookings: [{ status: 'done' }] }); ck('candidate pool: the journey ends there, said plainly', s.ended === 'In the candidate pool (no offer now)' && !s.stages.some((x) => x.state === 'current'))
s = S({ app, offer: offerNew() }); ck('offer sent: signature current, the expiry and reminders named, owned by the applicant', states(s).startsWith('dddddc') && /Open until Oct 12/.test(s.next.why) && s.next.owner === 'the applicant', s.next)
s = S({ app, offer: offerNew({ offer_signed_at: '2026-10-06T15:00:00Z' }) }); ck('offer letter signed, position description not: still current, the note says which', states(s).startsWith('dddddc') && /position description is not yet/.test(s.stages[5].note))
s = S({ app, offer: offerNew({ offer_status: 'declined', offer_declined_at: '2026-10-06T15:00:00Z' }) }); ck('a declined offer ends the journey: "They declined the offer", nobody owns a next step', s.ended === 'They declined the offer' && s.next.owner === 'nobody: closed')
s = S({ app, offer: offerNew(signed), step1: { started_at: '2026-10-06T16:00:00Z', signatures: sigs(3), answers: { a: 1 } } })
ck('Step 1 in progress: current, "3 of 12", and the nine outstanding forms named in Missing (the driving agreement stands in until they answer)', states(s).startsWith('ddddddc') && /3 of 12 signed/.test(s.next.title) && s.step1.forms.filter((f) => !f.signed_at).length === 9 && /Details for the Background Checks, Availability/.test(s.missing.join()), s)
s = S({ app, offer: offerNew(signed), step1: { completed_at: '2026-10-07T18:00:00Z', signatures: sigs(7), answers: { a: 1 } }, cand: { id: 9, r1n: 'Jane', r2n: 'Tom' }, owner: { name: 'Krystal' } })
ck('Step 1 complete, no readiness card yet: start the checks and references, owned by the named Recruiting & Orientation owner', states(s).startsWith('dddddddc') && /Start the background checks/.test(s.next.title) && s.next.owner === 'Krystal (Recruiting & Orientation)', s.next)
ck('Background & References with only 2 of 4 references: said in Missing', /has 2 of 4 references/.test(s.missing.join()))
s = S({ app, offer: offerNew(signed), step1: { completed_at: '2026-10-07T18:00:00Z', signatures: sigs(7) }, cand: { id: 9, r1n: 'A', r2n: 'B', r3n: 'C', r4n: 'D' }, journey: { journey_id: 'j1' }, refs: [{ responded_at: 'x' }, { responded_at: null }, { responded_at: null }] })
ck('a readiness card exists: the page takes the next step from it (never guessed here); 2 of 3 references unanswered', s.readiness === true && s.journey_id === 'j1' && s.next.from_readiness === true && /2 of 3 references not answered/.test(s.missing.join()), s)
s = S({ app, offer: { id: 'o2', onboarding_path: 'old', offer_sent_at: 'x', offer_signed_at: 'x', pd_signed_at: 'x' } }); ck('old process: Step 1 shows as not applicable (the start link), never as missing', s.stages[6].state === 'na' && !s.missing.some((m) => /Step 1/.test(m)) && s.path === 'old')
s = S({ app, offer: offerNew(signed), step1: { completed_at: 'x', signatures: sigs(7) }, rec: { approved_to_work_at: '2026-10-20T15:00:00Z' }, journey: { journey_id: 'j1' } }); ck('approved to work on the roster record: the last stage is done', s.stages[11].state === 'done')
s = S({ app, experience: { counts: { confirmed: 2, supported: 1, self_reported: 3, questioned: 0 } } }); ck('unverified experience is named in Missing as not counting until confirmed', /4 tasks from their experience not verified yet \(does not count until a reference who saw it confirms\)/.test(s.missing.join()), s.missing)
ck('submitted: what they gave us, from the records (no free typing)', S({ app: { ...app, post_interview: { x: 1 } }, cand: { r1n: 'A' } }).submitted.interview_answers === true && S({ cand: { r1n: 'A' } }).submitted.references_listed === 1)
ck('a blank never counts: an offer row without a send date is not an offer sent', S({ app, offer: { id: 'o3', onboarding_path: 'new' } }).stages[4].state !== 'done')
/* 2026-10-13: each form's own status */
{ const fs = M.formState
  ck('form status: Not Started (no answers), In Progress (answers, no signature), Signed, Needs Attention (no PDF, or an older wording)',
    fs('availability', { answers: {}, signatures: {}, pdfs: {} }).state === 'not_started'
    && fs('availability', { answers: { hours_ideal: 30 }, signatures: {}, pdfs: {} }).state === 'in_progress'
    && fs('availability', { answers: {}, signatures: { availability: { at: 'x', version: M2.FORMS.availability.version } }, pdfs: { availability: 'p.pdf' } }).state === 'signed'
    && fs('availability', { answers: {}, signatures: { availability: { at: 'x', version: M2.FORMS.availability.version } }, pdfs: {} }).state === 'needs_attention'
    && /older|version/.test(fs('availability', { answers: {}, signatures: { availability: { at: 'x', version: 1 } }, pdfs: { availability: 'p' } }).why || ''), null) }

/* 2026-10-13 HEPATITIS B IN STEP 1: listed only when their Step 1 has it (13 forms), its signed state never "needs attention"
   for a missing onboarding PDF (the PDF lives on the confidential hepatitis B record) */
{ const fs = M.formState
  let s2 = S({ app, offer: offerNew(signed), step1: { started_at: 'x', signatures: sigs(3), answers: { a: 1 }, hepb_form: true } })
  const keys = s2.step1.forms.map((f) => f.key)
  ck('HEP B: a Step 1 with the form lists it last: 13 forms, "of 13 forms signed"', keys.at(-1) === 'hepb_vaccination' && keys.length === 13 && /3 of 13 forms signed/.test(s2.stages[6].note), { keys, note: s2.stages[6].note })
  s2 = S({ app, offer: offerNew(signed), step1: { started_at: 'x', signatures: sigs(3), answers: { a: 1 } } })
  ck('HEP B: a Step 1 without it (started before approval) lists 12 and never the Hepatitis B form', !s2.step1.forms.some((f) => f.key === 'hepb_vaccination') && s2.step1.forms.length === 12, s2.step1.forms.length)
  ck('HEP B: signed, no PDF in the Step 1 store: Signed (its PDF is on the confidential record), never Needs Attention', fs('hepb_vaccination', { answers: {}, signatures: { hepb_vaccination: { at: 'x', version: 1 } }, pdfs: { availability: 'p' } }).state === 'signed') }
for (const [n, ok, note] of res) console.log((ok ? 'ok    ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]); console.log(`${res.length - bad.length}/${res.length} passed`); if (bad.length) process.exit(1)
