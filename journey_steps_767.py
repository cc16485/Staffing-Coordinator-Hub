#!/usr/bin/env python3
# 767 · THREE NEW STEPS ON EVERY CLIENT JOURNEY. CRM plan step A5 (Samantha 2026-10-15, "yes to all 10"; the home safety
#   check stays part of the assessment): "Welcome call to the family" right after they say yes, "Set the Start Date in
#   AxisCare" once they are in AxisCare, and "Check the first visit's EVV in AxisCare" after the first visit. "Complete start
#   of care" waits for them, and the First visit instructions say clock-in and clock-out. Changes only the step catalog
#   (client_journey_step_def); no server piece is deployed. Never texts or emails anyone.
# Part 1 (read only): the reviewed file; the catalog is as expected; how many open journeys see each new step now.
# Part 2: one transaction. Part 3 (proof): the catalog reads back as 767's.
import json, os, re, hashlib, urllib.request, urllib.error, datetime as dt, sys
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); REF = "zngsgedlsxinbygwmxwn"
REPO = os.environ["SB_REPO"]; WANT = os.environ.get("SB_A5_SHA", "")
lines = []; fails = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", str(s)); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def sql(q):
    req = urllib.request.Request(f"{API}/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": "cc-767/1.0", "Authorization": "Bearer " + TOKEN})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: b = r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return False, f"HTTP {e.code}: {e.read().decode(errors='replace')[:300]}"
    except Exception as e: return False, type(e).__name__
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
lit = lambda v: "'" + str(v).replace("'", "''") + "'"
F = os.path.join(REPO, "client-journey", "catalog-a5-767.json")
CAT = os.path.join(REPO, "client-journey", "catalog-v1.json")

say("767 · THREE NEW STEPS ON EVERY CLIENT JOURNEY"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
if not os.path.exists(F) or hashlib.sha256(open(F, "rb").read()).hexdigest() != WANT: bad("the step change is not the reviewed one"); say("  STOP. Nothing was run."); done(2)
A5 = json.load(open(F)); NEW = {d["key"]: d for d in A5["add"]}
OLD_FV = next(d for d in json.load(open(CAT))["steps"] if d["key"] == "fw.first_visit")["howto"]
keys = list(NEW) + ["fw.first_visit", "active.complete"]
ok, r = sql("select key, def, active from public.client_journey_step_def where key in (" + ",".join(lit(k) for k in keys) + ")")
if not ok: bad("couldn't read the step catalog: " + str(r)); done(3)
live = {x["key"]: x for x in r}
if "fw.first_visit" not in live or "active.complete" not in live: bad("the catalog has no First visit or Complete start of care step. Nothing was changed. Tell Claude."); done(3)
state = {}
for k, d in NEW.items():
    if k not in live: state[k] = "add"
    elif live[k]["def"] == d: state[k] = "this"
    else: bad(f"the catalog already has a different step named {k}. Nothing was changed. Tell Claude."); done(3)
fv = live["fw.first_visit"]["def"].get("howto")
if fv == A5["patch"]["fw.first_visit"]["howto"]: state["fw.first_visit"] = "this"
elif fv == OLD_FV: state["fw.first_visit"] = "patch"
else: bad("the First visit instructions are not the ones 767 replaces. Nothing was changed. Tell Claude."); done(3)
after = live["active.complete"]["def"].get("after") or []
if not isinstance(after, list): bad("Complete start of care has no list of steps it waits for. Nothing was changed. Tell Claude."); done(3)
missing = [k for k in A5["complete_after"] if k not in after]
say("  ✓ the step catalog is as expected: " + ", ".join(f"{NEW[k]['title']} ({'already there' if s == 'this' else 'to add'})" for k, s in state.items() if k in NEW))
ok, n = sql("""with j as (select journey_id from public.client_journey where status = 'open' and not is_test and coalesce(subject, 'client') = 'client'),
  s as (select journey_id, step_key from public.client_journey_step where state in ('complete','not_needed','exception'))
select (select count(*) from j)::int as open,
  (select count(*) from j where exists (select 1 from s where s.journey_id = j.journey_id and s.step_key = 'signed.yes'))::int as yes,
  (select count(*) from j where exists (select 1 from s where s.journey_id = j.journey_id and s.step_key = 'ax.client'))::int as ax,
  (select count(*) from j where exists (select 1 from s where s.journey_id = j.journey_id and s.step_key = 'fw.first_visit'))::int as fv""")
if not ok or not n: bad("couldn't count the open journeys. Nothing was changed."); done(3)
c = n[0]
say(f"  · {c['open']} open client journeys. Once this is in: {c['yes']} will show Welcome call (they already said yes), {c['ax']} will show Set the Start Date in AxisCare, {c['fv']} will show Check the first visit's EVV")

say(); say("PART 2 · CHANGE")
stmts = []
for k, d in NEW.items():
    if state[k] == "add":
        stmts.append(f"insert into public.client_journey_step_def (key, catalog_version, def, active, updated_by) values ({lit(k)}, 3, {lit(json.dumps(d))}::jsonb, true, '767')")
if state["fw.first_visit"] == "patch":
    stmts.append(f"update public.client_journey_step_def set def = def || {lit(json.dumps(A5['patch']['fw.first_visit']))}::jsonb, updated_at = now(), updated_by = '767' where key = 'fw.first_visit'")
if missing:
    stmts.append(f"update public.client_journey_step_def set def = jsonb_set(def, '{{after}}', coalesce(def->'after', '[]'::jsonb) || {lit(json.dumps(missing))}::jsonb), updated_at = now(), updated_by = '767' where key = 'active.complete'")
if not stmts: say("  ✓ already in place: nothing to change")
else:
    ok, r = sql("begin;\n" + ";\n".join(stmts) + ";\ncommit;")
    if not ok: bad("the catalog was not changed (nothing in it was saved): " + str(r)[:200]); say("  STOP. Tell Claude."); done(6)
    say(f"  ✓ the step catalog changed ({len(stmts)} change(s), all together)")

say(); say("PART 3 · PROOF")
ok, r = sql("select key, def, active from public.client_journey_step_def where key in (" + ",".join(lit(k) for k in keys) + ")")
live = {x["key"]: x for x in (r if ok else [])}
for k, d in NEW.items():
    if live.get(k, {}).get("def") == d and live[k].get("active"): say(f"  ✓ {d['title']}: in the catalog")
    else: bad(f"{d['title']} is not in the catalog as reviewed")
fvok = live.get("fw.first_visit", {}).get("def", {}).get("howto") == A5["patch"]["fw.first_visit"]["howto"]
(say("  ✓ First visit happened: the instructions say clock-in and clock-out") if fvok else bad("the First visit instructions did not change"))
acok = all(k in (live.get("active.complete", {}).get("def", {}).get("after") or []) for k in A5["complete_after"])
(say("  ✓ Complete start of care waits for the three new steps") if acok else bad("Complete start of care does not wait for the new steps"))
say()
say("RESULT: " + ("DONE · the new steps show on every client journey from the next time it is opened or swept (10 minutes)." if not fails else "PARTLY DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed. No journey's own steps were changed.")
say("Rollback: Claude sets the three new steps inactive and puts the First visit instructions and the Complete start of care list back.")
done(0 if not fails else 8)
