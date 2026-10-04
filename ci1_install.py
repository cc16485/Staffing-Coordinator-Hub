#!/usr/bin/env python3
# 434 · CALL-INS CI1: THE SAFE FILL. Samantha approved the call-ins plan 2026-10-03 ("yes to all").
# Why: confirming who covers a call-in happened only in the browser, saving the page's whole copy of the case: two
# people confirming at once both "won" (in the Hub and in AxisCare), and an older copy could undo a fill or wipe a YES.
# What changes (the shared Hub project):
#   ci1.sql: the coverage case guard (closed stays closed unless deliberately reopened, the first close wins, every
#     caregiver's answer is kept), the one-case patch (one confirm wins) and the ask reservation (nobody asked twice).
#   coverage-assign: confirm and close on the server, office staff only (it used to accept any signed-in account);
#     AxisCare is changed only where nobody else is on the visit (_shared/coverage-fill.ts).
#   coverage-run: a coordinator's send records each ask before the text (no double asks) and applies the caregiver
#     night rule on the server.
# Part 1 (read only): the reviewed builds (pinned), the tests pass here, ci1.sql is the reviewed file.
# Part 2: ci1.sql (one transaction); then each function redeployed only if its live copy is GitHub's (the reviewed
#   base) or already this build, keeping its gateway setting.
# Part 3 (proof; NOTHING is sent, NO real case is touched): the live copies are the reviewed build; outsiders are
#   refused; the guard and the one-winner confirm are proven inside a transaction that is always undone.
# Prints counts only.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
REF = "zngsgedlsxinbygwmxwn"
ROOT = os.environ["SB_REPO"]; BASE = os.environ.get("SB_BASE", "")
SHAS = json.loads(os.environ["SB_SHAS"])
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FIRST = ["coverage-assign", "coverage-run"]
NEW = set()                                # both exist
TESTS = ["ci1_test.mjs", "prn3_coverage_test.mjs", "axiscare_change_wiring_test.mjs", "nsf2_scheduling_test.mjs", "j1_job_locks_test.mjs",
         "quiet_hours_425_test.mjs", "optout_0b3_test.mjs", "late_l1_test.mjs"]
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=150):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-ci1/1.0"}, **(headers or {})))
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
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def keys():
    """The project's keys. Lesson from 412: ask with ?reveal=true first, then without it. A value that isn't a usable
    key counts as missing."""
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
shab = lambda b: hashlib.sha256(b).hexdigest()
sha = lambda p: shab(open(p, "rb").read())
def git(*a): return subprocess.run(["git", *a], cwd=ROOT, capture_output=True)
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)

def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
pinpath = lambda k: f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts"
def deps_of(fn):
    s = set(); deps(os.path.join(ROOT, f"supabase/functions/{fn}/index.ts"), s)
    return {os.path.relpath(x, ROOT).replace(os.sep, "/") for x in s}

def reviewed():
    if not BASE or git("cat-file", "-e", BASE + "^{commit}").returncode != 0: bad("the reviewed starting point isn't in this folder's history"); say("  STOP. Nothing was run."); done(2)
    changed = sorted(x for x in git("diff", "--name-only", BASE, "HEAD", "--", "supabase/functions").stdout.decode().split() if x.endswith(".ts") and os.path.exists(os.path.join(ROOT, x)))
    pinned = {pinpath(k): v for k, v in SHAS.items()}
    if not pinned or not set(pinned) <= set(changed): bad(f"the reviewed files aren't all changed here ({', '.join(sorted(set(pinned) - set(changed)))[:200]})"); say("  STOP. Nothing was run."); done(2)
    for rel, want in pinned.items():
        if sha(os.path.join(ROOT, rel)) != want: bad(f"{rel.split('functions/')[1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
    fnroot = os.path.join(ROOT, "supabase/functions"); users = []
    for fn in sorted(os.listdir(fnroot)):
        p = os.path.join(fnroot, fn, "index.ts")
        if fn.startswith("_") or not os.path.exists(p): continue
        used = {os.path.relpath(x, ROOT).replace(os.sep, "/") for x in (lambda s: (deps(p, s), s)[1])(set())}
        if used & set(pinned): users.append((fn, used))
    # Another change merged since (another branch): fine only when none of the functions this updates uses it.
    extra = sorted(set(changed) - set(pinned))
    touch = sorted({e for e in extra for fn, used in users if e in used})
    if touch: bad(f"other changes merged since the review touch these functions ({', '.join(touch)[:200]}). Ask Claude to refresh 433."); say("  STOP. Nothing was run."); done(2)
    names = [fn for fn, _ in users]
    say(f"  ✓ the {len(pinned)} changed file(s) are the reviewed build" + (f" (other merged changes don't touch them: {', '.join(e.split('functions/')[1] for e in extra)[:160]})" if extra else ""))
    say(f"  ✓ functions to update ({len(names)}): {', '.join(names)}")
    return [f for f in FIRST if f in names] + [f for f in names if f not in FIRST]

def live_files(fn):
    tmp = tempfile.mkdtemp(prefix="ci1-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for root, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(root, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live

def base_sha(rel):
    b = git("show", f"{BASE}:{rel}")
    return shab(b.stdout) if b.returncode == 0 else None

def is_reviewed_live(fn):
    okd, live = live_files(fn)
    if not okd: return False, "couldn't read the live copy"
    need = deps_of(fn)
    missing = [k for k in need if k not in live]
    if missing: return False, "live copy is missing " + ", ".join(sorted(k.split("functions/", 1)[1] for k in missing))
    off = [k for k in need if live[k] != sha(os.path.join(ROOT, k))]
    return (not off), ("" if not off else "live differs in " + ", ".join(sorted(k.split("functions/", 1)[1] for k in off)))

def deploy(fn):
    sM, m = fmeta(fn)
    if sM == 404 and fn in NEW:
        p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"], cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        good, _ = is_reviewed_live(fn)
        if not good: bad(f"{fn} didn't deploy: " + (p.stderr or p.stdout)[-200:]); return False
        sN, mN = fmeta(fn)
        if (mN or {}).get("verify_jwt") is not True:
            http("PATCH", f"{API}/v1/projects/{REF}/functions/{fn}", {"verify_jwt": True}, MG()); sN, mN = fmeta(fn)
            if (mN or {}).get("verify_jwt") is not True: bad(f"{fn}: its gateway sign-in check is not on. Tell Claude."); return False
        say(f"  ✓ {fn} created, version {(mN or {}).get('version', '?')} (gateway sign-in check on; it also checks the staff sign-in itself)")
        return True
    if sM == 404: bad(f"{fn} is not deployed. Tell Claude."); return False
    if fn in NEW and not is_reviewed_live(fn)[0]:
        bad(f"{fn} already exists and is not this build (unexpected), NOT changed. Tell Claude."); return False
    vj = (m or {}).get("verify_jwt")
    if not isinstance(vj, bool): bad(f"{fn}: couldn't read its gateway setting, NOT changed"); return False
    okd, live = live_files(fn)
    mine = f"supabase/functions/{fn}/index.ts"
    if not okd or mine not in live: bad(f"{fn}: couldn't read its live copy, NOT changed"); return False
    need = deps_of(fn)
    if all(k in live and live[k] == sha(os.path.join(ROOT, k)) for k in need):
        say(f"  ✓ {fn} already had it"); return True
    if live[mine] != base_sha(mine) and live[mine] != sha(os.path.join(ROOT, mine)):
        bad(f"{fn}: its live code is not today's GitHub main (was something else deployed?), NOT changed"); return False
    pinned = {pinpath(k) for k in SHAS}
    # A shared file this build newly imports is not in the live copy yet: fine when it is unchanged GitHub code
    # (same at the reviewed base and now). Anything present but different still stops. (433b, 2026-10-03: ghl-call-link
    # now imports job-auth.ts; the same fix 432's installer got in #173.)
    other = [k.split("supabase/functions/", 1)[1] for k in need if k != mine and k not in pinned
             and ((k in live and live[k] != sha(os.path.join(ROOT, k))) or (k not in live and base_sha(k) != sha(os.path.join(ROOT, k))))]
    if other: bad(f"{fn}: live shared code differs from GitHub ({', '.join(sorted(other))[:160]}), NOT changed"); return False
    odd = [k.split("supabase/functions/", 1)[1] for k in need if k != mine and k in pinned and k in live and live[k] not in (base_sha(k), sha(os.path.join(ROOT, k)))]
    if odd: bad(f"{fn}: its live {', '.join(sorted(odd))} is neither today's GitHub main nor this build, NOT changed"); return False
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                       cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0:
        # Lesson from 394: a deploy can answer 500 'internal error' and still have gone through. Look before calling it failed.
        good, _ = is_reviewed_live(fn)
        if not good: bad(f"{fn} didn't deploy: " + (p.stderr or p.stdout)[-200:]); return False
        say(f"  · {fn}: the deploy answered with an error, but the live copy IS the reviewed build")
    sN, mN = fmeta(fn)
    if (mN or {}).get("verify_jwt") != vj:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{fn}", {"verify_jwt": vj}, MG()); sN, mN = fmeta(fn)
        if (mN or {}).get("verify_jwt") != vj: bad(f"{fn}: its gateway setting changed and couldn't be put back. Tell Claude."); return False
    say(f"  ✓ {fn} deployed, now version {(mN or {}).get('version', '?')} (was {(m or {}).get('version', '?')}; gateway sign-in check kept {'on' if vj else 'off'})")
    return True



SQL_SHA = os.environ.get("SB_SQL_SHA", "")
say("434 · CALL-INS: THE SAFE FILL (CI1)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
order = reviewed()
sqlp = os.path.join(ROOT, "ci1.sql")
if not os.path.exists(sqlp) or sha(sqlp) != SQL_SHA: bad("ci1.sql is not the reviewed file"); say("  STOP. Nothing was run."); done(2)
say("  ✓ ci1.sql is the reviewed file")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for t in TESTS:
        p = subprocess.run([NODE, t], cwd=ROOT, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or "FAIL" in last or re.search(r"^FAIL", p.stdout, re.M): bad(f"{t} failed: {last}"); say("  STOP. Nothing was run."); done(2)
        say(f"  ✓ {t}: {last.strip()} (run here, against fakes; nothing sent)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
K = keys(); ANON, SERVICE = K.get("anon", ""), K.get("service_role", "")
HIDE += [ANON, SERVICE]
if not ANON or not SERVICE: bad("couldn't read the project's keys. Nothing was changed."); done(3)
ok, cc = sql("select count(*)::int as n, count(*) filter (where x->>'status' = 'open')::int as open from app_data, jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) x where key = 'coverage_cases'")
if not ok: bad("couldn't read the coverage cases (counts). Nothing was changed."); done(3)
say(f"  ✓ coverage cases on file: {cc[0]['n']} ({cc[0]['open']} open)")

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(sqlp).read() + "\ncommit;")
if not ok: bad("ci1.sql didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. The functions were NOT updated. Tell Claude."); done(6)
ok, fx = sql("""select (select count(*) from pg_proc where proname in ('coverage_case_patch','coverage_case_add_ask','coverage_case_remove_ask','coverage_cases_guard','coverage_asks_merge'))::int as fns,
  (select count(*) from pg_trigger where tgname = 'coverage_cases_guard_t' and not tgisinternal)::int as trg,
  has_function_privilege('authenticated', 'public.coverage_case_patch(text, jsonb, jsonb)', 'execute') as auth_can,
  has_function_privilege('anon', 'public.coverage_case_add_ask(text, jsonb)', 'execute') as anon_can,
  has_function_privilege('service_role', 'public.coverage_case_patch(text, jsonb, jsonb)', 'execute') as svc_can""")
g = ok and fx and fx[0]["fns"] == 5 and fx[0]["trg"] == 1 and not fx[0]["auth_can"] and not fx[0]["anon_can"] and fx[0]["svc_can"]
chk(g, "the guard, the one-case patch and the ask reservation are in place (the server only can call them)" + ("" if g else f" ({fx})"))
if not g: say("  STOP before updating the functions. Tell Claude."); done(6)
went = [fn for fn in order if deploy(fn)]

say(); say("PART 3 · PROOF (nothing is sent; no real case is touched)")
for fn in went:
    good, why = is_reviewed_live(fn)
    chk(good, f"{fn}: the live copy is exactly the reviewed build" + ("" if good else f" ({why})"))
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
FN = lambda n: f"{FNB}/functions/v1/{n}"
s1 = http("POST", FN("coverage-assign"), {"action": "confirm", "case_id": "x", "covered_by": "x"}, {})[0]
s2 = http("POST", FN("coverage-assign"), {"action": "confirm", "case_id": "x", "covered_by": "x"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
chk(s1 == 401 and s2 == 401, f"coverage-assign refuses no key ({s1}) and the public key, not office staff ({s2})")
s3, b3 = http("POST", FN("coverage-assign"), {"action": "confirm", "case_id": "ci1-proof-no-such-case", "covered_by": "Nobody"}, {"apikey": ANON, "Authorization": "Bearer " + SERVICE})
chk(s3 == 404, f"coverage-assign's new confirm answers (a case that isn't there: {s3}; nothing touched)")
s4 = http("POST", FN("coverage-run"), {"action": "send_selected", "case_id": "x", "recipients": ["x"]}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
chk(s4 in (401, 403), f"coverage-run refuses a send from the public key ({s4})")
PROOF = """do $p$
declare stale jsonb; f jsonb; r1 jsonb; r2 jsonb; a1 text; a2 text; out jsonb := '{}'::jsonb;
begin
  update app_data set data = coalesce(data, '[]'::jsonb) || '[{"id":"ci1_proof","status":"open","client":"Proof","asked":[{"id":"pa1","name":"Proof One","phone":"4170000001","state":"waiting"}]}]'::jsonb
   where key = 'coverage_cases';
  select x into stale from app_data, jsonb_array_elements(data) x where key = 'coverage_cases' and x->>'id' = 'ci1_proof';
  f := jsonb_set(stale, '{asked,0}', (stale->'asked'->0) || '{"state":"yes","replied_at":"2026-10-04T00:00:00Z"}'::jsonb);
  perform upsert_app_data_item('coverage_cases', f);
  perform upsert_app_data_item('coverage_cases', stale || '{"note":"older copy"}'::jsonb);
  select x into f from app_data, jsonb_array_elements(data) x where key = 'coverage_cases' and x->>'id' = 'ci1_proof';
  out := out || jsonb_build_object('yes_kept', f->'asked'->0->>'state' = 'yes' and f->>'note' = 'older copy');
  r1 := coverage_case_patch('ci1_proof', '{"status":"done","resolved_how":"covered","covered_by":"Proof One","resolved_at":"2026-10-04T00:01:00Z"}'::jsonb, '{"status":"open"}'::jsonb);
  r2 := coverage_case_patch('ci1_proof', '{"status":"done","resolved_how":"covered","covered_by":"Proof Two","resolved_at":"2026-10-04T00:01:30Z"}'::jsonb, '{"status":"open"}'::jsonb);
  out := out || jsonb_build_object('first_confirm_wins', r1->>'outcome' = 'ok' and r2->>'outcome' = 'conflict');
  perform upsert_app_data_item('coverage_cases', stale);
  select x into f from app_data, jsonb_array_elements(data) x where key = 'coverage_cases' and x->>'id' = 'ci1_proof';
  out := out || jsonb_build_object('fill_not_undone', f->>'status' = 'done' and f->>'covered_by' = 'Proof One');
  perform upsert_app_data_item('coverage_cases', f || jsonb_build_object('status', 'open', 'covered_by', null, 'resolved_at', null, 'reopened_from', f->>'resolved_at'));
  a1 := coverage_case_add_ask('ci1_proof', '{"id":"pa2","name":"Proof Two","phone":"4170000002","at":"t"}'::jsonb);
  a2 := coverage_case_add_ask('ci1_proof', '{"id":"pa3","name":"Proof Two","phone":"(417) 000-0002","at":"t"}'::jsonb);
  out := out || jsonb_build_object('reopen_ok', a1 = 'added', 'asked_once', a2 = 'already_asked');
  raise exception 'CI1_PROOF:%', out;
end $p$;"""
sP, bP = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": PROOF}, MG())
try: r = json.loads(bP).get("message", "") if bP.strip().startswith("{") else bP
except Exception: r = bP
m = re.search(r"CI1_PROOF:(\{[^{}]*\})", str(r).replace('\\"', '"'))
res = json.loads(m.group(1)) if m else {}
words = {"yes_kept": "an older copy saved after a YES keeps the YES", "first_confirm_wins": "two confirms: the first wins, the second is told it's taken",
         "fill_not_undone": "an older copy can't undo a fill", "reopen_ok": "a deliberate reopen goes through", "asked_once": "the same caregiver can't be asked twice on one case"}
if not res: bad("the guard proof didn't answer: " + str(r)[:200])
for k, w in words.items():
    if res: chk(res.get(k) is True, w + " (proven inside a transaction that was undone)")
ok, lg = sql("select count(*)::int as n from coverage_case_guard_log where case_id = 'ci1_proof'")
chk(ok and lg and lg[0]["n"] == 0, "the proof left nothing behind")

say()
if fails: say("RESULT: PARTLY DONE · the ✗ lines above need Claude.")
else: say("RESULT: DONE · confirming and closing a call-in now happen on the server, one winner, no lost YES. Next: merge the Hub branch ci1-safe-fill (cc-hub-live), so the board's Pick and Close use it.")
say("Nothing was texted, emailed or called, and no real coverage case was changed by this installer.")
say("Rollback: Claude redeploys coverage-assign and coverage-run from the previous commit; the guard can be dropped (drop trigger coverage_cases_guard_t) with nothing else to undo.")
done(0 if not fails else 8)
