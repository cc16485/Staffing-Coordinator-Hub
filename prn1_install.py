#!/usr/bin/env python3
# PRN1 · THE PRN CNA TEAM, RECRUITING (Desktop 352). Samantha approved 2026-09-29 ("yes to all").
# Part 1 (read only): the reviewed builds; the live interview-messages is exactly GitHub (prn1_accept.json; stops and
#   keeps a copy otherwise); the tables are there; the screen trigger is there; the PRN role and posting names are free
#   (or already PRN, from an earlier run).
# Part 2: prn1.sql in one transaction (new columns, the PRN save, the pay guard, the PRN screen, the role). Nothing
#   already live is replaced. Then interview-messages is deployed (gateway setting kept).
# Part 3 (proof; nothing is kept and nothing is sent): three practice applications inside a transaction that is
#   undone: a good PRN one (refused without the pay tick, then cleared the screen with the role's wording stored),
#   one under a year (needs a look), a caregiver one (exactly as before). The public key can read the role and call
#   the PRN save; the interview texts refuse outsiders, let their schedule in, and a practice run works.
# Part 4: only if everything above passed, the always-on posting is published (prn1_posting.sql). The website's job
#   page follows at its next hourly build.
# Prints counts only: no name, number, email, key or secret.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time, tempfile, shutil, uuid
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "40"))
KEEP = os.environ.get("SB_KEEP_DIR", os.path.expanduser("~/Claude/prn1-live-copy"))
VAULT_NAME = "hub_job_secret"; FN = "interview-messages"
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
def http(method, url, body=None, headers=None, timeout=150):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-prn1/1.0"}, **(headers or {})))
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
    try: j = json.loads(b) if s == 200 else None
    except Exception: j = None
    return s, j
def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def src_path(name):
    if not name.startswith("_shared/") and "/" not in name and not name.endswith((".json", ".sql")): return os.path.join(FNROOT, name, "index.ts")
    if name.startswith("_shared/"): return os.path.join(FNROOT, name + ".ts")
    return os.path.join(REPO, name)

say("PRN1 · THE PRN CNA TEAM, RECRUITING"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
need = {FN, "_shared/job-auth", "_shared/optout", "_shared/staff-auth", "prn1.sql", "prn1_posting.sql", "prn1_accept.json"}
badb = False
for name, want in SHAS.items():
    p = src_path(name)
    if not os.path.exists(p) or sha(p) != want: bad(f"{name} is not the reviewed build"); badb = True
if badb or not need <= set(SHAS): say("  STOP. Nothing was run."); done(2)
say("  ✓ the database change, the posting, the interview texts and the comparison list are the reviewed builds")
s1, m1 = fmeta(FN)
if s1 != 200 or not isinstance((m1 or {}).get("verify_jwt"), bool): bad("could not read the interview texts' settings. Nothing was changed."); done(4)
VJ = m1["verify_jwt"]
ACC = json.load(open(os.path.join(REPO, "prn1_accept.json")))[FN]["files"]
tmp = tempfile.mkdtemp(prefix="prn1-live-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
d = subprocess.run([SUPA, "functions", "download", FN, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if d.returncode != 0: bad("could not download the live interview texts to compare. Nothing was changed."); done(4)
diff, seen = [], set()
for root, _, files in os.walk(tmp):
    for f in files:
        if not f.endswith(".ts"): continue
        lp = os.path.join(root, f); tail = "/".join(os.path.relpath(lp, tmp).replace(os.sep, "/").split("/")[-2:])
        hits = [r for r in ACC if r.endswith(tail)]
        if len(hits) != 1: diff.append(tail + " (not expected)"); continue
        seen.add(hits[0]); h = sha(lp)
        if h not in (ACC[hits[0]]["base"], ACC[hits[0]]["deploy"]): diff.append(hits[0])
for r in ACC:
    if r not in seen: diff.append(r + " (not found live)")
if diff:
    shutil.rmtree(KEEP, ignore_errors=True); shutil.copytree(tmp, KEEP)
    bad("the live interview texts are NOT the version on GitHub (" + ", ".join(sorted(set(diff))) + f"). Nothing was changed; the live copy is kept at {KEEP} for Claude.")
    shutil.rmtree(tmp, ignore_errors=True); done(5)
shutil.rmtree(tmp, ignore_errors=True)
say(f"  ✓ the live interview texts are exactly GitHub's · gateway sign-in check {'on' if VJ else 'off'} (kept)")
ok, st = sql("""select to_regclass('public.job_positions') is not null as positions, to_regclass('public.job_postings') is not null as postings,
  to_regclass('public.job_applicants') is not null as applicants,
  exists (select 1 from pg_trigger where tgrelid = 'public.job_applicants'::regclass and tgname = 'applicant_screen_after' and not tgisinternal) as screen,
  (select coalesce(json_agg(tgname order by tgname), '[]'::json) from pg_trigger where tgrelid = 'public.job_applicants'::regclass and not tgisinternal) as triggers,
  exists (select 1 from public.job_positions where key = 'prn_cna') as role_there,
  (select to_jsonb(p)->>'track' from public.job_positions p where key = 'prn_cna') as role_track,
  exists (select 1 from public.job_postings where slug = 'prn-cna-springfield') as post_there,
  (select to_jsonb(j)->>'position' from public.job_postings j where slug = 'prn-cna-springfield') as post_position,
  (select count(*) from vault.decrypted_secrets where name = """ + lit(VAULT_NAME) + """)::int as vault""")
if not ok or not st: bad("could not read the database. Nothing was changed. " + str(st)[:200]); done(4)
S0 = st[0]
if not (S0["positions"] and S0["postings"] and S0["applicants"]): bad("the recruiting tables aren't all there (unexpected). Nothing was changed."); done(4)
if not S0["screen"]: bad("the applicant screen's trigger isn't there (unexpected). Nothing was changed."); done(4)
if S0["role_there"] and S0["role_track"] != "prn": bad("a role called prn_cna already exists and isn't the PRN one (unexpected). Nothing was changed."); done(4)
if S0["post_there"] and S0["post_position"] != "prn_cna": bad("a posting at prn-cna-springfield already exists for something else (unexpected). Nothing was changed."); done(4)
if S0["vault"] != 1: bad("the jobs' secret (S3) isn't there. Nothing was changed."); done(4)
trig = S0["triggers"] if isinstance(S0["triggers"], list) else json.loads(S0["triggers"] or "[]")
later = [t for t in trig if t > "zz_applicant_screen_prn" and not t.startswith("zz_applicant_screen_prn")]
if later: bad("another trigger on applications would run after the PRN screen (unexpected). Nothing was changed."); done(4)
say(f"  ✓ the recruiting tables and the applicant screen are there ({len(trig)} trigger{"s" if len(trig) != 1 else ""} on applications) · the PRN role and posting names are "
    + ("already PRN (an earlier run)" if S0["role_there"] or S0["post_there"] else "free"))

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(os.path.join(REPO, "prn1.sql")).read() + "\ncommit;")
if not ok: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok, v = sql("""select exists (select 1 from pg_proc where proname = 'apply_prn_save') as save, exists (select 1 from pg_proc where proname = 'prn_clean') as clean,
  exists (select 1 from pg_trigger where tgname = 'applicant_prn_pay_guard') as guard, exists (select 1 from pg_trigger where tgname = 'zz_applicant_screen_prn') as screen,
  (select track from public.job_positions where key = 'prn_cna') as track, (select pay_ack_version from public.job_positions where key = 'prn_cna') as ver,
  (select pay_min from public.job_positions where key = 'prn_cna')::float as pay""")
V = v[0] if ok and v else {}
if V.get("save") and V.get("clean") and V.get("guard") and V.get("screen") and V.get("track") == "prn" and V.get("ver") == "PRN-PAY-2026-09" and V.get("pay") == 20:
    say("  ✓ the database: PRN answers and the pay acceptance have their place, the pay guard and the PRN screen are on, the role PRN CNA Team ($20, PRN-PAY-2026-09) is there")
else: bad("the database isn't as intended: " + json.dumps(V)[:240])
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"] + ([] if VJ else ["--no-verify-jwt"]),
                   cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad(f"{FN}: deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Tell Claude."); done(6)
sN, mN = fmeta(FN)
if (mN or {}).get("verify_jwt") != VJ: bad(f"{FN}: its gateway setting isn't as intended ({(mN or {}).get('verify_jwt')})")
say(f"  ✓ the interview texts deployed, now version {(mN or {}).get('version')} (was {m1.get('version')}), gateway setting kept")

say(); say("PART 3 · PROOF (practice applications, all undone; nothing is sent)")
PROOF = """do $proof$
declare a uuid; b uuid; c uuid; refused boolean := false; outv jsonb;
  shared jsonb := '{"age_ok":true,"work_auth":true,"has_transport":true,"has_license":true,"has_insurance":true,"can_pass_background":true,"lived_outside_mo":false}'::jsonb;
  start jsonb := '{"first_name":"PRN1 practice","last_name":"(undone)","zip":"65802","sms_consent":false,"experience_kinds":["I have worked for a home care agency"]}'::jsonb;
begin
  a := public.apply_save(null, start, false);
  perform public.apply_prn_save(a, 'prn_cna', '{"cna":true,"one_year":true}'::jsonb, false);
  perform public.apply_save(a, shared || '{"position":"prn_cna"}'::jsonb, false);
  perform public.apply_prn_save(a, 'prn_cna', '{"days":["mon","sat"],"times":["evening"],"notice":"same_day"}'::jsonb, false);
  begin
    perform public.apply_save(a, '{"availability":"practice"}'::jsonb, true);
  exception when others then refused := sqlerrm like '%PAY_ACK_REQUIRED%';
  end;
  perform public.apply_prn_save(a, 'prn_cna', '{}'::jsonb, true);
  perform public.apply_save(a, '{"availability":"practice"}'::jsonb, true);
  b := public.apply_save(null, start, false);
  perform public.apply_prn_save(b, 'prn_cna', '{"cna":true,"one_year":false,"days":["tue"],"times":["morning"],"notice":"24h"}'::jsonb, true);
  perform public.apply_save(b, shared || '{"position":"prn_cna"}'::jsonb, false);
  perform public.apply_save(b, '{"availability":"practice"}'::jsonb, true);
  c := public.apply_save(null, start, false);
  perform public.apply_save(c, shared || '{"position":"caregiver"}'::jsonb, false);
  perform public.apply_save(c, '{"availability":"practice"}'::jsonb, true);
  select jsonb_build_object('refused', refused,
    'a', (select jsonb_build_object('status', status, 'grade', screen_grade, 'prnflags', (select count(*) from unnest(screen_flags) f where f in ('CNA not confirmed','under a year of caregiving experience','PRN Team pay not acknowledged','no PRN availability given')),
                                    'ver', pay_ack_version, 'text_ok', pay_ack_text = (select pay_ack from public.job_positions where key = 'prn_cna'), 'acked', pay_ack_at is not null, 'days', prn->'days') from public.job_applicants where id = a),
    'b', (select jsonb_build_object('status', status, 'grade', screen_grade, 'under_year', 'under a year of caregiving experience' = any(screen_flags)) from public.job_applicants where id = b),
    'c', (select jsonb_build_object('status', status, 'prn', prn is not null, 'acked', pay_ack_at is not null, 'graded', screen_grade is not null) from public.job_applicants where id = c)) into outv;
  raise exception 'PRN_PROOF:%', outv::text;
end $proof$;"""
s, b = sql_raw(PROOF)
msg = ""
try: msg = json.loads(b).get("message", "") if isinstance(json.loads(b), dict) else b
except Exception: msg = b or ""
P = None
if "PRN_PROOF:" in msg:
    try: P = json.JSONDecoder().raw_decode(msg[msg.index("PRN_PROOF:") + 10:])[0]
    except Exception: P = None
if not P: bad("the practice applications didn't run: " + re.sub(r"\s+", " ", msg)[:300])
else:
    A_, B_, C_ = P.get("a") or {}, P.get("b") or {}, P.get("c") or {}
    g1 = P.get("refused") is True
    (say if g1 else bad)(("  ✓ " if g1 else "") + "a PRN application without the pay tick can't be sent")
    g2 = A_.get("status") == "new" and A_.get("grade") == "qualified" and A_.get("prnflags") == 0 and A_.get("acked") and A_.get("ver") == "PRN-PAY-2026-09" and A_.get("text_ok") and A_.get("days") == ["mon", "sat"]
    (say if g2 else bad)(("  ✓ " if g2 else "") + "with it: sent, cleared the screen, the role's wording and version stored with the time, availability kept"
                         + ("" if g2 else " · " + json.dumps(A_)[:200]))
    g3 = B_.get("status") == "new" and B_.get("grade") == "review" and B_.get("under_year")
    (say if g3 else bad)(("  ✓ " if g3 else "") + "under a year's experience: needs a look (not turned away)" + ("" if g3 else " · " + json.dumps(B_)[:200]))
    g4 = C_.get("status") == "new" and not C_.get("prn") and not C_.get("acked") and C_.get("graded")
    (say if g4 else bad)(("  ✓ " if g4 else "") + "a caregiver application: sent without any pay tick and graded as before" + ("" if g4 else " · " + json.dumps(C_)[:200]))
ok, left = sql("select count(*)::int as n from public.job_applicants where first_name = 'PRN1 practice'")
(say if ok and left and left[0]["n"] == 0 else bad)(("  ✓ " if ok and left and left[0]["n"] == 0 else "") + "nothing from the practice was kept")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)}
except Exception: keys = {}
ANON, SVC = keys.get("anon", ""), keys.get("service_role", ""); HIDE += [ANON, SVC]
H = {"apikey": ANON, "Authorization": "Bearer " + ANON}
s, b = http("GET", f"{FNB}/rest/v1/job_positions?key=eq.prn_cna&select=track,pay_ack_version,pay_min", None, H)
try: row = (json.loads(b) or [{}])[0] if s == 200 else {}
except Exception: row = {}
s2, b2 = http("POST", f"{FNB}/rest/v1/rpc/apply_prn_save", {"p_id": str(uuid.uuid4()), "p_position": "prn_cna", "p_prn": {}, "p_pay_ack": False}, H)
g = row.get("track") == "prn" and row.get("pay_ack_version") == "PRN-PAY-2026-09" and s2 == 200 and b2.strip() in ("null", "")
(say if g else bad)(("  ✓ " if g else "") + f"the apply page's view (public key): the role reads as PRN · the PRN save answers ({s2}) and changes nothing for an unknown application")
IM = f"{FNB}/functions/v1/{FN}"
a1 = http("POST", IM + "?auth_check=1", {}, H)[0]; a2 = http("POST", IM + "?auth_check=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC})[0]
(say if a1 == 401 and a2 == 200 else bad)(("  ✓ " if a1 == 401 and a2 == 200 else "") + f"the interview texts: public key {a1} → refused · your server key {a2} → accepted")
ok, rq = sql("select net.http_post(url := " + lit(IM + "?auth_check=1") + ", headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', "
             + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), body := '{}'::jsonb) as id")
got = None; waited = 0.0
while ok and rq and waited <= POLL_MAX:
    ok3, rr = sql(f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(POLL); waited += POLL
g = got and got["status_code"] == 200 and jget(got["content"], "caller") == "cron"
(say if g else bad)(("  ✓ " if g else "") + "their every-15-minutes schedule still gets in" + ("" if g else f" ({got['status_code'] if got else 'no answer'})"))
sD, bD = http("POST", IM + "?dry=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 300)
try: j = json.loads(bD)
except Exception: j = {}
w = j.get("would") or {}
g = sD == 200 and j.get("dry") is True and isinstance(w.get("nudge"), list)
(say if g else bad)(("  ✓ " if g else "") + "a practice run of the interview texts (sends and writes nothing): "
    + (f"{len(w.get('confirm', []))} confirmations, {len(w.get('nudge', []))} booking texts ({sum(1 for x in w.get('nudge', []) if 'PRN' in str(x))} PRN), {len(w.get('alerted', []))} office alerts would go" if g else f"HTTP {sD}"))

say(); say("PART 4 · THE POSTING")
if fails:
    say("  · not published, because something above needs a look first.")
else:
    ok, r = sql(open(os.path.join(REPO, "prn1_posting.sql")).read())
    ok2, pr = sql("select status, position, valid_through is null as always_on, pay_min::float as pay, employment_type from public.job_postings where slug = 'prn-cna-springfield'")
    P4 = pr[0] if ok2 and pr else {}
    g = ok and P4.get("status") == "published" and P4.get("position") == "prn_cna" and P4.get("always_on") and P4.get("pay") == 20 and P4.get("employment_type") == "PER_DIEM"
    (say if g else bad)(("  ✓ " if g else "") + "the PRN CNA posting is published: $20/hr, PRN, no end date, linked to the PRN CNA Team"
        + (". mo-care.com/jobs/prn-cna-springfield appears at the website's next hourly build (about :17 past)." if g else " · " + json.dumps(P4)[:200]))
say()
say("RESULT: " + ("DONE · the PRN CNA Team is recruiting." if not fails else "CHECK THE ✗ LINES."))
say("Rollback: close the posting and mark the role not hiring in the Hub; Claude can remove the two PRN triggers (prn1_rollback.sql) and redeploy the interview texts from before.")
done(0 if not fails else 8)
