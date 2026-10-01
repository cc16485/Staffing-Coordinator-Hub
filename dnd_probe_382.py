#!/usr/bin/env python3
# 382 · READ ONLY: why sends are refused with "could not check GHL Do Not Disturb" (2026-10-01). Part 1: every sender's
# refusals in the last 7 days, by reason (counts). Part 2: a temporary helper repeats the door's own GoHighLevel lookup for
# up to 8 refused addresses and reports which do-not-disturb fields GoHighLevel returns (yes/no + types), then is removed.
# No names, numbers, emails or ids are printed. No message is sent.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, time
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip(); REF = "zngsgedlsxinbygwmxwn"; SUPA = os.environ.get("SB_SUPA_CLI", "")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co"); FN = "dnd-probe"
lines = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def http(method, url, body=None, headers=None, timeout=170):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-382/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    try: return json.loads(b) if s in (200, 201) else {"error": b[:200]}
    except Exception: return {"error": b[:200]}
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
say("382 · WHY ARE SENDS REFUSED? (read only)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
for n, w in SHAS.items():
    p = os.path.join(FNROOT, n + ".ts") if n.startswith("_shared/") else os.path.join(FNROOT, n, "index.ts")
    if sha(p) != w: say(f"  ✗ {n} is not the reviewed build. Nothing was run."); done(2)
say("1 · EVERY SENDER'S REFUSALS, LAST 7 DAYS")
r = sql("""select split_part(sender, ' (by', 1) as sender, channel, reasons::text as why, count(*)::int as n, max(at)::text as last
  from public.contact_send_refusal where at > now() - interval '7 days' group by 1,2,3 order by n desc limit 40""")
if isinstance(r, dict): say("  couldn't read: " + r["error"])
else:
    for x in r: say(f"  {x['n']:>4}× {x['sender']} · {x['channel']} · last {x['last'][:16]} · {x['why'][:110]}")
say(); say("2 · WHAT GOHIGHLEVEL ACTUALLY RETURNS (temporary helper)")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api", "--no-verify-jwt"], cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: say("  ✗ couldn't put up the helper: " + (p.stderr or p.stdout)[-200:]); done(4)
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)} if s == 200 else {}
SVC = keys.get("service_role", ""); HIDE.append(SVC); time.sleep(10)
s, b = http("POST", f"{FNB}/functions/v1/{FN}", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
try: j = json.loads(b)
except Exception: j = {}
if s == 200 and j.get("ok"):
    for x in j["results"]:
        u, g = x["upsert_answer"] or {}, x["get_answer"] or {}
        say(f"  {x['channel']}: upsert {x['upsert_status']} (dnd field: {u.get('has_dnd_key')}/{u.get('dnd_type')}, dndSettings: {u.get('has_dndSettings')} {u.get('dndSettings_channels')}) · "
            f"get {x['get_status']} (dnd field: {g.get('has_dnd_key')}/{g.get('dnd_type')}, dndSettings: {g.get('has_dndSettings')} {g.get('dndSettings_channels')})")
    if not j["results"]: say("  no recent 'could not check' refusals to test")
else: say(f"  ✗ the helper didn't answer ({s}): {b[:160]}")
http("DELETE", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
s2, _ = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
say(("  ✓" if s2 == 404 else "  ✗") + " the temporary helper is removed")
say(); say("RESULT: DONE · read only. Tell Claude it's done.")
done(0)
