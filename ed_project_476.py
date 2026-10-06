#!/usr/bin/env python3
# 476 · ED ANDERSON: FIX HIS TEAM BUILDER PLAN AND START HIS PROJECT. Samantha 2026-10-06 ("yes build 476"), after 475c showed
# his plan named just "Ed", both shifts still at the 9am-5pm default and nobody on any of the 14 shifts.
#   1. The plan: named "Ed Anderson"; Shift 1 becomes Mornings 9am-2pm, Shift 2 Evenings 4pm-9pm, 7 days. Each shift keeps
#      its key, so anyone already on a shift stays on it. Only that plan, and only while it still says "Ed".
#   2. His project on My Work (the Hub's Client start / coming home, exactly as ＋ New project builds it): Krystal owns it,
#      the Staffing Coordinator is on the team, ready by Tue Oct 13, Pamela Anderson (daughter) gives the date and is asked
#      for 48 hours notice, All hands on deck on, an owner signs it off. Never made twice.
# Part 1 (read only): what is there now. Part 2: the two changes. Part 3: read back. Nothing is texted or emailed.
import json, os, re, urllib.request, urllib.error, datetime as dt, sys
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
BY = "samantha@mo-care.com"; BY_NAME = "Samantha Troutman"
OWNER = "krystal@mo-care.com"; READY = "2026-10-13"; PLAN_TAIL = "08746980"
PID = "ops_proj_ed_anderson_476"
SLOTS = [("Mornings", "09:00", "14:00"), ("Evenings", "16:00", "21:00")]
O = {"date_contact": "Pamela Anderson (daughter)", "notice": "48 hours", "shifts": "9am–2pm and 4pm–9pm, 7 days a week",
     "care_level": "bed bound, Hoyer or sit-to-stand"}
lines = []; fails = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", str(s)); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    s = re.sub(r"\(?\b\d{3}\)?[ .\-]?\d{3}[ .\-]\d{4}\b", "(a number)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200] + ". Nothing was texted. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def sql(q):
    req = urllib.request.Request(f"{API}/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + TOKEN, "User-Agent": "cc-476/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read().decode())
    except urllib.error.HTTPError as e: return False, e.read().decode(errors="replace")[:300]
    except Exception as e: return False, type(e).__name__
lit = lambda v: "'" + str(v).replace("'", "''") + "'"
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
def as_list(x):
    if isinstance(x, str):
        try: x = json.loads(x)
        except Exception: return []
    if isinstance(x, dict): x = list(x.values())
    return [i for i in (x or []) if isinstance(i, dict)]
def read(k):
    ok, r = sql(f"select data from public.app_data where key = {lit(k)}")
    if not ok: bad(f"couldn't read {k} ({r}). Nothing was changed."); done(3)
    return as_list(r[0]["data"]) if r else []

say("476 · ED ANDERSON: HIS TEAM BUILDER PLAN FIXED AND HIS PROJECT STARTED"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
plans = read("staffing_plans")
plan = next((p for p in plans if str(p.get("id") or "").endswith(PLAN_TAIL)), None)
if not plan: bad("couldn't find Ed's plan (…" + PLAN_TAIL + "). Nothing was changed."); done(4)
slots = plan.get("slots") or []
say(f"  · plan …{PLAN_TAIL}: named \"{plan.get('client')}\", {len(plan.get('days') or [])} days, shifts: " + "; ".join(f"{s.get('label')} {s.get('start')}-{s.get('end')}" for s in slots))
say(f"  · people on shifts now: {len(plan.get('cells') or {})}")
plan_todo = str(plan.get("client") or "").strip().lower() == "ed"
if not plan_todo: say(f"  · the plan is already named \"{plan.get('client')}\": it is left as it is")
if len(slots) != 2: bad(f"the plan has {len(slots)} shifts, not 2. Nothing was changed. Tell Claude."); done(5)

ops = read("ops_items")
already = next((i for i in ops if i.get("id") == PID or (i.get("kind") == "project" and i.get("status") == "open" and "ed anderson" in str(i.get("title") or "").lower())), None)
say("  · Ed's project: " + (f"already there (\"{already.get('title')}\"), not made again" if already else "not there yet"))

ok, r = sql("""select p.full_name, lower(p.primary_email) as email, r.role from public.staff_roles r join public.persons p on p.person_id = r.person_id
               where r.entity = 'cc_ihs' and r.role in ('staffing_coordinator', 'care_coordinator', 'owner_admin') order by p.full_name""")
if not ok: bad(f"couldn't read who holds which role ({r}). Nothing was changed."); done(3)
people = {x["email"]: x["full_name"] for x in r}
owner_name = people.get(OWNER)
if not owner_name: bad("Krystal doesn't hold an office role in the Hub, so she can't own the project. Nothing was changed."); done(6)
sc = sorted({x["email"] for x in r if x["role"] == "staffing_coordinator" and x["email"] != OWNER})
say(f"  · owner: {owner_name} · Staffing Coordinator: " + (", ".join(people[e] for e in sc) if sc else "nobody holds that role, so the recruiting step goes to Krystal too"))
sc1 = sc[0] if sc else ""

say(); say("PART 2 · CHANGE")
now = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
if plan_todo:
    new_slots = [dict(s, label=SLOTS[i][0], start=SLOTS[i][1], end=SLOTS[i][2]) for i, s in enumerate(slots)]
    patch = {"client": "Ed Anderson", "slots": new_slots, "project_id": PID, "updated_at": now}
    ok, r = sql(f"""with p as (select {lit(json.dumps(patch))}::jsonb as m),
      upd as (update public.app_data a set data = (
        select coalesce(jsonb_agg(case when x->>'id' = {lit(plan['id'])} and lower(trim(x->>'client')) = 'ed' then x || (select m from p) else x end order by o), '[]'::jsonb)
        from jsonb_array_elements(a.data) with ordinality e(x, o))
      where a.key = 'staffing_plans' and jsonb_typeof(a.data) = 'array' returning 1)
      select count(*)::int as n from upd""")
    if not ok or not r or r[0]["n"] != 1: bad("the plan change didn't save: " + str(r)[:200]); say("  Nothing was changed."); done(7)
    say("  ✓ plan renamed Ed Anderson; Mornings 9am-2pm and Evenings 4pm-9pm")
else: say("  · plan: nothing to change")

if not already:
    central = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=5)
    t0 = dt.date(central.year, central.month, central.day); ready = dt.date.fromisoformat(READY)
    clamp = lambda d: str(min(max(d, t0), ready))
    who = lambda w: [sc1 or OWNER] if w == "sc" else ([OWNER] + ([sc1] if sc1 else [])) if w == "both" else [OWNER]
    T = [("date", "cc", 1, None, f"Who tells us the date: {O['date_contact']}, ask for {O['notice']} notice"),
         ("level", "cc", 2, None, f"Care level set ({O['care_level']})"),
         ("family", "cc", 3, None, "Family told the plan"),
         ("recruit", "sc", None, 1, "Recruiting for the open shifts"),
         ("shifts", "both", None, 1, f"Every shift confirmed ({O['shifts']})"),
         ("transfer", "both", None, 2, "Transfer / Hoyer practice"),
         ("equip", "cc", None, 3, "Equipment at home checked"),
         ("plan", "cc", None, 1, "Care plan and AxisCare schedule")]
    steps = [{"id": f"s{k + 1}", "key": key, "label": label, "who": who(w),
              "due": clamp(t0 + dt.timedelta(days=fr) if fr is not None else ready - dt.timedelta(days=bf))} for k, (key, w, fr, bf, label) in enumerate(T)]
    team = [sc1] if sc1 else []
    item = {"id": PID, "kind": "project", "status": "open", "template": "client_start", "title": "Ed Anderson coming home", "about": "Ed Anderson",
            "detail": "Team Builder plan: Ed Anderson (Mornings 9am-2pm, Evenings 4pm-9pm). No facility discharge: Pamela arranges everything.",
            "plan_id": plan["id"], "owner": OWNER, "owner_name": owner_name, "team": team, "also_for": team,
            "ready_by": READY, "due": READY + "T17:00:00.000Z", **O, "steps": steps, "signoff": {"needed": True},
            "all_hands": {"on": True, "on_at": now, "on_by": BY, "on_by_name": BY_NAME, "auto": True},
            "urgency": "normal", "created_at": now, "created_by": BY, "created_by_email": BY, "opened_by": "person", "last_activity_at": now,
            "history": [{"at": now, "by": BY_NAME, "text": "Project created by " + BY_NAME + " (Desktop 476)"}]}
    ok, r = sql(f"""with upd as (update public.app_data a set data = a.data || jsonb_build_array({lit(json.dumps(item))}::jsonb)
        where a.key = 'ops_items' and jsonb_typeof(a.data) = 'array'
          and not exists (select 1 from jsonb_array_elements(a.data) x where x->>'id' = {lit(PID)}) returning 1)
      select count(*)::int as n from upd""")
    if not ok or not r or r[0]["n"] != 1: bad("the project didn't save: " + str(r)[:200])
    else:
        say(f"  ✓ project \"Ed Anderson coming home\" on My Work: {owner_name} owns it, ready by Tue Oct 13, All hands on deck on")
        for s in steps: say(f"      {s['due'][5:]} · {s['label']} · " + " & ".join(people.get(e, e).split(' ')[0] for e in s["who"]))
        sql(f"""insert into public.op_events (actor_email, actor_name, verb, item_id, area, summary, data)
                values ({lit(BY)}, {lit(BY_NAME)}, 'item_created', {lit(PID)}, '', 'New project: Ed Anderson coming home (Krystal, ready by Tue Oct 13)', '{{}}'::jsonb)""")
else: say("  · project: nothing to make")

say(); say("PART 3 · READ BACK")
p2 = next((p for p in read("staffing_plans") if p.get("id") == plan["id"]), {})
if plan_todo:
    chk(p2.get("client") == "Ed Anderson" and [(s.get("start"), s.get("end")) for s in p2.get("slots") or []] == [(a, b) for _, a, b in SLOTS], "the plan reads back as Ed Anderson, 9am-2pm and 4pm-9pm")
    chk(len(p2.get("cells") or {}) == len(plan.get("cells") or {}), "nobody already on a shift was moved or dropped")
pj = next((i for i in read("ops_items") if i.get("id") == PID), None)
if not already: chk(pj and pj.get("status") == "open" and len(pj.get("steps") or []) == 8 and pj.get("all_hands", {}).get("on") is True, "the project reads back: open, 8 steps, All hands on deck")
say(); say("RESULT: " + ("DONE · Ed's plan is set up and his project is on My Work for the whole office." if not fails else "CHECK THE ✗ LINES."))
say("Nothing was texted or emailed. Krystal puts her people on his shifts in the Team Builder (Scheduling).")
done(0 if not fails else 8)
