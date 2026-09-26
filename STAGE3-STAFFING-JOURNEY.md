# Stage 3 · Staffing Need → Ask → Reply → Assignment — record

**Status:** DEPLOYED AND IN SOAK. Every piece below is live in production (2026-09-26) and verified.
The legacy screens (`coverage_cases`, `leads`, Team Builder plans) are still the only authority.
The canonical tables are a one-way shadow written only through Doors. Cutover is a later, single step.

Builds on Stage 2 v2 (`journey-foundation-v2.sql`, PR #2).

## What it is

1. **Baseline-open.** Each currently active AxisCare client with a confirmed identity gets one current
   Journey episode marked PRIOR HISTORY UNOBSERVED. It infers nothing: no historical start date, no
   lifetime ordinal, no earlier episodes, no original lead, no payer or authorization history, no old
   staffing. Idempotent; refuses rather than open a second active episode. Commit requires the exact
   eligibility hash from the dry run.
2. **Client admission.** A newly observed AxisCare client is never attached to a person automatically.
   The scan opens an admission case (with suggestions only); a person in the Client Intake seat confirms
   "existing" or "new". Fails toward separation and review.
3. **Staffing foundation.** `staffing_need` (immutable requirement, dated shift or recurring slot),
   `staffing_ask` (who was asked, message kept exactly, verbally, or marked not retained for legacy),
   `staffing_reply` (verbatim, supersede once), `staffing_assignment` (decided by a seat). Status is
   derived in `staffing_need_status`, never stored.
4. **Three one-way mirrors**, each with a parity view, an append-only run log and a 15-minute pg_cron job
   behind a non-blocking advisory lock:
   - coverage call-offs → Needs, Asks, Replies, Assignments (`legacy_mirror_*`)
   - inquiries → provisional Journey episodes (`lead_journey_*`)
   - linked Team Builder plans → Needs, Asks, Assignments (`team_build_*`)
5. **Team Build linking.** A signed-in staff member holding a Journey seat links a plan to its Journey
   through the `journey-link-plan` edge function. First link: Client Intake. Changing a link: Owner /
   Decision. Who holds a seat is routing configuration (`journey_seat_member`), not Journey data.

Every write goes through a Door (`security invoker`, EXECUTE for `service_role` only). Signed-in users
read only; anonymous users get nothing. Legacy tables are read, never written.

## Files

| File | Purpose |
|---|---|
| `baseline-open-eligibility.sql` | Read-only eligibility: ELIGIBLE / SKIP / EXCLUDED / ADMISSION |
| `baseline_open.py` | Dry run or hash-gated commit through `episode_open_for_person` |
| `client-admission.sql` | Admission case + append-only events + open / confirm / dismiss Doors |
| `supabase/functions/client-admission-scan/` | Server-only scan that opens admission cases |
| `admission_install.py` | Installs migration + scan function, then verifies |
| `staffing-foundation.sql` | Needs, asks, replies, assignments, sync record, audit, Doors |
| `staffing-foundation-fingerprint.sql`, `-parts.sql`, `staffing-expected.json` | Fingerprint and proven components |
| `staffing_deploy.py`, `staffing_gen_expected.py` | Production deploy + verification; expected-file generator |
| `legacy-mirror.sql`, `legacy-mirror-parity.sql`, `legacy-mirror-runlog.sql` | Coverage mirror, parity, run log + schedule wrapper |
| `mirror_run.py`, `mirror_activate.py` | Coverage mirror dry run / commit; schedule activation |
| `lead-journey-mirror.sql`, `lead_mirror_run.py` | Inquiry mirror with parity, run log, schedule |
| `team-build-link.sql` | Seat membership, append-only plan links, Journey directory, link Door |
| `supabase/functions/journey-link-plan/` | Browser-callable link endpoint (CORS + OPTIONS, signed-in seat holders only) |
| `team_link_install.py` | Installs linking + function + seat membership, then verifies |
| `team-build-mirror.sql`, `team_build_run.py` | Team Build mirror with parity, run log, schedule |
| `*_proof.py`, `edge_helpers.ts` | Disposable-Postgres proof harnesses; edge-function helper tests |
| `*-proof-results.txt` | Harness output |

Test fixtures use `example.com` addresses. No production data is in this branch.

## Proofs (disposable PostgreSQL)

| Harness | Result |
|---|---|
| baseline-open | 13 / 13 |
| client admission / install | 19 / 19 · 5 / 5 |
| staffing foundation / deploy | 40 / 40 · 4 / 4 |
| coverage mirror / run log | 24 / 24 · 13 / 13 |
| inquiry mirror / runner | 21 / 21 · 3 / 3 |
| Team Build linking / install / helpers | 14 / 14 · 4 / 4 · 10 / 10 |
| Team Build mirror / runner | 22 / 22 · 3 / 3 |

## Identity of what was deployed (SHA-256)

- `staffing-foundation.sql` `5fabf82dffba9f36e6c1a4fabba6a2065360ad0eacc9400a2529667b0c5e5322`, fingerprint `3aa7c95fd62c1d70eb0214454781ae67` (424 components)
- `legacy-mirror.sql` `b92a3b15633c438f4a5c7dccf08cabea188301402e8c3ec7c752986362f37ead`
- `legacy-mirror-runlog.sql` `a052c9addaf4a00351f2c720e7e3db190d9a9cb82fd120778da62d7d2d24d4ad`
- `lead-journey-mirror.sql` `62118dcb3900d870aa30bd8667e29f394b1c4819099e8a19cea647eb396fef7b`
- `team-build-mirror.sql` `32ade94acd9d5ba2b86cb2d9eeae0eb0a94a5166f84da15176989e3d8a2ea109`
- `client-admission-scan/index.ts` `411221c092157e7abf9419a74236df54ef2941590d5347153b0cd8a7e0fe62b2`
- `journey-link-plan/index.ts` `619b99ea2525cd50285bb91be7b8731445fee6f9bf057080fb22655cdbf5cf2c`

## Production state at soak start (2026-09-26)

- Journey: 38 episodes (24 client baselines, 14 inquiry provisionals). One newly observed AxisCare
  client is waiting in admission; the 25th active client stays excluded until admitted.
- Staffing shadow: 22 needs, 69 asks, 24 replies, 7 assignments. Coverage parity 22 / 22.
- All three mirrors scheduled every 15 minutes, first runs healthy, legacy tables unchanged.
- Team Builder link picker live in the care-coordinator hub; one plan not yet linked.

## What comes next

Soak: clean scheduled runs across live days in all three run logs. Then one cutover: every writer moves
to the Doors behind a single flag and the legacy tables become derived views. The dormant
`coverage_outreach` / `coverage_replies` tables retire after that.
