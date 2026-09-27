# ONE client profile (map and plan, nothing built)

Samantha, 2026-09-27: "I want clients to have ONE profile" · "the clients profile can have sub tabs
to keep organized" · "I dont want everything spread out all over the hub".

## Today: one family is spread over 9 detail screens
| Screen | Keyed on | What it holds |
|---|---|---|
| Lead profile (+ intake form, guided call) | lead id | caller, client details, needs, payer + Medicaid, schedule wanted, Start of Care checklist, Start Contract, Journey status, texts/calls, AxisCare attributes, documents, nurture |
| Client 360 (slide-over) | AxisCare id | care level, phone, care synopsis, Home & life (only editor), call-in plan, "their start", circle (read-only), timeline |
| Client History modal | AxisCare id or name | read-only copies: lead, assessment, check-ins, reviews, Care Match |
| New Clients launch card | queue id | launch steps, call notes, AxisCare read-outs, Start Contract (editable), follow-ups |
| Assessment + care plan modals | assessment id | assessment, AI summary, care plan, AxisCare care tasks |
| Care Plan Reviews card | AxisCare id or name | reviews, level change, ask caregivers |
| Check-ins / Care Match / Nurse / GHE | various, some typed names | calls, ratings, do-not-return, nurse visits, GHE re-typed details |
| Team Builder board | plan id | the care team grid |
| Family Circle card | circle id | family, consent, AxisCare responsible parties |

The same fact is edited in several places: care level (3 editors), payer (2), start date (3 copies),
phone/contacts, home notes (3 holders), address/physician (re-typed on the GHE form).

## The one profile
One full page per client, opened from ANY list (Leads, Start of Care, New Clients, Clients, Care
Match, Cara, Nurse, Family Circles, My Work). Summary on top; sub-tabs below.

| Sub-tab | What lives there (one home each) |
|---|---|
| **Summary** | What's next / who owns it / what we're waiting on; status, level, payer, phone; open callouts; stuck start |
| **Start of Care** | Journey + "who is this", Start of Care checklist, Start Contract + the four dates, the New Clients launch steps, first-shift follow-up |
| **Family & Contacts** | caller + family, Family Circle (edited here), AxisCare responsible parties, texts/calls/emails, do not contact |
| **Care** | needs + clinical from intake, assessment, care plan + AxisCare care tasks, care level (AxisCare), care plan reviews, nurse visits |
| **Team & Schedule** | caregivers from AxisCare, Team Builder plan, Care Match calls / favorites / do-not-return, "When a caregiver calls in", callout history |
| **Check-ins** | monthly check-ins (log here) |
| **Payer** | payer, Medicaid DCN/county, state submission, authorization, quoted price |
| **Home & Life** | home, pets, entrance, life story, AxisCare attributes checklist, care synopsis for callout texts |
| **History & Documents** | timeline, earlier Journeys (a returning client), status changes, documents |

**Lists find the work; the profile is where a family is worked.** The office boards stay (New
Clients queue, Care Match pairs due, Cara call-offs, nurse board, reviews due) but every row opens
the profile at the right tab. The Client 360 slide-over, the Client History modal and the separate
lead page stop being separate profiles.

## Who the profile is (identity)
- From the first call the profile exists for the inquiry (lead). When a person confirms who they
  are (Convert, "Check and connect", "Who is this?") it becomes that client's profile. Same page,
  nothing re-typed. Identity stays a person's decision; no name matching (the Sept rule).
- After that the profile belongs to the PERSON: a returning client has one profile with earlier
  Journeys under History.
- Gaps to fix along the way: current clients backfilled from AxisCare may have no Journey yet; a
  returning family can become a duplicate (the lead de-dupe checks the caller's phone only, and
  Convert on a new lead makes a second AxisCare client); no screen opens from a person id today.

## One editor per fact
Care level: AxisCare's class (intake estimate kept as its own labeled fact) · Payer: the Payer tab ·
Start date: the Start Contract (the others become read-outs) · Contacts: Family & Contacts ·
Home notes: Home & Life · Address/DCN/physician: typed once at intake, read everywhere else ·
Caregiver team: AxisCare (the typed name becomes a read-out).

## Build order (each step small, tested, reversible; no data moves in steps 1-3)
1. The profile shell: one "open client" from any key (lead, AxisCare id, person), sub-tabs, and the
   lead page + Client 360 sections moved into their tabs unchanged.
2. Start of Care tab takes the New Clients launch card; the New Clients list opens it.
3. Care, Family & Contacts, Team & Schedule, Check-ins tabs take their editors (assessment/plan,
   circle, Team Builder, Care Match call, check-in form).
4. One editor per fact (the list above).
5. Retire the slide-over, the history modal and the duplicate forms; identity gaps fixed.

Found along the way: archiving, marking duplicate or deleting a lead hides an element that doesn't
exist (`#leadProfile`, the page is `#leadProfileView`), so the profile can stay on screen afterward.

## Rulings (2026-09-27): "yes to all, full page, start with 1"

## Step 1 as built (hub only; no database or function change)
- `#leadProfileView` IS the one profile now: a title row (name, AxisCare # or "Inquiry · status",
  "Past client") and 9 sub-tabs. Every lead-page card moved into its tab unchanged (all element
  ids kept, checked line by line; only the old Back button and two layout wrappers changed).
  The inquiry's cards (class `cp-lead`) show while there is a lead; Client 360's sections fill
  `cp_c_*` slots in their tabs (`cl360RenderInto(r, null, 'cp_', panes)`).
- `openClient(seed, tab)` opens it from a lead id, an AxisCare id or a roster row; a lead joins a
  client only through a CONFIRMED Journey connection (a lead that merely carries the AxisCare id
  shows a "check and connect" note instead). `openLeadProfile(id, tab)` and client names
  (`openClientProfile`) both open it full page; "Back" returns to the tab you came from.
  Start of Care list, stuck-start alert and New Clients' "check and connect" open the Start of
  Care tab.
- New small tabs: Check-ins (this client's monthly check-ins by AxisCare id, "Log a check-in"
  prefilled) and Payer (the intake's payer, DCN, county, state submission, quoted price; edited in
  the intake form for now).
- FIXED: Client 360 never recorded which client it showed (`CL360_CURRENT[px]`), so "Save home &
  life" (since 2026-09-13) and the call-in plan's "Add an update" silently did nothing.
- FIXED: archive / duplicate / delete now close the page (they hid a non-existent `#leadProfile`).
- Verified in the browser (local copy, fake data, database and server calls replaced, nothing
  sent): lead L1 confirmed to AxisCare #501 opens one page with both parts; all 9 tabs show only
  their own sections; Home & life saves; the call-in form opens prefilled; an inquiry-only lead
  shows "fill in once they are a client"; an AxisCare-only client opens full page with no lead
  cards, and a carrier lead is flagged, not merged; Back returns to Leads / Cara; archive closes.
  Earlier hub tests still pass (family links 26, call-in plan 18, pickers 28, follow-up 19).

## Step 2 as built (hub only)
- The New Clients launch checklist lives on the profile's **Start of Care** tab (slot `cp_launch`,
  between the inquiry's Start Contract + checklist and "Their start"): `card(c,'profile')`, always
  open, without the card's own family / Start Contract block (the tab already shows those).
- The **New Clients list** is rows: `card(c,'list')` = the header (name, chips, step dots, progress,
  start date, caregiver) with "Open ›"; clicking opens `openClient({launch_id},'start')`. Completed
  launches open the same way. No checklist is drawn twice on the page.
- `openClient` accepts `launch_id`, finds this client's launch by AxisCare id otherwise
  (`cqLaunchFor`), and shows a walk-in launch with no AxisCare id under its own name. The family
  link row's "Launch" opens the profile too.
- Every save (tick, notes, caregiver name, AxisCare read-outs, Launch complete) redraws the list, and
  the list redraw redraws the profile's checklist (`renderProfileCard`).
- The Care Match follow-up button works from the profile without visiting New Clients first.
- Verified in the browser (fake data, nothing sent): 6 tick steps + 2 Care Match read-outs on the
  tab; a tick saves and redraws; the list shows rows only; a row opens the profile at Start of Care
  and Back returns to New Clients; a walk-in launch opens under its own name. Tests: follow-up 19,
  family links 26 (Launch now opens the profile), call-in 18, pickers 28, stalled starts 25.

## Step 3 as built (hub only)
- **Care** tab: this family's assessments (by lead id or AxisCare id) with "Open assessment" and
  "Open care plan" / "Write the care plan" (their usual pop-ups), "＋ New assessment" (from the
  lead, or prefilled with the client's name and AxisCare id), and care plan reviews with
  "📝 Log a review". Saves refresh the tab.
- **Family & Contacts** tab: the client's Family Circle, fully editable (consent, AxisCare edits,
  send an update); "＋ Create the Family Circle" when there is none. Client 360's read-only copy
  is gone from the page. While a profile shows a circle, the Family Circles list leaves that one
  circle out, so no circle is drawn twice; it comes back as soon as you leave.
- **Team & Schedule** tab: the client's Team Builder board (found through its Journey link),
  fully workable in place; the Team Builder spot is emptied meanwhile; "← All plans" hidden.
  Their Care Match calls, and "＋ Log a Care Match call" (prefilled with the client and AxisCare id).
- Forms that live on other screens (the care plan review form, the Care Match call form) are
  BORROWED into the profile while it is open and handed back when you leave (Back, another
  client, or any hub tab), the same pattern as the guided call cockpit. Their slots sit outside
  anything that is redrawn, so a refresh never deletes a borrowed form.
- Verified in the browser (fake data, nothing sent): assessments, plan and reviews on Care; the
  review form borrowed, filled and still on the page after the refresh; the circle open and
  editable in the profile, absent from the list, back in the list after leaving; the board in
  the profile with a working cell editor and nothing in the Team Builder spot; the Care Match form
  borrowed and prefilled; everything handed back on Back. Hub tests still pass.

## Step 4 as built (hub only): one editor per fact
Mapped first (every editor and every reader, with which readers decide something). Changes:
- **Payer** (editor: the intake). The assessment's payer is read-only from the intake when the family
  has an inquiry ("From the intake. Change it on the Payer tab"); no more "Medicaid" default (new
  option "Not recorded", plus CDS and PACE). An assessment with no inquiry keeps its own. Safe: the
  assessment payer feeds no decision.
- **Start date** (editor: the Start Contract). The care plan's start date shows the Start Contract
  target read-only and saves that value (so the AxisCare note agrees). With no Start Contract the
  plan keeps its own date. Left as its own fact on purpose: New Clients' start date, which is what
  AxisCare recorded and drives the "start passed, no clock-in" check.
- **Care level** (truth: AxisCare's class). Team Builder uses AxisCare's level for matching once the
  plan's client is known through its Journey link ("Level 3 (from AxisCare)"); the typed level is
  only for a client AxisCare doesn't have yet ("typed; not in AxisCare yet"). The intake estimate and
  the review's finding stay their own, labeled facts.
- **Contacts / address / DCN** (typed once at intake). Adding a nurse client fills the phone from the
  client's record; a new GHE form fills empty DCN, birth date, county, client phone and address from
  the CONFIRMED inquiry (by AxisCare id, never by name). Both stay editable (the nurse's GHL contact
  and the GHE are their own records).
- **Home notes**: Home & Life shows the intake checklist's cats / dogs / smoking answers beside the
  home notes.
- Not changed (and why): caller phone vs client phone vs Family Circle contacts are different
  people; the care synopsis for callout texts already has one editor; Team Builder town/zip must stay
  typeable for clients not linked yet. Found, for later: the hub (`cqIsMedicaid`: medicaid|ihs|dsds)
  and the server (profile-check: medicaid|ihs|pace) test "is this Medicaid" differently.
- Verified in the browser (fake data, nothing sent) for every item above; hub tests still pass.

## Step 5a as built (hub only): the old separate screens retired
- The **Client History pop-up** is gone; "View History" on the Clients list opens the client's one
  profile on its **History** tab (`openClientHistory` → `openClientProfile(ref,'history')`).
- **Client 360 is no longer its own profile**: its old slide-in grid layout is removed; it only ever
  fills the profile's tabs. The slide-in remains solely for "More than one client is named …, pick
  one" and "No profile found".
- The profile opens from a **person id** too (their AxisCare id, else their confirmed inquiry).
- Verified in the browser (fake data): View History by AxisCare id and by name → History tab; person
  id → the right client, or the confirmed inquiry; two "Ann Jones" → the pick list. Hub tests pass
  (family-links test updated for the opener's new tab argument).

## Step 5b: returning families (design approved 2026-09-27 "yes to all, go and merge"; A cut to the lock only, B + D + C built, E + F next)
How a second record happens today (most likely first):
1. A former client's family calls back; a new inquiry is entered (no check against AxisCare, and
   ~268 former AxisCare clients aren't in the hub's identity list at all); Convert creates a SECOND
   AxisCare client (it only looks for its own lead's id) and a second person.
2. A different relative calls, or the web form is used: the hub checks only the caller's phone (and
   Cancel saves anyway); the web form checks nothing. A second inquiry.
3. Automatic entries (AI phone call, calendar booking, call disposition) find an OLD lead by phone and
   rewrite it: notes overwritten, a Converted lead pushed back to "Assessment Scheduled".
4. A current client's family asks for more hours: a new lead + Convert = a second AxisCare client;
   typing the real AxisCare id is refused because their Journey is active, so the inquiry is stranded.
5. "Mark as duplicate" archives the lead but leaves its Journey open.

Proposed (identity stays a person's decision; software suggests, never merges):
- A. ~~Bring the ~268 former AxisCare clients into the hub's identity list~~ DROPPED 2026-09-27: B and D
  check AxisCare live instead (see 5b-A below). Only the identity-backfill lock ships.
- B. "Is this family already known?" when an inquiry is saved: caller phone, client phone, email,
  client name + birth date, across inquiries and AxisCare clients (current and former). Name alone is
  a hint only. The person picks "same family: open their profile" or "a different family".
- C. Automatic entries (web form, AI call, bookings) never merge or rewrite: 0 matches = new inquiry;
  1 or more = new inquiry flagged "possibly returning" + a My Work "check if this is the same family".
  Old Converted / Lost leads are never rewritten.
- D. Convert looks in AxisCare first (including inactive clients): "use their existing AxisCare record"
  instead of creating a second one. AxisCare status stays AxisCare's (the status review catches it).
- E. A current client's family: the inquiry form says "this is a current client, open their profile"
  (a change in care is handled there, not as a new start).
- F. "Mark as duplicate" also closes the duplicate's empty Journey; a returning family's new inquiry
  can be attached to their current Journey.
Build order: A (lock only) → B + D (hub, live AxisCare check) → C (server entry points) → E + F.

## Step 5b-A: changed 2026-09-27 to "lock only"
Samantha asked why former clients should be in the hub at all. They shouldn't be copied: AxisCare owns client
identity (the locked client rule), a third of them are deceased, and the import would hold only the client's
own phones, not the relative who calls back. So there is **no import and no birth-date field**. Instead B and D
check AxisCare directly (current and inactive clients, ~293 records) when an inquiry is saved and at Convert.
The first build (PR 29) was merged but never run; its import mode and migration are removed.

What stays, as a security fix: **the identity-backfill caller lock.** It had no caller check, so the public key
could run every mode, including the ones that write identity rows and return names and numbers. Now only the
nightly Family Circle sync (`circles=1`) is open to the public key and signed-in staff, with counts only (the
hub's Sync button only shows counts); every other mode needs the service key. The function stays deployed with
key checking on (Desktop 262 checks), so a faked key never reaches it. Old one-off Desktop scripts 84, 85, 86
and 122 used the public key for other modes and will now be refused.
Tests: `identity_backfill_lock_test.mjs` (18), `identity_backfill_lock_install_proof.py` (8). Install: Desktop 262.

## Step 5b B + D as built (hub + server; Desktop 263)
- **`client-lookup`** (new function, read only, signed-in staff only; the public key and the service key are
  refused). Checks AxisCare live, every client current and inactive, plus every Family Circle contact (so a
  relative's number counts). Answers with names, AxisCare numbers, status and why; never a phone number, birth
  date or SSN. Rules in `_shared/client-lookup.ts`: own phone, a Family Circle member's phone, name + birth date
  (and "goes by"), last name + birth date (weaker), name only (a hint). Same name with two different birth dates
  is two people and is not shown. AxisCare's next page must be on the agency's own site.
- **B, new inquiry** (the form and the guided call): before saving, past inquiries (phone, client phone, email,
  name + birth date) and client-lookup. The panel "Is this family already known?" offers: Open this inquiry;
  a current client, Open their profile (a change in care is handled there); a former client, Same family: link
  to #id, which goes through the existing "Is this the same person?" side-by-side; A different family: save as
  new; Go back. Replaced the caller-phone-only check (where Cancel saved anyway). An id the check filled in and
  the person backed out of never carries over. If AxisCare can't be checked, the inquiry saves and says so.
- **D, Convert**: AxisCare is checked BEFORE anything is created. A former client: "Use this AxisCare record"
  (side-by-side, then the inquiry is linked and Converted, `axiscare_convert.reused_existing`, Journey connected
  when it can be; no second client). A current client: Open their profile. If AxisCare can't be checked,
  creating a new client needs a yes.
- **`client-status-returning.sql`**: when AxisCare later flips the returning client to Active, "Returning client"
  (Owner / Decision) keeps the Journey their linked inquiry opened (open / converted) instead of trying to open a
  second one, which used to be refused. An established active Journey still refuses, as before. Only
  `client_status_decide` is replaced; no rows move. The hub says "the Journey their new inquiry opened carries on".
- Tests: `client_lookup_fn_test.mjs` 21, `known_family_hub_test.mjs` 24, `client_status_returning_proof.py` 33
  (every original status-change proof plus the new cases), `known_family_install_proof.py` 6. Browser-checked
  with fakes: the panel, Go back, link (side-by-side), backing out then "different family", Convert reuse, and
  Convert with AxisCare down.

## Step 5b C as built (server + hub; Desktop 264)
The automatic front doors: the web form (`lead-intake`), the booking calendar (`assessment-intake`), the website
scheduler (`cc-booking`), the AI phone call (`call-followup`) and call dispositions (`call-disposition`).
- Rules in `_shared/returning.ts`. Closed = Converted, Lost or archived. Only an OPEN inquiry is ever reused; a
  closed one is never rewritten. A NEW inquiry is checked (earlier inquiries by phone / email, and the shared
  client-lookup: AxisCare current + former, Family Circles). Any match: `possibly_returning` on the new inquiry
  {at, by, matches, axiscare_checked} and one My Work item `ops_returning_<lead id>` (source type `returning`,
  domain family_enquiries). A name alone from AxisCare never raises work (it is often the caller's name, not the
  client's). AxisCare down never loses an inquiry; the flag says it wasn't checked. Nothing contacts anyone.
- Per door: the web form always makes a new inquiry (it never rewrote) and now flags a match, open or closed;
  the booking calendar, scheduler and AI call reuse an open inquiry or make a new flagged one; the AI call's
  second call ADDS to the notes instead of wiping them. Call dispositions: an open inquiry takes the call; on a
  Converted / archived one a call meaning "wants care" makes a new flagged inquiry and anything else is only
  logged ("not interested" can no longer mark a Converted inquiry Lost); a Lost inquiry keeps its follow-up calls
  (no answer, voicemail) but "wants care" makes a new flagged inquiry (the Lost Journey is closed). When an open
  and a closed inquiry share a number, the open one takes it.
- Hub: the inquiry shows "Is this the same family?" (slot `lp_returning`) with Check and answer: the same panel
  as at save, in review mode (the earlier inquiry: Open it / Same family; a former client: Same family: link to
  #id through the side-by-side; a current client: Open their profile; A different family). The answer is kept on
  `possibly_returning` (decision, decided_by, decided_at, same_as_lead / axiscare_client_id) and closes the My Work
  item. The My Work card has "Open the inquiry". The earlier inquiry is never changed.
- `client-lookup`'s matching moved into `_shared/client-lookup.ts` (same rules) so the doors share it.
- Deploying: the webhooks can't sign in, so they run without sign-in checking and are gated by their own token.
  Desktop 264 reads each function's current setting, deploys it exactly the same way, reads it back, and proves
  each still refuses a wrong token.
- Tests: `returning_entries_test.mjs` 26 (the real functions against fakes; fails on the old code),
  `returning_hub_test.mjs` 10, `returning_entries_install_proof.py` 8; every earlier suite still passes.
  Browser-checked: the banner, the panel, both answers closing the item, the My Work link.
