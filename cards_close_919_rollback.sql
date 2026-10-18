-- 919 rollback: turn the three card-check switches off first (call_cards_practice, call_cards_suggest_live, call_cards_close_live), then run this.
-- Cards already closed or marked Looks done stay as they are; their history says why.
begin;
drop function if exists public.call_card_patch(text, jsonb, jsonb);
drop table if exists public.call_card_check;
commit;
