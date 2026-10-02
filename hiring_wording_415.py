#!/usr/bin/env python3
# 415 · HIRING WORDING (orientation from home, part 3). Samantha 2026-10-02: applicants are told what really happens.
# One 20-minute in-person interview, then paperwork, a 15-minute welcome video call and 6 hours of PAID training
# (2h orientation + 4h Alzheimer's and dementia) from home. The application takes about 2 minutes.
# Two projects, one Supabase access token (it is account-wide):
#   THE HUB (zngsgedlsxinbygwmxwn): hiring_wording_415.sql fixes the wording of the job adverts (job_postings) and the
#     saved descriptions (job_templates) with targeted replace() only, and adds the one-liner; send-candidate-message's
#     in-office orientation confirmation asks for the original ID documents from Viventium Step 2 (no Social Security
#     card, no voided check).
#   THE TRAINING PLATFORM (rdqujxiycycwhskyvrwa): job-offer's Viventium welcome text + email say "a 15-minute welcome
#     video call, then paid training from home" instead of "we'll contact you to schedule your orientation".
# Part 1 (read only): reviewed builds (pinned, the SQL too) in both projects, the tests pass, the tables are as
#   expected, a count of the adverts the SQL will change, and a copy of their current words saved next to this report.
# Part 2, in this order (each step only if the one before it worked): the SQL; Hub send-candidate-message; Training
#   job-offer. Each function only if its live copy is today's GitHub main (or already this build), each keeping its
#   own gateway setting.
# Part 3 (proof, NOTHING is sent): the adverts read back clean and with the one-liner; a second run would change
#   nothing; the live copies are exactly the reviewed builds; send-candidate-message refuses a stranger's text and a
#   made-up booking; job-offer refuses the welcome without a Hub staff sign-in (none, and a made-up one).
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB, TP = "zngsgedlsxinbygwmxwn", "rdqujxiycycwhskyvrwa"
ROOTS = {HUB: os.environ["SB_HUB_ROOT"], TP: os.environ["SB_TR_ROOT"]}
BASES = {HUB: os.environ.get("SB_HUB_BASE", ""), TP: os.environ.get("SB_TR_BASE", "")}
SHAS = {HUB: json.loads(os.environ["SB_HUB_SHAS"]), TP: json.loads(os.environ["SB_TR_SHAS"])}
SQL_SHA = os.environ.get("SB_SQL_SHA", "")
NAMES = {HUB: "Hub", TP: "Training"}
FNB = {HUB: os.environ.get("SB_HUB_FN_BASE", f"https://{HUB}.supabase.co"), TP: os.environ.get("SB_TR_FN_BASE", f"https://{TP}.supabase.co")}
WANT = {HUB: ["send-candidate-message"], TP: ["job-offer"]}
SQLFILE = "hiring_wording_415.sql"
LINE = "One 20-minute in-person interview at our office, then your paperwork, welcome call and 6 hours of paid training all from home on your phone or computer."
OLD = ["Ongoing paid training, including dementia and Alzheimer's care", "Paid orientation and training", "rientation and training are provided before you start",
       "under two minutes", "Apply in about five minutes", "Apply in about 5 minutes", "takes about five minutes", "takes about 5 minutes"]
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-wording415/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(ref, q):
    s, b = http("POST", f"{API}/v1/projects/{ref}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def fmeta(ref, fn):
    s, b = http("GET", f"{API}/v1/projects/{ref}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def keys(ref):
    """The project's keys. Lesson from 412: newer projects only give the real value with ?reveal=true, and some answer
    that with an error; ask with it first, then without it. A value that isn't a usable key counts as missing."""
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{ref}/api-keys{q}", headers=MG())
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
def git(ref, *a): return subprocess.run(["git", *a], cwd=ROOTS[ref], capture_output=True)
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
lit = lambda s: "'" + s.replace("'", "''") + "'"

def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
pinpath = lambda k: f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts"
def deps_of(ref, fn):
    s = set(); deps(os.path.join(ROOTS[ref], f"supabase/functions/{fn}/index.ts"), s)
    return {os.path.relpath(x, ROOTS[ref]).replace(os.sep, "/") for x in s}

def reviewed(ref):
    """The changed function files since the reviewed starting point are exactly the pinned builds. Returns the
    functions that are or include a changed file."""
    R, BASE = ROOTS[ref], BASES[ref]
    if not BASE or git(ref, "cat-file", "-e", BASE + "^{commit}").returncode != 0: bad(f"{NAMES[ref]}: the reviewed starting point isn't in this folder's history"); say("  STOP. Nothing was run."); done(2)
    changed = sorted(x for x in git(ref, "diff", "--name-only", BASE, "HEAD", "--", "supabase/functions").stdout.decode().split() if x.endswith(".ts") and os.path.exists(os.path.join(R, x)))
    pinned = {pinpath(k): v for k, v in SHAS[ref].items()}
    if set(changed) != set(pinned): bad(f"{NAMES[ref]}: the list of changed files isn't the reviewed list ({', '.join(changed)[:200]})"); say("  STOP. Nothing was run."); done(2)
    for rel, want in pinned.items():
        if sha(os.path.join(R, rel)) != want: bad(f"{NAMES[ref]} {rel.split('functions/')[1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
    users = []
    fnroot = os.path.join(R, "supabase/functions")
    for fn in sorted(os.listdir(fnroot)):
        p = os.path.join(fnroot, fn, "index.ts")
        if fn.startswith("_") or not os.path.exists(p): continue
        used = set(); deps(p, used)
        if any(os.path.normpath(os.path.join(R, c)) in used for c in changed): users.append(fn)
    say(f"  ✓ {NAMES[ref]}: the {len(changed)} changed file(s) are the reviewed build; functions to update: {', '.join(users)}")
    return users

def live_files(ref, fn):
    tmp = tempfile.mkdtemp(prefix="hw415-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", ref, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for root, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(root, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live

def base_sha(ref, rel):
    b = git(ref, "show", f"{BASES[ref]}:{rel}")
    return shab(b.stdout) if b.returncode == 0 else None

def deploy(ref, users):
    """One function at a time; only if its live copy is the reviewed starting point (today's GitHub main, which 414
    deployed) or already this build, and every file it uses is unchanged; its gateway setting kept."""
    R = ROOTS[ref]; ok_all = True
    for fn in users:
        sM, m = fmeta(ref, fn)
        if sM == 404: bad(f"{NAMES[ref]} {fn} is not deployed there. Tell Claude."); ok_all = False; continue
        vj = (m or {}).get("verify_jwt")
        if not isinstance(vj, bool): bad(f"{NAMES[ref]} {fn}: couldn't read its gateway setting, NOT changed"); ok_all = False; continue
        okd, live = live_files(ref, fn)
        mine = f"supabase/functions/{fn}/index.ts"
        if not okd or mine not in live: bad(f"{NAMES[ref]} {fn}: couldn't read its live copy, NOT changed"); ok_all = False; continue
        need = deps_of(ref, fn)
        if all(k in live and live[k] == sha(os.path.join(R, k)) for k in need):
            say(f"  ✓ {NAMES[ref]} {fn} already had it"); continue
        if live[mine] != base_sha(ref, mine):
            bad(f"{NAMES[ref]} {fn}: its live code is not today's GitHub main (was 414 run? was something else deployed?), NOT changed"); ok_all = False; continue
        other = [k.split("supabase/functions/", 1)[1] for k in need if k != mine and (k not in live or live[k] != sha(os.path.join(R, k)))]
        if other: bad(f"{NAMES[ref]} {fn}: live shared code differs from GitHub ({', '.join(sorted(other))[:160]}), NOT changed"); ok_all = False; continue
        p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", ref, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                           cwd=R, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        if p.returncode != 0: bad(f"{NAMES[ref]} {fn} didn't deploy: " + (p.stderr or p.stdout)[-200:]); ok_all = False; continue
        sN, mN = fmeta(ref, fn)
        if (mN or {}).get("verify_jwt") != vj:
            http("PATCH", f"{API}/v1/projects/{ref}/functions/{fn}", {"verify_jwt": vj}, MG()); sN, mN = fmeta(ref, fn)
            if (mN or {}).get("verify_jwt") != vj: bad(f"{NAMES[ref]} {fn}: its gateway setting changed and couldn't be put back. Tell Claude."); ok_all = False; continue
        say(f"  ✓ {NAMES[ref]} {fn} deployed (gateway setting kept: sign-in check {'on' if vj else 'off'})")
    return ok_all

def is_reviewed_live(ref, fn):
    okd, live = live_files(ref, fn)
    if not okd: return False, "couldn't read the live copy"
    need = deps_of(ref, fn)
    missing = [k for k in need if k not in live]
    if missing: return False, "live copy is missing " + ", ".join(sorted(k.split("functions/", 1)[1] for k in missing))
    off = [k for k in need if live[k] != sha(os.path.join(ROOTS[ref], k))]
    return (not off), ("" if not off else "live differs in " + ", ".join(sorted(k.split("functions/", 1)[1] for k in off)))

COLS = "summary, description, responsibilities, qualifications, benefits"
def old_cond(alias_status):
    """A row the SQL will change: an old phrase anywhere in its text, or (open, non-empty description) no one-liner."""
    txt = "concat_ws(' ', summary, description, responsibilities, qualifications, benefits)"
    anyold = f"{txt} like any (array[{', '.join(lit('%' + o + '%') for o in OLD)}])"
    return f"({anyold} or ({alias_status} and coalesce(btrim(description), '') <> '' and position({lit(LINE)} in description) = 0))"
P_COND, T_COND = old_cond("status <> 'closed'"), old_cond("true")

say("415 · HIRING WORDING (one interview, then the rest from home)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
SQLP = os.path.join(ROOTS[HUB], SQLFILE)
if not os.path.exists(SQLP) or sha(SQLP) != SQL_SHA: bad(f"{SQLFILE} is not the reviewed version"); say("  STOP. Nothing was run."); done(2)
SQLTEXT = open(SQLP).read()
say(f"  ✓ {SQLFILE} is the reviewed version")
hub_users = reviewed(HUB); tr_users = reviewed(TP)
if hub_users != WANT[HUB]: bad("Hub: only send-candidate-message should change"); say("  STOP. Nothing was run."); done(2)
if sorted(tr_users) != WANT[TP]: bad("Training: only job-offer should change"); say("  STOP. Nothing was run."); done(2)
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for ref, t in ((HUB, "security_sms_test.mjs"), (HUB, "nsf2_hiring_test.mjs"), (HUB, "hiring_wording_415_test.mjs"),
                   (TP, "training_texts_test.mjs"), (TP, "orientation_link_test.mjs")):
        p = subprocess.run([NODE, t], cwd=ROOTS[ref], capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or "FAIL" in last: bad(f"{NAMES[ref]} {t} failed: {last}"); say("  STOP. Nothing was run."); done(2)
        say(f"  ✓ {NAMES[ref]} {t}: {last} (run here, against fakes; nothing sent)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
ok, cols = sql(HUB, "select table_name, count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name in ('job_postings', 'job_templates') "
                    "and column_name in ('summary', 'description', 'responsibilities', 'qualifications', 'benefits') group by table_name")
cn = {r["table_name"]: r["n"] for r in (cols or [])} if ok else {}
if cn.get("job_postings") != 5: bad("the Hub's job_postings table isn't as expected. Nothing was changed. Tell Claude: " + str(cols)[:200]); done(3)
HAS_T = cn.get("job_templates") == 5
say("  ✓ job_postings has the five text columns" + ("; job_templates too" if HAS_T else "; there is no job_templates table (the SQL skips it)"))
ok, cnt = sql(HUB, f"select count(*) filter (where {P_COND})::int as n, count(*) filter (where {P_COND} and status = 'published')::int as pub, count(*)::int as total from public.job_postings")
if not ok: bad("couldn't count the adverts: " + str(cnt)[:200]); done(3)
say(f"  · the SQL will change {cnt[0]['n']} of {cnt[0]['total']} job postings ({cnt[0]['pub']} of them published)")
TB = []
if HAS_T:
    ok, tc = sql(HUB, f"select count(*) filter (where {T_COND})::int as n, count(*)::int as total from public.job_templates")
    if ok: say(f"  · and {tc[0]['n']} of {tc[0]['total']} saved descriptions (job_templates)")
    ok, TB = sql(HUB, f"select id, name, {COLS} from public.job_templates where {T_COND} order by name")
ok, PB = sql(HUB, f"select id, slug, status, {COLS} from public.job_postings where {P_COND} order by slug")
if not ok: bad("couldn't save a copy of the current wording first. Nothing was changed: " + str(PB)[:200]); done(3)
BEFORE = os.path.join(os.path.dirname(os.path.abspath(REPORT)), "Hiring wording 415 before " + dt.datetime.now().strftime("%H.%M.%S") + ".json")
json.dump({"job_postings": PB, "job_templates": TB or []}, open(BEFORE, "w"), indent=1)
say(f"  ✓ saved a copy of their current words first: {os.path.basename(BEFORE)} (job adverts only, nothing private)")
kt, kh = keys(TP), keys(HUB)
TP_ANON, HUB_ANON = kt.get("anon", ""), kh.get("anon", "")
HIDE += [TP_ANON, HUB_ANON]
if not TP_ANON or not HUB_ANON: bad("couldn't read the projects' public keys. Nothing was changed."); done(3)
say("  ✓ read both projects' public keys (kept in memory only, never printed)")

say(); say("PART 2 · CHANGE (in order; each step only if the one before it worked)")
ok, r = sql(HUB, SQLTEXT)
if not ok: bad("the job advert wording didn't apply (one transaction, so nothing in it changed): " + str(r)[:200]); say("  STOP. No function was changed. Tell Claude."); done(4)
say("  ✓ job advert wording fixed (one transaction)")
if not deploy(HUB, hub_users): say("  STOP. The Training Platform was not changed. Tell Claude."); done(4)
if not deploy(TP, sorted(tr_users)): say("  STOP. Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent)")
ok, rows = sql(HUB, f"select slug, status, {COLS} from public.job_postings where status <> 'closed'")
if not ok: bad("couldn't read the adverts back: " + str(rows)[:200]); rows = []
txt = lambda r: " ".join(str(r.get(c) or "") for c in ("summary", "description", "responsibilities", "qualifications", "benefits"))
for word, why in (("five minutes", '"five minutes"'), ("under two minutes", '"under two minutes"'), ("Ongoing paid training", '"Ongoing paid training"'),
                  ("orientation and training are provided", '"orientation and training are provided"')):
    hit = [r["slug"] for r in rows if word.lower() in txt(r).lower()]
    chk(not hit, f"no open advert says {why}" + (f" (still in: {', '.join(hit)})" if hit else ""))
noline = [r["slug"] for r in rows if (r.get("description") or "").strip() and LINE not in r["description"]]
chk(rows and not noline, f"every open advert ({len(rows)}) carries the one-liner" + (f" (missing: {', '.join(noline)})" if noline else ""))
if HAS_T:
    ok, trows = sql(HUB, f"select name, {COLS} from public.job_templates")
    hit = [t["name"] for t in (trows or []) if any(o.lower() in txt(t).lower() for o in ("five minutes", "under two minutes", "Ongoing paid training", "orientation and training are provided"))]
    chk(ok and not hit, "no saved description (job_templates) has the old wording" + (f" (still in: {', '.join(hit)})" if hit else ""))
ok, again = sql(HUB, f"select (select count(*) from public.job_postings where {P_COND})::int as n")
chk(ok and again and again[0]["n"] == 0, f"running the SQL again would change nothing ({(again or [{}])[0].get('n') if ok else again})")
for ref, fns in ((HUB, hub_users), (TP, sorted(tr_users))):
    for fn in fns:
        good, why = is_reviewed_live(ref, fn)
        chk(good, f"{NAMES[ref]} {fn}: the live copy is now exactly the reviewed build" + ("" if good else f" ({why})"))
SCM = f"{FNB[HUB]}/functions/v1/send-candidate-message"
s1, _ = http("POST", SCM, {"phone": "0000000000", "message": "proof"}, {"Authorization": "Bearer " + HUB_ANON, "apikey": HUB_ANON})
chk(s1 == 401, f"send-candidate-message refuses a text from someone who isn't signed-in office staff ({s1}); nothing sent")
s2, _ = http("POST", SCM, {"kind": "orientation_confirmation", "phone": "4170000415", "session_id": "hiring-wording-415-proof", "first": "Proof"}, {"Authorization": "Bearer " + HUB_ANON, "apikey": HUB_ANON})
chk(s2 in (400, 404), f"send-candidate-message refuses a confirmation for a booking that doesn't exist ({s2}); nothing sent")
JO = f"{FNB[TP]}/functions/v1/job-offer"
probe = {"action": "send_welcome", "offer_id": "00000000-0000-4000-8000-000000000415"}
s3, _ = http("POST", JO, probe, {"Authorization": "Bearer " + TP_ANON, "apikey": TP_ANON})
chk(s3 == 401, f"job-offer refuses the welcome without a Hub staff sign-in ({s3}); nothing sent")
s4, _ = http("POST", JO, probe, {"Authorization": "Bearer " + TP_ANON, "apikey": TP_ANON, "x-hub-token": "not-a-real-hub-session"})
chk(s4 in (401, 403), f"job-offer refuses the welcome with a made-up Hub sign-in ({s4})")
say("  · The new welcome words are proved by the tests above (training_texts_test.mjs, against fakes). The next offer")
say("    marked \"entered in Viventium\" is the live proof. The website job pages pick up the new advert words within the hour.")
say()
if fails: say("RESULT: PARTLY DONE · the ✗ lines above need Claude.")
else: say("RESULT: DONE · the adverts, the Viventium welcome and the in-office orientation text now say \"one interview, then the rest from home\". "
          "Merge the Training Platform branch next, then the Hub page branch (cc-hub-live), so the Hub's preview matches what is sent.")
say("Nothing was texted or emailed by this installer.")
say(f"Rollback: Claude redeploys the previous send-candidate-message and job-offer from GitHub, and can put the advert words back from {os.path.basename(BEFORE)}.")
done(1 if fails else 0)
