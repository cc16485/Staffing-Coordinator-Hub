#!/usr/bin/env python3
# Change 6a · Family Circles belong to a client. Run AFTER the hub update is merged.
#  1. sha-checks the migration and the four functions (+ the shared family-text module)
#  2. applies the migration (adds the link columns, links ONLY the sync's own exact matches)
#  3. records Samantha's exception approval for Cara's "caregiver changed" family text
#     (2026-09-27) BEFORE Cara's update is deployed, so there is no gap
#  4. deploys family-circles, circle-send, identity-backfill, coverage-run
#  5. runs tonight's family sync as a DRY RUN and lists every circle still waiting for a person
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt
MIG = open(os.environ["SB_MIGFILE"], "rb").read(); MIG_SHA = os.environ["SB_MIG_SHA"]
FNROOT = os.environ["SB_FNROOT"]; FN_SHAS = json.loads(os.environ["SB_FN_SHAS"])   # {"coverage-run": sha, "_shared/family-change-text.ts": sha, ...}
REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
HUB = os.environ.get("SB_HUB_URL", "https://cc.mo-care.com")
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=240):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-family-circles/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace"), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace"), dict(e.headers)
    except Exception as e: return None, "%s: %s" % (type(e).__name__, e), {}
def sql(q):
    s, b, _ = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": "Bearer " + TOKEN}, 300)
    if s not in (200, 201): return False, f"HTTP {s}: {b[:500]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:400]

say("CHANGE 6a · FAMILY CIRCLES BELONG TO A CLIENT · INSTALL")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
sha = hashlib.sha256(MIG).hexdigest()
say("  migration sha256 " + sha[:16] + "…" + ("  ✓ proven build" if sha == MIG_SHA else "  ✗ NOT the proven build"))
if sha != MIG_SHA: say("  STOP. Nothing was run."); done(2)
for fn, want in FN_SHAS.items():
    path = os.path.join(FNROOT, fn) if fn.endswith(".ts") else os.path.join(FNROOT, fn, "index.ts")
    got = hashlib.sha256(open(path, "rb").read()).hexdigest()
    say(f"  {fn} sha256 {got[:16]}…" + ("  ✓ reviewed source" if got == want else "  ✗ differs"))
    if got != want: say("  STOP. Nothing was run."); done(2)
s2, page, _ = http("GET", HUB + "/?v=" + dt.datetime.now().strftime("%H%M%S"))
if s2 != 200 or "fcLinkPick" not in page:
    say("  ✗ STOP: the live hub does not have the Change 6a update yet (merge the hub pull request, wait a few minutes). Nothing was run."); done(3)
say("  ✓ the live hub has the new Family Circles screen")

COUNTS = """select (select count(*) from care_circles where active is true)::int as circles,
   (select count(*) from circle_contacts)::int as members,
   (select count(*) from circle_contacts where sms_consent is true)::int as consenting"""
ok, b = sql(COUNTS)
if not ok: say("  ✗ STOP: could not read Family Circles: " + str(b)[:300]); done(4)
before = b[0]
say(f"  before: {before['circles']} active circle(s), {before['members']} member(s), {before['consenting']} with texting consent")
ok, r = sql(MIG.decode())
if not ok: say("  ✗ STOPPED: the migration did not complete (guard or self-check); nothing changed: " + str(r)[:500]); done(5)
ok, b = sql(COUNTS); after = b[0] if ok and b else {}
ok2, lk = sql("select count(*)::int as n from care_circles where active is true and axiscare_client_id is not null")
say(f"  ✓ migration committed · {lk[0]['n'] if ok2 else '?'} circle(s) linked (the nightly sync's own exact matches only)")
if after != before: say(f"  ✗ circle or member counts changed during the migration: {before} -> {after}"); done(6)
say("  ✓ no circle or member added or removed; texting consent unchanged")

APPROVAL = {"by": "Samantha", "decided_on": "2026-09-27", "words": "Approve it as an exception to your rule",
            "scope": "Cara's automatic 'your caregiver has changed' text, after a confirmed fill, to consenting members of the Family Circle linked to that client",
            "recorded_by": "Desktop 251"}
ok, r = sql("""insert into public.app_data (key, data, updated_at) values ('ops_settings', jsonb_build_object('family_caregiver_change_text_approved', '%s'::jsonb), now())
  on conflict (key) do update set data = (case when jsonb_typeof(public.app_data.data) = 'object' then public.app_data.data else '{}'::jsonb end)
    || jsonb_build_object('family_caregiver_change_text_approved', '%s'::jsonb), updated_at = now()
  returning (data ? 'family_caregiver_change_text_approved') as ok""" % (json.dumps(APPROVAL).replace("'", "''"), json.dumps(APPROVAL).replace("'", "''")))
if not ok or not r or r[0].get("ok") not in (True, "true"): say("  ✗ could not record the approval: " + str(r)[:300]); done(7)
say("  ✓ your exception approval for Cara's family text is recorded (ops_settings), before Cara's update goes out")

deploy = [f for f in FN_SHAS if not f.endswith(".ts")]
if SKIP_FN: say("  (test target: function deploys skipped)")
else:
    for fn in deploy:
        p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"], cwd=os.path.dirname(os.path.dirname(FNROOT)),
                           env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        if p.returncode != 0: say(f"  ✗ {fn} deploy failed: " + (p.stderr or p.stdout)[-400:]); done(8)
        say(f"  ✓ {fn} deployed")
s, _, h = http("OPTIONS", f"{FNB}/functions/v1/family-circles", headers={"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})
cors = s == 200 and (h.get("Access-Control-Allow-Origin") or h.get("access-control-allow-origin")) == "*"
say("  " + ("✓ the Family Circles screen can reach its service (CORS answered)" if cors else f"✗ CORS preflight answered {s}"))

s, kb, _ = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers={"Authorization": "Bearer " + TOKEN})
svc = ""
try: svc = next((k.get("api_key", "") for k in json.loads(kb) if isinstance(k, dict) and k.get("name") == "service_role"), "")
except Exception: pass
s, body, _ = http("POST", f"{FNB}/functions/v1/identity-backfill?circles=1", None, {"Authorization": "Bearer " + svc, "apikey": svc}, 300); svc = ""
try: d = json.loads(body)
except Exception: d = {"error": body[:300]}
dry_ok = s == 200 and d.get("mode") == "DRY RUN"
say(); say("WHAT TONIGHT'S FAMILY SYNC WILL DO (dry run, nothing changed)")
if dry_ok:
    say(f"  clients read: {d.get('clients')} · circles it will link: {d.get('circles_linked')} · new circles: {d.get('circles_created')}")
    say(f"  AxisCare family members updated from AxisCare: {d.get('contacts_updated')} · added: {d.get('contacts_added')} · marked no longer on AxisCare's list: {d.get('contacts_marked_removed')}")
    say(f"  office-typed members left untouched: {d.get('manual_untouched')} · circles waiting for a person to link: {d.get('waiting_for_person_link')}")
    for e in d.get("errors") or []: say(f"    ✗ {e}")
else: say("  ✗ the dry run did not complete: HTTP " + str(s) + " " + json.dumps(d)[:300])
ok, un = sql("""select c.client_name, (select count(*) from circle_contacts m where m.circle_id::text = c.id::text)::int as members,
   (select count(*) from circle_contacts m where m.circle_id::text = c.id::text and m.sms_consent is true)::int as consenting
   from care_circles c where c.active is true and c.axiscare_client_id is null order by c.client_name""")
say(); say("CIRCLES WAITING FOR A PERSON TO LINK THEM (never sent to until linked; Family Circles → \"Link to a client\")")
if ok:
    if not un: say("  none: every active circle is linked")
    for x in un: say(f"  • {x['client_name']} · {x['members']} member(s), {x['consenting']} with texting consent")
else: say("  could not read: " + str(un)[:200])
say()
allok = cors and dry_ok
say("RESULT: " + ("INSTALLED · circles are tied to clients; Cara's family text is gated and uses the link; tonight's sync follows AxisCare" if allok else "CHECK THE ✗ LINES"))
done(0 if allok else 9)
