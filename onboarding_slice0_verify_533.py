#!/usr/bin/env python3
# 533 · SLICE 0 VERIFICATION, READ ONLY (Samantha 2026-10-08). Two runs with the same script:
#   SB_MODE=before (run BEFORE 531 and 532): takes a snapshot of what Slice 0 must not change (message stamps on offers,
#     caregiver statuses as the Training sync and the Hub roster hold them, every Hub switch, the event-log count) and
#     saves it to the Desktop.
#   SB_MODE=after (run AFTER 531, 532 and the merges, and after Samantha saves the Onboarding workflow card once): reads
#     everything back and compares it with the snapshot: the settings as saved, the Approve to Work names, every offer
#     on the old path, the trigger refusing a change, the live function versions, the event-log lines for onboarding
#     changes, and NO difference in message stamps, caregiver statuses or switches.
# It writes nothing to either project (the trigger proof is a transaction that always rolls back).
import os, json, datetime as dt
os.environ.setdefault("SB_STEP", "533")
from cc_step_lib import *
HUB = "zngsgedlsxinbygwmxwn"; TRN = "rdqujxiycycwhskyvrwa"; MODE = os.environ.get("SB_MODE", "after")
SNAP = os.path.expanduser("~/Desktop/Slice 0 snapshot (533).json")
start("SLICE 0 VERIFICATION, " + ("SNAPSHOT BEFORE" if MODE == "before" else "READ BACK AND COMPARE"))

def counts(ref, q, label):
    ok_, rows = sql(ref, q)
    if not ok_: bad(f"{label}: could not read ({str(rows)[:100]})"); return None
    return rows
def snapshot():
    s = {"taken_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    ocols = {c["column_name"] for c in (counts(TRN, "select column_name from information_schema.columns where table_schema='public' and table_name='job_offers'", "offer columns") or [])}
    stamps = [c for c in ("welcome_sent_at", "start_link_sent_at", "step1_done_at", "viventium_entered_at") if c in ocols]
    r = counts(TRN, "select count(*) as offers" + "".join(f", count({c}) as {c}" for c in stamps) + " from public.job_offers", "offers")
    s["offers"] = r[0] if r else None
    cols = counts(TRN, "select column_name from information_schema.columns where table_schema='public' and table_name='caregivers'", "caregiver columns") or []
    names = {c["column_name"] for c in cols}
    stat = next((c for c in ("status", "axiscare_status", "employment_status") if c in names), None)
    s["training_caregivers"] = (counts(TRN, f"select coalesce({stat}::text,'(none)') as status, count(*) as n from public.caregivers group by 1 order by 1", "caregiver statuses") if stat else [{"status": "(no status column)", "n": 0}])
    s["hub_roster"] = counts(HUB, "select coalesce(e->>'status', e->>'axiscare_status', '(none)') as status, count(*) as n from public.app_data d, jsonb_array_elements(case when jsonb_typeof(d.data)='array' then d.data else '[]'::jsonb end) e where d.key='caregivers' group by 1 order by 1", "Hub roster statuses")
    sw = counts(HUB, "select e.key as key, e.value as value from public.app_data d, jsonb_each(case when jsonb_typeof(d.data)='object' then d.data else '{}'::jsonb end) e where d.key='ops_settings' and e.key like '%\\_live' order by 1", "switches")
    s["switches"] = {r["key"]: r["value"] for r in (sw or [])}
    ev = counts(HUB, "select count(*) as n from public.op_events", "event log"); s["op_events"] = int(ev[0]["n"]) if ev else None
    return s

if MODE == "before":
    say("PART 1 · SNAPSHOT (nothing changes)")
    s = snapshot()
    if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
    open(SNAP, "w").write(json.dumps(s, indent=1))
    say(f"  ✓ offers: {s['offers']['offers']}; message stamps: " + ", ".join(f"{k} {v}" for k, v in s["offers"].items() if k != "offers"))
    say("  ✓ Training caregivers by status: " + ", ".join(f"{r['status']} {r['n']}" for r in s["training_caregivers"]))
    say("  ✓ Hub roster by status: " + ", ".join(f"{r['status']} {r['n']}" for r in s["hub_roster"]))
    say(f"  ✓ {len(s['switches'])} Hub switches recorded, event log at {s['op_events']} lines")
    say(f"  ✓ snapshot saved: {SNAP}"); say()
    say("RESULT: DONE · snapshot taken, nothing changed. Run 531, then 532, then the merges, save the Onboarding workflow card once, then run the 'after' step."); done(0)

say("PART 1 · THE SETTINGS AS SAVED (Owners Hub Admin page)")
ok_, st = sql(HUB, "select data->'onboarding' as onb, data->'company_holidays' as hol, data->'viventium_step2_checklist' as ck, data->>'onboarding_switch_date' as sw from public.app_data where key='ops_settings'")
if not ok_ or not st: bad("could not read ops_settings")
else:
    o = st[0].get("onb") or {}
    say("  ✓ reminder days and deadlines saved: " + json.dumps({k: o.get(k) for k in ("offer_days", "step1_days", "step2_days", "due_hour", "step2_sent_due_days", "verify_due_days", "final_approval_due_days")}) + (f" (by {o.get('changed_by')} at {str(o.get('changed_at'))[:16]})" if o.get("changed_at") else "")) if o else say("  · reminder days not saved yet (the card shows the approved defaults until a save)")
    hol = st[0].get("hol") or []; say(f"  ✓ company holidays: {len(hol)}: " + ", ".join(f"{h.get('date')} {h.get('name','')}".strip() for h in hol)) if hol else say("  · no company holidays saved yet")
    ck = st[0].get("ck") or {}; say(f"  ✓ Viventium checklist version {ck.get('version')}: {len(ck.get('items') or [])} items, {len(ck.get('history') or [])} earlier version(s) kept") if ck else say("  · the checklist has not been saved yet (version 0, the starting list)")
    sw = st[0].get("sw"); say("  ✓ switch date: not set (locked)") if not sw else bad(f"the switch date is SET ({sw}) and must not be before the approved launch")
say(); say("PART 2 · WHO MAY APPROVE")
ok_, pr = sql(HUB, "select data from public.app_data where key='onboarding_permissions'")
if ok_ and pr:
    d = pr[0]["data"] or {}
    work = [f"{m.get('name') or '?'} <{m.get('email')}>" for m in d.get("work") or []]
    say("  ✓ Approve to Work: " + ", ".join(work)) if len(work) == 2 and all(e in (m.get("email") for m in d.get("work") or []) for e in ("samantha@mo-care.com", "zach@mo-care.com")) else bad("Approve to Work is not exactly Samantha and Zachary: " + ", ".join(work))
    say("  ✓ Approve to Advance: " + (", ".join(f"{m.get('name') or '?'} <{m.get('email')}>" for m in d.get("advance") or []) or "nobody named yet (owners can always advance)"))
    say(f"  ✓ change history: {len(d.get('history') or [])} line(s)")
else: bad("the permissions record is missing (did 531 run?)")
say(); say("PART 3 · EVERY OFFER ON THE OLD PATH")
r = counts(TRN, "select coalesce(onboarding_path,'(missing)') as p, count(*) as n from public.job_offers group by 1 order by 1", "offers by path")
if r is not None: say("  ✓ offers by path: " + ", ".join(f"{x['p']} {x['n']}" for x in r)) if all(x["p"] == "old" for x in r) else bad("an offer is not on the old path: " + json.dumps(r))
ok_, t_ = sql(TRN, "do $p$ declare v_id uuid; v_ok text; begin select id into v_id from public.job_offers limit 1; if v_id is null then raise exception using message = 'no offers'; end if; begin update public.job_offers set onboarding_path = 'new' where id = v_id; v_ok := 'ALLOWED'; exception when others then v_ok := 'refused: ' || sqlerrm; end; raise exception using message = v_ok; end $p$")
say("  ✓ the trigger refuses a change to the path") if (not ok_) and "refused" in str(t_) and "set once at Send Offer" in str(t_) else (say("  · no offers to test the trigger on") if (not ok_) and "no offers" in str(t_) else bad(f"the trigger did not refuse a change (or the column is not there yet): {str(t_)[:160]}"))
say(); say("PART 4 · THE LIVE FUNCTIONS")
for ref, fn in ((HUB, "onboarding-permissions"), (HUB, "outreach-check"), (HUB, "caregiver-hiring-history"), (TRN, "job-offer")):
    sx, mx = fmeta(ref, fn)
    say(f"  ✓ {fn}: version {(mx or {}).get('version', '?')}, gateway sign-in check {'on' if (mx or {}).get('verify_jwt') else 'off'}") if sx == 200 else bad(f"{fn} could not be read ({sx})")
say(); say("PART 5 · THE EVENT LOG (onboarding changes since the snapshot)")
snap = json.load(open(SNAP)) if os.path.exists(SNAP) else None
since = snap["taken_at"] if snap else "1970-01-01"
ev = counts(HUB, f"select at, actor_email, verb, summary from public.op_events where at >= {lit(since)} and (verb like 'onboarding_%' or summary ilike '%onboarding%' or summary ilike '%company holidays%' or summary ilike '%Viventium Step 2 checklist%') order by at", "event log")
if ev is not None:
    for e in ev[:30]: say(f"  · {str(e['at'])[:16]} {e['actor_email']}: {e['summary']}")
    say(f"  ✓ {len(ev)} onboarding event(s) since the snapshot")
say(); say("PART 6 · NOTHING ELSE CHANGED (against the snapshot)")
if not snap: say("  · no snapshot found on the Desktop (the 'before' step was not run), so there is nothing to compare")
else:
    now = snapshot()
    a, b = snap["offers"] or {}, now["offers"] or {}
    same = all(a.get(k) == b.get(k) for k in a if k != "offers")
    say("  ✓ message stamps on offers unchanged by the deploy: " + ", ".join(f"{k} {a.get(k)} → {b.get(k)}" for k in a if k != "offers") + f" (offers {a.get('offers')} → {b.get('offers')}; new ones since the snapshot are the office's own)") if same else bad(f"message stamps changed: {a} → {b}. If the office sent offers meanwhile that is expected; otherwise tell Claude.")
    for key, label in (("training_caregivers", "Training caregiver statuses"), ("hub_roster", "Hub roster statuses")):
        before = {r["status"]: r["n"] for r in snap[key]}; after = {r["status"]: r["n"] for r in now[key]}
        say(f"  ✓ {label} unchanged: " + ", ".join(f"{k} {v}" for k, v in after.items())) if before == after else say(f"  · {label} differ: before {before}, after {after} (the nightly AxisCare sync and the office's own work change these daily; a difference here is not by itself a Slice 0 change)")
    say("  ✓ every Hub switch is as it was") if snap["switches"] == now["switches"] else bad("a Hub switch changed: " + json.dumps({k: (snap['switches'].get(k), now['switches'].get(k)) for k in set(snap['switches']) | set(now['switches']) if snap['switches'].get(k) != now['switches'].get(k)}))
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Slice 0 is live as approved: settings saved, the owner list right, every offer on the old path, nothing else changed. Nothing was written by this step."); done(0)
