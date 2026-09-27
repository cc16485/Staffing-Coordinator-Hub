#!/usr/bin/env python3
# One client profile 5b F · folded inquiries close their empty Journey · install, preview, then ask (Desktop 265).
#  1. sha-checks the migration; checks the live hub has the fold buttons (merge first)
#  2. applies lead-journey-fold.sql. It installs OFF: the lead mirror behaves exactly as before.
#  3. lists every inquiry a person already folded (Mark as duplicate) and what would happen to its Journey
#  4. asks; only a typed "yes" switches it on (ops_settings.lead_fold_live), records the approval, and runs
#     the mirror once so the list above is done now
#   SB_MODE=off switches it off (Desktop 266): nothing voided comes back, but no more are voided.
import json, os, hashlib, urllib.request, urllib.error, datetime as dt
MIG = open(os.environ["SB_MIGFILE"], "rb").read() if os.environ.get("SB_MIGFILE") else b""; MIG_SHA = os.environ.get("SB_MIG_SHA", "")
REPORT = os.environ["SB_REPORT"]; MODE = os.environ.get("SB_MODE", "install")
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); HUB = os.environ.get("SB_HUB_URL", "https://cc.mo-care.com")
lines = []
def say(s=""): print(s, flush=True); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=300):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-lead-fold/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, "%s: %s" % (type(e).__name__, e)
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": "Bearer " + TOKEN})
    if s not in (200, 201): return False, f"HTTP {s}: {b[:400]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:300]
def setlive(on, approval=None):
    extra = f", 'lead_fold_approved', '{json.dumps(approval).replace(chr(39), chr(39) * 2)}'::jsonb" if approval else ""
    ok, r = sql(f"""update public.app_data set data = data || jsonb_build_object('lead_fold_live', {'true' if on else 'false'}{extra}), updated_at = now()
      where key = 'ops_settings' and jsonb_typeof(data) = 'object' returning (data->>'lead_fold_live')::boolean as on""")
    return ok and r and r[0].get("on") in (on, str(on).lower())

if MODE == "off":
    say("5b F · FOLDED INQUIRIES · SWITCH OFF"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
    say("  ✓ switched off: no more Journeys are voided; the ones already voided stay voided (they point at the one kept)" if setlive(False) else "  ✗ could not switch it off"); done(0)

say("5b F · FOLDED INQUIRIES CLOSE THEIR EMPTY JOURNEY · INSTALL")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
sha = hashlib.sha256(MIG).hexdigest()
say("  migration sha256 " + sha[:16] + "…" + ("  ✓ proven build" if sha == MIG_SHA else "  ✗ NOT the proven build"))
if sha != MIG_SHA: say("  STOP. Nothing was run."); done(2)
s, page = http("GET", HUB + "/?v=" + dt.datetime.now().strftime("%H%M%S"))
if s != 200 or "ckFold" not in page:
    say("  ✗ STOP: the live hub doesn't have the fold buttons yet (merge the hub pull request, wait a few minutes). Nothing was run."); done(3)
say("  ✓ the live hub has the fold buttons and the change requests")
ok, st = sql("select coalesce((data->>'lead_fold_live')::boolean, false) as on from public.app_data where key = 'ops_settings' and jsonb_typeof(data) = 'object'")
if not ok or not st: say("  ✗ STOP: could not read the settings: " + str(st)[:200]); done(4)
if st[0]["on"] in (True, "true") and not setlive(False): say("  ✗ STOP: it was already on and could not be paused for the preview"); done(4)
ok, r = sql(MIG.decode())
if not ok: say("  ✗ STOPPED: the migration did not complete (self-check); nothing changed: " + str(r)[:400]); done(5)
say("  ✓ installed, OFF: the lead mirror behaves exactly as before")
ok, rows = sql("""with l as (
    select e as lead, nullif(btrim(e->>'id'), '') as id, public.lead_fold_intent(e) as f
      from public.app_data ad, jsonb_array_elements(case when jsonb_typeof(ad.data) = 'array' then ad.data else '[]'::jsonb end) e
     where ad.key = 'leads' and jsonb_typeof(e) = 'object')
  select l.id, l.f->>'kind' as kind, l.f->>'ref' as ref,
         btrim(concat_ws(' ', l.lead->>'client_first_name', l.lead->>'client_last_name')) as client,
         btrim(concat_ws(' ', l.lead->>'first_name', l.lead->>'last_name')) as contact,
         e.state, (e.person_id is not null) as has_person, public.lead_fold_target(l.f)::text as target
    from l left join public.episode_source s on s.system = 'lead' and s.role = 'origin' and s.source_ref = l.id
           left join public.journey_episode e on e.episode_id = s.episode_id
   where l.f is not null order by l.id""")
if not ok: say("  ✗ the preview could not be read: " + str(rows)[:300]); done(6)
void = [x for x in rows if x["state"] == "provisional" and x["has_person"] in (False, "false")]
held = [x for x in rows if x["state"] in ("open", "converted", "established")]
none = [x for x in rows if x["state"] is None]
say(); say(f"WHAT SWITCHING ON WOULD DO NOW (preview: nothing written) · {len(rows)} inquiries were marked duplicate or folded")
who = lambda x: (x["client"] or x["contact"] or "(no name)") + (f" (caller {x['contact']})" if x["client"] and x["contact"] else "")
into = lambda x: ("AxisCare client #" + x["ref"]) if x["kind"] == "client" else ("the inquiry it duplicates")
for x in void: say(f"  • close the empty Journey of {who(x)}: folded into {into(x)}" + ("" if x["target"] else "; that one has no open Journey, so it just closes"))
if not void: say("  • no empty Journeys to close")
for x in held: say(f"  ○ left alone, a client was confirmed on it: {who(x)} ({x['state']}). Owner / Decision if it really is a duplicate")
if none: say(f"  ○ {len(none)} never had a Journey; none will be opened for them")
say(f"  ✓ already closed or voided: {len(rows) - len(void) - len(held) - len(none)}")
say()
say("  Switching on means: these Journeys close now, and from now on marking a duplicate (or folding an")
say("  inquiry into another or into a client) closes its empty Journey within the next mirror run.")
try: ans = input("  Switch it on now? Type yes: ").strip().lower()
except EOFError: ans = ""
say(f"  answer: {ans or '(nothing)'}")
if ans != "yes": say(); say("RESULT: INSTALLED, LEFT OFF · nothing was voided; run 265 again to switch on"); done(0)
approval = {"by": "Samantha", "decided_on": dt.date.today().isoformat(), "words": "yes to all, go and merge (5b E + F)", "confirmed_at_install": "yes", "recorded_by": "Desktop 265"}
if not setlive(True, approval): say("  ✗ could not switch it on; it stays off"); done(7)
say("  ✓ switched on, with your approval recorded")
ok, rr = sql("select public.lead_journey_mirror_scheduled('manual') as r")
res = (rr[0]["r"] if ok and rr else None)
if isinstance(res, str):
    try: res = json.loads(res)
    except Exception: res = None
if not isinstance(res, dict): say("  ○ the first run didn't answer (" + str(rr)[:200] + "); the next scheduled run will do it"); done(0)
say(f"FIRST RUN: {res.get('outcome')} · {res.get('closed', 0)} closed (Lost and folded) · {res.get('errors', 0)} errors")
if res.get("detail"): say("  detail: " + str(res.get("detail"))[:400])
say(); say("RESULT: INSTALLED AND ON · a duplicate's empty Journey closes and points at the one kept")
done(0 if not res.get("errors") else 8)
