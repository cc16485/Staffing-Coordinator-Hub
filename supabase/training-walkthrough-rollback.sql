-- TRAINING WALKTHROUGH rollback: the three server doors go; whatever they did stays (nothing is deleted).
drop function if exists public.test_people_add(text, text);
drop function if exists public.test_people_remove(text, text);
drop function if exists public.training_walkthrough_close(text, text);
drop function if exists public.tw_card_hit(jsonb, text, text[], text[], text[]);
