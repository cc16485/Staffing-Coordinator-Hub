# axiscare-push-note (retired 2026-10-11, Desktop step 579)

Samantha's decision 2026-10-11: retire the old, unsecured function now. This folder preserves the exact source that was live
on the Hub project (version 64, sha256 8c4b09d5…, identical to the archived Onboarding-repo build) for the record. It is not
deployed from here and must not be redeployed: it answered any caller with no sign-in and no gateway check, wrote an AxisCare
client note containing the New Clients queue's call notes verbatim, and recorded nothing. Existing records it touched
(client_queue.axiscare_note_id, the AxisCare notes it created) are preserved as they are.

Anything a coordinator wants written to AxisCare from the New Clients queue goes through the AxisCare note contract
(Phase 1, Slice 5) with a visible send step, the staff check and the change log. No automatic AxisCare writer replaces it.
