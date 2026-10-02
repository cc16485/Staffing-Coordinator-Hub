#!/usr/bin/env python3
# 409 · CAREGIVER PROFILE, PART 2 SLICE 2A: ONE PROFILE IN ONBOARDING. Samantha 2026-10-01.
# The office drafts the profile with AI before the welcome call, reads it to them on the call, sends their personal
# photo link (photo required, video optional), and publishes it once the photo is in. The same profile is reachable
# from the employee's page for as long as they work here.
# Part 1 (read only): reviewed builds; the profile table and its public bucket are there.
# Part 2: caregiver_profile_2a.sql in one transaction (new columns, AND it closes two gaps: anonymous visitors could
#   add rows to caregiver_profiles and upload files to the caregiver-profiles bucket); the new caregiver-profile
#   function (sign-in check OFF at the gateway, because the new hire's page has no sign-in; the office actions check
#   the signed-in staff member themselves); the guarded one-at-a-time redeploy of every function that includes a
#   changed shared file (send-problems.ts: the new sender's words for Needs Attention cards).
# Part 3 (proof): the public key can no longer add a profile, upload a file or list the bucket; the family card still
#   works; the new function refuses office actions without sign-in; an unknown link is a 404; a throwaway profile with
#   a known token opens, gets a signed upload link, saves words, and is removed. No message is ever sent.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
BASE = os.environ.get("SB_BASE", ""); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co"); HELPER = "caregiver-profile"
FIRST = []
FIRST = ["outreach-check", "interview-messages", "reference-chase", "send-candidate-message", "applicant-invite", "reference-send"]
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-profile409/1.0"}, **(headers or {})))
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

say("409 · CAREGIVER PROFILE (ONBOARDING + EMPLOYEE PAGE)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not BASE or git("cat-file", "-e", BASE + "^{commit}").returncode != 0: bad("the reviewed starting point isn't in this folder's history"); say("  STOP. Nothing was run."); done(2)
changed = sorted(x for x in git("diff", "--name-only", BASE, "HEAD", "--", "supabase/functions").stdout.decode().split() if x.endswith(".ts") and os.path.exists(os.path.join(REPO, x)))
pinned = {(f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts"): v for k, v in SHAS.items()}
if set(changed) != set(pinned): bad("the list of changed files isn't the reviewed list"); say("  STOP. Nothing was run."); done(2)
for rel, want in pinned.items():
    if not os.path.exists(os.path.join(REPO, rel)) or sha(os.path.join(REPO, rel)) != want: bad(f"{rel.split('functions/')[1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say(f"  ✓ the {len(changed)} changed files are the reviewed builds")
users = []
for fn in sorted(os.listdir(FNROOT)):
    p = os.path.join(FNROOT, fn, "index.ts")
    if fn.startswith("_") or not os.path.exists(p): continue
    s = set(); deps(p, s)
    if fn != HELPER and any(os.path.normpath(os.path.join(REPO, c)) in s for c in changed): users.append(fn)
users = [f for f in FIRST if f in users] + [f for f in users if f not in FIRST]
ok, before = sql("select coalesce(max(id), 0)::bigint as id from contact_send_refusal")
if not ok: bad("couldn't read the refusal log. Nothing was changed."); done(4)
mark = before[0]["id"]
say(f"  ✓ {len(users)} functions include a changed file; each is redeployed only if its live copy is known code")

ok, pre = sql("select (select count(*)::int from caregiver_profiles) as n, (select count(*)::int from storage.buckets where id = 'caregiver-profiles' and public) as b")
if not ok: bad("couldn't read the profile table or the bucket. Nothing was changed. Tell Claude: " + str(pre)[:160]); done(4)
if pre[0]["b"] != 1: bad("the caregiver-profiles bucket is missing or not public. Nothing was changed. Tell Claude."); done(4)
say(f"  ✓ the profile table is there ({pre[0]['n']} profiles today) and its photo bucket is public")
SQLF = os.path.join(REPO, "caregiver_profile_2a.sql")
if sha(SQLF) != os.environ.get("SB_SQL_SHA", ""): bad("caregiver_profile_2a.sql is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the database change is the reviewed build")

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(SQLF).read() + "\ncommit;")
if not ok: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Nothing else was changed. Tell Claude."); done(6)
say("  ✓ the profile columns are in, and the public can no longer add profiles or upload files")
NEWFN = "caregiver-profile"
p = subprocess.run([SUPA, "functions", "deploy", NEWFN, "--project-ref", REF, "--use-api", "--no-verify-jwt"], cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
sN, mN = fmeta(NEWFN)
if p.returncode != 0 and sN != 200: bad("the caregiver-profile step didn't deploy: " + (p.stderr or p.stdout)[-200:])
else:
    if (mN or {}).get("verify_jwt") is not False:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{NEWFN}", {"verify_jwt": False}, MG()); sN, mN = fmeta(NEWFN)
    if (mN or {}).get("verify_jwt") is not False: bad(f"the caregiver-profile step's gateway check should be OFF (the new hire's page has no sign-in) but reads {(mN or {}).get('verify_jwt')}")
    else: say("  ✓ the caregiver-profile step (draft, send link, publish; the new hire's page) is up; office actions check sign-in themselves")
say(); say("PART 2b · THE REST (one function at a time)")
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
    b = git("show", f"{BASE}:{mine}")
    if live[mine] not in (sha(os.path.join(REPO, mine)), shab(b.stdout) if b.returncode == 0 else ""): skipped.append((fn, "its live code is not a reviewed GitHub version")); continue
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

say(); say("PART 3 · PROOF (no message is sent)")
s_, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)}
except Exception: keys = {}
ANON = keys.get("anon", "")
HA = {"Authorization": "Bearer " + ANON, "apikey": ANON}
B = f"{FNB}/rest/v1"; FN = f"{FNB}/functions/v1/{NEWFN}"
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
# gap 1: the table
s1, _ = http("POST", f"{B}/caregiver_profiles", {"first_name": "Proof 409"}, dict(HA, Prefer="return=minimal"))
chk(s1 in (401, 403), f"the public can no longer add a profile ({s1})")
if s1 in (200, 201): sql("delete from caregiver_profiles where first_name = 'Proof 409'")
s2, b2 = http("GET", f"{B}/caregiver_profiles?select=id&limit=1", None, HA)
chk(s2 in (401, 403) or (s2 == 200 and b2.strip() == "[]"), f"the public cannot read profiles ({s2})")
# gap 2: the bucket
req = urllib.request.Request(f"{FNB}/storage/v1/object/caregiver-profiles/proof-409/x.png", data=b"\x89PNG\r\n", method="POST",
                             headers=dict(HA, **{"Content-Type": "image/png", "User-Agent": "cc-profile409/1.0"}))
try:
    with urllib.request.urlopen(req, timeout=60) as r: s3 = r.status
except urllib.error.HTTPError as e: s3 = e.code
except Exception as e: s3 = None
chk(s3 is not None and s3 not in (200, 201), f"the public can no longer upload into the photo bucket ({s3})")
if s3 in (200, 201): bad("a test file proof-409/x.png is in the bucket: tell Claude so it can be removed")
s4, b4 = http("POST", f"{FNB}/storage/v1/object/list/caregiver-profiles", {"prefix": "", "limit": 5}, HA)
chk(s4 != 200 or b4.strip() == "[]", f"the public cannot list the photo bucket ({s4})")
# the family card still works
ok, pub = sql("select id, photo_path from caregiver_profiles where published and status <> 'withdrawn' order by updated_at desc limit 1")
if ok and pub:
    s5, b5 = http("GET", f"{FNB}/functions/v1/caregiver-card?id={pub[0]['id']}", None, HA)
    g = s5 == 200 and '"name"' in b5
    if g and pub[0].get("photo_path"):
        s6, _ = http("GET", f"{FNB}/storage/v1/object/public/caregiver-profiles/{pub[0]['photo_path']}", None, {})
        g = s6 == 200
    chk(g, f"a published family card still opens, photo included ({s5})")
else: say("  · no published profile yet, so the family card check was skipped")
# the new function
s7, _ = http("POST", FN, {"action": "draft", "candidate_id": "proof-409", "first": "Proof"}, HA)
s8, _ = http("POST", FN, {"action": "send_link", "profile_id": "00000000-0000-4000-8000-000000000000", "dry": True}, HA)
chk(s7 == 401 and s8 == 401, f"the caregiver-profile step refuses office actions without an office sign-in ({s7}, {s8})")
s9, _ = http("POST", FN, {"action": "mine", "t": str(__import__("uuid").uuid4())}, HA)
chk(s9 == 404, f"an unknown personal link is a friendly 404 ({s9})")
s10, _ = http("OPTIONS", FN, None, {"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})
chk(s10 == 200, f"the browser pre-check (CORS) is answered ({s10})")
T = str(__import__("uuid").uuid4())
ok, ins = sql(f"insert into caregiver_profiles (first_name, last_name, candidate_id, upload_token, about) values ('Proof', 'Test', 'proof-409', '{T}', '[ask: proof]') returning id")
if not ok: bad("couldn't make the throwaway profile: " + str(ins)[:160])
else:
    pid = ins[0]["id"]
    try:
        s11, b11 = http("POST", FN, {"action": "mine", "t": T}, HA)
        chk(s11 == 200 and '"first_name": "Proof"' in b11.replace('":"', '": "') and "upload_token" not in b11 and "proof-409" not in b11,
            f"the throwaway profile opens by its personal link, without its token or candidate id ({s11})")
        s12, b12 = http("POST", FN, {"action": "upload_url", "t": T, "kind": "photo", "ext": "jpg"}, HA)
        try: j12 = json.loads(b12)
        except Exception: j12 = {}
        chk(s12 == 200 and str(j12.get("path", "")).startswith(pid + "/photo-") and j12.get("signed_url"), f"it gets a one-time signed upload link inside its own folder ({s12})")
        s13, b13 = http("POST", FN, {"action": "submit", "t": T, "about": "Proof words", "consent": False}, HA)
        ok14, r14 = sql(f"select about, submitted_at is not null as sub from caregiver_profiles where id = '{pid}'")
        chk(s13 == 200 and ok14 and r14 and r14[0]["about"] == "Proof words" and r14[0]["sub"], f"it saves words from the page ({s13})")
    finally:
        sql(f"delete from caregiver_profiles where id = '{pid}'")
        ok15, r15 = sql(f"select count(*)::int as n from caregiver_profiles where id = '{pid}'")
        chk(ok15 and r15[0]["n"] == 0, "the throwaway profile is removed")
ok, after = sql("select (select count(*)::int from pg_policies where tablename = 'caregiver_profiles' and 'anon' = any(roles)) as anon_pol, "
                "(select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'cgp_%' and ('anon' = any(roles) or 'public' = any(roles))) as file_pol, "
                "has_table_privilege('anon', 'public.caregiver_profiles', 'INSERT') as anon_ins")
chk(ok and after[0]["anon_pol"] == 0 and after[0]["file_pol"] == 0 and after[0]["anon_ins"] is False, "no profile or photo-bucket rule mentions the public any more")
say()
if fails: say(f"RESULT: PARTLY DONE · {len(deployed)} redeployed, {len(already)} already had it; the ✗ lines above were left alone. Tell Claude.")
else: say(f"RESULT: DONE · {len(deployed)} redeployed, {len(already)} already had it. Open a welcome call card and press Caregiver profile.")
say("Rollback: Claude can redeploy the previous versions. The two closed gaps should stay closed; the old no-sign-in profile form is replaced by the personal-link page.")
done(1 if fails else 0)
