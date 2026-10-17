// OKLAHOMA OFFER HOLD (2026-10-16, Samantha approved the Oklahoma hiring plan, build step 1). The Hub's half: outreach-check's
// onboarding_path answer carries `office` ('MO' | 'OK') for a named person, by the ok_applicant_hold rule (latest application by
// last 10 phone digits or email). The Training Platform's job-offer refuses an 'OK' offer. No network. node ok_offer_hold_test.mjs
import fs from 'fs'; import path from 'path';
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 600)]);
const { applicantOffice } = await import(path.join(ROOT, 'supabase/functions/_shared/applicant-office.ts'));

// A stand-in database: .or() returns every row (a superset, like a loose ilike), so the exact match must happen in the helper.
let ROWS = [], FAIL = false, ASKED = null;
const db = { from: (t) => { const b = { select() { return b; }, or(o) { ASKED = o; return b; }, order() { return b; }, limit() { return b; },
  then(ok) { return Promise.resolve(FAIL ? { data: null, error: { message: 'boom' } } : { data: t === 'job_applicants' ? [...ROWS].sort((a, z) => z.created_at.localeCompare(a.created_at)) : [], error: null }).then(ok); } }; return b; } };

ROWS = [{ office: 'OK', phone: '(405) 555-0180', email: 'okay@practice.invalid', created_at: '2026-10-16T10:00:00Z' },
        { office: 'MO', phone: '417-555-0101', email: 'mo@x.com', created_at: '2026-10-15T10:00:00Z' }];
let r = await applicantOffice(db, '405-555-0180', null);
ck('an Oklahoma applicant found by phone (any format) is OK', r.office === 'OK' && !r.error, r);
ck('the phone is asked loosely (digits in any format) and matched exactly afterwards', /^phone\.ilike\.%405%555%0180%$/.test(ASKED), ASKED);
r = await applicantOffice(db, null, ' OKAY@practice.invalid ');
ck('an Oklahoma applicant found by email (any case, spaces trimmed) is OK', r.office === 'OK', r);
r = await applicantOffice(db, '+1 (417) 555-0101', 'mo@x.com');
ck('a Missouri applicant is MO', r.office === 'MO', r);
r = await applicantOffice(db, '4055550181', 'someone@else.com');
ck('a near-miss phone (one digit off) is not the Oklahoma person: MO', r.office === 'MO', r);
r = await applicantOffice(db, '9135550000', 'nobody@x.com');
ck('someone with no application (an existing employee) is MO, as today', r.office === 'MO', r);
r = await applicantOffice(db, '', '');
ck('no phone and no email: MO without asking the database', r.office === 'MO' && !r.error, r);

ROWS.push({ office: 'MO', phone: '4055550180', email: null, created_at: '2026-10-16T12:00:00Z' });
r = await applicantOffice(db, '405 555 0180', null);
ck('the LATEST application wins: a newer Missouri application makes them MO (the ok_applicant_hold rule)', r.office === 'MO', r);
ROWS.push({ office: 'OK', phone: null, email: 'mo@x.com', created_at: '2026-10-16T13:00:00Z' });
r = await applicantOffice(db, '4175550101', 'mo@x.com');
ck('matching by phone OR email: a newer Oklahoma application under the same email makes them OK', r.office === 'OK', r);

FAIL = true; r = await applicantOffice(db, '4055550180', null); FAIL = false;
ck('a database error comes back as an error (outreach-check answers 500, Training saves and sends nothing)', !!r.error, r);

// outreach-check wiring (read the source): only the onboarding_path answer, only when a person is named, 500 on a read error
const oc = fs.readFileSync(path.join(ROOT, 'supabase/functions/outreach-check/index.ts'), 'utf8');
ck('outreach-check imports the shared helper', oc.includes("import { applicantOffice } from '../_shared/applicant-office.ts'"));
ck('outreach-check asks only when the caller names a person', /if \(b\.phone \|\| b\.email\) \{\s*const o = await applicantOffice\(db, b\.phone, b\.email\)/.test(oc));
ck('outreach-check answers 500 on a read error', /if \(o\.error\) return json\(\{ error: 'could not read which office this applicant belongs to: ' \+ o\.error \}, 500\)/.test(oc));
ck('outreach-check adds office to the onboarding_path answer only when it was asked', oc.includes('...(office ? { office } : {}) })'));
ck('the helper never writes (read only, unlike ok_applicant_hold which stamps a held note)', !/\.(update|insert|upsert|delete|rpc)\(/.test(fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/applicant-office.ts'), 'utf8')));

let bad = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note)); if (!ok) bad++; }
console.log(`\n${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0);
