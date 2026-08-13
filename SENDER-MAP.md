# Sender → phone source → identity confidence

Traced 2026-08-13, from source. Every function that can reach a real person by
SMS or voice through GoHighLevel.

**The headline: no sender consults the identity layer. Not one.** The only file
in the project that reads `phone_index`, `person_identity` or
`phone_safe_for_outreach` is `identity-backfill`, which populates them. So the
outreach safety rule is **not enforced** — the view exists and nothing calls it.

## How every sender actually works

All 24 follow the same two-step shape:

```
POST /contacts/upsert     { locationId, phone, email, firstName }  → contactId
POST /conversations/messages { type: 'SMS', contactId, message }
```

The destination is decided by **whatever phone string is handed to the upsert**.
GoHighLevel then matches on phone or email and returns a contact id. That is the
whole identity decision: a raw string from a record, with no confidence attached
and no check that the number belongs to the person the message is about.

This is also why a wrong number is worse than it looks. The upsert does not just
send to the wrong person, it **merges** them into the contact.

## The 24 senders

| Sender | Destination phone comes from | Hours gate | Identity check |
|---|---|---|---|
| applicant-reengage | `p.phone` (candidate record) | shared module | none |
| campaign-auto | contactId, phone on upsert | shared module | none |
| ghe-reminders | contactId only | shared module | none |
| lead-nurture | `l.phone` (lead record) | shared module | none |
| reference-chase | reference contact string | shared module | none |
| cc-booking | contactId only | inline | none |
| cc-corner | contactId only | inline | none |
| interview-messages | `p` (candidate phone) | inline | none |
| lead-digest | contactId only | inline (7am) | none |
| lead-followup | `p` (lead phone) | inline | none |
| lead-intake | `p`, `p.phone` | inline | none |
| ops-escalate | `String(...)` staff phone | inline (24/7 by design) | none |
| **calls-feed** | `String(phone)` from call record | **none** | none |
| **campaign-send** | contactId only | **none** | none |
| **caregiver-intro** | `c.phone` (caregiver record) | **none** | none |
| **cc-417** | `s`, `v.org_phone` | **none** | none |
| **cc-feedback** | contactId only | **none** | none |
| **cc-memories** | contactId only | **none** | none |
| **cc-story** | contactId only | **none** | none |
| **circle-send** | `c.phone` | **none** | none |
| **ht-local** | `clean(...)` form input | **none** | none |
| **shared-backup** | contactId only | **none** | none |
| **stripe-webhook** | `c.phone`, Stripe customer | **none** | none |
| **vapi-interview** | contactId only | **none** | none |

**5 of 24** use the shared module. **7** carry an inline hours check, some
deliberately (`ops-escalate` is 24/7 by design, `lead-digest` fires at 7am).
**12 have no hours gate at all.**

That is the drift Samantha predicted: a policy implemented per-function does not
stay uniform. It also corrects an earlier claim of mine that the outreach-hours
policy was "in force" — it is in force for the senders that were deployed with
it, which is a minority.

## The one that would have sent to a name-matched number

`caregiver-intro` reads `c.phone` straight off the caregiver record. Had the 52
name-matched numbers stayed on the roster, this function would have texted them
with no check of any kind. That is the concrete harm the rollback prevented.

## The narrowest common boundary

Do not add 24 checks. Every sender passes through the same two-call pair, so the
fix belongs there:

```
sendToPerson({ personId | phone, kind, message })
   → resolve destination through the identity layer
   → refuse anything not 'confirmed' for autonomous sending
   → apply the existing hours policy by communication type
   → upsert the contact, then send
```

`_shared/outreach.ts` is the right home. It already owns the hours policy, it is
already proven to bundle in this project, and 5 senders already import it. One
module gains the identity gate and every adopter inherits it.

## The invariant

**Identity resolution and outbound authorization are separate decisions.**

A `probable` phone is useful for showing an office employee "Possible caller:
Jane Smith" — a human can ask. A `probable` phone must never be sufficient for
autonomous outbound, because there is nobody in the loop to catch it.

## Retrofit order, when it happens

1. **`caregiver-intro`, `circle-send`, `calls-feed`** — read a phone directly
   off a person record, no gate. Highest risk.
2. **`campaign-send`, `cc-*`, `shared-backup`, `vapi-interview`** — no hours
   gate. Lower identity risk (contactId already resolved), real policy gap.
3. **`stripe-webhook`, `ht-local`** — customer-supplied phone. Different trust
   question: the person gave us the number, so identity is not in doubt.
4. **The inline-gate group** — move to the shared module so the policy stops
   living in seven copies.

Not tonight. The map exists so the retrofit is a decision, not a discovery.
