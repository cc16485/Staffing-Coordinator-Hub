-- 463 rollback: takes My Desk's storage back out completely. Only safe while desks hold nothing (before Stage 1), which
-- the installer checks before it uses this. Nothing outside these tables and functions is touched.
begin;
drop table if exists public.kind_word_drops, public.kind_words, public.desk_visits, public.desk_settings, public.desk_pages,
                     public.desk_stickies, public.desk_lines cascade;
drop function if exists public.desk_star_line(uuid, boolean), public.desk_set_has_desk(uuid, boolean), public.kind_word_decide(uuid, boolean),
  public.desk_tidy(), public.desk_guard_lines(), public.desk_guard_stickies(), public.desk_guard_settings(), public.desk_guard_drops(),
  public.desk_kind_decider(), public.desk_can_read(uuid), public.desk_can_write(uuid), public.desk_is_owner(), public.desk_hub_ok(), public.desk_me();
commit;
