#!/usr/bin/env python3
# 581 · PHASE 1 SLICE 2 · CHANGE HISTORY FOR THE OPERATIONAL RECORDS. Run by "581 Slice 2 change history.command".
# Part 1 (READ ONLY): the reviewed files, the tests, the 418 history is installed, no trigger on app_data calls out,
#   and each watched key's size (records, bytes) and last save.
# Part 2 (SPEED, NOTHING STAYS): one request, one transaction, always rolled back: time 5 saves of one record on every
#   watched list and the settings record with today's history, install the 581 watcher inside that transaction, time
#   5 more. GATE: if any save with the watcher takes half a second or more, STOP here and install nothing.
# Part 3 (CHANGE): app_data_history_581.sql in one transaction (the watcher and its two triggers; the table, its read
#   rule and every line already in it stay as they are).
# Part 4 (PROOF, NOTHING STAYS): a signed-in work-item save leaves one line with that person; a settings save one line
#   naming the setting; a server job's save one line as "server"; with the watcher forced to fail the save still goes
#   through. Then: everything is exactly as before the proof.
# Sends nothing. No switch changes. No permission changes. Only the watcher is replaced.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, shutil
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB = "zngsgedlsxinbygwmxwn"
ROOT = os.environ["SB_HUB_ROOT"]
FILES = {"app_data_history_581.sql": os.environ.get("SB_SQL_SHA", ""), "app_data_history_581_proof.sql": os.environ.get("SB_PROOF_SHA", ""),
         "app_data_history_581_speed.sql": os.environ.get("SB_SPEED_SHA", ""), "app_data_history_581_rollback.sql": os.environ.get("SB_ROLLBACK_SHA", "")}
KEYS = ["candidates", "caregivers", "ops_items", "leads", "coverage_cases", "timekeeper_cases", "staffing_plans", "visit_changes", "ops_settings"]
LABEL = {"candidates": "candidates", "caregivers": "caregivers", "ops_items": "work items", "leads": "leads", "coverage_cases": "coverage cases",
         "timekeeper_cases": "missed clock-in cases", "staffing_plans": "staffing plans", "visit_changes": "visit changes", "ops_settings": "settings record"}
GATE_MS = 500
lines = []; fails = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", str(s))
    s = re.sub(r"[\w.%+\-]+@(?!invalid\.test)[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=180):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-slice2-581/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{HUB}/database/query", {"query": q}, {"Authorization": "Bearer " + TOKEN})
    if s not in (200, 201): return False, f"HTTP {s}: {b[:400]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def probe(q):
    """Run a request that always ends by raising PROBE_RESULT (so it is rolled back). Returns (result dict or None, raw message)."""
    s, b = http("POST", f"{API}/v1/projects/{HUB}/database/query", {"query": q}, {"Authorization": "Bearer " + TOKEN})
    msg = b
    try: msg = json.loads(b).get("message", b)
    except Exception: pass
    if "PROBE_RESULT: " in str(msg):
        try: return json.JSONDecoder().raw_decode(str(msg).split("PROBE_RESULT: ", 1)[1])[0], msg
        except Exception: pass
    return None, f"({s}) {str(msg)[:300]}"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
TRG = "select pg_get_triggerdef(oid) as d from pg_trigger where tgrelid = 'public.app_data'::regclass and tgname = 'app_data_item_change_t'"

say("581 · PHASE 1 SLICE 2 · CHANGE HISTORY FOR THE OPERATIONAL RECORDS"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for f, want in FILES.items():
    p = os.path.join(ROOT, f)
    if not want or not os.path.exists(p) or sha(p) != want: bad(f"{f} is not the reviewed version"); say("  STOP. Nothing was run."); done(2)
TEXT = {f: open(os.path.join(ROOT, f)).read() for f in FILES}
say("  ✓ the four 581 SQL files are the reviewed versions")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    p = subprocess.run([NODE, "slice2_581_test.mjs"], cwd=ROOT, capture_output=True, text=True)
    last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
    if p.returncode != 0 or "FAIL" in last: bad(f"slice2_581_test.mjs failed: {last}"); say("  STOP. Nothing was run."); done(2)
    say(f"  ✓ slice2_581_test.mjs: {last} (run here; the SQL checks)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
ok, trg = sql("select t.tgname, (p.prosrc ~* '(net\\.|http_post|http_get|pg_net)') as calls_out from pg_trigger t join pg_proc p on p.oid = t.tgfoid "
              "where t.tgrelid = 'public.app_data'::regclass and not t.tgisinternal order by 1")
if not ok: bad("couldn't read app_data's triggers: " + str(trg)[:200]); done(2)
say("  · triggers on app_data: " + ", ".join(r["tgname"] + (" (CALLS OUT over the network)" if r["calls_out"] else "") for r in trg))
if not any(r["tgname"] == "app_data_item_change_t" for r in trg): bad("the 418 change history is not installed (app_data_item_change_t missing)"); say("  STOP. Nothing was run."); done(2)
callers = [r["tgname"] for r in trg if r["calls_out"] and not r["tgname"].startswith("app_data_item_change")]
if callers: bad("a trigger on app_data could call out over the network (" + ", ".join(callers) + "), so the timed saves were NOT run"); say("  STOP. Nothing was run. Tell Claude."); done(2)
ok, t0 = sql(TRG)
ALREADY = ok and t0 and "ops_items" in (t0[0].get("d") or "")
say("  · the history watches today: " + ("candidates, caregivers AND the operational keys (581 is already installed; running it again is safe)" if ALREADY else "candidates and caregivers only"))
ok, sz = sql("select key, case when jsonb_typeof(data) = 'array' then jsonb_array_length(data) end as n, pg_column_size(data) as bytes, updated_at::text as u, version "
             "from public.app_data where key in (" + ", ".join("'" + k + "'" for k in KEYS) + ") order by key")
if not ok: bad("couldn't read the sizes: " + str(sz)[:200]); sz = []
have = {r["key"]: r for r in sz}
for k in KEYS:
    r = have.get(k)
    say(f"  · {LABEL[k]} ({k}): " + (f"{'one record' if r['n'] is None else str(r['n']) + ' records'}, {round((r['bytes'] or 0) / 1024)} KB, last saved {str(r['u'])[:16]} UTC" if r else "no row yet (it is watched from its first save)"))
ok, base = sql("select coalesce(max(id), 0)::bigint as maxid, count(*)::int as n from public.app_data_item_change")
BASE = base[0] if ok and base else {"maxid": 0, "n": 0}

say(); say("PART 2 · SPEED (one transaction, rolled back; nothing stays)")
body = re.sub(r"(?m)^begin;\s*$|^commit;\s*$", "", TEXT["app_data_history_581.sql"])
if TEXT["app_data_history_581_speed.sql"].count("-- 581 INSTALL GOES HERE") != 1: bad("the speed probe does not have exactly one install marker"); done(2)
J, raw = probe(TEXT["app_data_history_581_speed.sql"].replace("-- 581 INSTALL GOES HERE", body))
if J is None: bad("the speed probe gave no result " + raw); say("  STOP. Nothing was installed."); done(3)
times = J.get("times") or {}
slow = []
for k in KEYS:
    t = times.get(k)
    if not t: say(f"  · {LABEL[k]}: not timed (no record to save)"); continue
    say(f"  · {LABEL[k]}: a save took {t['before_med']} ms (slowest {t['before_max']}) today, {t['after_med']} ms (slowest {t['after_max']}) with the history; {t.get('lines', 0)} history line(s) written in the trial")
    if float(t["after_max"] or 0) >= GATE_MS: slow.append(LABEL[k])
missing = [LABEL[k] for k in KEYS if k != "candidates" and k != "caregivers" and times.get(k) and not times[k].get("lines")]
ok, t1 = sql(TRG)
chk(ok and t1 and ("ops_items" in (t1[0].get("d") or "")) == bool(ALREADY), "afterwards: the trial install was rolled back (the live watcher is as it was)")
if missing: bad("in the trial the watcher wrote no line for: " + ", ".join(missing))
if slow: bad(f"GATE: with the history a save of {', '.join(slow)} took half a second or more")
if slow or missing or fails: say("  STOP. Nothing was installed. Tell Claude."); done(3)
say(f"  ✓ GATE: every save stays under half a second with the history")

say(); say("PART 3 · CHANGE (one transaction)")
ok, r = sql(TEXT["app_data_history_581.sql"])
if not ok: bad("581 didn't install (one transaction, so nothing in it changed): " + str(r)[:300]); say("  STOP. Tell Claude."); done(4)
ok, t2 = sql(TRG)
chk(ok and t2 and all(k in (t2[0].get("d") or "") for k in KEYS), "the history now watches candidates, caregivers and the 7 operational keys")
ok, ln = sql("select count(*)::int as n from public.app_data_item_change")
chk(ok and ln and ln[0]["n"] >= BASE["n"], f"every history line already written is still there ({ln[0]['n'] if ok and ln else '?'} now, {BASE['n']} before)")
if fails: say("  STOP. Tell Claude."); done(4)

say(); say("PART 4 · PROOF (one transaction, rolled back; nothing stays)")
snap = "select (select count(*) from public.app_data_item_change where actor = 'proof-581@invalid.test')::int as proof_left, (select count(*) from pg_constraint where conname = 'proof_581_force_error')::int as rule_left, (select md5(data::text) from public.app_data where key = 'ops_settings') as s"
ok, b4 = sql(snap); b4 = b4[0] if ok and b4 else {}
J, raw = probe(TEXT["app_data_history_581_proof.sql"])
if J is None: bad("the proof gave no result " + raw)
elif J.get("skipped"): say(f"  · proof skipped: {J['skipped']} (the tests proved it in a test database)")
else:
    ir, sr, vr = J.get("item_rows") or [], J.get("settings_rows") or [], J.get("server_rows") or []
    chk(len(ir) == 1 and ir[0]["change"] == "changed" and ir[0]["fields_changed"] == ["_proof_581"] and ir[0]["actor"] == "proof-581@invalid.test" and ir[0]["role"] == "authenticated" and ir[0]["same_record"] and not ir[0]["has_name"],
        "a signed-in save of a work item left ONE history line: that record, the field name only, the person who saved (the Slice 2 gate)")
    chk(len(sr) == 1 and sr[0]["fields_changed"] == ["_proof_581"] and sr[0]["actor"] == "proof-581@invalid.test" and sr[0]["record_id"] is None, "a settings save left ONE line naming the setting that changed, with the person")
    chk(len(vr) == 1 and vr[0]["actor"] == "server" and vr[0]["role"] == "service_role", "a server job's save left ONE line as \"server\"")
    chk(J.get("error_saved") is True and J.get("error_rows") == 1, "with the watcher forced to fail, the work-item save STILL went through, and one 'trigger_error' line was written instead")
ok, af = sql(snap); af = af[0] if ok and af else {}
chk(af.get("proof_left") == 0 and af.get("rule_left") == 0 and af.get("s") == b4.get("s"), "afterwards: no proof line, no temporary rule, the settings record exactly as before (all rolled back)")

say()
if fails: say("RESULT: PARTLY DONE · the ✗ lines above need Claude.")
else: say("RESULT: DONE · every save of work items, leads, coverage cases, missed clock-in cases, staffing plans, visit changes and the settings record is now recorded (who, when, which fields). It never blocks a save.")
say("Nothing was texted or emailed. No switch or permission changed. The only change is the watcher.")
say("Rollback (only if ever needed): run app_data_history_581_rollback.sql (the 418 watcher again; lines already written stay).")
done(1 if fails else 0)
