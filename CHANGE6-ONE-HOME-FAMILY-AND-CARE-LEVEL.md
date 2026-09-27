# Change 6 · One home for the family list and for care level

Approved in the audit (order 1 → 6). Mapped 2026-09-27. Decisions 2026-09-27: build 6a first, then 6b; ownership split and new fields approved. Cara's family text **approved as an exception** to the audience rule. **6a built and tested; 6b not started.**

## Found first: a family text can pick the wrong family (verified in code)

- When Cara fills a call-off, the "your caregiver has changed" text picks the **Family Circle whose client has the same first name**, and takes whichever the database returns first (`coverage-run/index.ts:1893-1897`). It sends only to members with texting consent, and only when Cara's sending is on.
- The client profile's family card picks the circle by part of the first name (`index.html:30583`).
- Family Circles are keyed by a typed client name. There is no AxisCare ID or person ID on a circle.
- Other family-text gaps:
  - `circle-send` ignores a member's "stopped" mark and their caregiver-intro preference.
  - coverage-run's family text bypasses the shared outreach gate.

**Desktop 250** (read only) checks whether this could happen today (shared first names, textable members, whether sending is on) and re-checks every family text ever sent.

## A. The family list

**Today there are three copies:**
- the lead's caller;
- AxisCare's three responsible-party slots;
- Family Circles, which pulls the slots nightly but only fills blanks, skips anything typed in the office, and never writes back.

AxisCare has no place for texting consent or "wants updates", and holds at most three people. The two can't simply merge.

**Proposed ownership:**
- **AxisCare owns the responsible parties.** That's up to three people: name, relationship, phone, email, HIPAA authorization, medical decisions.
- **The hub owns how and whether we text or email them**, plus any extra family members beyond the three.

**What changes:**
1. **Circles are tied to the client, not a typed name.** Each circle gets the client's AxisCare ID.
   - Existing circles are linked where the name exactly matches one client.
   - Anything else is shown for a person to link.
   - Cara, the client profile and the send screens look circles up by ID only. **A circle nobody has linked is never texted.**
2. **AxisCare-linked family members follow AxisCare.**
   - The nightly pull updates them fully, not just blanks. This also corrects the old wrong "not authorized" HIPAA flags.
   - Someone removed in AxisCare is marked "no longer in AxisCare". They are not deleted.
3. **Editing an AxisCare-linked member in Family Circles** (name, phone, email, relationship) writes to AxisCare's slot after a side-by-side confirm, then reads it back. HIPAA and medical-decision flags are shown but set only in AxisCare, since they're legal authorizations.
4. **"Add to AxisCare"** for an office-typed family member, when one of the three slots is free.
5. **Family texts honour "stopped" and the caregiver-intro preference everywhere,** and Cara's family text goes through the shared outreach gate.

## B. Care level

**Today it's stored in five places, in three formats:**
- the lead estimate (`'2'`);
- Client 360 (`'Level 2'`);
- each care plan review (`2`);
- the Team Builder plan (`'2'`);
- AxisCare's client class (mixed in with payer classes).

Only AxisCare's class is used for matching caregivers (Cara, profile check). The hub copies are never compared with it. The level-reading rule is copied five times, and it misses "Advanced Care".

**Proposed ownership:**
- **Once someone is in care, AxisCare's class is the care level.**
- The intake estimate and each review's assessed level stay as labelled history. They are not the current level.

**What changes:**
1. **One shared level rule,** used everywhere. It includes "Advanced Care".
2. **Client 360 shows AxisCare's level,** with the intake estimate and the latest review beside it, and flags when they differ. The separate Client 360 care-level picker is retired; what it holds today is kept as history.
3. **A care plan review whose level differs from AxisCare's** offers "Update AxisCare's care level". It changes only the level class, keeps the payer classes exactly as they are, and reads back.
4. **Team Builder** defaults a linked plan's level from AxisCare's. Hours Watch matching defaults to the client's AxisCare level instead of asking.
5. **Cara re-reads a client's level** when it was unknown last time. Today an unknown is never refreshed.

## Needs your decision

- **Run 250 first.** If it finds shared first names with textable families, I'd pause Cara's family text before anything else. That's a small, separate change.
- **Build this in two parts:** 6a (family) first, because it contains the safety fix, then 6b (care level).
- **The ownership split** for the family list and for care level, as above.
- **New fields:**
  - `care_circles.axiscare_client_id`;
  - on circle members, a "no longer in AxisCare" date.

  Writes to AxisCare (the responsible-party slot, and the level class) always happen after a side-by-side confirm, followed by a read-back.

## 6a as built (2026-09-27)

- **Desktop 250 result:**
  - Cara's sending is on, and 5 of 20 circles have textable members.
  - The only shared first name is "Charles", and neither of those circles has anyone textable.
  - Both past family texts (Sep 23, Sep 25) went to the right family.
- **Cara's family text** now lives in `_shared/family-change-text.ts`:
  - the circle is found by the case's AxisCare client ID, and unlinked circles or two circles on one client mean nobody is texted;
  - members who replied STOP or are no longer on AxisCare's list are left out;
  - it goes through the shared gate as audience `family`, `explicitlyEnabled`, and only while `ops_settings.family_caregiver_change_text_approved` records her approval (Desktop 251 records it before deploying Cara).
- **Linking** (`family-circles-link.sql`): link columns, one active circle per client, and an append-only link log.
  - **Doors:** `family_circle_link` and `family_circle_unlink` (unlinking needs a reason).
  - **At install:** only the nightly sync's own exact matches are linked.
- **Nightly sync:**
  - finds circles by ID;
  - links an unlinked circle only when the sync itself fed it and the name is an exact, unique match;
  - never feeds an office-typed circle by name;
  - creates new circles already linked;
  - AxisCare-sourced members follow AxisCare in full;
  - members AxisCare no longer lists are marked, never deleted;
  - office-typed members are never touched (her Sep 20 rule).
- **`circle-send`:** refuses unlinked circles, and leaves out STOP and removed members.
- **`family-circles` function:**
  - link and unlink;
  - edit an AxisCare contact: writes AxisCare's slot, keeping everything else including the HIPAA and medical answers, then reads it back;
  - add an office-typed person to a free slot.
- **Hub:**
  - Family Circles shows link status and a client picker (new circles are created for a client);
  - AxisCare-contact badges show HIPAA and medical answers;
  - Edit in AxisCare and Add to AxisCare;
  - an AxisCare contact can't be deleted in the hub;
  - there's no sending from an unlinked circle;
  - the Client 360 family card finds the circle by AxisCare ID.

| Proof | Result |
|---|---|
| Linking, disposable Postgres (`family_circles_proof.py`) | 17/17 |
| Cara's family text module (`family_change_text_test.mjs`) | 10/10 |
| Nightly sync (`circles_sync_harness.mjs`) | 9/9 |
| `family-circles` function (`family_circles_harness.mjs`) | 13/13 |
| `circle-send` (`circle_send_test.mjs`) | 2/2 |
| Install script (`family_circles_install_proof.py`) | 7/7 |
| Family Circles screen, link picker, edit panel, guards | checked in the browser preview |

**Rollout:** merge both pull requests, then run `251`.
