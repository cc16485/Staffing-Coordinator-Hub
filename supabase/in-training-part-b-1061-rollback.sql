-- 1061 rollback: the check-in row goes inactive. To release anyone a check-in call is holding, turn off checkin_call_live
-- (Owners Hub > Admin) first: the hold follows that switch. The AxisCare row's old how-to is put back by the copy 1061 saved in its
-- report (Desktop "1061 ... report"), because the live wording is read at install time. Nothing is deleted.
update public.client_journey_step_def set active = false, updated_by = '1061 rollback' where key = 'cg.checkin.call';
