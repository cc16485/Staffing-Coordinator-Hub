#!/usr/bin/env python3
# Step 0 · combined production proof after 270 and 269 (Desktop 271). READ ONLY: changes nothing.
# Reads every value Samantha asked to see, runs the inquiry sweep's dry run (no messages), and looks for any
# family or caregiver message sent after each pause took effect. Also restates the decisions she recorded.
import json, os, re, urllib.request, urllib.error, datetime as dt
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
REPORT = os.environ["SB_REPORT"]; API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
lines = []; fails = []
def say(s=""): print(s, flush=True); lines.append(s)
def okl(g, text): say(("  ✓ " if g else "  ✗ ") + text); (None if g else fails.append(text))
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-step0-check/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=240) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, f"{type(e).__name__}: {e}"
def read(q):
    if not re.match(r"^\s*(select|with)\b", q, re.I): return False, "refused: not a read"
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": "Bearer " + TOKEN})
    if s not in (200, 201): return False, f"HTTP {s}: {b[:200]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def obj(v): return v if isinstance(v, (dict, list)) else json.loads(v or "null")

say("STEP 0 · COMBINED PRODUCTION PROOF · READ ONLY, nothing is changed")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
if not TOKEN.startswith("sbp_"): say("✗ That is not a Supabase access token (sbp_...)."); done(1)
ok, r = read("select data from app_data where key='ops_settings'"); o = obj(r[0]["data"]) if ok and r else {}
ok, r = read("select data from app_data where key='campaign_settings'"); cs = obj(r[0]["data"]) if ok and r else []
cset = next((x for x in cs if isinstance(x, dict) and x.get("id") == "settings"), {}) if isinstance(cs, list) else {}
ok, jobs = read("select jobname, active from cron.job where jobname in ('timekeeper-watch','lead-followup','daily-campaign-auto')")
active = {j["jobname"]: j["active"] for j in (jobs or [])} if ok else {}

say("SAFETY SWITCHES")
okl(o.get("timekeeper_text_live") is False, f"timekeeper_text_live = {o.get('timekeeper_text_live')!r} (caregiver clock-in and clock-out texts paused)")
okl(o.get("timekeeper_watch_live") is True and active.get("timekeeper-watch") is True, f"timekeeper_watch_live = {o.get('timekeeper_watch_live')!r}, scheduled watcher active = {active.get('timekeeper-watch')!r}")
okl(cset.get("aud_monthly") is False, f"open-lead campaign audience = {cset.get('aud_monthly')!r}")
okl(not cset.get("aud_clients"), f"active-client campaign = {cset.get('aud_clients', False)!r}")
okl(not cset.get("aud_client_contacts"), f"family / client-contact campaign = {cset.get('aud_client_contacts', False)!r}")
say(f"    (unchanged and reported only: campaign master = {cset.get('enabled')!r}, caregiver campaign = {cset.get('aud_caregivers')!r}, next-day EVV chase = {o.get('evv_chase_live', '(absent, off)')!r})")
ok, tw = read("""select content from net._http_response where content like '%settings_in_effect%' and content like '%timekeeper_text_live%'
                  and created > now() - interval '1 hour' order by created desc""")
if ok and tw:
    ans = [json.loads(x["content"]) for x in tw if x.get("content")]
    sent = sum(int(a.get("texts_sent", 0)) + int(a.get("clockout_texts_sent", 0)) for a in ans)
    watch_only = [a for a in ans if str(a.get("mode", "")).startswith("LIVE (watch only")]
    okl(bool(watch_only), f"the watcher's own answers in the last hour: {len(ans)} runs, {len(watch_only)} in watch-only mode")
    okl(all(int(a.get("texts_sent", 0)) + int(a.get("clockout_texts_sent", 0)) == 0 for a in watch_only), f"caregiver texts sent by the watcher since it went watch-only: {sum(int(a.get('texts_sent',0))+int(a.get('clockout_texts_sent',0)) for a in watch_only)}")
else: okl(False, "could not read the watcher's recent answers: " + str(tw)[:120])
say()

say("INQUIRY AUTOMATION")
okl(o.get("inquiry_ack_live") is False, f"inquiry_ack_live = {o.get('inquiry_ack_live')!r}")
okl(o.get("inquiry_followups_live") is False, f"inquiry_followups_live = {o.get('inquiry_followups_live')!r}")
paused_at = ((o.get("inquiry_paused") or {}).get("at")) if isinstance(o.get("inquiry_paused"), dict) else None
say(f"    paused at: {paused_at or '(not recorded)'}")
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers={"Authorization": "Bearer " + TOKEN})
try: svc = {k.get("name"): k.get("api_key", "") for k in json.loads(kb) if isinstance(k, dict)}.get("service_role", "")
except Exception: svc = ""
s, b = http("POST", f"{FNB}/functions/v1/lead-followup?dry=1", {}, {"Authorization": "Bearer " + svc, "apikey": svc}) if svc else (None, "")
try: d = json.loads(b)
except Exception: d = {}
w = d.get("would") or {}
okl(s == 200 and not w.get("acknowledge") and not w.get("nudge"), f"live dry run: would greet {len(w.get('acknowledge') or [])} and follow up {len(w.get('nudge') or [])} families")
say(f"    immediate acknowledgments being held: {len(w.get('paused_ack') or [])}")
say(f"    day-1 / day-3 follow-ups being held:   {len(w.get('paused_followups') or [])}")
ok, al = read("select count(*)::int as n from applicant_alerts where active = true and 'lead' = any(alert_on)")
okl(active.get("lead-followup") is True and ok and al and al[0]["n"] > 0,
    f"office lead alert still active: the sweep runs every 15 minutes and {al[0]['n'] if ok and al else '?'} alert recipient(s) are on it; planned right now: {len(w.get('office') or [])}")
if paused_at:
    ok, late = read("""select count(*)::int as n from app_data, jsonb_array_elements(case when jsonb_typeof(data)='array' then data else '[]'::jsonb end) x
                        where key='leads' and (x->>'ack_sent_at' > '""" + paused_at + """' or x->>'nudge_1_at' > '""" + paused_at + """' or x->>'nudge_2_at' > '""" + paused_at + """')""")
    okl(ok and late and late[0]["n"] == 0, f"no family greeting or follow-up recorded after the pause ({late[0]['n'] if ok and late else '?'} found)")
else: okl(False, "the pause time is not recorded, so 'nothing sent since' cannot be checked")
say()

say("DECISIONS ON RECORD (Samantha, Sept 27, 2026)")
for t in ("Shared Admin = Samantha, Zach, Krystal, Angiel",
          "Cierra excluded; her hub sign-in and old duty windows are stale configuration for later cleanup",
          "The office line (…8494) does not count as after-hours monitoring; after-hours monitoring is UNASSIGNED",
          "Samantha as the missed-call escalation fallback is a known routing defect, to be removed in Step 2",
          "Inbound communications reaching the hub remain UNPROVEN (zero recorded is a baseline, not proof of silence)"):
    say("  • " + t)
say()
say("RESULT: " + ("ALL CHECKS PASS" if not fails else f"{len(fails)} CHECK(S) NEED ATTENTION (✗ above)"))
done(0 if not fails else 9)
