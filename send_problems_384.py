#!/usr/bin/env python3
# 384 · NO SILENT FAILURES. Samantha, 2026-10-01: "NO SILENT FAILURES" / "yes build it".
# Every text or email that is held back (the opt-out check said no, or could not check) or that GoHighLevel refuses
# now raises a "Didn't go through" card on Needs Attention (_shared/send-problems.ts): who, which message, why, next step.
# It also carries 383's Do Not Disturb fix, so it can be run whether or not 383 was.
# Part 1 (read only): the reviewed builds.
# Part 2: every function that uses the shared check is redeployed ONE AT A TIME and ONLY when its live copy is known
#   code: its own index.ts is GitHub's current one or the one at BASE (the last reviewed version before this change),
#   and every other file in the live copy is a version that exists in GitHub's history. Anything else is listed and
#   left alone. Each function's gateway (sign-in) setting is kept exactly as it was.
# Part 3: the catch-up. A temporary helper turns every text or email held back since Sep 24 into a card (nothing is
#   sent), then is deleted.
# Part 4 (proof): the helper refuses the public key; the open "didn't go through" cards (counts only).
# Prints counts and function names only: no name, number, email, key or secret.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
BASE = os.environ.get("SB_BASE", ""); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co"); HELPER = "send-problems-catchup"
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-nsf384/1.0"}, **(headers or {})))
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

say("384 · NO SILENT FAILURES"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
for name in ("_shared/optout", "_shared/outreach", "_shared/send-problems", "interview-messages", "reference-chase", HELPER):
    p = os.path.join(FNROOT, name + ".ts") if name.startswith("_shared/") else os.path.join(FNROOT, name, "index.ts")
    if not os.path.exists(p) or sha(p) != SHAS.get(name): bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
if not BASE or git("cat-file", "-e", BASE + "^{commit}").returncode != 0: bad("the reviewed starting point isn't in this folder's history"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the shared check, the new card step, the two senders and the catch-up helper are the reviewed builds")
users = []
for fn in sorted(os.listdir(FNROOT)):
    p = os.path.join(FNROOT, fn, "index.ts")
    if fn.startswith("_") or not os.path.exists(p): continue
    s = set(); deps(p, s)
    if fn != HELPER and os.path.normpath(os.path.join(FNROOT, "_shared/optout.ts")) in s: users.append(fn)
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
    if all(os.path.exists(os.path.join(REPO, k)) and h == sha(os.path.join(REPO, k)) for k, h in live.items()) and "supabase/functions/_shared/send-problems.ts" in live:
        already.append(fn); continue
    b = git("show", f"{BASE}:{mine}")
    if live[mine] not in (sha(os.path.join(REPO, mine)), shab(b.stdout) if b.returncode == 0 else ""): skipped.append((fn, "its live code is not a reviewed GitHub version")); continue
    unknown = [k.split("supabase/functions/", 1)[1] for k, h in live.items() if k != mine and h not in history(k)]
    if unknown: skipped.append((fn, "live code not in GitHub: " + ", ".join(sorted(unknown))[:160])); continue
    newer = sorted(k.split("supabase/functions/", 1)[1] for k, h in live.items() if os.path.exists(os.path.join(REPO, k)) and h != sha(os.path.join(REPO, k))
                   and not k.endswith(("_shared/optout.ts", "_shared/outreach.ts")) and not k.endswith(f"/{fn}/index.ts"))
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
miss = [f for f in FIRST if f not in deployed and f not in already]
if miss: bad("these senders still have the old check: " + ", ".join(miss))

say(); say("PART 3 · THE CATCH-UP (nothing is sent)")
p = subprocess.run([SUPA, "functions", "deploy", HELPER, "--project-ref", REF, "--use-api"], cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
s_, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)}
except Exception: keys = {}
ANON, SVC = keys.get("anon", ""), keys.get("service_role", "")
URL = f"{FNB}/functions/v1/{HELPER}"
if p.returncode != 0 or not ANON or not SVC: bad("the catch-up helper didn't go up, so last week's held-back messages have no cards yet. Tell Claude.")
else:
    s1, _ = http("POST", URL, {}, {"Authorization": "Bearer " + ANON, "apikey": ANON})
    (say if s1 == 401 else bad)(("  ✓ " if s1 == 401 else "") + f"the helper refuses the public key ({s1})")
    if s1 == 401:
        s2, b2 = http("POST", URL + "?dry=1", {}, {"Authorization": "Bearer " + SVC, "apikey": SVC})
        try: j = json.loads(b2)
        except Exception: j = {}
        if s2 != 200: bad(f"the practice count didn't run ({s2})")
        else:
            say(f"  · practice count: {j.get('refusals')} held-back messages since Sep 24 → {j.get('cards')} cards ({j.get('named')} with a name)")
            for k, v in sorted((j.get("by_sender") or {}).items(), key=lambda x: -x[1]): say(f"      {k}: {v}")
            s3, b3 = http("POST", URL, {}, {"Authorization": "Bearer " + SVC, "apikey": SVC})
            (say if s3 == 200 else bad)(("  ✓ the cards are on Needs Attention" if s3 == 200 else f"the catch-up didn't finish ({s3}). Tell Claude."))
http("DELETE", f"{API}/v1/projects/{REF}/functions/{HELPER}", headers=MG())
sD, _ = fmeta(HELPER)
(say if sD == 404 else bad)(("  ✓ the temporary helper is removed" if sD == 404 else "the temporary helper is still there; tell Claude"))

say(); say("PART 4 · PROOF")
ok, r = sql("""select count(*) filter (where i->>'kind' = 'send_problem' and coalesce(i->>'status','open') not in ('done','resolved'))::int as open_cards
  from app_data, jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) i where key = 'ops_items'""")
if ok and r: say(f"  · open \"Didn't go through\" cards on Needs Attention: {r[0]['open_cards']}")
ok, r = sql(f"""select count(*)::int as n,
  count(*) filter (where reasons::text ilike '%could not check GHL Do Not Disturb%')::int as unk
  from contact_send_refusal where id > {int(mark)}""")
if ok and r: say(f"  · held back since the redeploy started: {r[0]['n']} (of those 'could not check Do Not Disturb': {r[0]['unk']})")
say("  · next: Krystal sends Cythenia's orientation invite again")
say()
if fails: say(f"RESULT: PARTLY DONE · {len(deployed)} redeployed, {len(already)} already had it; the ✗ lines above were left alone. Tell Claude.")
else: say(f"RESULT: DONE · {len(deployed)} redeployed, {len(already)} already had it. Open Needs Attention to see the cards.")
say("Rollback: Claude can redeploy the previous versions; the cards are ordinary Needs Attention items (close them with Done).")
done(1 if fails else 0)
