-- Rollback for phone-default.sql: the default goes back to 'confirmed' (rows are untouched either way).
alter table public.phone_index alter column confidence set default 'confirmed';
