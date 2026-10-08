-- 528 · GRIEVANCE as a client issue kind (Samantha 2026-10-08, "grievance log"; her approved compliance matrix).
-- The rules: we must have a system through which participants may present grievances (19 CSR 15-7.021(18)(P)); the written
-- rights statement includes our grievance procedure, without fear of retribution ((18)(O)4); retaliation by provider
-- agencies or their staff is prohibited and the participant may also file with DSDS (online portal or 866-835-3505)
-- (HCBS Manual 8.15; HCBS 07-26-01, July 30 2026). Abuse, neglect or exploitation is NOT a grievance: the hotline
-- 1-800-392-0210 ((18)(Q)), the existing "Possible abuse" kind. Our practice: first response within one day, a follow-up
-- check 14 days after it is resolved, Samantha sees every grievance.
-- Adds one row; changes nothing else. Safe to run again.
insert into public.issue_category (code, label, default_domain, default_urgency, target_hours,
  follow_up_required, follow_up_days, notify_beyond_owner, owner_authority,
  requires_policy_lookup, resolution_means, required_info, sort)
values ('grievance', 'Grievance: the client or their representative complains about our services', 'client_care', 'high', 24,
  true, 14, 'samantha', false, true,
  'We answered the client (or their legally responsible representative) in writing with what we found and what we did; they were told they can also file a grievance with DSDS (the online portal or 866-835-3505); and nothing about their care changed because they complained.',
  'who is complaining (the client or their legally responsible representative), what happened and when, what they want, and whether they have also filed with DSDS. Abuse, neglect or exploitation is not a grievance: report it to the hotline (1-800-392-0210) under Possible abuse.',
  95)
on conflict (code) do nothing;
