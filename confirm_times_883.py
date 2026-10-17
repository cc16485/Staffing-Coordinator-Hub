#!/usr/bin/env python3
# 883 · THE EVV FORM IS RETIRED: CALL THE CLIENT TO CONFIRM THE TIMES (Samantha 2026-10-17: "just have the policy that we
# call the client to confirm a caregivers time or arrival departure if they didnt clock out"; "completely remove the EVV
# tab"; "The SOP is right as written. Build it all").
#  · redeploys timekeeper-watch (missed clock-in becomes a Call card when the shift ends; a missed clock-out becomes one
#    30 minutes after the end; the clock-out text has no form link; no next-visit signing text, no Saturday reminder),
#    coverage-watch (the overnight check: yesterday's visits still missing a time get a Call card) and clockin-alert
#    ("Text the EVV form" refused, nothing sent)
#  · settings: the next-visit signing text and the Saturday EVV reminder off; a saved clock-out wording that still links
#    to the form is taken out (the standard wording goes). The old values are kept in ops_settings.confirm_times_previous.
#  · every EVV form still waiting, and every open "EVV fix needed" card, becomes ONE Call card (the form itself is kept
#    as it is and still shows on the caregiver's and client's profiles)
#  · publishes the procedure she approved: Procedures > "Missed clock-in or clock-out: confirm the times with the client"
#  Nothing is texted, emailed or called by this step. Nobody outside the office is ever contacted by the cards.
import json, os, re, subprocess, datetime as dt
os.environ.setdefault("SB_STEP", "883")
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta, API, MG, HIDE

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FNS = ("timekeeper-watch", "coverage-watch", "clockin-alert")
OWNER_DEFAULT = "samantha@mo-care.com"
ok = lambda s: say("  ✓ " + s)
def run(args, inp=None): p = subprocess.run(args, capture_output=True, text=True, input=inp, cwd=ROOT); return p.returncode, (p.stdout or ""), (p.stderr or "")
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)
def q(v): return "'" + str(v).replace("'", "''") + "'"
def jlit(o): return "$cc883$" + json.dumps(o) + "$cc883$::jsonb"
NOW = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

start("THE EVV FORM IS RETIRED: CALL THE CLIENT TO CONFIRM THE TIMES")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
for fn in FNS:
    drift = []
    for k in sorted(L.need(FNROOT, fn)):
        c2, b2, _ = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
        if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
    if drift: stop(f"{fn} isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
    ok(f"{fn}: the reviewed build is what is on GitHub's main")
gate = {}
for fn in FNS:
    s, m = fmeta(REF, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})")
    gate[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate[fn] else 'off'} (kept)")

ok1, r1 = sql(REF, """select (select data from public.app_data where key = 'ops_settings') as st,
  (select data from public.app_data where key = 'ops_items') as ops,
  (select data from public.app_data where key = 'timekeeper_cases') as tk,
  (select data from public.app_data where key = 'sop_library') as sop,
  to_regclass('public.evv_submissions') is not null as has_forms""")
if not ok1: stop(f"could not read the database: {r1}")
x = r1[0]
st = x["st"] if isinstance(x["st"], dict) else json.loads(x["st"] or "{}")
ops = x["ops"] if isinstance(x["ops"], list) else json.loads(x["ops"] or "[]")
tk = x["tk"] if isinstance(x["tk"], list) else json.loads(x["tk"] or "[]")
sop = x["sop"] if isinstance(x["sop"], list) else json.loads(x["sop"] or "[]")
admins = st.get("coverage_alert_admins") if isinstance(st.get("coverage_alert_admins"), list) and st.get("coverage_alert_admins") else [OWNER_DEFAULT]
OWNER = str(admins[0])
say(f"  · switches now: watcher {'on' if st.get('timekeeper_watch_live') is True else 'OFF'}, loops {'on' if st.get('loops_close_live') is True else 'OFF'} (the Call cards need both on), "
    f"next-visit signing text {'on' if st.get('evv_next_visit_live') is True else 'off'}, Saturday EVV reminder {'on' if st.get('evv_chase_live') is True else 'off'}")
if not (st.get("timekeeper_watch_live") is True and st.get("loops_close_live") is True):
    say("  · NOTE: with either switch off, the watcher only lists the Call cards it would make. Tell Claude if that is not what you expect.")
msg_out = str(st.get("timekeeper_msg_out") or "")
fix_msg = bool(re.search(r"evv-correction-form", msg_out, re.I))
say("  · your saved clock-out wording " + ("still links to the form: it will be taken out and the standard wording used" if fix_msg else ("has no form link: kept as it is" if msg_out else "is the standard one")))
have = {str(i.get("id")) for i in ops if isinstance(i, dict)}

# EVV forms still waiting (never processed): each becomes ONE Call card
forms = []
if x["has_forms"]:
    okf, rf = sql(REF, "select to_jsonb(s) as r from public.evv_submissions s where coalesce(s.processed, false) = false order by s.visitdate nulls last")
    if not okf: stop(f"could not read the waiting EVV forms: {rf}")
    forms = [f["r"] if isinstance(f["r"], dict) else json.loads(f["r"]) for f in rf]
hm = lambda t: (re.match(r"^\d{1,2}:\d{2}", str(t or "")) or [None])[0]
hm2 = lambda t: (hm(t) or "").zfill(5) if hm(t) else ""
visits = []
for f in forms:
    vid = str(f.get("axiscare_visit_id") or "") or f"form_{f.get('id')}"
    cg = str(f.get("caregiver_linked_name") or f.get("attendant") or "the caregiver")
    cl = str(f.get("client_linked_name") or f.get("consumer") or "the client")
    nin, nout = hm2(f.get("new_in")), hm2(f.get("new_out"))
    visits.append({ "visit_id": vid, "caregiver": cg, "caregiver_axiscare_id": f.get("caregiver_axiscare_id"),
        "client_first": cl.split()[0] if cl.split() else "the client", "client_name": cl, "client_axiscare_id": f.get("client_axiscare_id"),
        "shift_date": str(f.get("visitdate") or "")[:10], "start": nin, "end": nout,
        "missing": "both" if nin and nout else ("in" if nin else "out"), "times_label": "asked for on the form",
        "source": "883 (an EVV form that was waiting)", "extra": { "from_evv_form": str(f.get("id")) },
        "detail_prefix": f"From an EVV correction form {cg} sent: the form is no longer used, so confirm the times with {cl.split()[0] if cl.split() else 'the client'} by phone instead." })
# open "EVV fix needed" cards: each becomes ONE Call card for the same visit, and the old card closes
old_fix = [i for i in ops if isinstance(i, dict) and i.get("kind") == "evv_fix" and i.get("status") == "open"]
lad = {str(l.get("evv_fix_item") or ""): l for l in tk if isinstance(l, dict) and l.get("evv_fix_item")}
for i in old_fix:
    l = lad.get(str(i.get("id")), {})
    m_ = re.search(r"EVV fix needed: (.+?), (.+?)'s ", str(i.get("title") or ""))
    visits.append({ "visit_id": str(i.get("visit_id") or l.get("visit_id") or i.get("id")), "caregiver": str(i.get("about") or l.get("caregiver") or (m_.group(1) if m_ else "the caregiver")),
        "caregiver_axiscare_id": l.get("caregiver_axiscare_id"), "client_first": str(l.get("client_first") or (m_.group(2) if m_ else "the client")),
        "client_axiscare_id": l.get("client_axiscare_id"), "shift_date": str(i.get("shift_date") or l.get("shift_date") or ""),
        "start": hm2(i.get("shift_time") or l.get("shift_time")), "end": "", "missing": "both",
        "source": "883 (an EVV fix card)", "extra": { "from_evv_fix": str(i.get("id")) } })
rc, outj, errj = run(["node", os.path.join(ROOT, "confirm_times_883_cards.mjs")], json.dumps({ "now": NOW, "owner": OWNER, "visits": visits }))
if rc != 0: stop("could not build the cards with the server's own builder: " + (errj or outj)[-200:])
cards = json.loads(outj or "[]")
seen = set(); new_cards = []
for c in cards:
    if c["id"] in have or c["id"] in seen: continue
    seen.add(c["id"]); new_cards.append(c)
say(f"  · EVV forms still waiting: {len(forms)}; open \"EVV fix needed\" cards: {len(old_fix)}; Call cards to make: {len(new_cards)}" + (f" ({len(cards) - len(new_cards)} visit(s) already have one)" if len(cards) != len(new_cards) else ""))
for c in new_cards[:25]: say(f"      {c['title']}")

SOP = json.load(open(os.path.join(ROOT, "confirm_times_883_sop.json")))
SOP_DOC = dict(SOP, id="sop_" + SOP["slot"], status="published", drafted_by="Claude, 2026-10-17",
    reviewed_at=NOW, reviewed_by="samantha@mo-care.com (approved in chat 2026-10-17: \"The SOP is right as written\")", updated_at=NOW)
cur = next((d for d in sop if isinstance(d, dict) and d.get("id") == SOP_DOC["id"]), None)
say("  · the procedure \"" + SOP["title"] + "\": " + ("there now as a " + str(cur.get("status") or "document") + " (\"" + str(cur.get("title") or "") + "\"), it will be replaced by the approved wording, published" if cur else "not there yet, it will be added, published"))
say("  · what changes: 3 functions redeployed, 3 settings, " + str(len(new_cards)) + " Call card(s), " + str(len(old_fix)) + " old EVV fix card(s) closed, 1 procedure published. Nothing is texted, emailed or called.")
if L.fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, gate[fn]):
        say(f"  RESULT: STOPPED at {fn}. Tell Claude. (Settings, cards and the procedure were not changed.)"); done(7)
prev = { "at": NOW, "evv_next_visit_live": st.get("evv_next_visit_live"), "evv_chase_live": st.get("evv_chase_live"), "timekeeper_msg_out": msg_out or None }
okS, rS = sql(REF, f"""update public.app_data set data = (coalesce(data, '{{}}'::jsonb) {"- 'timekeeper_msg_out'" if fix_msg else ""})
  || jsonb_build_object('evv_next_visit_live', false, 'evv_chase_live', false, 'confirm_times_previous', {jlit(prev)}), updated_at = now()
  where key = 'ops_settings' returning data->'evv_next_visit_live' as nv, data->'evv_chase_live' as ch, data ? 'timekeeper_msg_out' as has_out""")
if okS and rS and rS[0]["nv"] is False and rS[0]["ch"] is False and (not fix_msg or rS[0]["has_out"] is False):
    ok("settings: next-visit signing text off, Saturday EVV reminder off" + (", the old clock-out wording with the form link taken out" if fix_msg else "") + " (old values kept in confirm_times_previous)")
else: bad(f"the settings did not change as expected: {rS}")
made = 0
for c in new_cards:
    okC, rC = sql(REF, f"select public.upsert_app_data_item('ops_items', {jlit(c)})")
    if okC: made += 1
    else: bad(f"card not made ({c['id']}): {rC}")
for i in old_fix:
    j = dict(i, status="resolved", resolved_at=NOW, resolved_how="became_confirm_times", close_note="The EVV form is retired: now a call to the client to confirm the times.")
    okC, rC = sql(REF, f"select public.upsert_app_data_item('ops_items', {jlit(j)})")
    if not okC: bad(f"old EVV fix card not closed ({i.get('id')}): {rC}")
ok(f"{made} Call card(s) made, {len(old_fix)} old EVV fix card(s) closed") if made == len(new_cards) else bad(f"only {made} of {len(new_cards)} Call cards were made")
okP, rP = sql(REF, f"select public.upsert_app_data_item('sop_library', {jlit(SOP_DOC)})")
ok("the procedure is published in Procedures") if okP else bad(f"the procedure was not saved: {rP}")

say(); say("PART 3 · PROOF (nothing is sent)")
ok3, r3 = sql(REF, f"""select (select count(*) from jsonb_array_elements(coalesce((select data from public.app_data where key = 'ops_items'), '[]'::jsonb)) e
     where e->>'kind' = 'confirm_times' and e->>'status' = 'open') as open_cards,
  (select count(*) from jsonb_array_elements(coalesce((select data from public.app_data where key = 'ops_items'), '[]'::jsonb)) e
     where e->>'kind' = 'evv_fix' and e->>'status' = 'open') as open_fix,
  (select e->>'status' from jsonb_array_elements(coalesce((select data from public.app_data where key = 'sop_library'), '[]'::jsonb)) e where e->>'id' = {q(SOP_DOC['id'])}) as sop_status""")
if ok3:
    y = r3[0]
    ok(f"read back: {y['open_cards']} open Call card(s), {y['open_fix']} open EVV fix card(s), the procedure is {y['sop_status']}") if int(y["open_fix"]) == 0 and y["sop_status"] == "published" else bad(f"read back is not right: {y}")
else: bad(f"could not read back: {r3}")
sK, bK = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG())
SVC = ""
try: SVC = next((k.get("api_key", "") for k in json.loads(bK) if isinstance(k, dict) and k.get("name") == "service_role"), "") if sK == 200 else ""
except Exception: SVC = ""
HIDE.append(SVC)
if SVC:
    s4, b4 = http("POST", f"{FNB}/functions/v1/timekeeper-watch?dry=1", {}, { "Authorization": "Bearer " + SVC, "apikey": SVC })
    try: j4 = json.loads(b4)
    except Exception: j4 = {}
    if s4 == 200 and "confirm_times" in j4 and "retired" in json.dumps(j4.get("evv_next_visit", {})):
        ok(f"a practice run of the watcher (nothing written or sent): the Call cards are in, out after {j4['confirm_times'].get('out_after_min')} minutes; the signing text and Saturday reminder are retired")
    else: bad(f"the watcher's practice run did not answer as expected ({s4}): {b4[:200]}")
else: say("  · could not read the server key for the practice run; skipped (the deploy itself was checked above)")
s5, _ = http("OPTIONS", f"{FNB}/functions/v1/clockin-alert"); ok("the missed clock-in link page can still reach its function") if s5 == 200 else bad(f"clockin-alert: the browser check answered {s5}")
say("  · tested before deploying: the watcher, the overnight check and the link page against fakes (timekeeper-watch, coverage-watch, clockin-alert; 62 + 64 + 57 + 35 + 10 checks), and the Hub card and screens (30 + 11).")
say()
if L.fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Merge the Hub pull request next (it removes the EVV tab and adds the Call card buttons). Nothing was sent by this step."); done(0)
