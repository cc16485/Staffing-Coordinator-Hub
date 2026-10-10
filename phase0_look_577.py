#!/usr/bin/env python3
# 577 · TWO LOOKS, READ ONLY (Samantha, 2026-10-10, before Phase 1 is built):
#   A. axiscare-push-note, the AxisCare note writer that is live on the Hub project but in no repository: what it does,
#      what triggers it, what it changes, how it authenticates, whether its actions are audited.
#   B. The Hub's orientation reminders: actual per-person deliveries (not run counts), and whether the GoHighLevel
#      workflow could still be sending duplicates.
# Nothing is changed, deployed, sent or switched. Prints counts and first names only: no phone, no email, no secret.
import os, json, re, tempfile, shutil, subprocess
os.environ.setdefault("SB_STEP", "577")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; BASE = f"https://{REF}.supabase.co"
ARCHIVE_SHA = "8c4b09d5ccb01abfa4ad037e002b8b5b95b2af8bae7b231617d5b6e29b7d475e"  # the archived Onboarding-repo build of axiscare-push-note
_say = say
def say(s=""):  # also hide phone numbers
    _say(re.sub(r"(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})", "(a number)", str(s)))
def keys():
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict)}
        got = {k: v for k, v in got.items() if isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_")) and "*" not in v}
        if got.get("service_role"): return got
    return {}
start("TWO LOOKS, READ ONLY: THE UNTRACKED AXISCARE NOTE WRITER, AND ORIENTATION REMINDER DELIVERIES")
say("PART A · axiscare-push-note (nothing changes)")
sx, mx = fmeta(REF, "axiscare-push-note")
if sx != 200: say(f"  · axiscare-push-note is not live ({sx}); the Hub's call to it fails quietly. Nothing more to look at.");
else:
    vj = (mx or {}).get("verify_jwt")
    say(f"  · live: version {mx.get('version', '?')}, created {str(mx.get('created_at', ''))[:10]}, last updated {str(mx.get('updated_at', ''))[:10]}, gateway sign-in check {'ON' if vj else 'OFF'}")
    tmp_ = tempfile.mkdtemp(prefix="cc577-"); os.makedirs(os.path.join(tmp_, "supabase"), exist_ok=True)
    subprocess.run([SUPA, "functions", "download", "axiscare-push-note", "--project-ref", REF, "--use-api"], cwd=tmp_, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    txt = ""; lp = ""
    for r_, _, fs_ in os.walk(tmp_):
        for f_ in fs_:
            if f_ == "index.ts": lp = os.path.join(r_, f_); txt = open(lp, errors="replace").read()
    live_sha = sha(lp) if lp else ""
    shutil.rmtree(tmp_, ignore_errors=True)
    if not txt: bad("could not download the live copy to read it")
    else:
        same = live_sha == ARCHIVE_SHA
        say(f"  {'✓' if same else '·'} the live copy is {'EXACTLY the archived Onboarding-repo build (read and summarised below from that source)' if same else 'NOT the archived build; summarised from markers in the live copy'}")
        marks = {
            "reads client_queue by the id it is given": "from(\"client_queue\")" in txt or "from('client_queue')" in txt,
            "posts a note onto the AxisCare CLIENT profile (/api/notes/client/)": "notes/client" in txt,
            "the note contains the caregiver-call notes and client-call notes typed in the Hub": "caregiver_call_notes" in txt and "client_call_notes" in txt,
            "stores the AxisCare note id back on the client_queue row": "axiscare_note_id" in txt,
            "checks WHO is calling (staff sign-in)": "requireStaff" in txt or "getUser" in txt,
            "checks a job secret or owner key": "jobCaller" in txt or "serverSecretOk" in txt or "x-cron-secret" in txt,
            "writes an AxisCare change-log row": "axiscare_change_record" in txt,
            "writes an op_events row": "op_events" in txt or "opEvent" in txt,
            "uses the AxisCare token from the project's secrets (never from the request)": "AXISCARE_API_KEY" in txt or "AXISCARE_TOKEN" in txt,
        }
        for k, v in marks.items(): say(f"    {'✓' if v else '✗'} {k}")
        say("  · auth, as it stands: " + ("any caller holding the public key passes the gateway and can push a note for ANY client_queue id (no staff check inside)" if vj and not marks["checks WHO is calling (staff sign-in)"] else "no gateway check and no staff check: anyone who knows the URL can call it" if not vj and not marks["checks WHO is calling (staff sign-in)"] else "a staff check exists inside"))
        say("  · audit, as it stands: " + ("none: no change-log row, no event row; only the note id on the queue row" if not marks["writes an AxisCare change-log row"] and not marks["writes an op_events row"] else "it writes a log row"))
    ok_, q = sql(REF, "select count(*)::int as total, count(*) filter (where axiscare_note_id is not null)::int as pushed, count(*) filter (where sched_note_pushed_at > now() - interval '30 days')::int as pushed_30d, count(*) filter (where sched_note_pushed_at > now() - interval '90 days')::int as pushed_90d, max(sched_note_pushed_at) as last_pushed from client_queue")
    if ok_ and q: r = q[0]; say(f"  · client_queue: {r['total']} rows; {r['pushed']} carry an AxisCare note id; {r['pushed_30d']} pushed in the last 30 days, {r['pushed_90d']} in 90; last push {str(r['last_pushed'] or 'never')[:16]}")
    else: say(f"  · client_queue could not be read: {q}")
    say("  · trigger (from the Hub code, cc-hub-live index.html cqMaybePushSchedNote): the New Clients queue calls it automatically, with the coordinator's own sign-in, the moment a row has 'schedule added' ticked, both call notes filled, an AxisCare client id, and no note pushed yet. No button says 'send'. A failure is only a console warning.")
    say("  · what it changes: one AxisCare client note (not marked important) containing the four step timestamps, the caregiver name, both call notes verbatim, and who completed it; then client_queue.axiscare_note_id.")

say(); say("PART B · orientation reminders (nothing changes)")
ok_, sw = sql(REF, "select coalesce((data->>'orient_remind_live')::boolean, false) as live from app_data where key = 'ops_settings'")
live = bool(ok_ and sw and sw[0]["live"])
ok_, on = sql(REF, "select min(at) as first_on from op_events where verb = 'setting_changed' and (summary ilike '%orientation reminder%' or summary ilike '%orient_remind%' or data::text ilike '%orient_remind_live%')")
on_at = (on[0]["first_on"] if ok_ and on and on[0]["first_on"] else None)
say(f"  · the Hub reminder switch is {'ON' if live else 'OFF'}" + (f"; first turned on {str(on_at)[:16]} (from the settings change record)" if on_at else "; no settings-change record found for it (turned on before changes were recorded, or by a Desktop step)"))
ok_, runs = sql(REF, "select mode, count(*)::int as n, min(at) as first, max(at) as last, sum(sent)::int as sent, sum(not_sent)::int as not_sent, sum(failed)::int as failed, sum(would)::int as would, count(*) filter (where not ok)::int as bad_runs from orient_remind_runs group by mode order by mode")
if ok_:
    for r in runs or []: say(f"  · runs in {r['mode']} mode: {r['n']} (first {str(r['first'])[:16]}, last {str(r['last'])[:16]}); totals sent {r['sent'] or 0}, not sent {r['not_sent'] or 0}, failed {r['failed'] or 0}, would-have {r['would'] or 0}; runs that could not run {r['bad_runs']}")
    if not runs: say("  · no runs recorded")
else: say(f"  · run log unreadable: {runs}")
ok_, per = sql(REF, "select session_date, mode, result, count(*)::int as n from orient_reminders group by 1,2,3 order by 1 desc, 2, 3 limit 60")
if ok_:
    say("  · per orientation date (one row per person per session, so nobody can be reminded twice by the Hub):")
    for r in per or []: say(f"      {r['session_date']}  {r['mode']:8} {r['result']:9} {r['n']}")
    if not per: say("      (none yet)")
else: say(f"  · reminder rows unreadable: {per}")
ok_, fails_ = sql(REF, "select session_date, left(coalesce(detail,''), 90) as why from orient_reminders where mode = 'live' and result in ('failed', 'not_sent') order by at desc limit 10")
if ok_ and fails_:
    say("  · live reminders that did not go (most recent, reason only):")
    for r in fails_: say(f"      {r['session_date']}: {r['why']}")
elif ok_: say("  ✓ no live reminder has failed or been refused")
ok_, dup = sql(REF, "select count(*)::int as relayed_total, count(*) filter (where ghl_relayed_at > " + (lit(str(on_at)) + "::timestamptz" if on_at else "now() - interval '14 days'") + ")::int as relayed_since, max(ghl_relayed_at) as last_relay from orient_bookings")
if ok_ and dup:
    r = dup[0]
    say(f"  {'✓' if (r['relayed_since'] or 0) == 0 else '✗'} bookings relayed to the GoHighLevel reminder workflow {'since the switch went on' if on_at else 'in the last 14 days'}: {r['relayed_since'] or 0} (total ever relayed {r['relayed_total'] or 0}; last relay {str(r['last_relay'] or 'never')[:16]})" + ("" if (r['relayed_since'] or 0) == 0 else "  → those people could have been reminded by BOTH systems"))
    if (r['relayed_since'] or 0): fails.append("relays after the switch")
ok_, both = sql(REF, "select count(*)::int as n from orient_bookings b join orient_reminders o on o.phone10 = regexp_replace(coalesce(b.phone,''), '\\D', '', 'g') and o.session_id = b.session_id and o.mode = 'live' and o.result = 'sent' where b.ghl_relayed_at is not null")
if ok_ and both: say(f"  {'✓' if both[0]['n'] == 0 else '✗'} people who got BOTH a Hub reminder and a GoHighLevel relay for the same session: {both[0]['n']}")
ok_, cards = sql(REF, "select count(*)::int as n from app_data, jsonb_array_elements(data) c where key = 'ops_items' and c->>'kind' = 'send_problem' and c->>'sender' ilike '%orient%' and c->>'status' = 'open'")
if ok_ and cards: say(f"  · open Needs Attention send-problem cards from the orientation reminder: {cards[0]['n']}")
K = keys(); SVC = K.get("service_role", ""); HIDE.append(SVC)
if SVC:
    s_, b_ = http("POST", f"{BASE}/functions/v1/ghl-inventory", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 120)
    try: wf = json.loads(b_).get("workflows")
    except Exception: wf = None
    if isinstance(wf, list):
        hits = [w for w in wf if re.search(r"orient", str(w.get("name", "")), re.I)]
        if hits:
            for w in hits: say(f"  · GoHighLevel workflow '{w['name']}': {w['status'] or '?'} (last changed {w['updated'] or '?'})" + ("  → still live: it only fires when orientation-booked relays a booking, which it does not while the Hub switch is on" if str(w.get('status','')).lower() == 'published' else ""))
        else: say("  · no GoHighLevel workflow with 'orient' in its name")
    else: say(f"  · the GoHighLevel workflow list could not be read ({s_}); check the 'Orientation booked - remind' workflow's status in GoHighLevel by hand")
else: say("  · could not read the project's keys, so the GoHighLevel workflow list was not checked")
say()
say("RESULT: " + ("LOOKED · nothing was changed, sent or switched. Findings go to Claude for the Phase 0 report." if not fails else "LOOKED, WITH ✗ LINES · nothing was changed; the ✗ lines need Claude."))
done(0 if not fails else 8)
