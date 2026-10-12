-- care_packet_1.sql · Caregiver packets, Step 1 (Samantha "yes start step 1", 2026-10-12).
-- A client's caregiver packet: short notes about the client, plus how-to topics (each with its approved videos). Each
-- caregiver gets their own link and taps "I watched it and understand"; that tap is kept per packet version, so an edited
-- packet asks again. Only the care-packet function (service role) reads or writes these tables: RLS on, no policies, and
-- the browser roles hold no privileges on them. New tables only; nothing existing is changed.
begin;

create table if not exists public.care_topics (
  key         text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  title       text not null check (length(title) between 1 and 80),
  notes       text not null default '' check (length(notes) <= 2000),
  videos      jsonb not null default '[]'::jsonb check (jsonb_typeof(videos) = 'array'),
  active      boolean not null default true,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

create table if not exists public.care_packets (
  id                 uuid primary key default gen_random_uuid(),
  client_key         text not null unique check (client_key ~ '^(ax|lead):[A-Za-z0-9_.-]{1,80}$'),
  axiscare_client_id text,
  lead_id            text,
  client_first       text not null default '' check (length(client_first) <= 40),
  about              text not null default '' check (length(about) <= 2000),
  items              jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  version            integer not null default 1 check (version >= 1),
  ready              boolean not null default false,
  updated_by         text,
  updated_at         timestamptz not null default now(),
  created_at         timestamptz not null default now()
);
create index if not exists care_packets_ax on public.care_packets (axiscare_client_id);
create index if not exists care_packets_lead on public.care_packets (lead_id);

create table if not exists public.care_packet_recipients (
  id                    text primary key check (id ~ '^pl_[A-Za-z0-9]{20}$'),
  packet_id             uuid not null references public.care_packets(id) on delete cascade,
  caregiver_axiscare_id text not null,
  caregiver_name        text not null,
  link_made_at          timestamptz not null default now(),
  link_made_by          text,
  ack_version           integer,
  ack_at                timestamptz,
  unique (packet_id, caregiver_axiscare_id)
);

-- every "I understand" tap, append-only (the recipient row keeps only the latest)
create table if not exists public.care_packet_acks (
  id           bigserial primary key,
  recipient_id text not null references public.care_packet_recipients(id) on delete cascade,
  packet_id    uuid not null,
  version      integer not null,
  at           timestamptz not null default now()
);

alter table public.care_topics enable row level security;
alter table public.care_packets enable row level security;
alter table public.care_packet_recipients enable row level security;
alter table public.care_packet_acks enable row level security;
revoke all on public.care_topics, public.care_packets, public.care_packet_recipients, public.care_packet_acks from anon, authenticated;
revoke all on sequence public.care_packet_acks_id_seq from anon, authenticated;

commit;
