#!/usr/bin/env python3
# 919 · AI CALL CARDS CLOSE THEMSELVES, PRACTICE. Samantha 2026-10-17: "go" (her plan of 2026-10-14, item 1: "hard proof
#   closes alone: AxisCare shows the visit change, or office texted/called that person in GHL after the card"; anything
#   less is "Looks done" with one-tap Close).
#   Part 1 (read only): reviewed builds, tests, call-tasks live = the code this builds on, the reader is live and scheduled.
#   Part 2: cards_close_919.sql (the record of each look, and the one narrow way the job may change a card); call-tasks
#   deployed; practice ON (ops_settings.call_cards_practice). Looks done and close on proof stay OFF: two switches on the
#   Owners Hub Admin page, hers to turn on.
#   Part 3 (proof): the live copy is this build; one reader run; what it found is listed; NO card was changed; the public
#   can't read the record. Never texts, emails or calls anyone.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB_REF = "zngsgedlsxinbygwmxwn"
HUB = os.environ["SB_REPO"]; HUB_BASE = os.environ.get("SB_BASE", "")
HUB_SHAS = json.loads(os.environ["SB_SHAS"])
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB_REF}.supabase.co")
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "40"))
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-919/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            b = r.read(); return r.status, (b if raw else b.decode(errors="replace"))
    except urllib.error.HTTPError as e: return e.code, (b"" if raw else e.read().decode(errors="replace"))
    except Exception as e: return None, (b"" if raw else type(e).__name__)
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{HUB_REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def fmeta(ref, fn):
    s, b = http("GET", f"{API}/v1/projects/{ref}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def secrets(ref):
    s, b = http("GET", f"{API}/v1/projects/{ref}/secrets", headers=MG())
    try: return {x.get("name") for x in json.loads(b)} if s == 200 else set()
    except Exception: return set()
def keys(ref):
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
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
pinpath = lambda k: f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts"
def git(root, *a): return subprocess.run(["git", *a], cwd=root, capture_output=True)
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need(root, fn):
    s = set(); deps(os.path.join(root, f"supabase/functions/{fn}/index.ts"), s)
    return {os.path.relpath(x, root).replace(os.sep, "/") for x in s}
def live_files(ref, fn):
    tmp = tempfile.mkdtemp(prefix="cl919-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", ref, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for r, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(r, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live
def base_sha(root, base, rel):
    b = git(root, "show", f"{base}:{rel}")
    return shab(b.stdout) if b.returncode == 0 else None
def reviewed(root, base, shas, label, extra=()):
    if not base or git(root, "cat-file", "-e", base + "^{commit}").returncode != 0: bad(f"the reviewed starting point isn't in the {label} history"); say("  STOP. Nothing was run."); done(2)
    changed = set(git(root, "diff", "--name-only", base, "HEAD").stdout.decode().split())
    for rel, want in [(pinpath(k), v) for k, v in shas.items()] + list(extra):
        if rel not in changed or not os.path.exists(os.path.join(root, rel)) or sha(os.path.join(root, rel)) != want:
            bad(f"{label}: {rel.split('functions/')[-1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
    return changed
def state(ref, root, base, fn, pinned):
    """'new' | 'base' | 'this' | 'other' for one live function, with its gateway setting."""
    s, m = fmeta(ref, fn)
    if s == 404: return "new", None
    vj = (m or {}).get("verify_jwt")
    okd, live = live_files(ref, fn)
    if not okd or not isinstance(vj, bool): return "unreadable", vj
    nd = need(root, fn)
    if all(k in live and live[k] == sha(os.path.join(root, k)) for k in nd): return "this", vj
    if all((k in live and live[k] == base_sha(root, base, k)) or (k not in live and base_sha(root, base, k) is None and k in pinned) for k in nd): return "base", vj
    return "other", vj
def deploy(ref, root, fn, vj, label):
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", ref, "--use-api"] + ([] if vj in (True, None) else ["--no-verify-jwt"]), cwd=root, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, live = live_files(ref, fn)
    good = okd and all(k in live and live[k] == sha(os.path.join(root, k)) for k in need(root, fn))
    if not good: bad(f"{label} {fn} didn't deploy: " + (p.stderr or p.stdout)[-200:]); return False
    want = True if vj is None else vj
    sN, mN = fmeta(ref, fn)
    if (mN or {}).get("verify_jwt") != want:
        http("PATCH", f"{API}/v1/projects/{ref}/functions/{fn}", {"verify_jwt": want}, MG()); sN, mN = fmeta(ref, fn)
    chk((mN or {}).get("verify_jwt") == want, f"{label}: {fn} deployed, version {(mN or {}).get('version', '?')} (gateway sign-in check {'on' if want else 'off'})")
    return True
def lit(v): return "'" + str(v).replace("'", "''") + "'"
FN = "call-tasks"; JOB = "call-tasks"
SQLF = "cards_close_919.sql"; SQL_SHA = os.environ.get("SB_SQL_SHA", "")
TESTS = [("cards_close_919_test.mjs", "pglite")]
CARDS = """select count(*) filter (where x->>'kind' = 'call_followup' and x->>'status' = 'open')::int as open_cards,
  count(*) filter (where x->>'kind' = 'call_followup' and (x ? 'looks_done' or x->>'resolution_code' = 'proof'))::int as touched,
  md5(coalesce(string_agg(case when x->>'kind' = 'call_followup' then (x->>'id') || ':' || coalesce(x->>'status', '') end, ',' order by x->>'id'), ''))::text as sig
  from public.app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) x where a.key = 'ops_items'"""

say("919 · AI CALL CARDS CLOSE THEMSELVES (PRACTICE)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
if not SQL_SHA or not os.path.exists(os.path.join(HUB, SQLF)) or sha(os.path.join(HUB, SQLF)) != SQL_SHA: bad("the database change is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
reviewed(HUB, HUB_BASE, HUB_SHAS, "the Hub server")
pinned = {pinpath(k) for k in HUB_SHAS}
other = sorted(k for k in need(HUB, FN) if k not in pinned and base_sha(HUB, HUB_BASE, k) != sha(os.path.join(HUB, k)))
if other: bad(f"other changes merged since the review touch {FN} ({', '.join(other)[:200]}). Ask Claude to refresh 919."); say("  STOP. Nothing was run."); done(2)
say("  ✓ the card check and its database change are the reviewed builds")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
pg = os.environ.get("PGLITE") or os.path.expanduser("~/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js")
if NODE:
    for t, kind in TESTS:
        env = dict(os.environ); env.pop("PGLITE", None)
        if kind == "pglite" and os.path.exists(pg): env["PGLITE"] = pg
        p = subprocess.run([NODE, t], cwd=HUB, capture_output=True, text=True, env=env)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0: bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()}" + ("" if "PGLITE" in env else " (the test database is not on this Mac, so its SQL part was not re-run here)"))
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
st, vj = state(HUB_REF, HUB, HUB_BASE, FN, pinned)
if st not in ("base", "this"): bad(f"{FN} on the server is not the version this builds on ({st}); someone may have deployed a newer one. Nothing was changed. Tell Claude."); done(3)
say(f"  ✓ {FN}: " + {"base": "the live reader is the version this builds on", "this": "already this build"}[st])
ok, s0 = sql("""select data->>'call_tasks_live' as live, data->>'call_cards_practice' as practice, data->>'call_cards_suggest_live' as suggest, data->>'call_cards_close_live' as close_,
  (select count(*) from cron.job where jobname = 'call-tasks')::int as sched from public.app_data where key = 'ops_settings'""")
if not ok or not s0: bad("couldn't read the Hub's settings. Nothing was changed."); done(3)
s0 = s0[0]
if s0["live"] != "true": bad("call follow-up cards are off (call_tasks_live), so there are no cards to check. Nothing was changed."); done(4)
if s0["sched"] != 1: bad("the call reader has no schedule. Nothing was changed. Tell Claude."); done(4)
say("  ✓ call follow-up cards are on and the reader runs every 10 minutes")
if s0["suggest"] == "true" or s0["close_"] == "true": bad("Looks done or close on proof is already on; this step only puts practice in. Nothing was changed. Tell Claude."); done(4)
ok, c0 = sql(CARDS)
if not ok or not c0: bad("couldn't read the cards. Nothing was changed."); done(3)
c0 = c0[0]
say(f"  · {c0['open_cards']} open AI call card(s) right now")
K = keys(HUB_REF); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); HIDE += [ANON, SVC]
if not ANON or not SVC: bad("couldn't read the Hub's keys. Nothing was changed."); done(3)

say(); say("PART 2 · CHANGE")
ok, r = sql(open(os.path.join(HUB, SQLF)).read())
if not ok: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
say("  ✓ the record of each look, and the one narrow way the job may change a card (only an open AI call card, only Looks done or closing it)")
if st != "this" and not deploy(HUB_REF, HUB, FN, vj, "Hub"): say("  STOP. The table stays (harmless); the old reader keeps running. Tell Claude."); done(6)
if st == "this": say(f"  ✓ {FN} already had it")
ok, r = sql("""update public.app_data set data = data || jsonb_build_object('call_cards_practice', true) where key = 'ops_settings' and jsonb_typeof(data) = 'object'
  returning data->>'call_cards_practice' as p, data->>'call_cards_suggest_live' as s, data->>'call_cards_close_live' as c""")
chk(ok and r and r[0]["p"] == "true" and r[0]["s"] != "true" and r[0]["c"] != "true", "PRACTICE is on: each look is recorded, no card changes. Looks done and close on proof: OFF (your two switches on the Admin page, Calls)")
if fails: say("  STOP. Tell Claude."); done(6)

say(); say("PART 3 · PROOF (no card changes, nothing is sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
okd, live = live_files(HUB_REF, FN)
chk(okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(HUB, FN)), f"{FN}: the live copy is exactly the reviewed build")
URL = f"{FNB}/functions/v1/{JOB}"
a1 = http("POST", URL + "?auth_check=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
chk(a1 == 401, f"the reader refuses the public key ({a1})")
sR, bR = http("POST", URL, {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 300)
try: j = json.loads(bR)
except Exception: j = {}
if sR == 200 and j.get("ok") and j.get("card_check_mode") == "practice":
    say(f"  ✓ one reader run: {j.get('cards_checked', 0)} card(s) looked at (of {j.get('cards_open', 0)} open; the rest within the hour), {j.get('cards_asked', 0)} read by the AI")
    say(f"    it WOULD close {j.get('cards_would_close', 0)} on proof and say Looks done on {j.get('cards_would_suggest', 0)}")
    if j.get("card_check_errors"): bad(f"the run hit {j['card_check_errors']} error(s) looking at cards; they are on Call Follow Ups, Card checks. Tell Claude.")
else: bad(f"the reader run didn't answer as expected ({sR}): " + str(j.get("error") or bR)[:160])
ok, rows = sql("""select k.would, k.verdict, k.why, k.proofs, x->>'about' as about, x->>'title' as title from public.call_card_check k
  left join lateral (select e as x from public.app_data a, jsonb_array_elements(a.data) e where a.key = 'ops_items' and e->>'id' = k.card_id limit 1) c on true
  order by case k.would when 'close' then 0 when 'suggest' then 1 else 2 end, k.checked_at desc limit 40""")
for row in rows or []:
    if row["would"] not in ("close", "suggest"): continue
    say(f"    {'WOULD CLOSE' if row['would'] == 'close' else 'LOOKS DONE '} · {row['about'] or ''}: {(row['title'] or '')[:90]}")
    say(f"        {(row['why'] or '')[:200]}")
ok, c1 = sql(CARDS)
chk(ok and c1 and c1[0]["touched"] == 0, "NO card was changed by the check (none has Looks done, none was closed on proof)")
if ok and c1 and c1[0]["sig"] != c0["sig"]: say("  · cards changed while this ran (new cards or someone closed one); none by the check (above)")
sC, bC = http("GET", f"{FNB}/rest/v1/call_card_check?select=card_id&limit=1", None, {"apikey": ANON, "Authorization": "Bearer " + ANON})
chk(sC != 200 or bC.strip() in ("[]", ""), f"the public can't read the card checks ({sC})")
say()
say("RESULT: " + ("DONE · every 10 minutes the reader looks again at open AI call cards, in PRACTICE: Call Follow Ups, Card checks lists what it would close and where it would say Looks done. Next: Claude merges the Hub and Admin changes. After a day or two of checking that list, turn on Looks done (and later, close on proof) from the Admin page, Calls." if not fails else "PARTLY DONE · see the ✗ lines. Tell Claude."))
say("Nothing was texted, emailed or called. No card was changed.")
say("Rollback: turn practice off (call_cards_practice), then cards_close_919_rollback.sql (Claude can).")
done(0 if not fails else 8)
