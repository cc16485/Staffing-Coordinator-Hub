#!/usr/bin/env python3
# 472 · RE-READ THE OPEN OLDER SHIFT-NOTE FLAGS. Samantha 2026-10-06: "make the re-read step". The shift-note flags still
# open from before red and yellow get the same red / yellow / none question, from the caregiver's words on the card.
# Red or yellow: the card gets its level, why, the words that caused it, and (red) the Incidents owner; its due time
# only moves sooner. An ordinary day: left open and unchanged, listed here for a person to close. Nothing is sent.
# Part 1 (read only): the reviewed build; how many open flags have no level. Part 2: deploy care-notes (adds the
# re-read; the every-two-hours run is unchanged). Part 3: the public key is refused; the re-read; read back.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "care-notes"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Nothing was sent to anyone. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=400):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-472/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, b[:200]
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def probe(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    texts = []
    try:
        j = json.loads(b); texts.append(j.get("message") if isinstance(j, dict) else str(j))
    except Exception: pass
    texts.append(b.replace('\\"', '"'))
    for t in texts:
        if not t or "PROBE_RESULT: " not in t: continue
        try: return json.JSONDecoder().raw_decode(t[t.index("PROBE_RESULT: ") + len("PROBE_RESULT: "):])[0], None
        except Exception: continue
    return None, f"HTTP {s}: {b[:240]}"
def keys():
    s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG())
    try: return {k.get("name"): k.get("api_key", "") for k in json.loads(b)}
    except Exception: return {}
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)

lit = lambda v: "'" + str(v).replace("'", "''") + "'"
FN = "care-notes"
say("472 · RE-READ THE OPEN OLDER SHIFT-NOTE FLAGS"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p = os.path.join(FNROOT, "_shared", name.split("/", 1)[1] + ".ts") if name.startswith("_shared/") else os.path.join(FNROOT, name, "index.ts")
    if hashlib.sha256(open(p, "rb").read()).hexdigest() != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the reviewed build of the shift-note reader")
k = keys(); ANON, SVC = k.get("anon", ""), k.get("service_role", "")
if not ANON or not SVC: bad("could not read the project's keys. Nothing was changed."); done(4)
HIDE += [ANON, SVC]
s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
try: before = json.loads(b) if s == 200 else {}
except Exception: before = {}
if not isinstance(before.get("verify_jwt"), bool): bad("could not read the shift-note reader's setting. Nothing was changed."); done(4)
ok, r = sql("""select count(*)::int as n from public.app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) x
               where a.key = 'ops_items' and x->>'kind' = 'care_note' and x->>'status' = 'open' and coalesce(x->>'level', '') = ''""")
n0 = r[0]["n"] if ok and r else None
say(f"  · open shift-note flags from before red and yellow: {n0 if n0 is not None else '?'}")

say(); say("PART 2 · CHANGE")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"] + ([] if before["verify_jwt"] else ["--no-verify-jwt"]),
                   cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Nothing was changed."); done(6)
say("  ✓ the shift-note reader deployed (it can now re-read open older flags; its every-two-hours run is unchanged)")

say(); say("PART 3 · PROOF AND THE RE-READ (nothing sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
try: after = json.loads(b) if s == 200 else {}
except Exception: after = {}
chk(after.get("verify_jwt") == before["verify_jwt"] and isinstance(after.get("version"), int) and after["version"] > (before.get("version") or 0),
    f"gateway setting kept · now running version {after.get('version')} (was {before.get('version')})")
s1, _ = http("POST", f"{FNB}/functions/v1/{FN}?regrade=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
chk(s1 == 401, f"the public key can't re-read ({s1})")
say("  re-reading (this can take a minute)…")
s2, b2 = http("POST", f"{FNB}/functions/v1/{FN}?regrade=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
try: j = json.loads(b2)
except Exception: j = None
if s2 != 200 or not isinstance(j, dict) or j.get("error") or "looked" not in j: bad(f"the re-read did not answer ({s2}): " + str((j or {}).get("error") if isinstance(j, dict) else b2)[:160])
else:
    say(f"  ✓ re-read {j['looked']}: {j['red']} red, {j['yellow']} yellow, {j['normal_day']} ordinary days" + (f", {j['unread']} the AI couldn't read" if j.get("unread") else "") + (f", {j['no_words']} with no words on the card" if j.get("no_words") else "") + f" · {j['changed']} cards updated")
    for c in j.get("cards") or []: say(f"      {c.get('client')}: {c.get('level')}" + (f" · {c['kind']}" if c.get("kind") else ""))
    ok, r = sql("""select count(*)::int as n from public.app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) x
                   where a.key = 'ops_items' and x->>'kind' = 'care_note' and x->>'status' = 'open' and x->>'regraded_at' is not null""")
    chk(ok and r and r[0]["n"] >= j["changed"], f"the updated cards read back ({r[0]['n'] if ok and r else '?'} re-read)")
say()
say("RESULT: " + ("DONE · the open older flags now say red or yellow and why. Ordinary days are listed above: close them on My Work as Not a concern." if not fails else "CHECK THE ✗ LINES."))
say("Nothing was texted or emailed, and no note's words or phone numbers were printed.")
done(0 if not fails else 8)
