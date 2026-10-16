#!/usr/bin/env python3
# 808 · OKLAHOMA APPLICANT MESSAGES FROM THE 405 NUMBER. Samantha 2026-10-16: "Approve the Oklahoma applicant messages plan with
#   all five decisions as you recommended. Start building." Plan: https://claude.ai/artifact/6o96izMj4RBMEFZmgQBNn2 ; interviews by
#   video: "I want Zoom interviews set up like an easy link - or could be google meet interview".
# SB_MODE=install (default, Desktop 808)
#   Part 1, read only: the reviewed build; the live hold and follow-up stop are 806's (or already 808); the 4 senders on the
#     server are builds from GitHub.
#   Part 2: ok_messages_808.sql (both Oklahoma switches OFF, ok_from_number +1 405 500 1758 unless already set), then the 4
#     senders redeployed with the Oklahoma number and words (interview-messages, applicant-text, applicant-decision-msg,
#     applicant-noshow; each keeps its gateway setting).
#   Part 3, proof (made-up applicants inside a step that is always undone; nothing is sent).
# SB_MODE=proof_text (Desktop 808b, only after she types yes): deploys the one-time ok-from-probe, sends ONE text from the
#   Oklahoma number to the cell number she typed (SB_PROOF_TO), deletes the probe. Nothing else is sent.
# SB_MODE=undo: ok_messages_808_rollback.sql.
# Prints counts only: no name, number, email, key or secret.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
MODE = os.environ.get("SB_MODE", "install")
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
LOCAL = os.environ.get("SB_LOCAL_SOCK")          # rehearsal only: a throwaway local Postgres instead of the live database
REF = "zngsgedlsxinbygwmxwn"
HUB = os.environ["SB_REPO"]; BASE = os.environ.get("SB_BASE", "")
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
SAVE_ROOT = os.environ.get("SB_SAVE", os.path.expanduser("~/Claude/checks/808-saved"))
FNS = ["interview-messages", "applicant-text", "applicant-decision-msg", "applicant-noshow"]
TESTS = ["ok_messages_808_test.mjs", "ok_office_msgs_808_test.mjs"]
PROOF_TO = os.environ.get("SB_PROOF_TO", "")
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg); return good
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=200):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-808/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    """One script. (ok, rows | error text)."""
    if LOCAL:
        from pg8000.native import Connection
        c = Connection(user="postgres", database="postgres", unix_sock=LOCAL)
        try:
            rows = c.run(q); names = [x["name"] for x in (c.columns or [])]
            return True, [dict(zip(names, r)) for r in (rows or [])]
        except Exception as e:
            try: c.run("rollback")
            except Exception: pass
            return False, (e.args[0].get("M") if e.args and isinstance(e.args[0], dict) else str(e))[:6000]
        finally: c.close()
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:6000]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:300]
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
shab = lambda b: hashlib.sha256(b).hexdigest()
sha = lambda p: shab(open(p, "rb").read())
rd = lambda rel: open(os.path.join(HUB, rel)).read()
pinpath = lambda k: k if "." in k.split("/")[-1] and not k.endswith(".ts") or k.endswith(".sql") else (f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts")
def git(root, *a): return subprocess.run(["git", *a], cwd=root, capture_output=True)
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    src = "\n".join(l for l in open(path).read().split("\n") if not re.match(r"\s*import\s+type\b", l))
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", src):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need(fn):
    s = set(); deps(os.path.join(HUB, f"supabase/functions/{fn}/index.ts"), s)
    return {os.path.relpath(x, HUB).replace(os.sep, "/") for x in s}
def live_files(fn):
    for i in range(3):
        tmp = tempfile.mkdtemp(prefix="cc808-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
        d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        live = {}
        for r, _, files in os.walk(tmp):
            for f in files:
                lp = os.path.join(r, f).replace(os.sep, "/")
                if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
        shutil.rmtree(tmp, ignore_errors=True)
        if d.returncode == 0 and live: return True, live
        time.sleep(float(os.environ.get("SB_RETRY", "3")) * (i + 1))
    return False, {}
HIST = {}
def history_shas(rel):
    if rel in HIST: return HIST[rel]
    out = set()
    for c in git(HUB, "log", "--format=%H", "origin/main", "--", rel).stdout.decode().split():
        b = git(HUB, "show", f"{c}:{rel}")
        if b.returncode == 0: out.add(shab(b.stdout))
    HIST[rel] = out; return out
def state(fn):
    """'this' | 'older' (every live file is a version once merged to main) | 'other' | 'unreadable', with its gateway setting."""
    s, m = fmeta(fn)
    if s == 404: return "missing", None, []
    vj = (m or {}).get("verify_jwt")
    okd, live = live_files(fn)
    if not okd or not isinstance(vj, bool): return "unreadable", vj, []
    nd = need(fn)
    if all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in nd): return "this", vj, []
    odd = [k for k in nd if k in live and live[k] != sha(os.path.join(HUB, k)) and live[k] not in history_shas(k)]
    odd += [k for k in live if k.endswith((".ts", ".js")) and k not in nd and live[k] not in history_shas(k)]
    return ("older" if not odd else "other"), vj, odd
def deploy(fn, vj):
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"]), cwd=HUB, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, live = live_files(fn)
    good = p.returncode == 0 and okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(fn))
    if not good: bad(f"{fn} didn't deploy: " + (p.stderr or p.stdout)[-200:]); return False
    sN, mN = fmeta(fn)
    if (mN or {}).get("verify_jwt") != vj:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{fn}", {"verify_jwt": vj}, MG()); sN, mN = fmeta(fn)
    return chk((mN or {}).get("verify_jwt") == vj, f"{fn} deployed, version {(mN or {}).get('version', '?')} (gateway sign-in check {'on' if vj else 'off'})")

# ---- the two rules 808 replaces: what it was built on (806), and what it puts in ----
def body(defn):
    m = re.search(r"AS \$(\w*)\$(.*)\$\1\$", defn or "", re.S)
    return m.group(2).strip() if m else None
def fbody(text, name):
    m = re.search(r"create or replace function public\." + name + r"\(.*?as \$f\$(.*?)\$f\$", text, re.S | re.I)
    return m.group(1).strip() if m else None
SIGS = {"hold": "public.ok_applicant_hold(text,text,text,text)", "stop": "public.applicant_followup_stop(uuid)"}
NAMES = {"hold": "ok_applicant_hold", "stop": "applicant_followup_stop"}
def live_rules():
    out = {}
    for k, sig in SIGS.items():
        ok, r = sql(f"select pg_get_functiondef('{sig}'::regprocedure) d")
        out[k] = body(r[0]["d"]) if ok and r else None
    return out
def defs_text():
    q = " union all ".join(f"select pg_get_functiondef('{sig}'::regprocedure) d" for sig in SIGS.values())
    ok, r = sql(q)
    return "\n\n".join(x["d"] + ";" for x in r) if ok else None

PROOF = r"""
do $proof$
declare r jsonb := '{}'::jsonb; ok1 uuid; ops jsonb; h_office boolean; h_auto boolean; h_ref boolean; h_mo boolean;
begin
  select data into ops from public.app_data where key = 'ops_settings';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  ok1 := public.apply_save(null, '{"first_name":"Proof","last_name":"Eightoheight","phone":"405-555-0187","email":"proof-808-ok@practice.invalid","zip":"73099","position":"companion","channel":"self-test"}'::jsonb, false);
  perform public.apply_save(null, '{"first_name":"Proof","last_name":"Eightoheightmo","phone":"417-555-0186","position":"caregiver","channel":"self-test"}'::jsonb, false);
  -- with the switches as they are now (both off after a first install)
  h_office := public.ok_applicant_hold('+14055550187', null, 'send-candidate-message (office text)', 'sms');
  h_auto := public.ok_applicant_hold('+14055550187', null, 'interview-messages', 'sms');
  h_ref := public.ok_applicant_hold('+14055550187', null, 'reference-chase', 'email');
  h_mo := public.ok_applicant_hold('+14175550186', null, 'interview-messages', 'sms');
  r := r || jsonb_build_object('office_on', coalesce((ops->>'ok_applicant_office_msgs_live')::boolean, false),
    'auto_on', coalesce((ops->>'ok_applicant_auto_msgs_live')::boolean, false),
    'from_number', ops->>'ok_from_number', 'video_set', coalesce(ops->>'ok_interview_link', '') <> '',
    'h_office', h_office, 'h_auto', h_auto, 'h_ref', h_ref, 'h_mo', h_mo,
    'stop', public.applicant_followup_stop(ok1),
    'anon_hold', has_function_privilege('anon', 'public.ok_applicant_hold(text,text,text,text)', 'execute'));
  -- and with both switches on, inside this step only (undone): the office and interview senders go, the rest stay held
  update public.app_data set data = data || '{"ok_applicant_office_msgs_live": true, "ok_applicant_auto_msgs_live": true}' where key = 'ops_settings';
  r := r || jsonb_build_object('on_office', public.ok_applicant_hold('+14055550187', null, 'applicant-noshow', 'sms'),
    'on_auto', public.ok_applicant_hold('+14055550187', null, 'interview-messages', 'sms'),
    'on_ref', public.ok_applicant_hold('+14055550187', null, 'reference-chase', 'email'));
  raise exception 'PROOF808 %', r::text;
end $proof$;
"""
def proof_result():
    ok, r = sql(PROOF)
    txt = str(r).replace('\\"', '"'); i = txt.find("PROOF808 {")
    if ok or i < 0: return None, str(r)[:300]
    try: return json.JSONDecoder().raw_decode(txt[i + len("PROOF808 "):])[0], None
    except Exception: return None, txt[i:i + 300]

def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict)}
        if usable(got.get("service_role")): return got["service_role"]
    return ""
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")

title = {"install": "install", "proof_text": "PROOF TEXT FROM THE OKLAHOMA NUMBER (Desktop 808b)", "undo": "UNDO"}.get(MODE, MODE)
say(f"808 · OKLAHOMA APPLICANT MESSAGES ({title})"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
S808, SRB, S806 = rd("ok_messages_808.sql"), rd("ok_messages_808_rollback.sql"), rd("ok_companion_806.sql")
BUILT_ON = {k: fbody(S806, n) for k, n in NAMES.items()}; AFTER = {k: fbody(S808, n) for k, n in NAMES.items()}
if not all(BUILT_ON.values()) or not all(AFTER.values()): bad("couldn't read the rules from the files. Nothing was run."); done(2)
same = lambda L, want: all(L.get(k) == want[k] for k in want)

say("PART 1 · READ ONLY (nothing changes)")
if MODE == "install":
    if not BASE or git(HUB, "cat-file", "-e", BASE + "^{commit}").returncode != 0: bad("the reviewed starting point isn't in the history"); say("  STOP. Nothing was run."); done(2)
    changed = set(git(HUB, "diff", "--name-only", BASE, "HEAD").stdout.decode().split())
    for k, want in SHAS.items():
        rel = pinpath(k)
        if rel not in changed or not os.path.exists(os.path.join(HUB, rel)) or sha(os.path.join(HUB, rel)) != want:
            bad(f"{rel.split('functions/')[-1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
    pinned = {pinpath(k) for k in SHAS}
    for fn in FNS:
        other = sorted(k for k in need(fn) if k not in pinned and k in changed)
        if other: bad(f"other changes merged since the review touch {fn} ({', '.join(other)[:200]}). Ask Claude to refresh 808."); say("  STOP. Nothing was run."); done(2)
    say(f"  ✓ the {len(SHAS)} changed files are exactly the reviewed build; nothing else changed under the 4 senders")
    NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
    if NODE:
        for tt in TESTS:
            p = subprocess.run([NODE, tt], cwd=HUB, capture_output=True, text=True)
            last = [x for x in p.stdout.strip().splitlines() if re.search(r"ALL \d+ CHECKS PASS|\d+/\d+ passed", x)] or (p.stdout.strip().splitlines() or ["(no output)"])
            if p.returncode != 0: bad(f"{tt} failed: {last[-1]}"); say("  STOP. Nothing was changed."); done(2)
            say(f"  ✓ {tt}: {last[-1].strip()}")
    else: say("  · node is not on this Mac, so the message tests were not re-run here (they passed when built)")

L = live_rules()
if any(v is None for v in L.values()): bad("couldn't read the live hold. Is 806 in? Nothing was changed."); done(3)
st_rules = "before" if same(L, BUILT_ON) else "after" if same(L, AFTER) else "other"
if st_rules == "other": bad("the live hold isn't the one this was built on (someone changed it since). Nothing was changed. Tell Claude."); done(3)
say("  ✓ the live Oklahoma hold is " + ("806's, exactly what this was built on" if st_rules == "before" else "already 808 (an earlier run)"))

if MODE == "undo":
    say(); say("UNDO")
    ok, r = sql(SRB)
    if not ok: bad("the undo didn't go in, and was undone as a whole (nothing changed): " + str(r)[:300]); done(6)
    chk(same(live_rules(), BUILT_ON), "806's hold is back: every Oklahoma message held again")
    say(); say("UNDO COMPLETE. Nothing was sent." if not fails else f"{len(fails)} PROBLEM(S) ABOVE. Tell Claude."); done(0 if not fails else 4)

if MODE == "proof_text":
    if st_rules != "after": bad("808 isn't in yet. Nothing was sent."); done(3)
    if not re.fullmatch(r"\+1\d{10}", PROOF_TO or ""): bad("no usable cell number was typed. Nothing was sent."); done(2)
    ok, r = sql("select data->>'ok_from_number' as n from public.app_data where key = 'ops_settings'")
    n = (r[0]["n"] if ok and r else None) or ""
    if not re.fullmatch(r"\+1\d{10}", n): bad("no Oklahoma sending number is set. Nothing was sent."); done(3)
    say(f"  ✓ the Oklahoma sending number is set (ending {n[-4:]})")
    SVC = keys(); HIDE.append(SVC)
    if not SVC: bad("couldn't read the server key. Nothing was sent."); done(3)
    say(); say("PART 2 · ONE TEXT")
    p = subprocess.run([SUPA, "functions", "deploy", "ok-from-probe", "--project-ref", REF, "--use-api", "--no-verify-jwt"], cwd=HUB, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: bad("the one-time sender didn't deploy: " + (p.stderr or p.stdout)[-200:]); done(6)
    time.sleep(float(os.environ.get("SB_SETTLE", "8")))
    s, b = http("POST", f"{FNB}/functions/v1/ok-from-probe", {"to": PROOF_TO}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
    try: j = json.loads(b)
    except Exception: j = {}
    chk(s == 200 and j.get("sent") is True, f"GoHighLevel accepted one text to your cell (ending {PROOF_TO[-4:]}), sent from the number ending {str(j.get('from') or '')[-4:] or '?'}" if s == 200 else f"the text did not go: {s} {str(j.get('error') or b)[:160]}")
    s2, _ = http("DELETE", f"{API}/v1/projects/{REF}/functions/ok-from-probe", headers=MG())
    sg, _ = http("GET", f"{API}/v1/projects/{REF}/functions/ok-from-probe", headers=MG())
    chk(sg == 404, "the one-time sender is deleted again")
    say(); say("Now look at your phone: the text should come from (405) 500-1758. Tell Claude what number it came from.")
    say("PROOF TEXT DONE. One text to you; nothing else was sent." if not fails else f"{len(fails)} PROBLEM(S) ABOVE. Tell Claude."); done(0 if not fails else 4)

STATES = {}
for fn in FNS:
    st, vj, odd = state(fn)
    if st not in ("older", "this"): bad(f"{fn} on the server is not a build from GitHub ({st}{': ' + ', '.join(odd)[:160] if odd else ''}). Nothing was changed. Tell Claude."); done(3)
    STATES[fn] = (st, vj)
say(f"  ✓ all {len(FNS)} senders on the server are builds from GitHub ({sum(1 for s, _ in STATES.values() if s == 'this')} already this one)")

say(); say("PART 2 · CHANGE")
stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S"); save = os.path.join(SAVE_ROOT, stamp); os.makedirs(save, exist_ok=True)
d_ = defs_text()
if not d_: bad("couldn't save a copy of the live hold. Nothing was changed."); done(3)
open(os.path.join(save, "live_functions.sql"), "w").write("-- live before 808, " + stamp + "\n" + d_ + "\n")
say("  ✓ a copy of the live hold saved (for the undo)")
ok, r = sql(S808)
if not ok: bad("the database change didn't go in, and was undone as a whole (nothing changed): " + str(r)[:300]); say("  STOP. Tell Claude."); done(6)
if not chk(same(live_rules(), AFTER), "the database change is in: the two Oklahoma switches (both off), the Oklahoma number, no automatic follow-ups for Oklahoma"): done(6)
for fn in FNS:
    st, vj = STATES[fn]
    if st == "this": say(f"  ✓ {fn} already had it"); continue
    if not deploy(fn, vj): say("  STOP. The database part is in and safe on its own (both switches off). Tell Claude."); done(6)
time.sleep(float(os.environ.get("SB_SETTLE", "8")))

say(); say("PART 3 · PROOF (made-up applicants, always undone; nothing is sent)")
for fn in FNS:
    okd, live = live_files(fn)
    if not (okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(fn))): bad(f"{fn}: the live copy is not the reviewed build")
chk(not any("live copy" in f for f in fails), f"all {len(FNS)} senders: the live copy is exactly the reviewed build (Oklahoma number and words)")
P, perr = proof_result()
if not P: bad("the proof couldn't run: " + str(perr)); done(7)
chk(P.get("from_number") and re.fullmatch(r"\+1\d{10}", P["from_number"] or ""), f"the Oklahoma sending number is set (ending {str(P.get('from_number') or '')[-4:]})")
if not P.get("office_on") and not P.get("auto_on"):
    chk(P.get("h_office") is True and P.get("h_auto") is True and P.get("h_ref") is True, "both Oklahoma switches are OFF: every Oklahoma message is still held")
else:
    say("  ·  a switch is already on (" + ", ".join(k for k in ("office_on", "auto_on") if P.get(k)) + "): left exactly as it is")
chk(P.get("on_office") is False and P.get("on_auto") is False and P.get("on_ref") is True, "with both switches on: the office buttons and interview messages go, references and the rest stay held (tried inside the proof, undone)")
chk(P.get("h_mo") is False, "a Missouri applicant is never held")
chk(P.get("stop") == "Oklahoma applicant: the recruiter calls (no automatic follow-ups)", "no automatic follow-ups for Oklahoma applicants")
chk(P.get("anon_hold") is False, "the public can't use the hold")
ok, r = sql("select count(*)::int as n from public.job_applicants where email like 'proof-808-%' or last_name like 'Eightoheight%'")
chk(ok and r[0]["n"] == 0, "nothing made-up was left behind")
ok, r = sql("select coalesce((data->>'ok_applicant_office_msgs_live')::boolean, false) as o, coalesce((data->>'ok_applicant_auto_msgs_live')::boolean, false) as a from public.app_data where key = 'ops_settings'")
chk(ok and r and r[0]["o"] is False and r[0]["a"] is False or (ok and r and (P.get("office_on") or P.get("auto_on"))), "the switches are exactly as before the proof")
say("  ·  " + ("The Oklahoma video interview link is set." if P.get("video_set") else "No Oklahoma video interview link yet: paste your Zoom or Google Meet link on the Admin page before turning on interview messages."))
say(); say("808 COMPLETE. Nothing was sent." if not fails else f"{len(fails)} PROBLEM(S) ABOVE. Tell Claude. (To put it back: the 808 undo.)")
done(0 if not fails else 4)
