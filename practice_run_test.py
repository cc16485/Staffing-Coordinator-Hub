#!/usr/bin/env python3
# Rehearses the five practice-run Desktop steps (591-595) end to end against two real Postgres databases (practice_run_pgbridge.mjs),
# with the management API's function reads, deploys and the live services faked. Between steps it makes the database changes
# Samantha's Hub stations would make. Nothing leaves this machine.   PGLITE=<path> python3 practice_run_test.py
import os, sys, json, subprocess, time, runpy, tempfile, hashlib, urllib.request
ROOT = os.path.dirname(os.path.abspath(__file__)); FNROOT = os.path.join(ROOT, "supabase", "functions")
import socket
_s = socket.socket(); _s.bind(('127.0.0.1', 0)); PORT = _s.getsockname()[1]; _s.close()
TMP = tempfile.mkdtemp(prefix="pr-test-")
srv = subprocess.Popen(["node", os.path.join(ROOT, "practice_run_pgbridge.mjs"), str(PORT)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=os.environ)
assert srv.stdout.readline().strip() == b"ready", "bridge did not start"
os.environ.update({"SB_API_BASE": f"http://127.0.0.1:{PORT}", "SB_TOKEN": "sbp_test", "SB_SUPA_CLI": "/bin/ls", "SB_FNROOT": FNROOT, "SB_PR_OUT": os.path.join(TMP, "out"), "SB_REPORT": os.path.join(TMP, "boot.txt")})
res = []
def ck(n, c, note=""): res.append((n, bool(c), "" if c else str(note)[:600]))
def run(step, extra_env=None):
    os.environ["SB_STEP"] = step; os.environ["SB_REPORT"] = os.path.join(TMP, step + ".txt")
    import cc_step_lib as L
    L.lines.clear(); L.fails.clear(); L.STEP = step; L.REPORT = os.environ["SB_REPORT"]
    code = None
    try: runpy.run_path(os.path.join(ROOT, f"practice_run_{step}.py"), run_name="__main__")
    except SystemExit as e: code = e.code
    txt = open(os.environ["SB_REPORT"]).read() if os.path.exists(os.environ["SB_REPORT"]) else ""
    return code, txt
import cc_step_lib as L
real_http = L.http
CALLS = []
def q(ref, sql_):
    ok_, r = L.sql(ref, sql_)
    assert ok_, r
    return r
def fake_http(method, url, body=None, headers=None, timeout=120):
    if url.startswith(os.environ["SB_API_BASE"]) and "/database/query" in url: return real_http(method, url, body, headers, timeout)
    if "/api-keys" in url: return 200, json.dumps([{"name": "anon", "api_key": "eyJanon"}, {"name": "service_role", "api_key": "eyJsvc"}])
    CALLS.append((url.split("/functions/v1/")[-1] if "/functions/v1/" in url else url, body))
    if url.endswith("/notify-cleared"):   # what the real notice does for a new-path hire: stamp Training, complete the two rows on the Hub card
        cg = q("rdqujxiycycwhskyvrwa", f"select id, axiscare_id from public.caregivers where access_token = {L.lit(body['token'])}")
        if not cg: return 200, '{"status":"unknown_token"}'
        q("rdqujxiycycwhskyvrwa", f"update public.caregivers set cleared_reported_at = now() where id = {L.lit(cg[0]['id'])}")
        q("zngsgedlsxinbygwmxwn", "update public.client_journey_step set state = 'complete', completed_at = now(), completed_by_name = 'Training' where step_key in ('cg.training.orientation', 'cg.training.dementia')")
        return 200, '{"status":"reported_to_hub","applied":2}'
    return 200, '{"ok":true,"practice":true}'
L.http = fake_http
L.fmeta = lambda ref, fn: (200, {"verify_jwt": fn not in ("ghl-attach-doc",), "version": 7})
LIVE_OVERRIDE = {}
def fake_live(ref, fn):
    d = {k: L.sha(os.path.join(ROOT, k)) for k in L.need(FNROOT, fn)}
    d.update(LIVE_OVERRIDE.get(fn, {})); return True, d
L.live_files = fake_live
import hashlib
OLD_CJ = hashlib.sha256(subprocess.run(["git", "-C", ROOT, "show", "958c8098e9c1a2917dec8834ecd1c5239bab576b:supabase/functions/_shared/caregiver-journey.ts"], capture_output=True).stdout).hexdigest()
DEPLOYED = []
def fake_deploy(ref, fnroot, fn, vj): DEPLOYED.append(fn); L.say(f"  ✓ {fn} deployed (rehearsal)"); return True
L.deploy = fake_deploy
import practice_run_lib as P
P.save_object = lambda base, svc, bucket, path, name: (os.makedirs(P.OUT, exist_ok=True) or open(os.path.join(P.OUT, name), "wb").write(b"%PDF fake") or 9)
FN_SHAS = json.dumps({os.path.relpath(os.path.join(ROOT, k), FNROOT): L.sha(os.path.join(ROOT, k)) for fn in ["outreach-check", "ghl-attach-doc"] for k in L.need(FNROOT, fn)})
os.environ["SB_FN_SHAS"] = FN_SHAS
HUB, TRN = "zngsgedlsxinbygwmxwn", "rdqujxiycycwhskyvrwa"
q(HUB, """insert into public.app_data (key, data) values ('ops_settings', '{"offer_send_live": false, "cg_connect_live": true, "orient_remind_live": true}'),
  ('onboarding_permissions', '{"work": [{"email": "zach@mo-care.com", "name": "Zachary"}], "advance": [], "screening": []}'),
  ('candidates', '[{"id": 1, "first": "Real", "last": "Person", "phone": "4175551234"}]'), ('caregivers', '[{"id": 7, "first": "Ann", "last": "Real", "axiscare_id": "12345"}]'),
  ('ops_items', '[{"id": "o1", "title": "a real card", "status": "open"}]'), ('automation_log', '[]')""")

# ── 1. a switch on stops the set-up before anything changes ──
q(HUB, "update public.app_data set data = data || '{\"step2_send_live\": true}' where key = 'ops_settings'")
code, txt = run("591")
ck("591 refuses while a sending switch is on, before anything changes", code == 3 and "step2_send_live" in txt and not q(TRN, "select id from public.job_offers") and not DEPLOYED, txt[-600:])
q(HUB, "update public.app_data set data = data - 'step2_send_live' where key = 'ops_settings'")
q(HUB, "update public.app_data set data = data || '{\"onboarding_switch_date\": \"2026-10-12\"}' where key = 'ops_settings'")
code, txt = run("591")
ck("591 refuses while the switch date is set", code == 3 and "switch date is set" in txt, txt[-400:])
q(HUB, "update public.app_data set data = data - 'onboarding_switch_date' where key = 'ops_settings'")
# ── an unmerged change live on a service: the set-up stops before anything changes ──
LIVE_OVERRIDE["welcome-call"] = {"supabase/functions/_shared/caregiver-journey.ts": "f" * 64}
code, txt = run("591")
ck("591 refuses when a service's live copy holds a version never on main (someone's unmerged work)", code == 3 and "never on main" in txt and not DEPLOYED and not q(TRN, "select id from public.job_offers"), txt[-700:])
# ── a live copy built before the service used a file (the file is simply not there): brought up to main ──
def fake_live_missing(ref, fn):
    ok_, d = fake_live(ref, fn)
    if fn == "ghl-attach-doc": d.pop("supabase/functions/_shared/send-problems.ts", None); d.pop("supabase/functions/_shared/verbs.js", None)
    return ok_, d
L.live_files = fake_live_missing
# ── an older live copy (a version from main's own history): brought up to main ──
LIVE_OVERRIDE["welcome-call"] = {"supabase/functions/_shared/caregiver-journey.ts": OLD_CJ}
# ── 2. the set-up ──
code, txt = run("591")
ck("591 says which older shared files it brings up to main", "older versions (from main's own history) of _shared/caregiver-journey.ts" in txt, txt[-900:])
ck("591: a live copy missing files main now uses (built before it used them) is brought up to main, not refused", "built before it used _shared/send-problems.ts" in txt or "built before it used _shared/verbs.js" in txt, txt[-900:])
o = q(TRN, "select * from public.job_offers")
ck("591: the guard deployed to the nine services, then ONE offer for Pat on the new path with its sent event", code == 0 and len(DEPLOYED) == 9 and len(o) == 1 and o[0]['onboarding_path'] == 'new' and o[0]['phone'] == '4175550183' and o[0]['email'] == 'pat.practice@practice.invalid'
   and q(TRN, "select count(*)::int n from public.offer_events where kind = 'sent'")[0]['n'] == 1, txt[-900:])
ck("591: says you are not on the Approve to Work list", "not on the Approve to Work list" in txt)
ck("591: the station guide and the practice proof PDF are in the folder", os.path.exists(os.path.join(P.OUT, "Stations.txt")) and open(os.path.join(P.OUT, "Practice proof.pdf"), "rb").read().startswith(b"%PDF"))
ck("591: no real person, no em dash in the guide", "—" not in open(os.path.join(P.OUT, "Stations.txt")).read())
code, txt = run("591")
ck("591 again: refuses (a practice-run offer is already open)", code == 3 and "already open" in txt)
oid = o[0]['id']
# ── stations 1-7, as the Hub would leave them ──
q(TRN, f"update public.job_offers set offer_signed_at = now(), pd_signed_at = now(), offer_signer_name = 'Pat Practice', step1_done_at = now(), offer_pdf_path = 'offers/{oid}/offer.pdf', pd_pdf_path = 'offers/{oid}/pd.pdf' where id = '{oid}'")
q(TRN, f"insert into public.offer_events (offer_id, kind, by_who) values ('{oid}', 'signed', 'caregiver'), ('{oid}', 'step1_done', 'signature')")
q(HUB, f"""update public.app_data set data = data || jsonb_build_array(jsonb_build_object('id', 42, 'first', 'Pat', 'last', 'Practice', 'phone', '4175550183', 'offer_id', '{oid}', 'oig', 'CLEAR', 'oig_date', '2026-10-11',
  'step2_msg', jsonb_build_object('state', 'practice', 'text', 'Hi Pat, when Step 2 is done tap https://cc.mo-care.com/step2.html?c=42&e=1&t=abc. Thanks'))) where key = 'candidates'""")
j = q(HUB, f"insert into public.client_journey (subject, offer_id, client_name, status) values ('caregiver', '{oid}', 'Pat Practice', 'open') returning journey_id")[0]['journey_id']
q(HUB, f"insert into public.client_journey_step (journey_id, step_key, state) values ('{j}', 'cg.training.orientation', 'open'), ('{j}', 'cg.training.dementia', 'open'), ('{j}', 'cg.approve.work', 'open')")
q(HUB, f"insert into public.step1_forms (offer_id, completed_at, signatures, pdfs) values ('{oid}', now(), '{{\"employee_application\": {{\"at\": \"2026-10-11\", \"typed_name\": \"Pat Practice\", \"version\": 1}}}}', '{{\"employee_application\": {{\"path\": \"step1/{oid}/app.pdf\"}}}}')")
q(HUB, f"insert into public.step1_identity (offer_id, ssn_last4, license_last4, license_state, reveals) values ('{oid}', '6789', '5678', 'MO', 0)")
w = q(HUB, "insert into public.welcome_calls (candidate_id, phone, status) values ('42', '4175550183', 'booked') returning id")[0]['id']
code, txt = run("592")
ck("592 (read only): prints the Step 2 DONE link and the welcome call booking link", code == 0 and "https://cc.mo-care.com/step2.html?c=42&e=1&t=abc" in txt and f"welcome.html?w={w}" in txt, txt[-900:])
code, txt = run("593")
ck("593 refuses until Pat is on the caregiver roster (welcome call done)", code == 3 and "not on the caregiver roster" in txt and not q(TRN, "select id from public.caregivers"), txt[-500:])
q(HUB, "update public.welcome_calls set status = 'done', done_at = now()")
q(HUB, f"""update public.app_data set data = (select jsonb_agg(x) from jsonb_array_elements(data) x where x->>'id' <> '42') where key = 'candidates'""")
q(HUB, f"""update public.app_data set data = data || jsonb_build_array(jsonb_build_object('id', 99, 'first', 'Pat', 'last', 'Practice', 'phone', '4175550183', 'offer_id', '{oid}', 'candidate_id', 42,
  'step2_msg', jsonb_build_object('state', 'practice', 'text', 'x'), 'step2_sent_at', '2026-10-11', 'step2_verified_at', '2026-10-11')) where key = 'caregivers'""")
q(HUB, "insert into public.contact_send_refusal (sender, channel, address, reasons) values ('welcome-call', 'sms', '+14175550183', '[\"practice\"]'), ('welcome-call', 'sms', '+14175551234', '[\"real, not Pat\"]')")
# ── station 8: training ──
code, txt = run("593")
cg = q(TRN, "select * from public.caregivers")
enr = q(TRN, "select e.status, e.requirement, c.slug from public.enrollments e join public.courses c on c.id = e.course_id order by c.slug")
ck("593: Pat's Training row, In Training, made-up AxisCare number; courses assigned by the trigger", code == 0 and len(cg) == 1 and cg[0]['axiscare_id'] == '990000183' and cg[0]['status_label'] == 'In Training' and len(enr) == 3, txt[-900:])
ck("593: orientation and Dementia complete with completion rows; on-the-job training untouched", [e['status'] for e in enr if e['requirement'] == 'pre_service'] == ['complete', 'complete'] and [e['status'] for e in enr if e['requirement'] == 'ojt'] == ['not_started']
   and q(TRN, "select count(*)::int n from public.completions")[0]['n'] == 2, enr)
ck("593: the offer is matched to the row; only Pat's roster record got the made-up AxisCare number", q(TRN, "select matched_caregiver_id from public.job_offers")[0]['matched_caregiver_id'] == cg[0]['id']
   and q(HUB, "select string_agg(x->>'id' || ':' || coalesce(x->>'axiscare_id', ''), ',' order by x->>'id') s from public.app_data, jsonb_array_elements(data) x where key = 'caregivers'")[0]['s'] == '7:12345,99:990000183')
ck("593: the real completion notice was called with Pat's own training link, and the card shows both courses", any(c[0] == 'notify-cleared' and c[1].get('token') == cg[0]['access_token'] for c in CALLS) and "✓ the readiness card shows orientation and the Dementia course complete" in txt, txt[-700:])
ck("593: the training link is never printed", cg[0]['access_token'] not in txt)
code, txt = run("593")
ck("593 again: reuses Pat's row (no second row, no second completion)", code == 0 and len(q(TRN, "select id from public.caregivers")) == 1 and q(TRN, "select count(*)::int n from public.completions")[0]['n'] == 2, txt[-400:])
# ── the report ──
CALLS.clear()
code, txt = run("594")
kicks = [c[0] for c in CALLS]
ck("594: ran the nightly passes once (sweep, nightly, Step 2 pass, eligibility, obligations)", kicks[:5] == ['caregiver-journey', 'caregiver-journey', 'step2-handoff', 'eligibility-sweep', 'obligations-run'], kicks)
ck("594: the trail, the card, the refused sends (Pat's only), the Training record and the retirement checks are in the report", "step1_done" in txt and "cg.training.dementia" in txt and "+14175550183" in txt and "+14175551234" not in txt and "Training: Pat Practice" in txt and "PART 10" in txt and "SSN ending 6789" in txt, txt[-1500:])
ck("594: the PDFs saved into the folder, run.json written", all(os.path.exists(os.path.join(P.OUT, n)) for n in ["Pat Practice - offer letter.pdf", "Pat Practice - position description.pdf", "Pat Practice - Step 1 - employee_application.pdf", "run.json"]))
ck("594: read only apart from the kicks (no offer, record or card changed)", q(TRN, "select offer_status from public.job_offers")[0]['offer_status'] == 'sent' and q(HUB, "select jsonb_array_length(data) n from public.app_data where key = 'caregivers'")[0]['n'] == 2)
# ── close-out ──
q(HUB, f"""update public.app_data set data = data || jsonb_build_array(jsonb_build_object('id', 'cj_x', 'title', 'Didn''t go through: Pat Practice', 'status', 'open')) where key = 'ops_items'""")
code, txt = run("595")
ck("595: the offer is withdrawn with an event; the Training row inactive", code == 0 and q(TRN, "select offer_status from public.job_offers")[0]['offer_status'] == 'withdrawn' and q(TRN, "select count(*)::int n from public.offer_events where kind = 'withdrawn'")[0]['n'] == 1
   and q(TRN, "select active from public.caregivers")[0]['active'] is False, txt[-900:])
ck("595: the card closed with an event; Pat's card done, the real card untouched", q(HUB, "select status from public.client_journey")[0]['status'] == 'closed' and q(HUB, "select count(*)::int n from public.client_journey_event where kind = 'closed'")[0]['n'] == 1
   and q(HUB, "select string_agg(x->>'id' || ':' || (x->>'status'), ',' order by x->>'id') s from public.app_data, jsonb_array_elements(data) x where key = 'ops_items'")[0]['s'] == 'cj_x:done,o1:open')
ck("595: only Pat's records came off the lists; the real people stay; the value history kept Pat's", q(HUB, "select string_agg(x->>'id', ',' order by x->>'id') s from public.app_data, jsonb_array_elements(data) x where key in ('candidates', 'caregivers')")[0]['s'] == '1,7'
   and q(HUB, "select count(*)::int n from public.evidence_history where change = 'removed' and record_id = '99'")[0]['n'] == 1)
code, txt = run("595")
ck("595 again: safe (nothing more to do, nothing broken)", code == 0 and q(TRN, "select count(*)::int n from public.offer_events where kind = 'withdrawn'")[0]['n'] == 1, txt[-500:])
srv.terminate()
for n, ok_, note in res: print(("PASS  " if ok_ else "FAIL  ") + n + ("" if ok_ else "\n      " + note))
bad = [r for r in res if not r[1]]; print(f"{len(res) - len(bad)}/{len(res)} passed"); sys.exit(1 if bad else 0)
