-- 455 · HIDE A PHOTO OR VIDEO FROM A CAREGIVER'S PROFILE (Samantha, 2026-10-05: "i want to be able to choose to hide a photo
-- or video from a caregivers profile. for example, we dont like Grace's video and want to hide it on her profile").
-- Two fields, false for everyone. The office sets one from the Hub's profile panel; caregiver-card then leaves that photo or
-- video off the family card. The file itself is kept. Safe to run twice. Nothing is dropped or rewritten.
begin;
alter table public.caregiver_profiles add column if not exists photo_hidden boolean not null default false;
alter table public.caregiver_profiles add column if not exists video_hidden boolean not null default false;
comment on column public.caregiver_profiles.photo_hidden is '455: the office hid the photo from families (the file is kept).';
comment on column public.caregiver_profiles.video_hidden is '455: the office hid the video from families (the file is kept).';
commit;
