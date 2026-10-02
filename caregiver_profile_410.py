#!/usr/bin/env python3
# 410 · CAREGIVER PROFILE, PART 2 SLICE 2B: BOTH FAMILY MESSAGES USE THE ONE CAREGIVER CARD. Samantha 2026-10-01.
# "Introduce your caregiver" and "caregiver change" now both link the ONE profile card (cc.mo-care.com/caregiver.html),
# which shows "Sarah T.", a big photo and their words. The older intro list (caregiver_intros, meet.html) is moved into
# caregiver_profiles; old meet.html links in families' phones forward to the new card. The automatic caregiver-change
# text stays exactly as automatic as today, only its link changes; "introduce" stays a person-pressed send.
# Part 1 (read only): reviewed builds (pinned), the pure tests (card-link rules, the change text) pass, the intro list
#   has the columns the move needs.
# Part 2: caregiver_profile_2b.sql in one transaction (3 columns, the move, AxisCare ids only where certain); then, one
#   function at a time, every function that is or includes a changed file, each only if its live copy is known code,
#   each keeping its own gateway (sign-in check) setting: caregiver-card (OFF, families have no sign-in),
#   caregiver-profile (OFF, the new hire's page), coverage-run / late-watch / late-alert (include the change text).
# Part 3 (proof, NO message is sent): how many intros were moved and how many already had a profile; the card answers
#   for a moved profile with "First L." and no private field; ?legacy= opens it from its old meet.html id; unpublished,
#   unknown and odd ids are 404.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, urllib.parse, datetime as dt, sys, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
BASE = os.environ.get("SB_BASE", ""); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co"); FIRST = ["caregiver-card", "caregiver-profile", "coverage-run", "late-watch", "late-alert"]
lines = []; fails = []
def say(s=""):
    s = str(s); s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-profile410/1.0"}, **(headers or {})))
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
shab = lambda b: hashlib.sha256(b).hexdigest()
sha = lambda p: shab(open(p, "rb").read())
def git(*a): return subprocess.run(["git", *a], cwd=REPO, capture_output=True)

def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
HIST = {}
def history(rel):  # every committed version of one file (sha256 of its bytes), so "known code" can be told from unknown
    if rel not in HIST:
        hs = set()
        for c in git("log", "--format=%H", "--", rel).stdout.decode().split():
            b = git("show", f"{c}:{rel}")
            if b.returncode == 0: hs.add(shab(b.stdout))
        if os.path.exists(os.path.join(REPO, rel)): hs.add(sha(os.path.join(REPO, rel)))
        HIST[rel] = hs
    return HIST[rel]

say("410 · CAREGIVER PROFILE 2B (ONE CARD FOR BOTH FAMILY MESSAGES)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not BASE or git("cat-file", "-e", BASE + "^{commit}").returncode != 0: bad("the reviewed starting point isn't in this folder's history"); say("  STOP. Nothing was run."); done(2)
changed = sorted(x for x in git("diff", "--name-only", BASE, "HEAD", "--", "supabase/functions").stdout.decode().split() if x.endswith(".ts") and os.path.exists(os.path.join(REPO, x)))
pinned = {(f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts"): v for k, v in SHAS.items()}
if set(changed) != set(pinned): bad("the list of changed files isn't the reviewed list"); say("  STOP. Nothing was run."); done(2)
for rel, want in pinned.items():
    if not os.path.exists(os.path.join(REPO, rel)) or sha(os.path.join(REPO, rel)) != want: bad(f"{rel.split('functions/')[1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say(f"  ✓ the {len(changed)} changed files are the reviewed builds")
SQLF = os.path.join(REPO, "caregiver_profile_2b.sql")
if sha(SQLF) != os.environ.get("SB_SQL_SHA", ""): bad("caregiver_profile_2b.sql is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the database change is the reviewed build")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for t in (["caregiver_profile_2b_test.mjs"], ["family_change_text_test.mjs", "supabase/functions/_shared/family-change-text.ts"]):
        p = subprocess.run([NODE, *t], cwd=REPO, capture_output=True, text=True, env=dict(os.environ, HUB="/nonexistent"))
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0: bad(f"{t[0]} failed: {last}"); say("  STOP. Nothing was run."); done(2)
        say(f"  ✓ {t[0]}: {last} (the card-link choice and the change text, proven without sending)")
else: say("  · node is not on this Mac, so the pure tests were not re-run here (they passed when built)")
users = []
for fn in sorted(os.listdir(FNROOT)):
    p = os.path.join(FNROOT, fn, "index.ts")
    if fn.startswith("_") or not os.path.exists(p): continue
    s = set(); deps(p, s)
    if any(os.path.normpath(os.path.join(REPO, c)) in s for c in changed): users.append(fn)
users = [f for f in FIRST if f in users] + [f for f in users if f not in FIRST]
say(f"  ✓ {len(users)} functions are or include a changed file ({', '.join(users)}); each is redeployed only if its live copy is known code")
ok, pre = sql("select (select count(*)::int from caregiver_intros) as intros, (select count(*)::int from caregiver_profiles) as profiles, "
              "(select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'caregiver_intros' "
              "and column_name in ('id', 'name', 'intro', 'about', 'photo_url')) as cols")
if not ok: bad("couldn't read the intro list or the profiles. Nothing was changed. Tell Claude: " + str(pre)[:160]); done(4)
if pre[0]["cols"] != 5: bad(f"the intro list doesn't have the 5 columns the move reads (found {pre[0]['cols']}). Nothing was changed. Tell Claude."); done(4)
say(f"  ✓ {pre[0]['intros']} intros in the older list, {pre[0]['profiles']} caregiver profiles today")

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(SQLF).read() + "\ncommit;")
if not ok: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Nothing else was changed. Tell Claude."); done(6)
ok, mv = sql("select count(*) filter (where legacy_intro_id is not null and needs_review)::int as moved, "
             "count(*) filter (where legacy_intro_id is not null and not needs_review)::int as had, "
             "count(*) filter (where legacy_intro_id is not null and needs_review and axiscare_id is not null)::int as ax, "
             "(select count(*)::int from caregiver_intros i where coalesce(btrim(i.name), '') <> '' and not exists "
             "(select 1 from caregiver_profiles p where p.legacy_intro_id = i.id::text)) as left_over from caregiver_profiles")
if ok:
    m = mv[0]
    say(f"  ✓ the profile columns are in; {m['moved']} intros became published profiles marked \"older: check it\" ({m['ax']} matched to their AxisCare id)")
    say(f"  ✓ {m['had']} intros already had a profile, so only the link was remembered (no duplicate)")
    if m["left_over"]: say(f"  · {m['left_over']} intros were left alone (same name as a withdrawn profile or as more than one profile); their old links still open the old card")
else: bad("the change went in but the counts couldn't be read: " + str(mv)[:160])

say(); say("PART 2b · THE FUNCTIONS (one at a time)")
deployed, already, skipped, absent = [], [], [], []
for fn in users:
    sM, m = fmeta(fn)
    if sM == 404: absent.append(fn); continue
    vj = (m or {}).get("verify_jwt")
    if not isinstance(vj, bool): skipped.append((fn, "couldn't read its gateway setting")); continue
    tmp = tempfile.mkdtemp(prefix="dnd383-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for root, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(root, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    mine = f"supabase/functions/{fn}/index.ts"
    if d.returncode != 0 or mine not in live: skipped.append((fn, "couldn't read its live copy")); continue
    if all(os.path.exists(os.path.join(REPO, k)) and h == sha(os.path.join(REPO, k)) for k, h in live.items()):
        already.append(fn); continue
    if live[mine] not in history(mine): skipped.append((fn, "its live code is not a reviewed GitHub version")); continue
    unknown = [k.split("supabase/functions/", 1)[1] for k, h in live.items() if k != mine and h not in history(k)]
    if unknown: skipped.append((fn, "live code not in GitHub: " + ", ".join(sorted(unknown))[:160])); continue
    newer = sorted(k.split("supabase/functions/", 1)[1] for k, h in live.items() if os.path.exists(os.path.join(REPO, k)) and h != sha(os.path.join(REPO, k))
                   and k not in changed and not k.endswith(f"/{fn}/index.ts"))
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                       cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    sN, mN = fmeta(fn)
    if p.returncode != 0: bad(f"{fn} didn't deploy: " + (p.stderr or p.stdout)[-200:]); continue
    if (mN or {}).get("verify_jwt") != vj:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{fn}", {"verify_jwt": vj}, MG()); sN, mN = fmeta(fn)
        if (mN or {}).get("verify_jwt") != vj: bad(f"{fn}: its gateway setting changed and couldn't be put back. Tell Claude."); continue
    deployed.append(fn); say(f"  ✓ {fn}" + (f" (also brought its shared files up to GitHub: {', '.join(newer)})" if newer else ""))
for fn in already: say(f"  ✓ {fn} already had it")
for fn in absent: say(f"  · {fn} is not deployed on the Hub (nothing to do)")
for fn, why in skipped: bad(f"{fn} NOT changed: {why}")

for fn in ("caregiver-card", "caregiver-profile"):
    s_, m_ = fmeta(fn)
    if s_ == 200 and (m_ or {}).get("verify_jwt") is not False: bad(f"{fn}: its sign-in check should be OFF (families and new hires have no sign-in) but reads {(m_ or {}).get('verify_jwt')}. Tell Claude.")

say(); say("PART 3 · PROOF (no message is sent)")
s_, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)}
except Exception: keys = {}
ANON = keys.get("anon", "")
HA = {"Authorization": "Bearer " + ANON, "apikey": ANON}
CARD = f"{FNB}/functions/v1/caregiver-card"
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
ALLOWED = {"id", "name", "first", "photo", "video", "experience", "years", "specialties", "about", "why"}
ok, one = sql("select id, first_name, last_name, preferred_name, legacy_intro_id, axiscare_id, candidate_id, upload_token from caregiver_profiles "
              "where published and status <> 'withdrawn' and legacy_intro_id is not null order by needs_review desc, updated_at desc limit 1")
if ok and one:
    p = one[0]
    s1, b1 = http("GET", f"{CARD}?id={p['id']}", None, HA)
    try: j1 = json.loads(b1)
    except Exception: j1 = {}
    first = (p.get("preferred_name") or p.get("first_name") or "").strip()
    li = re.sub(r"^[^A-Za-z]+", "", (p.get("last_name") or "").strip())[:1].upper()
    want = f"{first} {li}." if li else first
    leaks = [x for x in (p.get("axiscare_id"), p.get("candidate_id"), p.get("upload_token")) if x and str(x) in b1]
    chk(s1 == 200 and j1.get("name") == want and set(j1) <= ALLOWED and not leaks and not re.search(r"upload_token|axiscare|candidate|consent|last_name", b1),
        f"a moved profile's card answers with \"{want}\" and no private field ({s1})")
    s2, b2 = http("GET", f"{CARD}?legacy={urllib.parse.quote(str(p['legacy_intro_id']))}", None, HA)
    try: j2 = json.loads(b2)
    except Exception: j2 = {}
    chk(s2 == 200 and j2.get("id") == p["id"], f"its old meet.html id opens the same card through ?legacy= ({s2}), so old links in families' phones still work")
else: say("  · no published moved profile, so the card checks for one were skipped")
s3, _ = http("GET", f"{CARD}?id={__import__('uuid').uuid4()}", None, HA)
s4, _ = http("GET", f"{CARD}?legacy=no-such-intro-410", None, HA)
s5, _ = http("GET", f"{CARD}?id=not-an-id", None, HA)
chk(s3 == 404 and s4 == 404 and s5 == 404, f"an unknown card, an unknown old id and an odd id are each a 404 ({s3}, {s4}, {s5})")
ok, un = sql("select id, legacy_intro_id from caregiver_profiles where not published or status = 'withdrawn' order by updated_at desc limit 1")
if ok and un:
    s6, _ = http("GET", f"{CARD}?id={un[0]['id']}", None, HA)
    s7 = 404
    if un[0].get("legacy_intro_id"): s7, _ = http("GET", f"{CARD}?legacy={urllib.parse.quote(str(un[0]['legacy_intro_id']))}", None, HA)
    chk(s6 == 404 and s7 == 404, f"an unpublished or withdrawn profile is a 404, by id and by old id ({s6}, {s7})")
s8, _ = http("OPTIONS", CARD, None, {"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "GET"})
chk(s8 == 200, f"the browser pre-check (CORS) is answered ({s8})")
say()
if fails: say(f"RESULT: PARTLY DONE · {len(deployed)} redeployed, {len(already)} already had it; the ✗ lines above were left alone. Tell Claude.")
else: say(f"RESULT: DONE · {len(deployed)} redeployed, {len(already)} already had it. Push the Hub branch next (the Circles tab and the profile panel read the new columns).")
say("Nothing was texted or emailed by this installer. Rollback: Claude can redeploy the previous function versions; the moved profiles can be unpublished from the Hub.")
done(1 if fails else 0)
