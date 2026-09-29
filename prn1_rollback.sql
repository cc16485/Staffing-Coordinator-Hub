-- PRN1 rollback (only if Samantha asks). Stops the PRN rules; keeps every application and answer already given.
-- The interview texts go back by redeploying interview-messages from the commit before PRN1.
update public.job_postings set status = 'closed' where slug = 'prn-cna-springfield';
update public.job_positions set active = false where key = 'prn_cna';
drop trigger if exists zz_applicant_screen_prn on public.job_applicants;
drop trigger if exists applicant_prn_pay_guard on public.job_applicants;
-- The PRN columns, prn_clean, apply_prn_save and applicant_screen_prn can stay: nothing calls them without the role.
