-- Undo rules_guard_rpc.sql: the Hub's GitHub check can no longer ask; rules_approved is untouched.
drop function if exists public.rules_fingerprint_approved(text, text);
