#!/usr/bin/env python3
# 383 · THE DO NOT DISTURB FIX. Samantha asked 2026-10-01 (Cythenia's orientation invite: "GHL failed to send on all channels").
# 382 proved the cause: GoHighLevel's contact answer has no `dnd` key unless DND is on, and the shared opt-out check
# (_shared/optout.ts) treated that as "could not check" and refused (interview reminders, reference emails, training
# invites, job offers...). The fix: a contact read back by a successful GET of that exact contact counts as checked.
# Part 1 (read only): the reviewed build of the shared check.
# Part 2: every function that uses the check is redeployed, ONE AT A TIME, and ONLY when its live copy is known code:
#   its own index.ts exactly GitHub's, and every other file in the live copy a version that exists in GitHub's history
#   (so nothing unknown is ever overwritten). Anything else is listed and left alone. Each function's gateway
#   (sign-in) setting is kept exactly as it was.
# Part 3 (proof; nothing is sent): the refusal log since the redeploy (counts only).
# Prints counts and function names only: no name, number, email, key or secret.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-dnd383/1.0"}, **(headers or {})))
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

say("383 · THE DO NOT DISTURB FIX"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if sha(os.path.join(FNROOT, "_shared/optout.ts")) != SHAS.get("_shared/optout"): bad("the shared check is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the shared opt-out check is the reviewed build")
users = []
for fn in sorted(os.listdir(FNROOT)):
    p = os.path.join(FNROOT, fn, "index.ts")
    if fn.startswith("_") or not os.path.exists(p): continue
    s = set(); deps(p, s)
    if os.path.normpath(os.path.join(FNROOT, "_shared/optout.ts")) in s: users.append(fn)
users = [f for f in FIRST if f in users] + [f for f in users if f not in FIRST]
if not set(FIRST) <= set(users): bad("the list of functions that use the check is missing one it should have. Nothing was changed."); done(2)
ok, before = sql("select coalesce(max(id), 0)::bigint as id from contact_send_refusal")
if not ok: bad("couldn't read the refusal log. Nothing was changed."); done(4)
mark = before[0]["id"]
say(f"  ✓ {len(users)} functions use the check; each is redeployed only if its live copy is known code")

say(); say("PART 2 · CHANGE (one function at a time)")
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
    if live.get("supabase/functions/_shared/optout.ts") == SHAS["_shared/optout"]: already.append(fn); continue
    if live[mine] != sha(os.path.join(REPO, mine)): skipped.append((fn, "its live code is not GitHub's current version")); continue
    unknown = [k.split("supabase/functions/", 1)[1] for k, h in live.items() if k != mine and h not in history(k)]
    if unknown: skipped.append((fn, "live code not in GitHub: " + ", ".join(sorted(unknown))[:160])); continue
    newer = sorted(k.split("supabase/functions/", 1)[1] for k, h in live.items() if os.path.exists(os.path.join(REPO, k)) and h != sha(os.path.join(REPO, k)) and not k.endswith("_shared/optout.ts"))
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                       cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    sN, mN = fmeta(fn)
    if p.returncode != 0: bad(f"{fn} didn't deploy: " + (p.stderr or p.stdout)[-200:]); continue
    if (mN or {}).get("verify_jwt") != vj:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{fn}", {"verify_jwt": vj}, MG()); sN, mN = fmeta(fn)
        if (mN or {}).get("verify_jwt") != vj: bad(f"{fn}: its gateway setting changed and couldn't be put back. Tell Claude."); continue
    deployed.append(fn); say(f"  ✓ {fn}" + (f" (also brought its shared files up to GitHub: {', '.join(newer)})" if newer else ""))
for fn in already: say(f"  ✓ {fn} already had the fix")
for fn in absent: say(f"  · {fn} is not deployed on the Hub (nothing to do)")
for fn, why in skipped: bad(f"{fn} NOT changed: {why}")
miss = [f for f in FIRST if f not in deployed and f not in already]
if miss: bad("these senders still have the old check: " + ", ".join(miss))

say(); say("PART 3 · PROOF (nothing is sent)")
ok, r = sql(f"""select count(*)::int as n,
  count(*) filter (where reasons::text ilike '%could not check GHL Do Not Disturb%')::int as unk
  from contact_send_refusal where id > {int(mark)}""")
if ok and r: say(f"  · refusals logged since the redeploy started: {r[0]['n']} (of those 'could not check GHL Do Not Disturb': {r[0]['unk']})")
else: say("  · couldn't read the refusal log (the redeploy above still stands)")
say("  · next: Krystal sends Cythenia's orientation invite again")
say()
if fails: say(f"RESULT: PARTLY DONE · {len(deployed)} redeployed with the fix, {len(already)} already had it; the ✗ lines above were left alone. Tell Claude.")
else: say(f"RESULT: DONE · {len(deployed)} redeployed with the fix, {len(already)} already had it. Have Krystal resend Cythenia's invite.")
say("Rollback: Claude can redeploy the previous shared check; nothing in the database was changed.")
done(1 if fails else 0)
