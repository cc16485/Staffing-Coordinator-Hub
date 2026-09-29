#!/usr/bin/env python3
# PRN3 · THE PRN TEAM GETS ASKED FIRST (Desktop 357). Samantha approved 2026-09-29 ("yes to all").
# Part 1 (read only): the reviewed builds; the live coverage-run and prn-team are exactly GitHub (prn3_accept.json;
#   stops and keeps a copy otherwise); the counts before.
# Part 2: prn3.sql in one transaction (the PRN shift record); deploy coverage-run and prn-team (gateway settings kept).
# Part 3 (proof; nothing is sent, nothing is kept): a practice shift record, undone; coverage-run refuses outsiders
#   and lets its schedule in; the list for one open call-off or one-time shift, as counts only. It never does a
#   plain coverage run: that one can text caregivers when sending is on.
# Prints counts only: no name, number, email, key or secret.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "40"))
KEEP = os.environ.get("SB_KEEP_DIR", os.path.expanduser("~/Claude/prn3-live-copy"))
FNS = ("coverage-run", "prn-team"); VAULT_NAME = "hub_job_secret"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=200):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-prn3/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql_raw(q): return http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
def sql(q):
    s, b = sql_raw(q)
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def lit(v): return "'" + str(v).replace("'", "''") + "'"
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def src_path(name):
    if name.startswith("_shared/"): return os.path.join(FNROOT, name + ".ts")
    if name.endswith((".sql", ".json")): return os.path.join(REPO, name)
    return os.path.join(FNROOT, name, "index.ts")

say("PRN3 · THE PRN TEAM GETS ASKED FIRST"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
for name, want in SHAS.items():
    if sha(src_path(name)) != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
if not {"coverage-run", "prn-team", "prn3.sql", "prn3_accept.json"} <= set(SHAS): bad("the reviewed list is incomplete"); done(2)
say("  ✓ the coverage engine, the PRN Team function, the shift record and the comparison list are the reviewed builds")
ACCALL = json.load(open(os.path.join(REPO, "prn3_accept.json")))
META = {}
for fn in FNS:
    s1, m1 = fmeta(fn)
    if s1 != 200 or not isinstance((m1 or {}).get("verify_jwt"), bool): bad(f"could not read {fn}'s settings. Nothing was changed."); done(4)
    META[fn] = m1
    ACC = ACCALL[fn]["files"]
    tmp = tempfile.mkdtemp(prefix="prn3-live-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if d.returncode != 0: bad(f"could not download the live {fn} to compare. Nothing was changed."); done(4)
    diff, seen = [], set()
    for root, _, files in os.walk(tmp):
        for f in files:
            if not f.endswith(".ts"): continue
            lp = os.path.join(root, f); tail = "/".join(os.path.relpath(lp, tmp).replace(os.sep, "/").split("/")[-2:])
            hits = [r for r in ACC if r.endswith(tail)]
            if len(hits) != 1: diff.append(tail + " (not expected)"); continue
            seen.add(hits[0])
            if sha(lp) not in (ACC[hits[0]]["base"], ACC[hits[0]]["deploy"]): diff.append(hits[0])
    for r in ACC:
        if r not in seen: diff.append(r + " (not found live)")
    if diff:
        shutil.rmtree(KEEP, ignore_errors=True); shutil.copytree(tmp, KEEP)
        bad(f"the live {fn} is NOT the version on GitHub (" + ", ".join(sorted(set(diff))) + f"). Nothing was changed; the live copy is kept at {KEEP} for Claude.")
        shutil.rmtree(tmp, ignore_errors=True); done(5)
    shutil.rmtree(tmp, ignore_errors=True)
say("  ✓ the live coverage engine and PRN Team function are exactly GitHub's · gateway settings: "
    + ", ".join(f"{fn} {'on' if META[fn]['verify_jwt'] else 'off'}" for fn in FNS) + " (kept)")
ok, st = sql("""select (select count(*) from public.pay_tracks where track = 'prn_team')::int as prn,
  (select count(*) from public.pay_tracks where track = 'prn_team' and axiscare_caregiver_id is not null)::int as linked,
  (select count(*) from vault.decrypted_secrets where name = """ + lit(VAULT_NAME) + """)::int as vault""")
if not ok or not st: bad("could not read the database. Nothing was changed."); done(4)
S0 = st[0]
if S0["vault"] != 1: bad("the jobs' secret (S3) isn't there. Nothing was changed."); done(4)
say(f"  · PRN CNA Team now: {S0['prn']} on the team, {S0['linked']} linked to their caregiver record (only linked members can be matched to shifts)")

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(os.path.join(REPO, "prn3.sql")).read() + "\ncommit;")
if not ok: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
say("  ✓ the PRN shift record is in place (confirmed and backed-out shifts, only ever added to)")
for fn in FNS:
    vj = META[fn]["verify_jwt"]
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                       cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: bad(f"{fn}: deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Tell Claude."); done(6)
    sN, mN = fmeta(fn)
    if (mN or {}).get("verify_jwt") != vj: bad(f"{fn}: its gateway setting isn't as intended ({(mN or {}).get('verify_jwt')})")
    say(f"  ✓ {fn} deployed, now version {(mN or {}).get('version')} (was {META[fn].get('version')}), gateway setting kept")

say(); say("PART 3 · PROOF (nothing is sent, nothing is kept)")
PROOF = """do $proof$
declare dup text := ''; frozen text := ''; n int;
begin
  insert into public.prn_shift_log (axiscare_caregiver_id, case_id, kind, shift_date, recorded_by) values ('0', '357-practice', 'confirmed', current_date, 'Desktop 357');
  begin insert into public.prn_shift_log (axiscare_caregiver_id, case_id, kind, shift_date, recorded_by) values ('0', '357-practice', 'confirmed', current_date, 'Desktop 357');
  exception when others then dup := 'refused'; end;
  begin update public.prn_shift_log set kind = 'backed_out' where case_id = '357-practice'; exception when others then frozen := sqlerrm; end;
  select count(*) into n from public.prn_shift_log where case_id = '357-practice';
  raise exception 'PRN3_PROOF:%', jsonb_build_object('n', n, 'dup', dup, 'frozen', frozen)::text;
end $proof$;"""
s, b = sql_raw(PROOF)
try: msg = json.loads(b).get("message", "")
except Exception: msg = b or ""
P = None
if "PRN3_PROOF:" in msg:
    try: P = json.JSONDecoder().raw_decode(msg[msg.index("PRN3_PROOF:") + 11:])[0]
    except Exception: P = None
g = bool(P) and P.get("n") == 1 and P.get("dup") == "refused" and "HISTORY_IS_KEPT" in (P.get("frozen") or "")
(say if g else bad)(("  ✓ " if g else "") + "a practice shift record: kept once, never twice, never edited" + ("" if g else " · " + (json.dumps(P) if P else re.sub(r"\s+", " ", msg)[:240])))
ok, left = sql("select count(*)::int as n from public.prn_shift_log where case_id = '357-practice'")
(say if ok and left and left[0]["n"] == 0 else bad)(("  ✓ " if ok and left and left[0]["n"] == 0 else "") + "nothing from the practice was kept")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)}
except Exception: keys = {}
ANON, SVC = keys.get("anon", ""), keys.get("service_role", ""); HIDE += [ANON, SVC]
CR = f"{FNB}/functions/v1/coverage-run"
a1 = http("POST", CR + "?auth_check=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
a2 = http("POST", CR, {"action": "candidates", "case_id": "none"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
g = a1 == 401 and a2 in (401, 403)
(say if g else bad)(("  ✓ " if g else "") + f"the coverage engine refuses the public key: its schedule door {a1}, the list {a2}")
ok, rq = sql("select net.http_post(url := " + lit(CR + "?auth_check=1") + ", headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', "
             + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), body := '{}'::jsonb) as id")
got = None; waited = 0.0
while ok and rq and waited <= POLL_MAX:
    ok3, rr = sql(f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(POLL); waited += POLL
g = got and got["status_code"] == 200 and jget(got["content"], "caller") == "cron"
(say if g else bad)(("  ✓ " if g else "") + "its every-3-minutes schedule still gets in" + ("" if g else f" ({got['status_code'] if got else 'no answer'})"))
ok, cs = sql("""select x->>'id' as id from public.app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) x
  where a.key = 'coverage_cases' and x->>'status' = 'open' and coalesce(x->>'kind', '') <> 'interest' and coalesce(x->>'reason', '') <> 'open'
    and coalesce(x->'shift_pattern'->>'kind', '') <> 'open_ongoing' and coalesce(x->>'shift_date', '') >= to_char(now() at time zone 'America/Chicago', 'YYYY-MM-DD')
  order by x->>'shift_date' limit 1""")
if ok and cs:
    sC, bC = http("POST", CR, {"action": "candidates", "case_id": cs[0]["id"]}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
    try: jc = json.loads(bC)
    except Exception: jc = {}
    if sC == 200 and isinstance(jc.get("group1"), list) and "group0" in jc:
        say(f"  ✓ the list for the next open call-off or one-time shift (read only, nothing sent): PRN who fit {len(jc.get('group0') or [])} · "
            + f"PRN listed apart {len(jc.get('prn_other') or [])} · worked with the client {len(jc['group1'])} · others {len(jc.get('group2') or [])}")
    else: bad(f"could not build the list for an open shift ({sC})")
else: say("  · no open call-off or one-time shift right now to show the list on (that's fine)")
say()
say("RESULT: " + ("DONE · for call-offs and one-time shifts, PRN CNAs who fit are listed and asked first; confirmed and backed-out shifts go on their record." if not fails else "CHECK THE ✗ LINES."))
say("Rollback: redeploy coverage-run and prn-team from the commit before this one (Claude can); the shift record stays.")
done(0 if not fails else 8)
