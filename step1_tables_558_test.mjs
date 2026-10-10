// SLICE 2a: the Step 1 tables SQL read for its exact shape, and the rollback. No network. node step1_tables_558_test.mjs
import fs from 'fs'; import path from 'path';
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 300)]);
const sql = fs.readFileSync(path.join(ROOT, 'supabase/slice2a-step1-tables.sql'), 'utf8'), rb = fs.readFileSync(path.join(ROOT, 'supabase/slice2a-step1-tables-rollback.sql'), 'utf8');
ck('step1_forms: one row per offer, answers, signatures, pdfs, progress, e-sign consent, reminders, receipt', /create table if not exists public\.step1_forms/.test(sql) && /offer_id uuid not null unique/.test(sql) && /signatures jsonb/.test(sql) && /pdfs jsonb/.test(sql) && /esign_consent_at/.test(sql) && /reminder_2_at/.test(sql) && /receipt jsonb/.test(sql));
ck('a signed form and a stored PDF are never changed, the completion time never moved (trigger)', /the signature of % is never changed/.test(sql) && /the stored PDF of % is never replaced/.test(sql) && /the completion time is never changed/.test(sql) && /before update on public\.step1_forms/.test(sql));
ck('Step 1 records are never deleted or emptied (delete and truncate triggers on both tables)', (sql.match(/execute function public\.step1_no_delete\(\)/g) || []).length === 4);
ck('step1_identity: sealed SSN, DOB and license, last four, address, purge stamps, reveal count; no plain SSN column', /ssn_sealed text/.test(sql) && /ssn_last4 text/.test(sql) && /dob_sealed text/.test(sql) && /license_sealed text/.test(sql) && /purge_after timestamptz/.test(sql) && /purged_at timestamptz/.test(sql) && /reveals integer/.test(sql) && !/\bssn text\b/.test(sql));
ck('both tables: row security on, every privilege revoked from anon and authenticated, no policy (server only)', (sql.match(/enable row level security/g) || []).length === 2 && (sql.match(/revoke all privileges on table public\.step1_\w+ from anon, authenticated/g) || []).length === 2 && !/create policy/.test(sql) && !/^\s*grant /m.test(sql));
ck('the reveal log is the existing append-only document_access_log', /document_access_log/.test(sql));
ck('the rollback drops nothing and deletes nothing', !/drop table|delete from|truncate/i.test(rb));
ck('no em dash', !/—/.test(sql + rb));
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note));
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0);
