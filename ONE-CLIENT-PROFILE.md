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
