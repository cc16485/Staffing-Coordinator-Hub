#!/usr/bin/env python3
# 439 · AFTER CAREGIVER CONNECT: CHECK ITS FIRST LIVE RUN, THEN BRING IN THE NEW PEOPLE'S GOHIGHLEVEL DOCUMENTS.
# Samantha 2026-10-03 ("yes": check the first run, then the documents for the people it connected).
# Part 1 (read only): the caregiver connect check has run live since her switch; what it did (counts), anything refused or
#   any error. Stops if it hasn't run live yet.
# Part 2: the reviewed build of ghl-docs-import (381's, plus: a file already imported under the Background & References
#   record a caregiver came from is not copied again); put up for this run only (owner key only).
# Part 3: PRACTICE over everyone (reads only): who has documents not yet in the Hub. Part 4: only if you type y, the REAL
#   copy. Then the import step is taken down again. Never: SSN cards, birth certificates, I-9 documents. No caregiver or
#   candidate record is written. Prints first names and last initials, check names and counts only.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, time, sys
REPORT = os.environ["SB_REPORT"]; ROOT = os.environ["SB_REPO"]; SHAS = json.loads(os.environ["SB_SHAS"])
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); SUPA = os.environ.get("SB_SUPA_CLI", "")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
SWITCHED_ON = os.environ.get("SB_SWITCHED_ON", "2026-10-04T04:30:00Z")
FN = "ghl-docs-import"; lines = []; fails = []; HIDE = []
LABEL = {"edl": "EDL", "oig": "OIG", "fcsr": "FCSR", "checkr": "Checkr", "ref_pro_1": "Pro ref 1", "ref_pro_2": "Pro ref 2", "ref_pro_3": "Pro ref 3", "ref_personal_1": "Personal ref 1", "ref_personal_2": "Personal ref 2"}
def say(s=""):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=170):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-439/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def lit(v): return "'" + str(v).replace("'", "''") + "'"
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict)}
        got = {k: v for k, v in got.items() if usable(v)}
        if got.get("anon"): return got
    return {}
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def src(n): return os.path.join(ROOT, "supabase/functions", n + ".ts") if n.startswith("_shared/") else os.path.join(ROOT, "supabase/functions", n, "index.ts")
def take_down():
    http("DELETE", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
    s, _ = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
    (say if s == 404 else bad)(("  ✓ " if s == 404 else "") + "the import step is taken down again" + ("" if s == 404 else f" (still there: {s})"))
def sweep(mode, SVC):
    off, people, fields = 0, [], []
    while off is not None:
        s, b = http("POST", f"{FNB}/functions/v1/{FN}", {"mode": mode, "offset": off, "limit": 8}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
        try: j = json.loads(b)
        except Exception: j = {}
        if s != 200 or not j.get("ok"): bad(f"the {mode} pass stopped at person {off} ({s}): " + str(j.get("error") or b)[:160]); return people, fields, False
        people += j["people"]; fields = j["fields_found"]; off = j["next"]
        print(f"    … {min(len(people), j['total_people'])} of {j['total_people']}", flush=True)
    return people, fields, True

say("439 · AFTER CAREGIVER CONNECT"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
say("PART 1 · THE FIRST LIVE CONNECT RUN (read only)")
ok, runs = sql(f"""select at, ok, linked, moved, created, review, refused, error from public.caregiver_connect_runs
                   where mode = 'live' and at > {lit(SWITCHED_ON)} order by at desc limit 3""")
if not ok: bad("couldn't read the connect runs: " + str(runs)[:160]); done(3)
if not runs:
    ok2, last = sql("select at, mode, ok from public.caregiver_connect_runs order by at desc limit 1")
    say("  · caregiver connect hasn't run live yet" + (f" (last run {last[0]['at'][:16].replace('T', ' ')} UTC, {last[0]['mode']})" if ok2 and last else "") + ".")
    say("  It runs at :17 past every hour. Run 439 again after the next one. Nothing was changed."); done(0)
first = runs[-1]
say(f"  ✓ live since {first['at'][:16].replace('T', ' ')} UTC ({len(runs)} live run{'s' if len(runs) != 1 else ''} so far)")
for r in reversed(runs):
    say(f"    {r['at'][11:16]} UTC: {'ok' if r['ok'] else 'NOT OK'} · connected {r['linked']}, moved over {r['moved']}, new records {r['created']}, need a look {r['review']}, refused {r['refused']}"
        + (f" · {r['error'][:160]}" if r.get("error") else ""))
    if not r["ok"]: bad("a live run did not finish cleanly (above). The documents step still runs; tell Claude.")
ok, lg = sql(f"""select action, result, count(*)::int as n from public.caregiver_connect_log where at > {lit(SWITCHED_ON)} and mode = 'live' and result in ('done', 'refused')
                 group by 1, 2 order by 1, 2""")
if ok and lg: say("  in the connect list: " + ", ".join(f"{x['n']} {x['action']} {x['result']}" for x in lg))
ok, rf = sql(f"select why, count(*)::int as n from public.caregiver_connect_log where at > {lit(SWITCHED_ON)} and result = 'refused' group by 1 order by 2 desc limit 5")
for x in (rf or []): say(f"    refused {x['n']}×: {x['why']}")
ok, dup = sql("""select count(*)::int as n from (select x->>'axiscare_id' a from app_data, jsonb_array_elements(data) x where key = 'caregivers'
                 and coalesce(x->>'axiscare_id', '') <> '' group by 1 having count(*) > 1) d""")
(say if ok and dup and dup[0]["n"] == 0 else bad)(("  ✓ " if ok and dup and dup[0]["n"] == 0 else "") + "no AxisCare caregiver has two Hub records" + ("" if ok and dup and dup[0]["n"] == 0 else f" ({dup})"))

say(); say("PART 2 · THE IMPORT STEP")
for n, w in SHAS.items():
    if not os.path.exists(src(n)) or sha(src(n)) != w: bad(f"{n} is not the reviewed build. Nothing was copied."); done(2)
if set(SHAS) != {FN, "_shared/job-auth"}: bad("the reviewed list is incomplete"); done(2)
ok, t = sql("select to_regclass('public.prehire_docs') is not null as t, (select count(*)::int from public.prehire_docs) as n")
if not ok or not t or not t[0]["t"]: bad("the imported-documents record isn't there (381). Nothing was copied."); done(3)
before = t[0]["n"]
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api", "--no-verify-jwt"], cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("couldn't put up the import step: " + (p.stderr or p.stdout)[-200:]); take_down(); done(4)
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); HIDE += [ANON, SVC]
if not ANON or not SVC: bad("couldn't read the project's keys. Nothing was copied."); take_down(); done(4)
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
a = http("POST", f"{FNB}/functions/v1/{FN}", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
(say if a == 401 else bad)(("  ✓ " if a == 401 else "") + f"the import step is up, the reviewed build, and refuses the public key ({a}) · {before} documents already in the Hub")

say(); say("PART 3 · PRACTICE (reads only; nothing copied)")
people, fields, ok = sweep("practice", SVC)
if not ok: take_down(); done(6)
would = 0; already = 0; moved = 0; nomatch = []
for pr in people:
    if not pr["matched"]: nomatch.append(f"{pr['who']} ({pr.get('why', 'not matched')})"); continue
    parts = []
    for c in pr["checks"]:
        st = c.get("state", "")
        if st == "would import": would += 1; parts.append(LABEL.get(c["check"], c["check"]) + ("*" if c["hub_has_doc"] else "") + (f" [{c['result']}]" if c["result"] else ""))
        elif st.startswith("already imported (under"): moved += 1
        elif st == "already imported": already += 1
    if parts: say(f"  {pr['who']} ({pr['kind']}): " + ", ".join(parts))
say(f"  → {would} new file(s) would be copied · {already} already in the Hub · {moved} already in under the Background & References record they moved from (not copied again)")
say("  * = the Hub already has its own document for that check (the Hub's stays the one shown first).")
if nomatch: say(f"  · not found in GoHighLevel ({len(nomatch)}): " + "; ".join(nomatch[:20]) + (" …" if len(nomatch) > 20 else ""))
if not would:
    take_down(); say(); say("RESULT: DONE · nothing new to copy." + (" CHECK THE ✗ LINES." if fails else "")); done(0 if not fails else 8)
say()
ans = os.environ.get("SB_AUTO", "") or input("  Copy these into the Hub now? Type y and Enter (anything else stops): ").strip().lower()
if ans not in ("y", "yes"): say("  · stopped after the practice pass; nothing was copied"); take_down(); say(); say("RESULT: PRACTICE ONLY · nothing copied. Run 439 again when ready."); done(0)
say(); say("PART 4 · THE REAL COPY")
people, fields, ok = sweep("live", SVC)
imp = sum(1 for pr in people for c in pr.get("checks", []) if c.get("state") == "imported")
skp = [(pr["who"], c["check"], c["state"]) for pr in people for c in pr.get("checks", []) if c.get("state") not in ("imported", "already imported") and not str(c.get("state", "")).startswith("already imported (under")]
say(f"  ✓ {imp} file(s) copied into the Hub's private storage")
for w, c, st in skp[:30]: say(f"  · {w}: {LABEL.get(c, c)} {st}")
ok2, cnt = sql("select count(*)::int as n from public.prehire_docs")
if ok2: say(f"  the imported-documents record now holds {cnt[0]['n']} file(s) (was {before})")
take_down()
say(); say("RESULT: " + ("DONE · they show on each caregiver's profile (Compliance) and in the Pre-Hire Audit now." if not fails else "CHECK THE ✗ LINES."))
say("Nothing was texted or emailed, and no caregiver or candidate record was changed.")
done(0 if not fails else 8)
