#!/usr/bin/env python3
# Change 3 · install client status reviews with the switch OFF: tables + Doors (sha-checked), the
# client-status-review function (sha-checked), then ONE dry run. Opens nothing, schedules nothing.
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt

MIG = open(os.environ["SB_MIGFILE"], "rb").read(); MIG_SHA = os.environ["SB_MIG_SHA"]
FNROOT = os.environ["SB_FNROOT"]; FN_SHAS = json.loads(os.environ["SB_FN_SHAS"])      # {"client-status-review": sha}
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
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-client-status/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace"), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace"), dict(e.headers)
    except Exception as e: return None, "%s: %s" % (type(e).__name__, e), {}
def sql(q):
    s, b, _ = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": "Bearer " + TOKEN}, 300)
    if s not in (200, 201): return False, f"HTTP {s}: {b[:500]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:400]

say("CHANGE 3 · AXISCARE STATUS REACHES THE HUB · INSTALL + DRY RUN")
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
s2, page, _ = http("GET", HUB + "/?v=" + stamp)
if s2 != 200 or "csrOpen" not in page:
    say("  ✗ STOP: the live hub does not have the Change 3 update yet (merge the hub pull request first). Nothing was run."); done(3)
say("  ✓ the live hub has the Change 3 screens (Answer panel, AxisCare status on Active Clients)")
ok, st = sql("select coalesce((data->>'client_status_live')::boolean, false) as live from app_data where key = 'ops_settings'")
if ok and st and st[0].get("live") in (True, "true"):
    say("  ✗ STOP: the switch (ops_settings.client_status_live) is already ON. This script only installs and dry-runs."); done(4)
say("  ✓ the switch is off, so no review, My Work item or client change can happen")

SNAP = """select (select count(*)::int from public.person_role where role = 'client' and status = 'active') as active_clients,
          (select count(*)::int from public.journey_episode where state = 'ended') as ended_journeys,
          (select coalesce(md5(string_agg(e::text, ',' order by e->>'id')), '') from public.app_data ad,
             lateral jsonb_array_elements(case when jsonb_typeof(ad.data) = 'array' then ad.data else '[]'::jsonb end) e
            where ad.key = 'ops_items') as items"""
ok, b = sql(SNAP)
if not ok: say("  ✗ STOP: could not read the client records: " + str(b)[:300]); done(5)
before = b[0]
say(f"  before: {before['active_clients']} active client(s), {before['ended_journeys']} ended Journey(s)")
ok, r = sql(MIG.decode())
if not ok: say("  ✗ STOPPED: the migration did not complete (guard or self-check); nothing changed: " + str(r)[:500]); done(6)
say("  ✓ migration committed: the review record, the status copy and their Doors; guard + self-check passed")

if SKIP_FN: say("  (test target: function deploys skipped)")
else:
    for fn in FN_SHAS:
        p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"],
                           cwd=os.path.dirname(os.path.dirname(FNROOT)),
                           env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        if p.returncode != 0: say(f"  ✗ {fn} deploy failed: " + (p.stderr or p.stdout)[-400:]); done(7)
        say(f"  ✓ {fn} deployed")
s, _, h = http("OPTIONS", f"{FNB}/functions/v1/client-status-review", headers={"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})
cors = s == 200 and (h.get("Access-Control-Allow-Origin") or h.get("access-control-allow-origin")) == "*"
say("  " + ("✓ the Answer panel can reach it from the browser (CORS answered)" if cors else f"✗ CORS preflight answered {s}"))

s, kb, _ = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers={"Authorization": "Bearer " + TOKEN})
svc = ""
try: svc = next((k.get("api_key", "") for k in json.loads(kb) if isinstance(k, dict) and k.get("name") == "service_role"), "")
except Exception: pass
if not svc: say("  ✗ could not get the server key for the dry run"); done(8)
s, body, _ = http("POST", f"{FNB}/functions/v1/client-status-review", {"action": "run"}, {"Authorization": "Bearer " + svc, "apikey": svc}, 300)
svc = ""
try: out = json.loads(body)
except Exception: out = {"error": body[:300]}
dry_ok = s == 200 and out.get("dry") is True
if not dry_ok: say("  ✗ the dry run did not complete: HTTP " + str(s) + " " + json.dumps(out)[:400])

ok, b = sql(SNAP); after = b[0] if ok and b else {}
ok2, n = sql("select (select count(*) from public.client_status_review)::int as reviews, (select count(*) from public.client_status_current)::int as cur")
unchanged = after == before and ok2 and n and int(n[0]["reviews"]) == 0 and int(n[0]["cur"]) == 0
say("  " + ("✓ clients, Journeys and My Work unchanged; no review opened (dry)" if unchanged else f"✗ something changed during the dry run: {before} -> {after}, {n}"))
ok, lg = sql("""select e->>'dry' as dry from app_data ad, lateral jsonb_array_elements(case when jsonb_typeof(ad.data) = 'array' then ad.data else '[]'::jsonb end) e
                 where ad.key = 'automation_log' and e->>'automation' = 'client_status' order by e->>'at' desc limit 1""")
logged = bool(ok and lg and lg[0].get("dry") == "true")
say("  " + ("✓ the dry run is in the automation log" if logged else "✗ no dry-run entry in the automation log"))
say()
if dry_ok:
    say("WHAT IT WOULD DO IF SWITCHED ON (dry run, nothing changed)")
    say(f"  AxisCare census: {out.get('census')} client(s); status changes recorded so far: {out.get('transitions_seen')}")
    say(f"  would open {out.get('would_open')} review(s) for hub clients · changes on clients the hub never knew (only logged): {out.get('no_hub_person')}"
        f" · older than 60 days: {out.get('too_old')} · already reviewed: {out.get('already_reviewed')}")
    sc = out.get("admission_scan") or {}
    say(f"  \"Who is this?\": {sc.get('would_check', '?')} Active AxisCare client(s) with no hub person would be checked")
    for p_ in out.get("preview") or []: say(f"    • AxisCare #{p_.get('axiscare_client_id')}: {p_.get('change')} (seen {p_.get('seen')})")
    for e in out.get("error_list") or []: say(f"    ✗ {json.dumps(e)[:300]}")
say()
allok = dry_ok and unchanged and logged and cors
say("RESULT: " + ("INSTALLED AND DRY RUN READ · nothing changed; the switch stays off until you turn it on (245)" if allok else "CHECK THE ✗ LINES"))
done(0 if allok else 9)
