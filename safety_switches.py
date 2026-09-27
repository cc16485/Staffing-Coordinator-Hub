#!/usr/bin/env python3
# Step 0 · two safety switches (Desktop 270). Exactly two production changes, each only if its current value
# is what Samantha expects, each read back, and everything else proven untouched.
#   A. timekeeper_text_live: true -> false. The watcher (timekeeper_watch_live) stays ON: missed clock-ins are
#      still detected and still become work items; only the automatic caregiver SMS (clock-in and clock-out
#      reminders) stops. The next-day EVV chase has its own switch (evv_chase_live) and is not touched.
#   B. campaign_settings open-leads audience (aud_monthly): true -> false. Master, caregivers, active clients
#      and client contacts are not touched (and are only reported).
# Proof for A includes the watcher's own next scheduled answer: "LIVE (watch only, texting off)", 0 texts sent.
import json, os, time, urllib.request, urllib.error, datetime as dt
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
REPORT = os.environ["SB_REPORT"]; API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
POLL_SEC = float(os.environ.get("SB_POLL_SEC", "20")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "420"))
lines = []; fails = []
def say(s=""): print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def sql(q):
    req = urllib.request.Request(f"{API}/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-safety-switches/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r: return True, json.loads(r.read())
    except urllib.error.HTTPError as e: return False, f"HTTP {e.code}: {e.read().decode(errors='replace')[:300]}"
    except Exception as e: return False, f"{type(e).__name__}: {e}"
def obj(v): return v if isinstance(v, (dict, list)) else json.loads(v or "null")
def ops():
    ok, r = sql("select data from app_data where key = 'ops_settings'")
    return obj(r[0]["data"]) if ok and r else None
def camp():
    ok, r = sql("select data from app_data where key = 'campaign_settings'")
    return obj(r[0]["data"]) if ok and r else None
def others_fp():
    ok, r = sql("select md5(string_agg(key || data::text, ',' order by key)) as fp from app_data where key not in ('ops_settings','campaign_settings')")
    return r[0]["fp"] if ok and r else None

say("STEP 0 · TWO SAFETY SWITCHES")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")); say()
if not TOKEN.startswith("sbp_"): say("✗ That is not a Supabase access token (sbp_...). Nothing was changed."); done(1)
fp0 = others_fp(); o0 = ops(); c0 = camp()
if o0 is None or c0 is None or fp0 is None: say("✗ STOP: could not read the settings. Nothing was changed."); done(2)

# ── A ──────────────────────────────────────────────────────────────────────────
say("A. PAUSE THE AUTOMATIC MISSED-CLOCK-IN CAREGIVER TEXT")
say(f"  before: timekeeper_text_live = {o0.get('timekeeper_text_live')!r} · timekeeper_watch_live = {o0.get('timekeeper_watch_live')!r} · evv_chase_live = {o0.get('evv_chase_live', '(absent, off)')!r}")
a_changed = False; a_at = None
if o0.get("timekeeper_text_live") is not True:
    say("  ○ A not changed: the current value is not true, so there is nothing to switch off (reported, not forced).")
else:
    ok, r = sql("""update public.app_data set data = jsonb_set(data, '{timekeeper_text_live}', 'false'::jsonb), updated_at = now()
                    where key = 'ops_settings' and data->'timekeeper_text_live' = 'true'::jsonb
                    returning to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS') || '+00' as at""")
    if not ok or not r: bad("A: the switch could not be changed: " + str(r)[:200])
    else: a_changed = True; a_at = r[0]["at"]; say(f"  ✓ changed at {a_at[:19]} UTC")
o1 = ops()
if o1 is None: bad("A: could not read the settings back")
else:
    if o1.get("timekeeper_text_live") is False: say("  ✓ 1-3. read back: timekeeper_text_live = false")
    else: bad(f"A: read back timekeeper_text_live = {o1.get('timekeeper_text_live')!r}")
    if o1.get("timekeeper_watch_live") is True: say("  ✓ 4. timekeeper_watch_live is still true (missed clock-ins are still detected)")
    else: bad(f"A: timekeeper_watch_live is {o1.get('timekeeper_watch_live')!r}, not true. The watcher is not running. Tell Claude.")
    rest0 = {k: v for k, v in o0.items() if k != "timekeeper_text_live"}; rest1 = {k: v for k, v in o1.items() if k != "timekeeper_text_live"}
    if rest0 == rest1: say(f"  ✓ every other setting ({len(rest1)}) is exactly as before")
    else: bad("A: other settings differ: " + ", ".join(sorted(k for k in set(rest0) | set(rest1) if rest0.get(k) != rest1.get(k))))
ok, cj = sql("select active from cron.job where jobname = 'timekeeper-watch'")
if ok and cj and cj[0]["active"] is True: say("  ✓ 5. the scheduled watcher (every 2 minutes) is still active")
else: bad("A: the scheduled watcher is not active: " + str(cj)[:120])
if a_changed:
    say(f"  … 6. waiting for the watcher's next scheduled run to answer (up to {int(POLL_MAX // 60)} minutes)")
    got = None; waited = 0.0
    while waited <= POLL_MAX and got is None:
        ok, rr = sql("""select content, status_code from net._http_response
                         where created >= '""" + a_at + """'::timestamptz and content like '%settings_in_effect%' and content like '%timekeeper_text_live%'
                         order by created desc limit 1""")
        if ok and rr: got = rr[0]; break
        time.sleep(POLL_SEC); waited += POLL_SEC
    if got is None: bad("A: no answer from the watcher's scheduled run yet. The switch is off (safe); rerun the combined check (271) to confirm the watcher.")
    else:
        try: d = json.loads(got["content"])
        except Exception: d = {}
        sw = ((d.get("settings_in_effect") or {}).get("switches") or {})
        if str(d.get("mode", "")).startswith("LIVE (watch only") and sw.get("timekeeper_text_live") is False and sw.get("timekeeper_watch_live") is True and int(d.get("texts_sent", 0)) == 0 and int(d.get("clockout_texts_sent", 0)) == 0:
            say(f"  ✓ 6. the watcher's own scheduled answer: \"{d.get('mode')}\" · {d.get('visits_seen', '?')} visits seen · texts sent 0 · work items still opened by the ladder")
        else: bad("A: the watcher's answer does not show watch-only mode: " + json.dumps({k: d.get(k) for k in ('mode', 'texts_sent', 'clockout_texts_sent')})[:200])
say()

# ── B ──────────────────────────────────────────────────────────────────────────
say("B. PAUSE AUTOMATIC CAMPAIGN EMAILS TO OPEN LEADS")
def settings_item(c): return next((x for x in (c or []) if isinstance(x, dict) and x.get("id") == "settings"), None)
s0 = settings_item(c0)
if s0 is None: say("  ○ B not changed: no campaign settings row exists (every audience is already off).")
else:
    say(f"  before: master {s0.get('enabled')!r} · open leads {s0.get('aud_monthly')!r} · caregivers {s0.get('aud_caregivers')!r} · active clients {s0.get('aud_clients')!r} · client contacts {s0.get('aud_client_contacts')!r}")
    if not s0.get("aud_monthly"):
        say("  ○ B not changed: open leads is already off.")
    else:
        ok, r = sql("""update public.app_data set data = (select jsonb_agg(case when e->>'id' = 'settings' then e || '{"aud_monthly": false}'::jsonb else e end order by o)
                                                            from jsonb_array_elements(data) with ordinality as t(e, o)), updated_at = now()
                        where key = 'campaign_settings' and jsonb_typeof(data) = 'array'
                        returning to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS') as at""")
        if not ok or not r: bad("B: the audience could not be changed: " + str(r)[:200])
        else: say(f"  ✓ changed at {r[0]['at']} UTC")
    c1 = camp(); s1 = settings_item(c1)
    if s1 is None: bad("B: could not read the campaign settings back")
    else:
        if s1.get("aud_monthly") is False: say("  ✓ read back: open leads = false")
        else: bad(f"B: read back open leads = {s1.get('aud_monthly')!r}")
        r0 = {k: v for k, v in s0.items() if k != "aud_monthly"}; r1 = {k: v for k, v in s1.items() if k != "aud_monthly"}
        if r0 == r1: say(f"  ✓ everything else in the campaign settings is exactly as before (master {s1.get('enabled')!r}, caregivers {s1.get('aud_caregivers')!r})")
        else: bad("B: other campaign settings differ: " + ", ".join(sorted(k for k in set(r0) | set(r1) if r0.get(k) != r1.get(k))))
        others0 = [x for x in c0 if x is not s0]; others1 = [x for x in c1 if not (isinstance(x, dict) and x.get("id") == "settings")]
        if others0 == others1: say("  ✓ no other campaign rows changed")
        else: bad("B: other campaign rows changed")
        if s1.get("aud_clients") or s1.get("aud_client_contacts"):
            bad("B: active-client or client-contact campaigns are ON. Not changed here (outside this slice); tell Claude.")
        else: say("  ✓ active clients and client contacts remain off")
say()
if others_fp() == fp0: say("✓ no other production data changed")
else: bad("something outside these two settings changed while this ran (possibly the hub or a scheduled job); tell Claude")
say()
say("RESULT: " + ("DONE · the caregiver clock-in text and open-lead campaign emails are paused; the watcher still runs" if not fails else "CHECK THE ✗ LINES ABOVE"))
done(0 if not fails else 9)
