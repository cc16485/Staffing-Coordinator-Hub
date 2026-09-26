#!/usr/bin/env python3
# Change 1 · install launch evidence with its switch OFF: table + Door (sha-checked), the launch-evidence
# function and the two clock-time fixes (sha-checked), then ONE dry run. Records nothing, schedules nothing.
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt

MIG = open(os.environ["SB_MIGFILE"], "rb").read(); MIG_SHA = os.environ["SB_MIG_SHA"]
FNROOT = os.environ["SB_FNROOT"]; FN_SHAS = json.loads(os.environ["SB_FN_SHAS"])      # {"launch-evidence": sha, ...}
REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
HUB = os.environ.get("SB_HUB_URL", "https://cc.mo-care.com")

lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=180):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-launch-evidence/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace"), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace"), dict(e.headers)
    except Exception as e: return None, "%s: %s" % (type(e).__name__, e), {}
def sql(q):
    s, b, _ = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": "Bearer " + TOKEN}, 300)
    if s not in (200, 201): return False, f"HTTP {s}: {b[:500]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:400]

say("CHANGE 1 · NEW CLIENTS READS AXISCARE · INSTALL + DRY RUN")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
say()
sha = hashlib.sha256(MIG).hexdigest()
say("  migration sha256 " + sha[:16] + "…" + ("  ✓ proven build" if sha == MIG_SHA else "  ✗ NOT the proven build"))
if sha != MIG_SHA: say("  STOP. Nothing was run."); done(2)
for fn, want in FN_SHAS.items():
    got = hashlib.sha256(open(os.path.join(FNROOT, fn, "index.ts"), "rb").read()).hexdigest()
    say(f"  {fn} sha256 {got[:16]}…" + ("  ✓ reviewed source" if got == want else "  ✗ differs"))
    if got != want: say("  STOP. Nothing was run."); done(2)

stamp = dt.datetime.now().strftime("%H%M%S")
s, eng, _ = http("GET", HUB + "/launch-evidence.js?v=" + stamp)
s2, page, _ = http("GET", HUB + "/?v=" + stamp)
if s != 200 or "CCLaunchEvidence" not in eng or s2 != 200 or "leRefresh" not in page:
    say("  ✗ STOP: the live hub does not have the Change 1 update yet (merge the hub pull request first). Nothing was run."); done(3)
say("  ✓ the live hub serves the launch evidence rules and the new New Clients card")
ok, st = sql("select coalesce((data->>'launch_evidence_live')::boolean, false) as live from app_data where key = 'ops_settings'")
if ok and st and st[0].get("live") in (True, "true"):
    say("  ✗ STOP: the switch (ops_settings.launch_evidence_live) is already ON. This script only installs and dry-runs."); done(4)
say("  ✓ the switch is off, so nothing can be recorded from AxisCare")

SNAP = """select count(*)::int as n, coalesce(md5(string_agg(concat_ws('|', id, status, caregiver_assigned, caregiver_assigned_name, caregiver_assigned_at,
            schedule_added, schedule_added_at, evv_verified, evv_verified_at, first_shift_done, first_shift_done_at), ',' order by id)), '') as h
          from public.client_queue"""
ok, b = sql(SNAP)
if not ok: say("  ✗ STOP: could not read New Clients: " + str(b)[:300]); done(5)
before = b[0]
say(f"  New Clients before: {before['n']} launch(es)")
ok, r = sql(MIG.decode())
if not ok: say("  ✗ STOPPED: the migration did not complete (guard or self-check); nothing changed: " + str(r)[:500]); done(6)
say("  ✓ migration committed: the launch_evidence record and its one Door; guard + self-check passed")

if SKIP_FN: say("  (test target: function deploys skipped)")
else:
    for fn in FN_SHAS:
        p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"],
                           cwd=os.path.dirname(os.path.dirname(FNROOT)),
                           env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        if p.returncode != 0: say(f"  ✗ {fn} deploy failed: " + (p.stderr or p.stdout)[-400:]); done(7)
        say(f"  ✓ {fn} deployed")
s, _, h = http("OPTIONS", f"{FNB}/functions/v1/launch-evidence", headers={"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})
cors = s == 200 and (h.get("Access-Control-Allow-Origin") or h.get("access-control-allow-origin")) == "*"
say("  " + ("✓ the card can reach it from the browser (CORS answered)" if cors else f"✗ CORS preflight answered {s}"))

s, kb, _ = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers={"Authorization": "Bearer " + TOKEN})
svc = ""
try: svc = next((k.get("api_key", "") for k in json.loads(kb) if isinstance(k, dict) and k.get("name") == "service_role"), "")
except Exception: pass
if not svc: say("  ✗ could not get the server key for the dry run"); done(8)
s, body, _ = http("POST", f"{FNB}/functions/v1/launch-evidence", {"action": "run"}, {"Authorization": "Bearer " + svc, "apikey": svc}, 300)
svc = ""
try: out = json.loads(body)
except Exception: out = {"error": body[:300]}
dry_ok = s == 200 and out.get("dry") is True
if not dry_ok: say("  ✗ the dry run did not complete: HTTP " + str(s) + " " + json.dumps(out)[:400])

ok, b = sql(SNAP); after = b[0] if ok and b else {}
ok2, n = sql("select count(*)::int as n from public.launch_evidence")
unchanged = after == before and ok2 and n and int(n[0]["n"]) == 0
say("  " + ("✓ New Clients unchanged and no evidence recorded (dry)" if unchanged else f"✗ something changed during the dry run: {before} -> {after}, evidence {n}"))
ok, lg = sql("""select e->>'dry' as dry from app_data ad, lateral jsonb_array_elements(case when jsonb_typeof(ad.data) = 'array' then ad.data else '[]'::jsonb end) e
                 where ad.key = 'automation_log' and e->>'automation' = 'launch_evidence' order by e->>'at' desc limit 1""")
logged = bool(ok and lg and lg[0].get("dry") == "true")
say("  " + ("✓ the dry run is in the automation log" if logged else "✗ no dry-run entry in the automation log"))
say()
if dry_ok:
    say("WHAT AXISCARE SHOWS FOR THE OPEN LAUNCHES (dry run, nothing recorded)")
    say(f"  open launches {out.get('launches_open')} · read {out.get('read')} · no AxisCare id yet {out.get('no_axiscare_id')}"
        f" · opened over 120 days ago {out.get('too_old')} · next run {out.get('deferred')}")
    say(f"  would record {out.get('would_record')} fact(s) · questions for a person {out.get('flagged')} · errors {out.get('errors')}"
        + (" · AxisCare asked us to slow down (429)" if out.get("rate_limited") else ""))
    for p_ in out.get("preview") or []:
        say(f"    • {p_.get('client')} (AxisCare {p_.get('axiscare_client_id')}): first shift {p_.get('first_shift')}"
            + (f", care began {p_.get('actual_soc')}" if p_.get("actual_soc") else "")
            + (" · would record: " + ", ".join(p_.get("would_record")) if p_.get("would_record") else " · nothing to record"))
        for q in p_.get("questions") or []: say(f"        ? {q}")
    for e in out.get("error_list") or []: say(f"    ✗ {json.dumps(e)[:300]}")
    if not (out.get("preview") or []): say("    (no open launch with an AxisCare id right now)")
say()
allok = dry_ok and unchanged and logged and cors
say("RESULT: " + ("INSTALLED AND DRY RUN READ · nothing was recorded; the switch stays off until you turn it on (240)" if allok else "CHECK THE ✗ LINES"))
done(0 if allok else 9)
