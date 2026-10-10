-- 562 (2026-10-09) · one GoHighLevel relay per orientation booking. Additive; no row changes; safe to run twice.
alter table public.orient_bookings add column if not exists ghl_relayed_at timestamptz;
comment on column public.orient_bookings.ghl_relayed_at is '562 · when orientation-booked relayed this booking to the GoHighLevel reminder workflow (once per booking; null while the Hub reminder switch is on)';
