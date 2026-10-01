#!/usr/bin/env python3
# 375 · REFERENCES R1–R5, server side. Samantha approved 2026-10-01 ("yes to all"). 375a proved online answers never
# saved (0 of 20). Part 1 (read only): reviewed builds. Part 2: refs_r1r5.sql (new answer columns, the reference_answer()
# save step, anon table access removed, hire_intake.no_employer_history); redeploy reference-chase (links carry the
# reference type; gateway setting kept). Part 3 (proof): a THROWAWAY request row is answered through the public key exactly
# as the form will, read back, refused a second time, then deleted. Sends nothing to anyone.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, time, uuid
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip(); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); SUPA = os.environ.get("SB_SUPA_CLI", "")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def http(method, url, body=None, headers=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-375/1.0"}, **(headers or {})))
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
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def src(n): return os.path.join(REPO, n) if n.endswith(".sql") else os.path.join(FNROOT, n, "index.ts")
say("375 · REFERENCES: TWO QUESTION SETS + ONLINE ANSWERS SAVE"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
for n, w in SHAS.items():
    if sha(src(n)) != w: bad(f"{n} is not the reviewed build. Nothing was run."); done(2)
if set(SHAS) != {"refs_r1r5.sql", "reference-chase"}: bad("the reviewed list is incomplete"); done(2)
sR, mR = fmeta("reference-chase"); vj = (mR or {}).get("verify_jwt")
if sR != 200 or not isinstance(vj, bool): bad("couldn't read reference-chase. Nothing was changed."); done(4)
say("  ✓ the reviewed builds · reference-chase is installed")
say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(src("refs_r1r5.sql")).read() + "\ncommit;")
if not ok: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); done(6)
say("  ✓ new answer columns, the one-time save step for the online form, and no other public access to the reference table")
p = subprocess.run([SUPA, "functions", "deploy", "reference-chase", "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                   cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("reference-chase deploy failed: " + (p.stderr or p.stdout)[-200:])
else:
    s2, m2 = fmeta("reference-chase")
    (say if (m2 or {}).get("verify_jwt") == vj else bad)(("  ✓ " if (m2 or {}).get("verify_jwt") == vj else "") + "reference-chase updated: its emails link to the right questions (gateway setting kept)")
say(); say("PART 3 · PROOF (a throwaway request; nothing is sent)")
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)}
except Exception: keys = {}
ANON = keys.get("anon", ""); HIDE.append(ANON); H = {"apikey": ANON, "Authorization": "Bearer " + ANON}
TID = str(uuid.uuid4())
ok, _ = sql(f"insert into public.reference_requests (id, candidate_id, slot, candidate_name, ref_name, ref_type, ref_company) values ('{TID}', -375, 1, 'Proof 375', 'Proof Reference', 'professional', 'Proof Co')")
if not ok: bad("couldn't make the throwaway row"); done(8)
time.sleep(float(os.environ.get("SB_SETTLE", "3")))
ans = {"recommend": "yes", "responder_name": "Proof Person", "responder_title": "Manager", "employer_confirmed": "Proof Co", "emp_from": "March 2023",
       "emp_to": "present", "job_title": "Caregiver", "hours_type": "full", "rehire": "policy", "reliability": "Good", "concerns": "none"}
s1, b1 = http("POST", f"{FNB}/rest/v1/rpc/reference_answer", {"p_id": TID, "p_answers": ans}, H)
ok, row = sql(f"select recommend, rehire, job_title, responded_at is not null as done from public.reference_requests where id = '{TID}'")
g = s1 == 200 and b1.strip().strip('"') == "saved" and ok and row and row[0]["done"] and row[0]["rehire"] == "policy" and row[0]["job_title"] == "Caregiver"
(say if g else bad)(("  ✓ " if g else "") + f"an online answer SAVES now, through the public key exactly as the form sends it ({s1} {b1.strip()[:30]})")
s2, b2 = http("POST", f"{FNB}/rest/v1/rpc/reference_answer", {"p_id": TID, "p_answers": {"recommend": "no", "responder_name": "Someone"}}, H)
ok, row2 = sql(f"select recommend from public.reference_requests where id = '{TID}'")
g = s2 == 200 and "already" in b2 and ok and row2 and row2[0]["recommend"] == "yes"
(say if g else bad)(("  ✓ " if g else "") + "a second answer on the same link is refused and changes nothing")
s3, b3 = http("POST", f"{FNB}/rest/v1/rpc/reference_answer", {"p_id": str(uuid.uuid4()), "p_answers": ans}, H)
(say if "not_found" in b3 else bad)(("  ✓ " if "not_found" in b3 else "") + "a made-up link is 'not found'")
s4, b4 = http("GET", f"{FNB}/rest/v1/reference_requests?select=id&limit=1", None, H)
g = s4 != 200 or b4.strip() in ("[]", "")
(say if g else bad)(("  ✓ " if g else "") + f"the public can't read the reference table ({s4})")
ok, _ = sql(f"delete from public.reference_requests where id = '{TID}'")
ok2, left = sql(f"select count(*)::int as n from public.reference_requests where candidate_id = -375")
(say if ok and ok2 and left[0]["n"] == 0 else bad)(("  ✓ " if ok and ok2 and left[0]["n"] == 0 else "") + "the throwaway row is deleted")
say()
say("RESULT: " + ("DONE · online reference answers save now (with the new questions once the Hub update is merged), and reference emails link to the right questions." if not fails else "CHECK THE ✗ LINES."))
done(0 if not fails else 8)
