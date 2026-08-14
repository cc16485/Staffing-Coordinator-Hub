# AxisCare capability map — authoritative

Source: `axiscare-openapi.yaml` in this repo. OpenAPI 3.1, `info.version 2025-06-25`,
63 operations, 26 models, pulled from
`https://static.axiscare.com/api/stoplight/reference/api.yaml`.

**This file supersedes every earlier assumption about what AxisCare can do.**
Several of those assumptions were wrong, and the corrections change the build
order.

## Three states, not one

The matrix previously said "blocked by AxisCare" for everything. That collapsed
three very different situations:

| State | Meaning | What to do |
|---|---|---|
| **UNSUPPORTED** | AxisCare does not expose it. No amount of access helps | Design around it permanently |
| **SUPPORTED, ACCESS-BLOCKED** | The endpoint exists and is documented. We cannot reach it today | Build the adapter now, dry-run, activate on access |
| **BUILT, WAITING** | Adapter written and dry-run proven | Switch on, one producer at a time |

---

## What I had wrong

### `/api/contacts` is not family
It is **professionals** — physicians, case managers, discharge planners.
Fields include `contactClass`, `phoneOffice`, `phoneDirectLine`,
`useOrganizationId`. Its `clients[]` link is read-only and carries **no
relationship type**.

I built the identity layer expecting this to be family contacts. It is a
referral network.

### Family and responsible parties DO exist — **SUPPORTED**
`GET /api/clients/{clientId}/responsibleParties`
`GET|PUT /api/clients/{clientId}/responsibleParties/{listNumber}`
Same under `/api/leads/{leadId}/...`

`listNumber` is 1, 2 or 3 — Primary, Secondary, Tertiary. **Maximum three per
client.**

Fields: `name` (single string), **`relationship`** (free text — "Spouse",
"Parent", "Guardian"), `address`, `phones[]` (exactly 2, typed
`Home|Mobile|Fax|Office|Work|Other`), `email`, `dateOfBirth`,
**`hipaaDisclosureAuthorization`**, **`canMakeMedicalDecisions`**.

**Do not collapse these into a generic "family" tag.** Preserve the tier, the
relationship string, and both authorisation flags separately. And **do not infer
legal authority beyond what those two fields say** — `canMakeMedicalDecisions`
is not the same as power of attorney, and the API does not record POA.

### Caregiver assignment write-back IS supported — **SUPPORTED**
`caregiverId` is **writable** on both:
- `POST|PATCH /api/schedules` and `/api/schedules/{scheduleId}`
- `POST|PATCH /api/visits` and `/api/visits/{visitId}`

`null` unassigns. On visits the field must be present in the POST body even when
null.

**Chain 1 was marked architecturally blocked. It is not.** It is
access-blocked, which is a completely different thing.

Two documented traps: a null caregiver on a schedule means *either* unassigned
*or* assigned-to-an-inactive-caregiver — indistinguishable. And visit ids are
composite keys (`s=222:d=2024-03-04`), not integers.

### Payer cannot be derived — **UNSUPPORTED, permanently**
`Class` is exactly `{code, label}`. No type, no category, no discriminator.
There is **no payer, payor, funding or insurance field anywhere in the API** —
`medicaidNumber` on `Client` is the only related field.

The documented example says it all: `{code: "UHC", label: "UNITED HEALTH CARE"}`
sitting beside `{code: "MEDS", label: "MEDICATIONS"}` in one flat array.

**`resolvePayer()` refusing on zero or multiple matches is the correct permanent
design, not a stopgap.** Never infer from array position. A confident match
against a known payer mapping resolves; anything else returns unresolved and
raises verification work.

### The version header was fine
`X-AxisCare-Api-Version: 2023-10-01` is **required on all 63 operations and is
the only accepted value** on 62 of them. `2025-06-25` is the documentation
bundle version, not a header value. I was wrong to suspect it.

---

## Webhooks: a doorbell, not a witness

**There is no signature, no HMAC, no shared secret.** Requests carry only
`content-type`, `user-agent: AWS-Webhook-Service`, and `x-webhook-id`.

**`x-webhook-id` is an identifier, not authentication.** Use it as a dedupe key
only. A unique id is not a trusted sender.

### The required pattern

```
webhook arrives
  → record the event id and minimal payload
  → validate shape and age
  → FETCH the authoritative record from the API
  → compare actual current state
  → only then create or update Hub work
```

**The webhook says something may have changed. The API says what is true.**

Never let a payload body directly authorise a consequential write — assignment,
care-started, hold, restart, discharge, status change, or anything that triggers
outreach. If the API is unavailable when a webhook arrives, **queue it for
reconciliation** rather than trusting the body.

46 documented events. The one Chain 1 needs is
**`scheduling.visit.caregiver`** — "the visit caregiver assignment was changed".
Also `client.created`, `client.updated`, `caregiver.created`, `caregiver.updated`,
and 32 `scheduling.visit.*` events.

**Replay on registration: NOT DOCUMENTED.** The 14-day age guard stays.

Retry policy: 3 attempts, 10s timeout, respond within 5s, 200/202 to
acknowledge. **"Too many Bad Request responses will result in the Subscriber
being disabled"** — threshold not given.

Webhook admin is off by default and requires AxisCare support to enable.

**Ask support whether they support a secret query parameter, a custom header,
fixed source IPs, or a per-endpoint token.** If none, hint-only mode stands.

---

## Chain status, corrected

| Chain | Step | Old | Correct |
|---|---|---|---|
| 1 | Identify affected shift | blocked | **SUPPORTED** — `/api/schedules`, `/api/visits` |
| 1 | Assignment write-back | blocked | **SUPPORTED** — `caregiverId` PATCH |
| 1 | Availability / conflict | blocked | **SUPPORTED** — schedules by date + caregiver |
| 1 | Overtime, distance, skills | blocked | **UNSUPPORTED** — no such fields |
| 4 | Family caller recognition | blocked, capability unknown | **SUPPORTED** — responsibleParties |
| 4 | Automatic issue detection | blocked | **SUPPORTED** — care notes on visits |
| 3 | Payer resolution | blocked | **UNSUPPORTED** — design around it |
| 5 | Authorisation tracking | blocked | **UNSUPPORTED** — no authorisation endpoint |

**Everything marked SUPPORTED is access-blocked only.** Adapters can be built
and dry-run proven now.

---

## Assignment write-back: never trust a 200

A successful PATCH is not proof the shift is correct. **Read the record back.**

The coverage case closes on **AxisCare confirming the assignment**, not on a
caregiver saying yes. If the PATCH fails, the case stays open and becomes an
exception.

Acceptance tests before this goes live: assign by `caregiverId`; unassign with
null; retry idempotency; API rejection; caregiver already assigned; two
caregivers accepting simultaneously; and read-back verification after every
successful write.

---

## Tokens

`GET /api/tokens/expiring` — monitoring only. Lists active tokens expiring
within 30 days, keyed by `name` and `expirationDate`. **No issue, renew or
revoke endpoint exists** — token lifecycle happens in the AxisCare admin UI.

Tokens do expire. But an expired token returns a **JSON 401** ("Token not
found"), not an HTML 403 — so expiry does not explain the current outage.

**Do not rotate the token.** There is no self-service way to issue a new one and
rotating destroys the evidence.

---

## The outage, in terms of the spec

Every documented error in this API is **JSON**. All 47 documented 403s are JSON
permission errors.

**An HTML 403 from CloudFront is outside the documented contract at every
layer.** It is generated by edge infrastructure before the request reaches the
application. Not a token problem, not a version problem, not a rate limit — none
of which are documented as existing.

Untested variable worth checking first: the hub project reads `AXISCARE_SITE`
while the working sync reads `AXISCARE_SITE_NUMBER`, in a different project.
**If those values differ, every probe hit a subdomain that does not exist** —
which would explain both the CloudFront 403 and the WordPress 404 exactly, with
nothing broken on AxisCare's side.
