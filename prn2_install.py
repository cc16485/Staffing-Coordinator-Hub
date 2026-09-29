#!/usr/bin/env python3
# PRN2 · FROM HIRE TO THE PRN TEAM (Desktop 356). Samantha approved 2026-09-29 ("yes to all", one pay track at a time).
# Part 1 (read only): the reviewed builds; the approved rates in Pay rates (PRN CNA Team, CNA); the tables/function
#   are new (or ours from an earlier run).
# Part 2: prn2.sql in one transaction (pay_tracks, the append-only history, pay_track_change); deploy prn-team with its
#   sign-in check on; the PRN CNA Team rate ($20) added to Pay rates if it isn't there (nothing else in it touched).
# Part 3 (proof; nothing is kept and nothing is sent): a practice start and Move to ongoing in a transaction that is
#   undone; history can't be edited; staff can't write around the function; the public can't read; prn-team refuses
#   anyone who isn't office staff; and whether PRN Team and CNA exist in AxisCare yet (read only).
# Prints counts only: no name, number, email, key or secret.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "prn-team"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=150):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-prn2/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql_raw(q): return http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
def sql(q):
    s, b = sql_raw(q)
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def lit(v): return "'" + str(v).replace("'", "''") + "'"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def src_path(name):
    if name.startswith("_shared/"): return os.path.join(FNROOT, name + ".ts")
    if name.endswith((".sql", ".json")): return os.path.join(REPO, name)
    return os.path.join(FNROOT, name, "index.ts")
money = lambda v: "not set" if v is None else "$" + (("%.2f" % float(v)).rstrip("0").rstrip("."))

say("PRN2 · FROM HIRE TO THE PRN TEAM"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
for name, want in SHAS.items():
    if sha(src_path(name)) != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
if not {FN, "_shared/staff-auth", "prn2.sql"} <= set(SHAS): bad("the reviewed list is incomplete"); done(2)
say("  ✓ the database change, the PRN Team function and the staff check are the reviewed builds")
ok, st = sql("""select to_regclass('public.pay_tracks') is not null as tracks, to_regclass('public.job_applicants') is not null as apps,
  (select count(*) from public.job_positions where key = 'prn_cna' and track = 'prn')::int as role,
  (select data from public.app_data where key = 'pay_rates') as pay_rates""")
if not ok or not st: bad("could not read the database. Nothing was changed. " + str(st)[:200]); done(4)
S0 = st[0]
if not S0["apps"] or S0["role"] != 1: bad("the PRN CNA Team role from PRN1 isn't there (unexpected). Nothing was changed."); done(4)
PR = S0["pay_rates"] if isinstance(S0["pay_rates"], list) else json.loads(S0["pay_rates"] or "[]")
REC = next((x for x in PR if isinstance(x, dict) and x.get("id") == "rates"), None)
rates = (REC or {}).get("rates") or {}
num = lambda v: (float(v) if v not in (None, "") and str(v).replace(".", "", 1).isdigit() else None)
prn_min, cna_min = num((rates.get("prn_cna") or {}).get("min")), num((rates.get("cna") or {}).get("min"))
say(f"  · approved rates now: PRN CNA Team {money(prn_min)} · CNA {money(cna_min)} · tables {'already there (an earlier run)' if S0['tracks'] else 'new'}")
if cna_min is not None and abs(cna_min - 18) > 0.001:
    bad(f"the approved CNA rate in Pay rates is {money(cna_min)}, not $18. Move to ongoing uses it, so change it in Pay rates (Today) or tell Claude. Nothing else is affected.")
if prn_min is not None and abs(prn_min - 20) > 0.001:
    bad(f"the approved PRN CNA Team rate in Pay rates is {money(prn_min)}, not $20. The offer and the pay track use it; change it in Pay rates or tell Claude.")
s1, b1 = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
say(f"  · the PRN Team function: {'already deployed (an earlier run)' if s1 == 200 else 'new'}")

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(os.path.join(REPO, "prn2.sql")).read() + "\ncommit;")
if not ok: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok, v = sql("""select to_regclass('public.pay_tracks') is not null as t, to_regclass('public.pay_track_history') is not null as h,
  exists (select 1 from pg_trigger where tgname = 'pay_track_history_frozen') as frozen, exists (select 1 from pg_proc where proname = 'pay_track_change') as fn""")
V = v[0] if ok and v else {}
(say if all(V.get(k) for k in ("t", "h", "frozen", "fn")) else bad)(("  ✓ " if all(V.get(k) for k in ("t", "h", "frozen", "fn")) else "") + "the database: each person's one current track, the history that is only ever added to, and the one way to change a track")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"], cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad(f"{FN}: deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Tell Claude."); done(6)
s2, b2 = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
try: vj = json.loads(b2).get("verify_jwt") if s2 == 200 else None
except Exception: vj = None
(say if vj is True else bad)(("  ✓ " if vj is True else "") + f"the PRN Team function deployed, sign-in check {'on' if vj else 'NOT on (' + str(vj) + ')'}")
if prn_min is None:
    if REC is None: newpr = PR + [{"id": "rates", "rates": {"prn_cna": {"min": 20, "max": 20}}, "note": "", "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(), "updated_by": "Desktop 356 (Samantha's approval)"}]
    else:
        newpr = [dict(x, rates=dict(x.get("rates") or {}, prn_cna={"min": 20, "max": 20}), updated_at=dt.datetime.now(dt.timezone.utc).isoformat(), updated_by="Desktop 356 (Samantha's approval)")
                 if isinstance(x, dict) and x.get("id") == "rates" else x for x in PR]
    old = json.dumps(PR)
    ok, r = sql("update public.app_data set data = " + lit(json.dumps(newpr)) + "::jsonb where key = 'pay_rates' and data = " + lit(old) + "::jsonb returning key"
                if S0["pay_rates"] is not None else "insert into public.app_data (key, data) values ('pay_rates', " + lit(json.dumps(newpr)) + "::jsonb) on conflict (key) do nothing returning key")
    (say if ok and r else bad)(("  ✓ " if ok and r else "") + ("Pay rates: PRN CNA Team $20 added (every other rate left exactly as it was)" if ok and r else "could not add the PRN CNA Team rate to Pay rates (it may have changed meanwhile); add $20 in Pay rates"))
else: say("  · Pay rates already has the PRN CNA Team rate; left as it is")

say(); say("PART 3 · PROOF (a practice pay track, undone; nothing is sent)")
PROOF = """do $proof$
declare a uuid; r1 jsonb; r2 jsonb; frozen text := ''; two text := ''; stale text := ''; staff text := ''; v_hist int; v_track text; v_rate numeric;
begin
  insert into public.job_applicants (first_name, last_name, status, position) values ('356 practice', '(undone)', 'new', 'prn_cna') returning id into a;
  r1 := public.pay_track_change(a, null, 'prn_team', 20, current_date, 'Desktop 356', 'Joined the PRN CNA Team (practice)');
  begin perform public.pay_track_change(a, 'ongoing', 'prn_team', 20, current_date, 'x', 'y'); exception when others then stale := sqlerrm; end;
  r2 := public.pay_track_change(a, 'prn_team', 'ongoing', 18, current_date, 'Desktop 356', 'Transitioned to ongoing scheduled shifts (practice)');
  begin insert into public.pay_tracks (applicant_id, track, rate, since) values (a, 'prn_team', 20, current_date); exception when others then two := 'refused'; end;
  begin update public.pay_track_history set to_rate = 20 where applicant_id = a; exception when others then frozen := sqlerrm; end;
  begin set local role authenticated; update public.pay_tracks set rate = 20 where applicant_id = a; exception when others then staff := 'refused'; end;
  reset role;
  select t.track, t.rate into v_track, v_rate from public.pay_tracks t where t.applicant_id = a;
  select count(*) into v_hist from public.pay_track_history h where h.applicant_id = a;
  raise exception 'PRN2_PROOF:%', jsonb_build_object('r1', r1->>'outcome', 'r2', r2->>'outcome', 'stale', stale, 'two', two, 'frozen', frozen, 'staff', staff,
    'track', v_track, 'rate', v_rate, 'hist', v_hist)::text;
end $proof$;"""
s, b = sql_raw(PROOF)
try: msg = json.loads(b).get("message", "")
except Exception: msg = b or ""
P = None
if "PRN2_PROOF:" in msg:
    try: P = json.JSONDecoder().raw_decode(msg[msg.index("PRN2_PROOF:") + 11:])[0]
    except Exception: P = None
if not P: bad("the practice pay track didn't run: " + re.sub(r"\s+", " ", msg)[:300])
else:
    def chk(good, text): (say if good else bad)(("  ✓ " if good else "") + text + ("" if good else " · " + json.dumps(P)[:240]))
    chk(P.get("r1") == "changed" and P.get("r2") == "changed" and P.get("track") == "ongoing" and float(P.get("rate") or 0) == 18 and P.get("hist") == 2,
        "joining the PRN CNA Team ($20) then Move to ongoing ($18): one current track, two history lines")
    chk("TRACK_CHANGED" in (P.get("stale") or ""), "a move from a page that's out of date is refused")
    chk(P.get("two") == "refused", "two tracks at once can't be stored")
    chk("HISTORY_IS_KEPT" in (P.get("frozen") or ""), "history can't be edited, even with the server key")
    chk(P.get("staff") == "refused", "staff can't change a track except through the PRN Team function")
ok, left = sql("select (select count(*) from public.job_applicants where first_name = '356 practice')::int as a, (select count(*) from public.pay_track_history where changed_by = 'Desktop 356')::int as h")
(say if ok and left and left[0]["a"] == 0 and left[0]["h"] == 0 else bad)(("  ✓ " if ok and left and left[0]["a"] == 0 and left[0]["h"] == 0 else "") + "nothing from the practice was kept")
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)}
except Exception: keys = {}
ANON, SVC = keys.get("anon", ""), keys.get("service_role", ""); HIDE += [ANON, SVC]
sR, bR = http("GET", f"{FNB}/rest/v1/pay_tracks?select=applicant_id&limit=1", None, {"apikey": ANON, "Authorization": "Bearer " + ANON})
g = sR != 200 or bR.strip() in ("[]", "")
(say if g else bad)(("  ✓ " if g else "") + f"the public can't read pay tracks ({sR})")
FU = f"{FNB}/functions/v1/{FN}"
n1 = http("POST", FU, {"action": "list"})[0]
n2 = http("POST", FU, {"action": "list"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
n3 = http("POST", FU, {"action": "move", "applicant_id": "00000000-0000-0000-0000-000000000000", "to": "ongoing"}, {"apikey": SVC, "Authorization": "Bearer " + SVC})[0]
g = n1 == 401 and n2 == 401 and n3 == 403
(say if g else bad)(("  ✓ " if g else "") + f"the PRN Team function refuses anyone who isn't signed-in office staff: no key {n1}, public key {n2}, server key asking to move {n3}")
sV, bV = http("POST", FU, {"action": "vocab"}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
try: jv = json.loads(bV)
except Exception: jv = {}
if sV == 200 and not jv.get("error"):
    say(f"  · AxisCare (read only): PRN Team class {'✓ ' + str(jv.get('prn')) if jv.get('prn') else 'not there yet'} · CNA class {'✓ ' + str(jv.get('cna')) if jv.get('cna') else 'not there yet'}")
    if jv.get("why"): say("    " + "; ".join(jv["why"]) + ". Create them in AxisCare (Settings, Classes) before the office uses \"Mark as PRN Team in AxisCare\".")
else: say(f"  · AxisCare's class list couldn't be read ({sV}): the office's button will say so if it can't either")
say()
say("RESULT: " + ("DONE · PRN hires now get their pay track with the offer, and the caregiver page can link them, mark them in AxisCare and move them to ongoing." if not fails else "CHECK THE ✗ LINES."))
say("Rollback: revert the Hub and remove the prn-team function; the tables and their history stay (Claude can do it).")
done(0 if not fails else 8)
