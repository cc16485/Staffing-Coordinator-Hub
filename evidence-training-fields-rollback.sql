-- Rollback for evidence-training-fields.sql: the rule goes back to ojt_online only. History already kept stays.
do $p$ declare src text; begin
  src := pg_get_functiondef('public.evidence_field_kept(text,text)'::regprocedure);
  if position('|ojt|ethics|rights|annual|' in src) = 0 then return; end if;
  execute replace(src, '|ojt|ethics|rights|annual|', '|ojt_online|annual|');
end $p$;
