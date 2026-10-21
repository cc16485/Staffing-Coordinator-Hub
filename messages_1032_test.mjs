// 1032 · THE ONE WELCOME MESSAGE, PROFILE REMINDERS, THE BADGE CARD (the approved onboarding design 2026-10-21, stops 5 and 6;
// decision 2 keeps the 15-minute welcome video call). Pure words + the wiring in the real files.   PGLITE=<path> node messages_1032_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const W = await import(path.join(process.cwd(), 'supabase/functions/_shared/welcome-message.ts'))
const src = (p) => fs.readFileSync(p, 'utf8')
const m1 = W.welcomeMessages('Kim', 'https://cc.mo-care.com/welcome.html?w=1', 'https://cc.mo-care.com/caregiver-profile.html?t=abc')
const m2 = W.welcomeMessages('Kim', 'https://cc.mo-care.com/welcome.html?w=1', 'https://cc.mo-care.com/caregiver-profile.html?t=abc', 'https://training.mo-care.com/#/me/xyz')
ck('ONE message: the welcome call booking link (ID for the I-9), the profile link, orientation, the badge, in any order', [m1.text, m1.html].every((t) => /welcome\.html\?w=1/.test(t) && /caregiver-profile\.html\?t=abc/.test(t) && /badge/.test(t) && /any order/.test(t) && /ID/.test(t)), m1)
ck('without the orientation link: it says the link comes in its own text from our training site', /own text from our training site/.test(m1.text) && /own message from our training site/.test(m1.html))
ck('with the orientation link: it is in the message', /training\.mo-care\.com\/#\/me\/xyz/.test(m2.text) && /Start my orientation/.test(m2.html))
const r = W.profileReminderMessages('Kim', 'https://cc.mo-care.com/caregiver-profile.html?t=abc')
ck('the profile reminder: their link, warm, short', /caregiver-profile\.html\?t=abc/.test(r.text) && /friendly reminder/.test(r.text) && /Finish my profile/.test(r.html))
ck('every text ends Reply STOP to opt out; no em dash anywhere', [m1.text, m2.text, r.text].every((t) => /Reply STOP to opt out\.$/.test(t)) && ![m1, m2, r].some((x) => /—/.test(x.text + x.html + x.subject)))
ck('the profile link is the same page caregiver-profile sends', W.profileLink('abc') === 'https://cc.mo-care.com/caregiver-profile.html?t=abc' && /caregiver-profile\.html\?t=' \+ encodeURIComponent\(token\)/.test(src('supabase/functions/caregiver-profile/index.ts')))
const wc = src('supabase/functions/welcome-call/index.ts'), s2 = src('supabase/functions/step2-handoff/index.ts'), cj = src('supabase/functions/caregiver-journey/index.ts')
ck('welcome-call: only the Step 2 server door can ask for the welcome message (invite_auto, welcome: true)', /welcome = b\.welcome === true/.test(wc) && wc.indexOf('welcome = b.welcome === true') < wc.indexOf("} else {\n    const who = await requireStaff"))
ck('welcome-call: the profile row is made if needed (self-complete) and a missing profile link stops the send, never a message without it', /self_complete: true/.test(wc) && /their caregiver profile could not be started, so there was no profile link to send\. Nothing was sent\./.test(wc))
ck('Step 2 Verify: the welcome message only with welcome_message_live (or a test person); the held text keeps the welcome words', /welcome_message_live === true/.test(s2) && /inviteVia\(c, cid, 'held text', 'text', inv\.welcome === true\)/.test(s2))
ck('profile reminders: day 3 and 6 after the welcome message, only while not sent in, in the window, profile_reminders_live, a failed one is a card', /profile_reminders_live !== true/.test(s2) && /\[6, 3\]\.find/.test(s2) && /!prof\.submitted_at && !prof\.published/.test(s2) && /inReminderWindow\(\)/.test(s2) && /'profile_reminder_' \+ cid/.test(s2))
ck('the badge card: when the profile photo is in, owned by Recruiting & Orientation, closed by badge_mailed_at, never part of Approve to Work, badge_cards_live', /cj_badge_/.test(cj) && /badge_cards_live === true/.test(cj) && /badge_mailed_at/.test(cj) && /never holds up Approve to Work/.test(cj) && !/badge/.test(src('supabase/functions/_shared/caregiver-journey.ts').split('export function verifyRows')[1].split('export const GATE_UNCONFIRMED')[0]))
const sq = src('supabase/messages-1032.sql'), rb = src('supabase/messages-1032-rollback.sql')
ck('no em dash in the SQL', !/—/.test(sq + rb))
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.reference_requests (id text primary key, sent_at timestamptz);
    create table public.app_data (key text primary key, data jsonb, updated_at timestamptz default now());
    create function public.app_data_rev(r jsonb) returns bigint language sql immutable as $$ select coalesce((r->>'_rev')::bigint, 0) $$;
    insert into public.app_data values ('candidates', '[{"id": 7, "first": "Kim"}]');`)
  await db.exec(sq); await db.exec(sq)
  const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'reference_requests' order by 1`)).rows.map((x) => x.column_name)
  ck('the SQL adds texted_at and reminder_texted_at (ran twice)', cols.includes('texted_at') && cols.includes('reminder_texted_at'), cols)
  const pr = (await db.query(`select public.step2_patch('candidates', '7', 0, '{"profile_reminders": {"d3": {"at": "x"}}}'::jsonb) as r`)).rows[0].r
  let refused = false; try { await db.query(`select public.step2_patch('candidates', '7', 0, '{"care_level_approved": 3}'::jsonb)`) } catch { refused = true }
  ck('the Step 2 record door saves profile_reminders, and still refuses any other field', pr.ok === true && refused, pr)
  await db.exec(rb); const after = (await db.query(`select column_name from information_schema.columns where table_name = 'reference_requests'`)).rows.map((x) => x.column_name)
  ck('rollback drops them', !after.includes('texted_at') && !after.includes('reminder_texted_at'), after)
} else ck('PGLITE is set', false)
for (const [n, o, note] of res) console.log((o ? 'PASS  ' : 'FAIL  ') + n + (o ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
