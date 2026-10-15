#!/usr/bin/env python3
# 749 · START DATES AND FIRST SHIFTS (READ ONLY). CRM plan step A (Samantha 2026-10-15, "yes to all 10").
# Before one start date, one "care began" rule and one next step are built, this counts what the live data holds:
#   A. the target start dates each client has (journey, Start Contract, First shift launch) and where they disagree
#   B. the "care began" answers (lead first_shift_at, care_began_for_episode, launch checkbox, launch evidence)
#   C. who is still on the old Start of Care checklist, by pathway (the Medicaid ones retire at 11-16)
#   D. leads marked Lost with no reason picked
#   E. journeys with a lead but no episode (Step B needs these joined)
# Reads only (select statements). Writes nothing, sends nothing.
# Env: SB_TOKEN (Supabase access token), SB_REPORT (report path). SB_FAKE=<json file> answers the queries instead (rehearsal).
import json, os, re, sys, urllib.request, urllib.error, datetime as dt
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
FAKE = os.environ.get("SB_FAKE")
API = "https://api.supabase.com"; REF = "zngsgedlsxinbygwmxwn"
lines = []; fails = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", str(s)); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
FAKES = json.load(open(FAKE)) if FAKE else None
def sql(name, q):
    if FAKES is not None:
        return (True, FAKES[name]) if name in FAKES else (False, "no fake for " + name)
    if not re.match(r"^\s*(select|with)\b", q, re.I): return False, "refused: not a read"
    data = json.dumps({"query": q}).encode()
    req = urllib.request.Request(f"{API}/v1/projects/{REF}/database/query", data=data, method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": "cc-749/1.0", "Authorization": "Bearer " + TOKEN})
    try:
        with urllib.request.urlopen(req, timeout=180) as r: b = r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return False, f"HTTP {e.code}: {e.read().decode(errors='replace')[:300]}"
    except Exception as e: return False, type(e).__name__
    try: return True, json.loads(b)
    except Exception: return False, b[:200]

say("749 · START DATES AND FIRST SHIFTS (READ ONLY)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
if FAKES is None and not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)

def rows(name, q):
    ok, r = sql(name, q)
    if not ok: bad(f"could not read {name}: {r}"); return None
    return r
J = rows("journeys", "select to_jsonb(j) as j from public.client_journey j")
EP = rows("lead_episodes", "select s.source_ref as lead_id, s.episode_id::text as episode_id, e.state from public.episode_source s join public.journey_episode e using (episode_id) where s.system = 'lead' and s.role = 'origin'")
SC = rows("contracts", "select episode_id::text as episode_id, target_date::text as target_date, confidence from public.start_contract_current")
CQ = rows("launches", "select to_jsonb(q) as q from public.client_queue q")
LE = rows("evidence", "select launch_id::text as launch_id, axiscare_client_id, source, ticked, recorded_at::text as recorded_at, evidence from public.launch_evidence where fact = 'first_shift'")
LD = rows("leads", "select data from public.app_data where key = 'leads'")
if None in (J, LD): say(); say("Stopped: the journeys or the leads could not be read, so nothing below would be true."); done(3)
J = [r["j"] for r in J]; CQ = [r["q"] for r in (CQ or [])]; EP = EP or []; SC = SC or []; LE = LE or []
L = (LD[0]["data"] if LD and isinstance(LD[0].get("data"), list) else [])
lead = {str(l.get("id")): l for l in L if isinstance(l, dict)}
epOf = {}
for e in EP: epOf.setdefault(str(e["lead_id"]), e)
scOf = {str(c["episode_id"]): c for c in SC}
ymd = lambda v: str(v)[:10] if v else ""
def queueFor(j):
    ax = str(j.get("axiscare_client_id") or "")
    lid = str(j.get("launch_id") or "")
    for q in CQ:
        if lid and str(q.get("id")) == lid: return q
    for q in CQ:
        if ax and str(q.get("axiscare_client_id") or "") == ax and q.get("status") != "complete": return q
    for q in CQ:
        if ax and str(q.get("axiscare_client_id") or "") == ax: return q
    return None
real = [j for j in J if not j.get("is_test")]
say(f"Journeys: {len(real)} real ({sum(1 for j in real if j.get('status')=='open')} open, {sum(1 for j in real if j.get('status')=='active')} receiving care, {sum(1 for j in real if j.get('status')=='closed')} closed), {len(J)-len(real)} test")
say(f"Start Contracts: {len(SC)} · First shift launches: {len(CQ)} · leads: {len(L)}"); say()

# A. target start dates
say("A · TARGET START DATES (open journeys)")
agree = differ = one = none = 0; diffs = []
for j in real:
    if j.get("status") != "open": continue
    l = lead.get(str(j.get("lead_id") or "")) or {}
    e = epOf.get(str(j.get("lead_id") or "")); c = scOf.get(e["episode_id"]) if e else None; q = queueFor(j)
    d = {"journey": ymd(j.get("target_start")), "contract": ymd(c and c.get("target_date")), "launch": ymd(q and q.get("start_date"))}
    have = {k: v for k, v in d.items() if v}
    if not have: none += 1
    elif len(have) == 1: one += 1
    elif len(set(have.values())) == 1: agree += 1
    else: differ += 1; diffs.append((j.get("client_name") or "(no name)", d))
say(f"  no target date anywhere: {none}"); say(f"  a date in one place only: {one}"); say(f"  the same date in two or three places: {agree}"); say(f"  DIFFERENT dates: {differ}")
for n, d in diffs: say(f"    {n}: journey {d['journey'] or '-'}, Start Contract {d['contract'] or '-'}, First shift launch {d['launch'] or '-'}")
say()

# B. care began
say("B · WHEN CARE BEGAN (clients receiving care, or with a first shift recorded anywhere)")
evBy = {}
for e in LE:
    if e.get("ticked"): evBy.setdefault(str(e.get("launch_id")), []).append(e)
want = []
for j in real:
    l = lead.get(str(j.get("lead_id") or "")) or {}; q = queueFor(j)
    if j.get("status") == "active" or l.get("first_shift_at") or (q and (q.get("first_shift_done") or q.get("first_shift_done_at"))): want.append((j, l, q))
eps = [epOf[str(j.get("lead_id"))]["episode_id"] for j, l, q in want if str(j.get("lead_id") or "") in epOf]
CB = {}
if eps:
    r = rows("care_began", "select e::text as episode_id, public.care_began_for_episode(e) as cb from unnest(array[" + ",".join("'" + x + "'::uuid" for x in eps if re.match(r"^[0-9a-f-]{36}$", x)) + "]) as e")
    for x in (r or []): CB[str(x["episode_id"])] = x["cb"] or {}
same = differ = single = 0
for j, l, q in want:
    e = epOf.get(str(j.get("lead_id") or "")); cb = CB.get(e["episode_id"]) if e else None
    ev = evBy.get(str(q.get("id"))) if q else None
    d = {"lead first_shift_at": ymd(l.get("first_shift_at")),
         "care_began": ymd(cb.get("on")) if cb and cb.get("began") else "",
         "launch checkbox": ymd(q and q.get("first_shift_done_at")),
         "launch evidence": ymd(sorted(ev, key=lambda x: x.get("recorded_at") or "")[0].get("evidence", {}).get("on") or sorted(ev, key=lambda x: x.get("recorded_at") or "")[0].get("recorded_at")) if ev else ""}
    have = {k: v for k, v in d.items() if v}
    if len(have) <= 1: single += 1
    elif len(set(have.values())) == 1: same += 1
    else: differ += 1; say(f"    {j.get('client_name') or '(no name)'}: " + ", ".join(f"{k} {v or '-'}" for k, v in d.items()))
say(f"  clients counted: {len(want)} · one answer only: {single} · all answers agree: {same} · answers DIFFER: {differ}"); say()

# C. old Start of Care checklist
say("C · STILL ON THE OLD START OF CARE CHECKLIST")
PW = {"A1": "New Medicaid referral (FUSION)", "A2": "PCCP transfer", "B": "DSDS offered us the case", "PP": "Private pay"}
soc = [l for l in L if isinstance(l, dict) and isinstance(l.get("soc"), dict) and not l["soc"].get("launch_completed_at") and l.get("status") != "Lost" and not l.get("archived")]
by = {}
for l in soc: by.setdefault(l["soc"].get("pathway") or "(none)", []).append(l)
if not soc: say("  nobody")
for k, ls in sorted(by.items()):
    say(f"  {PW.get(k, k)}: {len(ls)}")
    for l in ls: say(f"    {l.get('client_name') or l.get('name') or '(no name)'} (lead {l.get('id')}), started {ymd(l['soc'].get('started_at')) or '?'}")
say()

# D. Lost with no reason picked
say("D · LEADS MARKED LOST WITH NO REASON PICKED")
lost = [l for l in L if isinstance(l, dict) and l.get("status") == "Lost" and not l.get("lost_reason_key")]
tx = {}
for l in lost: tx[str(l.get("lost_reason") or "(blank)")] = tx.get(str(l.get("lost_reason") or "(blank)"), 0) + 1
say(f"  {len(lost)} leads")
for k, n in sorted(tx.items(), key=lambda x: -x[1]): say(f"    {n} × {k}")
say()

# E. journeys with a lead but no episode
say("E · JOURNEYS WITH A LEAD BUT NO EPISODE")
noep = [j for j in real if j.get("lead_id") and str(j["lead_id"]) not in epOf]
say(f"  {len(noep)} of {sum(1 for j in real if j.get('lead_id'))}")
for j in noep[:20]: say(f"    {j.get('client_name') or '(no name)'} (lead {j['lead_id']}, {j.get('status')})")
say()
say("Nothing was changed. " + ("Some parts could not be read (marked ✗ above)." if fails else "Every part was read."))
done(1 if fails else 0)
