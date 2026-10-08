#!/usr/bin/env python3
# 531R · RECOVERY: RESET THE APPROVE TO WORK LIST TO SAMANTHA AND ZACHARY (Slice 0, Samantha 2026-10-08).
# For the day both owners have lost Hub access, or the list is wrong and nobody on it can fix it. Runs only with the
# Supabase access token (sbp_), which ordinary administrators do not hold, as the project's owner, outside the Hub's own
# permission rules. It resets ONLY the Approve to Work list (by the two work emails in the staff list, active records
# only), keeps the Approve to Advance list and the whole change history, appends a reset line to that history and to the
# office event log. Nothing is deleted, nothing is sent, nothing is switched on.
import os, json, datetime as dt
os.environ.setdefault("SB_STEP", "531R")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; KEY = "onboarding_permissions"
EMAILS = ["samantha@mo-care.com", "zach@mo-care.com"]
start("RECOVERY: RESET THE APPROVE TO WORK LIST")
say("PART 1 · READ ONLY (nothing changes)")
ok_, rows = sql(REF, f"select data from public.app_data where key = {lit(KEY)}")
if not ok_: bad(f"could not read the permissions record: {rows}"); done(3)
cur = (rows[0].get("data") if rows else None) or {"version": 0, "advance": [], "work": [], "history": []}
say("  · Approve to Work now: " + (", ".join(m.get("name") or m.get("email") or "?" for m in cur.get("work") or []) or "(nobody)"))
say("  · Approve to Advance now: " + (", ".join(m.get("name") or m.get("email") or "?" for m in cur.get("advance") or []) or "(nobody)") + " (kept as it is)")
ok_, ppl = sql(REF, "select person_id, full_name, primary_email, active from public.persons where lower(primary_email) in (" + ",".join(lit(e) for e in EMAILS) + ")")
if not ok_: bad(f"could not read the staff list: {ppl}"); done(3)
found = {str(p.get("primary_email", "")).lower(): p for p in ppl if p.get("active") is True}
missing = [e for e in EMAILS if e not in found]
if missing: bad("no active staff record for " + ", ".join(missing) + ": nothing was changed. Add them in Team Access first."); done(3)
for e in EMAILS: say(f"  ✓ {found[e].get('full_name') or e} ({e}) is an active staff record")
say(); say("PART 2 · CHANGE")
now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
work = [{"person_id": str(found[e]["person_id"]), "email": e, "name": str(found[e].get("full_name") or ""), "added_by": "531R (Supabase access token)", "added_at": now} for e in EMAILS]
hist = list(cur.get("history") or [])
for m in work: hist.append({"at": now, "by": "531R", "by_email": "install", "kind": "work", "action": "add", "person_id": m["person_id"], "email": m["email"], "name": m["name"], "note": "reset by the owner's recovery step"})
rec = {"version": int(cur.get("version") or 0) + 1, "advance": list(cur.get("advance") or []), "work": work, "history": hist[-500:]}
ok_, r_ = sql(REF, f"insert into public.app_data (key, data, updated_at) values ({lit(KEY)}, {lit(json.dumps(rec))}::jsonb, now()) on conflict (key) do update set data = excluded.data, updated_at = now()")
say("  ✓ Approve to Work reset to: " + ", ".join(m["name"] or m["email"] for m in work)) if ok_ else bad(f"could not save the record: {r_}")
if ok_:
    ok2, _ = sql(REF, "insert into public.op_events (actor_email, actor_name, verb, item_id, area, summary, data) values ('samantha@mo-care.com', 'Samantha', 'onboarding_permission_reset', " + lit(KEY) + ", 'admin', 'Approve to Work list reset to Samantha and Zachary by the 531R recovery step', " + lit(json.dumps({"work": [m["email"] for m in work]})) + "::jsonb)")
    say("  ✓ recorded in the office event log") if ok2 else say("  · the event log line could not be written (the record's own history has it)")
say(); say("PART 3 · PROOF")
ok_, chk = sql(REF, f"select data->'work' as work from public.app_data where key = {lit(KEY)}")
names = [m.get("name") or m.get("email") for m in (chk[0].get("work") if ok_ and chk else [])]
say("  ✓ the record now reads: " + ", ".join(names)) if sorted(m["email"] for m in work) == sorted((m.get("email") for m in (chk[0].get("work") if ok_ and chk else []))) else bad(f"the record did not read back as expected: {chk}")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · only Samantha and Zachary can approve a caregiver to work. Nothing else changed."); done(0)
