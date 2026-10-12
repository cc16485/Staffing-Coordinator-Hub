-- 622 · THE NEW INTERVIEW (Samantha 2026-10-12, "yes to all, build it" on "The Best Caregiver Interview"). Installs the
-- interview_questions table the Hub's interview screen and Recruit → Interview questions read (it was written in September
-- as recruit-interview.sql but never run), with the six approved open questions. No scores (her rule): rubric is null.
-- Access: reading needs a Hub sign-in with care-coordinator access (desk_hub_ok); changing questions needs an office role
-- (hub_office_ok). Never "using (true)" (the shared project serves three hubs). Every role reads the caregiver set.
-- Safe to run again: seeded_as keeps a re-run from duplicating, and a re-run never overwrites questions edited in the Hub.
begin;
create table if not exists public.interview_questions (
  id          uuid primary key default gen_random_uuid(),
  position    text not null default 'caregiver',
  section     text not null,
  sort        int  not null default 0,
  question    text not null,
  kind        text not null default 'open' check (kind in ('open','yesno')),
  guidance    text,
  rubric      jsonb,
  optional    boolean not null default false,
  active      boolean not null default true,
  seeded_as   text unique,
  created_at  timestamptz not null default now()
);
create index if not exists interview_questions_pos_idx on public.interview_questions (position, sort) where active;
alter table public.interview_questions enable row level security;
drop policy if exists interview_questions_auth on public.interview_questions;
drop policy if exists interview_questions_read on public.interview_questions;
drop policy if exists interview_questions_write on public.interview_questions;
create policy interview_questions_read on public.interview_questions for select to authenticated using (public.desk_hub_ok());
create policy interview_questions_write on public.interview_questions for all to authenticated using (public.hub_office_ok()) with check (public.hub_office_ok());
revoke all on public.interview_questions from anon, authenticated;
grant select, insert, update, delete on public.interview_questions to authenticated;
grant all on public.interview_questions to service_role;

insert into public.interview_questions (seeded_as, position, section, sort, question, kind, guidance, rubric, optional) values
('v2-01','caregiver','Your story', 10,
 'Tell me a little about yourself, and how you came to caregiving.',
 'open', 'If not covered: "What kinds of clients have you cared for, and what did you help them with?" · "In homes, facilities, or family?" Strong: warmth about people; a reason about the person, not just the paycheck.', null, false),
('v2-02','caregiver','What you''re looking for', 20,
 'What are you looking for in your next job? Hours, pay, schedule, the kind of clients, anything. And what would make you want to stay somewhere a long time?',
 'open', 'Follow up: "What made you leave your last job, or think about leaving?" · "How many hours a week do you need to make it work?" If they need more hours than we can promise early on, say so honestly.', null, false),
('v2-03','caregiver','A client you loved, one who was hard', 30,
 'Tell me about a client you really enjoyed caring for, and one who was harder for you. What was the difference, and what did you do with the hard one?',
 'open', 'Follow up: "What did you try?" · "How did it turn out?" Strong: specific moments, patience and respect. New to caregiving? "A family member you cared for" works too.', null, false),
('v2-04','caregiver','Something was wrong', 40,
 'Tell me about a time a client refused care, or you noticed something was different or wrong. What did you do, and who did you tell?',
 'open', 'Strong: noticed it, acted, told the office or family quickly. Follow up if they waited or kept it to themselves.', null, false),
('v2-05','caregiver','When things go sideways', 50,
 'Tell me about a time you were running late, couldn''t make a shift, or made a mistake at work. What did you do?',
 'open', 'If never: "If it happened tomorrow, what would you do?" Strong: called the office early, owns the mistake. Kids, a second job or the bus never count against anyone; only how they handled it.', null, false),
('v2-06','caregiver','What isn''t a fit', 60,
 'Is there any kind of client, task, home or schedule that isn''t a good fit for you? Anything you''d want more training on first?',
 'open', 'An honest "not for me" is matching information, never a mark against them.', null, false)
on conflict (seeded_as) do nothing;
commit;
