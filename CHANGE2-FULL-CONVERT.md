# Change 2 · Convert sends the whole client to AxisCare

Approved in the audit (decision 3, order 1 → 2 → 3). Plan and all three decisions approved 2026-09-26 (move to the shared project, the `axiscare_convert` lead field, the no-op permission check). **Built and tested.**

## What Convert does today (verified in code, 2026-09-26)

- The lead profile's **Convert** button calls `axiscare-convert-lead` in the **Training** Supabase project, authorised by a shared "Training Hub read key" kept in the shared hub settings.
- It creates the AxisCare client with: first and last name, one phone, one email, date of birth, gender. Then it attaches the intake note (with the attributes checklist for hand entry).
- Problems found:
  1. **The family's details go on the client.** Phone falls back to the caller's phone, and email is always the caller's email.
  2. **Gender is never accepted as sent.** The hub sends "Male" or "Female"; AxisCare expects "M" or "F".
  3. **Not sent at all:** address, the client's own phone as a home phone, Medicaid number (DCN), referral source, assessment date, conversion date, and the family contact as a responsible party. Krystal retypes these in AxisCare.
  4. **No protection against a double create.** A retry after a slow network answer can create a second AxisCare client.
  5. **No read-back.** The hub never checks what AxisCare actually saved.
  6. If the client's own name is missing, the **caller's** name becomes the client's name.

## What Convert will send (all from fields the lead already has)

| AxisCare field | From the lead | Rule |
|---|---|---|
| firstName, lastName | client's name | Required. If missing, Convert stops and says so, unless Relationship is "Self". |
| dateOfBirth | client_dob | |
| gender | client_gender | Male → M, Female → F, Unknown → left blank |
| residentialAddress | client_address, city, state, zip | Only when all four are present (AxisCare needs the whole address). Otherwise not sent, and the preview says so. |
| homePhone or mobilePhone | client_phone | The coordinator picks Home or Mobile in the preview (default Home). **Never the caller's phone**, unless the caller is the client. |
| personalEmail | caller's email | **Only when the caller is the client.** |
| medicaidNumber | dcn | |
| assessmentDate | assessment_at | Springfield date |
| conversionDate | today | |
| externalId | `cchub-lead:<lead id>` | Lets Convert find a client it already created, so a retry never makes a second one. |
| referredBy | referral organisation or referral name | `{type: other, name}`. Sent separately so a refusal can't block the create. |
| **Responsible Party 1** | the caller: name, relationship, phone, email | Written only when the coordinator leaves it ticked. It starts ticked for family or friends, and unticked for professionals (case manager, social worker, discharge planner, nurse, hospital, and similar) and for "Self". HIPAA and medical-decision flags are **left blank**; nobody has asserted them. |

Left out on purpose: **start date** (set from Actual SOC in a later change, never at Convert); **classes** (care level and payer, see the classes defect); **status** (AxisCare makes new clients Active, same as today); **attributes and documents** (not in the API; the note checklist stays).

## How it works

1. **Preview, in place of today's "Convert this lead?" box.** It shows exactly what will go to AxisCare, side by side with the lead: every field, what is missing, the phone type, and the Responsible Party 1 tick. One button: **Create in AxisCare**. This replaces the current confirm; it is not a second one.
2. **Create.** First it checks for an AxisCare client that already has this lead's `externalId`, and reuses it if found. Otherwise it creates the client with the proven minimum plus the safe fields.
3. **Enrich.** Referral source, then Responsible Party 1. Each step reports on its own, so one refusal doesn't undo the rest.
4. **Read back** the client and its responsible parties from AxisCare. The result screen lists what AxisCare now holds and what still needs doing by hand.
5. The intake note (with the attributes checklist) is attached as today, and the Journey connects as today.

## Where it lives: moved into the shared project (recommended)

A new `client-convert` function in the shared project (cc16485/Staffing-Coordinator-Hub), called with the coordinator's own sign-in, not the shared Training key:
- the same project as Journey, launches and evidence, so the Convert and Journey steps can't drift apart;
- no shared secret readable by every signed-in user;
- the Training function keeps its note actions (six other screens use them). Only its create path stops being used.

Risk: the shared project's AxisCare token has never created or changed a client. The installer proves it can **without touching a real client**: it reads Test Client 5 (#290) and writes back the same priority note it already has (a no-op). If AxisCare refuses, the install stops and Convert keeps using today's path.

## New field (needs approval)

On the lead: `axiscare_convert` = when, who, what was sent, whether Responsible Party 1 was written, and what the read-back showed. It's the record of what we told AxisCare, and it keeps Convert from ever acting twice. No other new fields. The phone type and the Responsible Party tick are choices in the preview, stored only in that record.

## Proof plan

- Unit tests for the field mapping: self and not-self, professional callers, partial address, gender, missing name, DCN.
- Harness for the function with a fake AxisCare: create, reuse on retry (`externalId`), a refused referral that doesn't block, Responsible Party write + read-back, 403 and 400 handling, authentication.
- Hub preview checked with sample leads before merge.
- Install script: deploy, CORS, the no-op permission proof on Test Client 5.

## Proof

| What | Result |
|---|---|
| Mapping + function against a fake AxisCare (`client_convert_harness.mjs`) | 27/27 |
| Install script against fake services (`client_convert_install_proof.py`) | 4/4 |
| Hub preview and result screens with a sample lead | checked in the browser preview |

## Rollout (install BEFORE the hub merge)

1. Merge the Staffing-Coordinator-Hub pull request (the function and its tests).
2. `242` deploys `client-convert` and runs the permission check on Test Client 5. If AxisCare refuses, stop: the hub still uses today's path.
3. Merge the care-coordinator-hub pull request. Convert now opens the preview.
