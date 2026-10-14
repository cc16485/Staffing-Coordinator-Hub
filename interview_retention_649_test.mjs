// 649 · interview records kept 2 years (purge-recordings' interviewRecords), against a fake database. node interview_retention_649_test.mjs
import fs from 'fs'; import path from 'path'; import os from 'os'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const old = new Date(Date.now() - 800 * 864e5).toISOString(), recent = new Date(Date.now() - 100 * 864e5).toISOString()
let T, REMOVED
const reset = (days = 730) => { REMOVED = []; T = {
  recordings_settings: [{ id: 1, keep_interview_days: days }],
  job_applicants: [{ id: 'a1', records_hold_at: null, post_interview: { notes: 'kept', dogs: 'yes', observations: { at: old, family: { answer: 'yes', why: 'x' } } } },
                   { id: 'a2', records_hold_at: '2026-01-01', post_interview: { observations: { at: old } } },
                   { id: 'a3', records_hold_at: null, post_interview: { observations: { at: recent } } }],
  recordings: [{ id: 'r1', kind: 'interview', subject_id: 'a1', storage_path: 'interview/a1/x.webm', created_at: old, transcript: 'T', turns: [1], transcript_purged_at: null },
               { id: 'r2', kind: 'interview', subject_id: 'a2', storage_path: null, created_at: old, transcript: 'T', turns: [1], transcript_purged_at: null },
               { id: 'r3', kind: 'interview', subject_id: 'a3', storage_path: null, created_at: recent, transcript: 'T', turns: [1], transcript_purged_at: null }],
  interview_reviews: [{ id: 'v1', applicant_id: 'a1', created_at: old }, { id: 'v2', applicant_id: 'a2', created_at: old }, { id: 'v3', applicant_id: 'a3', created_at: recent }] } }
const q = (t) => { const f = []; let op = 'select', patch = null; const b = {
  select() { return b }, limit() { return b }, eq(c, v) { f.push((r) => r[c] === v); return b }, lt(c, v) { f.push((r) => String(r[c]) < v); return b },
  is(c, v) { f.push((r) => (r[c] ?? null) === v); return b }, in(c, vs) { f.push((r) => vs.includes(r[c])); return b },
  not(c, op2, v) { if (c === 'post_interview->observations') f.push((r) => r.post_interview && r.post_interview.observations != null); else f.push((r) => (r[c] ?? null) !== v); return b },
  update(p) { op = 'update'; patch = p; return b }, delete() { op = 'delete'; return b },
  maybeSingle() { return b.then((x) => ({ data: x.data[0] ?? null, error: null })) },
  then(ok) { const m = (r) => f.every((g) => g(r))
    if (op === 'update') T[t].filter(m).forEach((r) => Object.assign(r, patch))
    if (op === 'delete') T[t] = T[t].filter((r) => !m(r))
    return Promise.resolve({ data: op === 'select' ? JSON.parse(JSON.stringify(T[t].filter(m))) : null, error: null }).then(ok) } }; return b }
const db = { from: q, storage: { from: () => ({ remove: async (p) => { REMOVED.push(...p); return { error: null } } }) } }
globalThis.Deno = { env: { get: () => '' }, serve: () => {} }
let src = fs.readFileSync(path.join(FN, 'purge-recordings/index.ts'), 'utf8')
src = src.replace(/^import \{ createClient \} from .*$/m, 'const createClient = (..._a: any[]) => null').replace(/^import \{ jobCaller \} from .*$/m, 'const jobCaller = async (..._a: any[]) => null').replace(/'\.\.\/_shared\//g, "'" + path.join(FN, '_shared') + '/')
const tmp = path.join(os.tmpdir(), 'ret649_' + process.pid + '.ts'); fs.writeFileSync(tmp, src)
const M = await import(tmp); fs.unlinkSync(tmp)
reset(); let o = await M.interviewRecords(db, true)
ck('a dry look counts: 1 transcript, 1 review, 1 set of observations (the held person and the recent one are not counted)', o.transcripts === 1 && o.reviews === 1 && o.observations === 1 && o.held === 1, o)
ck('...and changes nothing', T.recordings[0].transcript === 'T' && T.interview_reviews.length === 3 && T.job_applicants[0].post_interview.observations && !REMOVED.length)
o = await M.interviewRecords(db, false)
ck('2 years on: the transcript is cleared (and any audio left removed), stamped', T.recordings[0].transcript === null && T.recordings[0].turns === null && !!T.recordings[0].transcript_purged_at && REMOVED[0] === 'interview/a1/x.webm', T.recordings[0])
ck('...the AI review is deleted', !T.interview_reviews.some((r) => r.id === 'v1'))
ck('...the observations are removed, and the interview answers on the application are kept', !T.job_applicants[0].post_interview.observations && T.job_applicants[0].post_interview.notes === 'kept' && T.job_applicants[0].post_interview.dogs === 'yes' && !!T.job_applicants[0].post_interview.observations_purged_at, T.job_applicants[0])
ck('a legal hold: nothing of theirs is touched', T.recordings[1].transcript === 'T' && T.interview_reviews.some((r) => r.id === 'v2') && !!T.job_applicants[1].post_interview.observations)
ck('anything under 2 years old is kept', T.recordings[2].transcript === 'T' && T.interview_reviews.some((r) => r.id === 'v3') && !!T.job_applicants[2].post_interview.observations)
o = await M.interviewRecords(db, false)
ck('the next day does nothing more', o.transcripts === 0 && o.reviews === 0 && o.observations === 0, o)
reset(0); o = await M.interviewRecords(db, false)
ck('setting 0 turns it off', o.off === true && T.recordings[0].transcript === 'T')
const sql = fs.readFileSync(path.join(ROOT, 'interview_retention_649.sql'), 'utf8')
ck('the database change adds only and sets 730 days', /keep_interview_days int not null default 730/.test(sql) && /set keep_interview_days = 730/.test(sql) && !/drop table|delete from|truncate/i.test(sql))
ck('no em dashes in anything new', ![sql, src].some((x) => x.includes('—')))
for (const [n, ok, note] of res) console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : '  ' + note))
console.log(res.filter((r) => r[1]).length + '/' + res.length + ' passed'); if (res.some((r) => !r[1])) process.exit(1)
