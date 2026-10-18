#!/usr/bin/env python3
# 941 · NO TWO-PERSON TRANSFERS. Samantha 2026-10-18 (plan https://claude.ai/artifact/W9WetxzBTJz7s8utoMfSkZ, "1 ask it (needs
#   a lift before we staff), 2 approved with the added Level 3 sentence"): caregivers never do two-person transfers; a client who
#   needs more than one person to transfer must have a lift.
#   Runs BEFORE the Hub change merges, so the family app and the matching report never pause:
#     1. approves the Hub's new matching rulebook (match-rules.js 1.3.0) ahead of time; the one the Hub serves today stays approved
#     2. the care-need label "Needs: two-person transfers" is turned off (never deleted) and "Needs more than one person to
#        transfer" (yes / no) is added; it STOPS first if any client record uses the old label
#     3. the eleven server services that carry the Step 1 wording are redeployed with her approved words (application v5,
#        experience v3); nothing else in them changes (it stops if anything else would)
#   Part 1 read only, Part 2 change, Part 3 proof. Never texts or emails anyone.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
REF = "zngsgedlsxinbygwmxwn"
REPO = os.environ["SB_REPO"]; BASE = os.environ.get("SB_BASE", "")
SHAS = json.loads(os.environ["SB_SHAS"])                    # {repo-relative path: sha256} of the reviewed server files
HUB = os.environ["SB_HUB"]                                  # a fresh copy of the Hub at the reviewed commit
RULES_FP = os.environ["SB_RULES_FP"]                        # sha256 of the reviewed match-rules.js (1.3.0)
SITE = os.environ.get("SB_HUB_SITE", "https://cc.mo-care.com")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
OLD_KIND, NEW_KIND = "need_two_person_transfers", "need_more_than_one_to_transfer"
NEW_LABEL = "Needs more than one person to transfer"
FNS = ["caregiver-export", "caregiver-journey", "driver-compliance", "hire-profile", "match-dark", "offer-sign", "reference-send",
       "reference-tasks", "step1-sign", "step2-handoff", "welcome-call"]   # every service that bundles _shared/step1-documents.ts
WORDING = "supabase/functions/_shared/step1-documents.ts"
TESTS = ["step1_two_person_test.mjs", "step1_documents_558_test.mjs", "step1_experience_test.mjs", "step1_sign_2b_test.mjs",
         "lpn_hiring_708_test.mjs", "practice_scenarios_test.mjs"]
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
def http(method, url, body=None, headers=None, timeout=200, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-941/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            b = r.read(); return r.status, (b if raw else b.decode(errors="replace"))
    except urllib.error.HTTPError as e: return e.code, (b"" if raw else e.read().decode(errors="replace"))
    except Exception as e: return None, (b"" if raw else type(e).__name__)
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
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
def git(root, *a): return subprocess.run(["git", *a], cwd=root, capture_output=True)
def lit(v): return "'" + str(v).replace("'", "''") + "'"
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    src = "\n".join(l for l in open(path).read().split("\n") if not re.match(r"\s*import\s+type\b", l))
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", src):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def closure(start):
    s = set(); deps(os.path.join(REPO, start), s)
    return {os.path.relpath(x, REPO).replace(os.sep, "/") for x in s}
need = lambda fn: closure(f"supabase/functions/{fn}/index.ts")
ALLOWED = closure(WORDING)          # the wording file and what it imports: the only files this step may change in a service
def live_files(fn):
    for i in range(3):
        tmp = tempfile.mkdtemp(prefix="cl941-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
        d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        live = {}
        for r, _, files in os.walk(tmp):
            for f in files:
                lp = os.path.join(r, f).replace(os.sep, "/")
                if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
        shutil.rmtree(tmp, ignore_errors=True)
        if d.returncode == 0 and live: return True, live
        time.sleep(float(os.environ.get("SB_POLL", "3")) * (i + 1))
    return False, {}
HIST = {}
def history_shas(rel):
    if rel in HIST: return HIST[rel]
    out = set()
    for c in git(REPO, "log", "--format=%H", "HEAD", "--", rel).stdout.decode().split():
        b = git(REPO, "show", f"{c}:{rel}")
        if b.returncode == 0: out.add(shab(b.stdout))
    HIST[rel] = out; return out
def state(fn):
    """('this' | 'older' | 'new' | 'unreadable' | 'other', gateway setting, odd files, files this deploy would change)"""
    s, m = fmeta(fn)
    if s == 404: return "new", None, [], []
    vj = (m or {}).get("verify_jwt")
    okd, live = live_files(fn)
    if not okd or not isinstance(vj, bool): return "unreadable", vj, [], []
    nd = need(fn)
    differ = sorted(k for k in nd if live.get(k) != sha(os.path.join(REPO, k)))
    if not differ: return "this", vj, [], []
    odd = [k for k in nd if k in live and live[k] != sha(os.path.join(REPO, k)) and live[k] not in history_shas(k)]
    odd += [k for k in live if k.endswith((".ts", ".js")) and k not in nd and live[k] not in history_shas(k)]
    return ("older" if not odd else "other"), vj, odd, differ
def deploy(fn, vj):
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if vj in (True, None) else ["--no-verify-jwt"]), cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, live = live_files(fn)
    if not (okd and all(live.get(k) == sha(os.path.join(REPO, k)) for k in need(fn))): bad(f"{fn} didn't deploy: " + (p.stderr or p.stdout)[-200:]); return False
    want = True if vj is None else vj
    sN, mN = fmeta(fn)
    if (mN or {}).get("verify_jwt") != want:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{fn}", {"verify_jwt": want}, MG()); sN, mN = fmeta(fn)
    chk((mN or {}).get("verify_jwt") == want, f"{fn} deployed, version {(mN or {}).get('version', '?')} (gateway sign-in check {'on' if want else 'off'})")
    return True

say("941 · NO TWO-PERSON TRANSFERS"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
# the reviewed builds
if not BASE or git(REPO, "cat-file", "-e", BASE + "^{commit}").returncode != 0: bad("the reviewed starting point isn't in the server's history"); say("  STOP. Nothing was run."); done(2)
changed = set(git(REPO, "diff", "--name-only", BASE, "HEAD").stdout.decode().split())
for rel, want in SHAS.items():
    if rel not in changed or not os.path.exists(os.path.join(REPO, rel)) or sha(os.path.join(REPO, rel)) != want:
        bad(f"the server: {rel.split('/')[-1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
for fn in FNS:
    other = sorted(k for k in need(fn) if k not in SHAS and k in changed)
    if other: bad(f"other changes merged since the review touch {fn} ({', '.join(other)[:200]}). Ask Claude to refresh 941."); say("  STOP. Nothing was run."); done(2)
say("  ✓ the Step 1 wording is the reviewed build (application v5, experience v3, her approval of 2026-10-18)")
mr = os.path.join(HUB, "match-rules.js")
if not os.path.exists(mr) or sha(mr) != RULES_FP: bad("the Hub's new matching rulebook is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say(f"  ✓ the Hub's new matching rulebook is the reviewed build (1.3.0, {RULES_FP[:12]})")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
pg = os.environ.get("PGLITE") or os.path.expanduser("~/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js")
if NODE:
    for root, t in [(HUB, "tests/match-rules-test.js")] + [(REPO, t) for t in TESTS]:
        p = subprocess.run([NODE, t], cwd=root, capture_output=True, text=True, env=dict(os.environ, PGLITE=pg))
        last = [x for x in p.stdout.strip().splitlines() if re.search(r"\d+/\d+ passed|\d+ passed, \d+ failed", x)] or (p.stdout.strip().splitlines() or ["(no output)"])
        if p.returncode != 0: bad(f"{t.split('/')[-1]} failed: {last[-1][:200]}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t.split('/')[-1]}: {last[-1].strip()}")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
# the approved rulebooks and what the Hub serves today
ok, ap = sql("select sha256 from public.rules_approved where file = 'match-rules.js' order by approved_at desc")
if not ok: bad(f"couldn't read the approved rules list ({ap})"); done(3)
apset = {r["sha256"] for r in ap}
s, b = http("GET", f"{SITE}/match-rules.js?v=941{int(time.time())}", raw=True)
live_fp = shab(b) if s == 200 else None
if not live_fp: bad(f"couldn't read the Hub's matching rulebook ({s}). Nothing was changed."); done(3)
if live_fp == RULES_FP: say("  · the Hub already serves the new rulebook" + ("" if RULES_FP in apset else " (NOT approved yet: the family app and the matching report are paused until Part 2)"))
elif live_fp in apset: say(f"  ✓ the Hub serves today's rulebook ({live_fp[:12]}), approved; it stays approved")
else: bad(f"the Hub serves a rulebook nobody approved ({live_fp[:12]}), not this change. Nothing was changed. Tell Claude."); done(3)
# the care-need labels: nobody may be recorded with the old one
ok, r = sql(f"select (select count(*) from public.client_fact where kind = {lit(OLD_KIND)})::int as used, "
            f"(select active from public.fact_kind where kind = {lit(OLD_KIND)}) as old_active, "
            f"(select row_to_json(k) from (select label, fact_group, value_shape, choices, layers, active from public.fact_kind where kind = {lit(NEW_KIND)}) k) as new_row")
if not ok: bad(f"couldn't read the care-need labels ({r})"); done(3)
x = r[0]
if int(x["used"]): bad(f"{x['used']} client record(s) use \"Needs: two-person transfers\". Nothing was changed. Tell Claude (they need a look first)."); done(3)
say("  ✓ nobody is recorded with \"Needs: two-person transfers\" (0 client records)")
if x["old_active"] is None: bad("the label need_two_person_transfers isn't there. Nothing was changed. Tell Claude."); done(3)
nr = x["new_row"]
if isinstance(nr, str): nr = json.loads(nr)
WANT_NEW = {"label": NEW_LABEL, "fact_group": "care_needs", "value_shape": "choice", "choices": ["yes", "no"], "layers": ["intake", "assessment", "plan", "current"]}
if nr and any(nr.get(k) != v for k, v in WANT_NEW.items()): bad(f"a label {NEW_KIND} already exists and is different. Nothing was changed. Tell Claude."); done(3)
say("  · the old label is " + ("on (will be turned off)" if x["old_active"] else "already off") + "; the new one is " + ("already there" if nr else "new"))
# the services
STATES = {}
for fn in FNS:
    st, vj, odd, differ = state(fn)
    if st not in ("older", "this"): bad(f"{fn} on the server is not a build from GitHub ({st}{': ' + ', '.join(odd)[:160] if odd else ''}). Nothing was changed. Tell Claude."); done(3)
    extra = [k for k in differ if k not in ALLOWED]
    if extra: bad(f"{fn}: redeploying would also change {', '.join(e.split('functions/')[-1] for e in extra)[:200]} (not part of this step). Nothing was changed. Tell Claude."); done(3)
    STATES[fn] = (st, vj); say(f"  ✓ {fn}: " + ("already this build" if st == "this" else "only the Step 1 wording changes"))
K = keys(); ANON = K.get("anon", ""); HIDE += [ANON, K.get("service_role", "")]
if not ANON: bad("couldn't read the Hub's public key. Nothing was changed."); done(3)

say(); say("PART 2 · CHANGE")
ok, r = sql(f"insert into public.rules_approved (file, sha256, note) values ('match-rules.js', {lit(RULES_FP)}, '941 no two-person transfers: match-rules 1.3.0 (her OK 2026-10-18)') "
            "on conflict (file, sha256) do update set approved_at = now(), note = excluded.note")
if not ok: bad(f"couldn't approve the new rulebook ({r}). Nothing else was changed."); done(4)
say(f"  ✓ the new matching rulebook ({RULES_FP[:12]}) is approved; today's stays approved")
ok, r = sql(f"""begin;
do $g$ begin if exists (select 1 from public.client_fact where kind = {lit(OLD_KIND)}) then raise exception 'a client record uses the old label'; end if; end $g$;
insert into public.fact_kind (kind, label, fact_group, value_shape, choices, layers, must_verify, created_by)
  values ({lit(NEW_KIND)}, {lit(NEW_LABEL)}, 'care_needs', 'choice', '["yes","no"]'::jsonb, '{{intake,assessment,plan,current}}', false, 'no_two_person_941')
  on conflict (kind) do nothing;
update public.fact_kind set active = false where kind = {lit(OLD_KIND)} and active;
commit;""")
if not ok: bad(f"the care-need labels weren't changed ({r}). Tell Claude before merging anything."); done(4)
say("  ✓ \"Needs: two-person transfers\" is off (kept, not deleted); \"Needs more than one person to transfer\" is on")
for fn in FNS:
    st, vj = STATES[fn]
    if st == "this": say(f"  ✓ {fn} already had it"); continue
    if not deploy(fn, vj): say("  STOP. Tell Claude."); done(6)
time.sleep(float(os.environ.get("SB_SETTLE", "10")))

say(); say("PART 3 · PROOF")
ok, r = sql("select sha256 from public.rules_approved where file = 'match-rules.js'")
have = {x["sha256"] for x in r} if ok else set()
chk(RULES_FP in have and live_fp in have, "approved now: the new rulebook and the one the Hub serves today (no pause either way)")
ok, r = sql(f"select kind, active from public.fact_kind where kind in ({lit(OLD_KIND)}, {lit(NEW_KIND)}) order by kind")
kv = {x["kind"]: x["active"] for x in r} if ok else {}
chk(kv.get(OLD_KIND) is False and kv.get(NEW_KIND) is True, "the labels: two-person off, more than one person to transfer on")
for fn in FNS:
    okd, live = live_files(fn)
    chk(okd and all(live.get(k) == sha(os.path.join(REPO, k)) for k in need(fn)), f"{fn}: the live copy is exactly the reviewed build")
VIS = {"apikey": ANON, "Authorization": "Bearer " + ANON}
s1, b1 = http("POST", f"{FNB}/functions/v1/step1-sign", {"action": "preview"}, VIS)
try: j1 = json.loads(b1)
except Exception: j1 = {}
forms = {f.get("key"): f for f in (j1.get("forms") or []) if isinstance(f, dict)}
words = json.dumps(j1.get("skill_groups") or []) + json.dumps(forms.get("experience") or {})
chk(s1 == 200 and (forms.get("employee_application") or {}).get("version") == 5 and (forms.get("experience") or {}).get("version") == 3
    and not re.search(r"two.?person", words, re.I) and "One caregiver per visit: a client who needs more than one person to transfer must have a lift." in words,
    f"the Step 1 preview shows the application v5 and the experience form v3, with no two-person transfers and the new Level 3 sentence ({s1})")
s2, b2 = http("POST", f"{FNB}/functions/v1/step1-sign", {"action": "preview", "approval_check": [{"form": "employee_application", "version": 5}, {"form": "experience", "version": 3}, {"form": "employee_application", "version": 4}]}, VIS)
try: ac = json.loads(b2).get("approval_check") or []
except Exception: ac = []
chk(s2 == 200 and len(ac) == 3 and ac[0].get("accepted") is True and ac[1].get("accepted") is True and ac[2].get("accepted") is False,
    "real applicants can sign the new versions (and not the old application)")
SVC = K.get("service_role", "")
if SVC:
    s3, b3 = http("POST", f"{FNB}/functions/v1/match-dark?rules_check=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
    try: j3 = json.loads(b3)
    except Exception: j3 = {}
    chk(s3 == 200 and j3.get("all_approved") is True, "the matching report accepts the rulebook the Hub serves now")
say()
say("RESULT: " + ("DONE · now Claude merges the Hub change; the server already accepts its rulebook, so nothing pauses." if not fails else "PARTLY DONE · the ✗ lines above need Claude. Don't merge the Hub change yet."))
say("Nothing was texted or emailed. No client or caregiver record was changed.")
say("Rollback: Claude turns the old label back on and the new one off, and redeploys the eleven services from the build before 941.")
done(0 if not fails else 8)
