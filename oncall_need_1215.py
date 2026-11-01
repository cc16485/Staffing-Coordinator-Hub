#!/usr/bin/env python3
# 1215 · STAFFING SERVER · WHICH ON-CALL SHIFTS ARE NEEDED MOST? A LOOK, READ ONLY. (Samantha 2026-10-30: "Yes, turn the
# which-shifts-need-on-call report into a Desktop step I can run.")
# Samantha 2026-10-30: PRN CNAs (and soon Level 3 caregivers) sign up ON CALL for daytime 7am-7pm or overnight 7pm-7am, any
# day. Her question: "which shifts are needed most for an on-call person and what is fine to leave without on call".
#
# What it counts, for the last 90 days (or as far back as each record goes), by the on-call slot the shift STARTS in:
#   daytime   = a shift starting 7:00am to 6:59pm, on that day (the 7am-to-7pm on-call shift, her change 2026-10-30)
#   overnight = a shift starting 7:00pm to 6:59am; a start after midnight belongs to the PREVIOUS evening's overnight
#               (a 2am Tuesday start is "Monday overnight", the same on-call slot as 7pm Monday)
# split by notice (after start, under 2 hours, 2 to 12 hours, more than 12 hours, unknown) and outcome
# (PRN Team filled, other caregiver filled, caller worked it after all, left unfilled, client cancelled, still open or no
# answer), plus the median time to fill.
#
# Sources (each read on its own; a missing one is reported, never fatal):
#   A. coverage cases: app_data coverage_cases + coverage_cases_archive (call-offs and open shifts; the archive holds the
#      2026-10-12 testing clean-up, Desktop 619/625/626, shown separately)
#   B. visit_history (coverage-watch, since Desktop 1108 on 2026-10-24): a visit going from a caregiver to EMPTY, when it
#      was first seen, and what happened next; also every visit seen, as the denominator (shifts per slot)
#   C. timekeeper_cases (missed clock-ins) · D. late_notices (running late / can't make it) · E. attendance_events callins
#   F. ops_items kind open_shift (open shift cards) · G. op_events coverage verbs and app_data_item_change (depth checks)
#
# READ ONLY. Every statement is a single SELECT (asserted below before it is sent). Nothing is written, deployed or sent.
# No names, phone numbers, notes or messages are printed: only counts, slots and minutes.
import os, re, json, statistics, datetime as dt
from collections import Counter, defaultdict
from zoneinfo import ZoneInfo

CHI = ZoneInfo("America/Chicago")
DAYS_BACK = int(os.environ.get("ONCALL_DAYS", "90"))
WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
NOTICE = ["after start", "under 2h", "2-12h", "over 12h", "unknown"]

# ---------------------------------------------------------------------------------------------------------------- helpers
def ts(s):
    """An ISO timestamp (UTC or with offset) as an aware datetime, or None."""
    s = str(s or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}", s): return None
    s = re.sub(r"([+-]\d{2})$", r"\1:00", s)                 # Postgres text '+00' -> '+00:00' (older Pythons need it)
    try:
        d = dt.datetime.fromisoformat(s.replace("Z", "+00:00").replace(" ", "T", 1))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=CHI)          # no offset: AxisCare/Hub wall clock is Chicago

def hm(t):
    """The START of a shift_time as (hour, minute): '09:00-13:00', '9:00 AM', '5pm-9pm', '17:30'. None when unreadable
    (Cara's free-text hints like 'this morning' stay unknown, never guessed)."""
    t = str(t or "").strip().lower()
    m = re.match(r"^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|a|p)?\b", t)
    if not m or (m.group(2) is None and m.group(3) is None): return None
    h, mi = int(m.group(1)), int(m.group(2) or 0)
    if m.group(3):
        if not 1 <= h <= 12: return None
        h = h % 12 + (12 if m.group(3).startswith("p") else 0)
    return (h, mi) if h < 24 and mi < 60 else None

def start_of(date_s, time_s):
    """Shift start as an aware Chicago datetime from shift_date + shift_time, or None."""
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", str(date_s or "")): return None
    x = hm(time_s)
    if not x: return None
    d = dt.date.fromisoformat(date_s)
    return dt.datetime(d.year, d.month, d.day, x[0], x[1], tzinfo=CHI)

def start_from_axis(s):
    """AxisCare's scheduledStartDate ('2026-10-24T22:00:00', maybe with an offset): the wall clock is what the jobs use."""
    s = str(s or "")
    m = re.match(r"^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})", s)
    return start_of(m.group(1), m.group(2)) if m else None

def slot(start):
    """(on-call day name, 'day' | 'night', on-call date) for a shift start."""
    loc = start.astimezone(CHI)
    if 7 <= loc.hour < 19: return WD[loc.weekday()], "day", loc.date()   # on-call daytime is 7am to 7pm (2026-10-30)
    d = loc.date() if loc.hour >= 19 else loc.date() - dt.timedelta(days=1)
    return WD[d.weekday()], "night", d

def notice(start, raised):
    if not start or not raised: return "unknown"
    h = (start - raised).total_seconds() / 3600
    return "after start" if h < 0 else "under 2h" if h < 2 else "2-12h" if h <= 12 else "over 12h"

def earliest(*xs):
    xs = [x for x in xs if x]
    return min(xs) if xs else None

def med(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.median(xs)) if xs else None

def is_select_only(q):
    s = re.sub(r"'(?:[^']|'')*'", "''", q).lower()          # ignore string literals
    return s.lstrip().startswith(("select", "with")) and not re.search(
        r"\b(insert|update|delete|truncate|alter|create|drop|grant|revoke|call|do|copy|vacuum|refresh|set|comment|lock|nextval|setval|pg_sleep)\b"
        r"|\b(upsert_app_data_item|delete_app_data_item|coverage_case_patch|record_event)\b", s) and ";" not in s.rstrip().rstrip(";")

# ---------------------------------------------------------------------------------------------------------------- outcomes
def case_kind(r):
    """'call-off' | 'open shift' | None (not a staffing need: interest checks, flags, merged duplicates, not a call-in)."""
    if r.get("kind") == "interest" or r.get("reason") == "new": return None
    if r.get("status") in ("flagged", "dismissed", "merged"): return None
    if r.get("how") == "not_a_callin" or str(r.get("not_a_callin") or "") == "true": return None
    if r.get("reason") == "open" or str(r.get("id") or "").startswith("cwo_") or r.get("opened_by") == "ongoing-sweep": return "open shift"
    return "call-off"

def case_outcome(r):
    how, st = r.get("how") or "", r.get("status") or ""
    if how == "covered":
        if r.get("prn_fill"): return "PRN Team filled"
        return "filled (found in AxisCare)" if r.get("resolved_by") == "cara" else "filled (office confirmed)"
    if how == "covered_other_way": return "caller worked it after all"
    if how in ("uncovered", "couldnt_staff"): return "left unfilled"
    if how == "client_cancelled": return "client cancelled"
    if how == "archived" or (r.get("src") == "archive" and st in ("open", "by_hand", "assigned", "needs_outcome")): return "archived while open"
    if st in ("open", "by_hand", "assigned", "needs_outcome"): return "still open / no answer"
    return "other: " + (how or st or "?")

OUTCOMES = ["PRN Team filled", "filled (office confirmed)", "filled (found in AxisCare)", "caller worked it after all",
            "left unfilled", "client cancelled", "still open / no answer", "archived while open"]

# ---------------------------------------------------------------------------------------------------------------- queries
ARR = lambda key: (f"jsonb_array_elements(case when jsonb_typeof((select data::jsonb from public.app_data where key = '{key}')) = 'array' "
                   f"then (select data::jsonb from public.app_data where key = '{key}') else '[]'::jsonb end)")

def q_cases(has_prn_log, has_tracks, has_vh):
    prn = []
    if has_prn_log: prn.append("exists (select 1 from public.prn_shift_log p where p.case_id = c->>'id' and p.kind = 'confirmed')")
    if has_tracks: prn.append("""exists (select 1 from jsonb_array_elements(case when jsonb_typeof(c->'asked') = 'array' then c->'asked' else '[]'::jsonb end) a
          join public.pay_tracks t on t.track = 'prn_team' and t.axiscare_caregiver_id = a->>'axiscare_id'
          where lower(btrim(a->>'name')) = lower(btrim(c->>'covered_by')))""")
    vh = ("""(select min(h.seen_at) from public.visit_history h where h.visit_id = c->>'axiscare_visit_id' and h.state = 'empty')::text""" if has_vh else "null::text")
    return f"""with raw as (
        select 'open list' as src, c from {ARR('coverage_cases')} c
        union all select 'archive', c from {ARR('coverage_cases_archive')} c),
      one as (select distinct on (c->>'id') src, c from raw where jsonb_typeof(c) = 'object' order by c->>'id', (src = 'open list') desc)
      select src, c->>'id' as id, c->>'status' as status, c->>'kind' as kind, c->>'reason' as reason, c->>'opened_by' as opened_by,
        c->>'resolved_how' as how, c->>'resolved_by' as resolved_by, c->>'closed_after_shift' as closed_after_shift,
        c->>'not_a_callin' as not_a_callin, left(coalesce(c->>'archived_reason', ''), 60) as archived_reason,
        c->>'shift_date' as shift_date, left(coalesce(c->>'shift_time', ''), 40) as shift_time,
        c->>'opened_at' as opened_at, c#>>'{{caregiver_said,at}}' as said_at, c->>'resolved_at' as resolved_at,
        c->>'confirmed_at' as confirmed_at, c->>'reopened_from' as reopened_from,
        jsonb_array_length(case when jsonb_typeof(c->'backed_out') = 'array' then c->'backed_out' else '[]'::jsonb end) as backed_out_n,
        jsonb_array_length(case when jsonb_typeof(c->'asked') = 'array' then c->'asked' else '[]'::jsonb end) as asked_n,
        {(' or '.join(prn)) if prn else 'false'} as prn_fill,
        {vh} as vh_first_empty
      from one"""

Q_EXISTS = """select to_regclass('public.prn_shift_log') is not null as prn_log, to_regclass('public.pay_tracks') is not null as tracks,
  to_regclass('public.visit_history') is not null as vh, to_regclass('public.late_notices') is not null as late,
  to_regclass('public.op_events') is not null as ev, to_regclass('public.app_data_item_change') is not null as chg"""

Q_TK = f"""select c->>'kind' as kind, c->>'shift_date' as shift_date, c->>'shift_time' as shift_time, c->>'opened_at' as opened_at,
  c->>'resolved_at' as resolved_at, c->>'resolved_how' as how, c->>'minutes_late' as minutes_late
  from {ARR('timekeeper_cases')} c where jsonb_typeof(c) = 'object'"""

Q_LATE = """select kind, status, shift_date::text as shift_date, shift_start::text as shift_start, said_at::text as said_at,
  (select min(x->>'at') from jsonb_array_elements(case when jsonb_typeof(said) = 'array' then said else '[]'::jsonb end) x) as first_said,
  closed_how, (coverage_case_id is not null) as became_case from public.late_notices"""

Q_ATT = f"""select c->>'shift_date' as shift_date, c->>'shift_time' as shift_time, c->>'notice_hours' as notice_hours,
  c->>'logged_by' as logged_by, coalesce(c->>'reported_at', c->>'created_at') as reported_at
  from {ARR('attendance_events')} c where jsonb_typeof(c) = 'object' and c->>'type' = 'callin'"""

Q_OPEN_CARDS = f"""select c->>'status' as status, c->>'created_at' as created_at, c->>'closed_at' as closed_at,
  left(coalesce(c->>'auto_closed_reason', ''), 80) as why, substring(c->>'axiscare_visit_id' from 'd=(\\d{{4}}-\\d{{2}}-\\d{{2}})') as shift_date,
  substring(c->>'detail' from 'this visit \\((\\d{{2}}:\\d{{2}})') as shift_time
  from {ARR('ops_items')} c where jsonb_typeof(c) = 'object' and c->>'kind' = 'open_shift'"""

# B: every visit becoming EMPTY (a caregiver taken off), with what came next; and every visit seen (the denominator)
Q_VH_EMPTY = """with h as (select visit_id, state, reason_name, start, seen_at, first_seen,
    lag(state) over w as prev_state, lead(state) over w as next_state, lead(seen_at) over w as next_at
    from public.visit_history window w as (partition by visit_id order by seen_at, id))
  select left(start, 19) as start, seen_at::text as seen_at, first_seen, prev_state, next_state, next_at::text as next_at,
    left(coalesce(reason_name, ''), 60) as reason
  from h where state = 'empty' and prev_state is distinct from 'empty'"""
Q_VH_ALL = """select distinct on (visit_id) left(start, 19) as start from public.visit_history
  where state in ('caregiver', 'empty') order by visit_id, seen_at"""

Q_DEPTH = {
    "op_events coverage verbs": """select verb, count(*)::int as n, min(at)::date::text as first, max(at)::date::text as last from public.op_events
        where verb like 'coverage%' or verb in ('open_shift_card', 'callin_recorded_axiscare') or verb like 'late_%' group by verb order by verb""",
    "app_data_item_change (coverage_cases)": """select change, count(*)::int as n, min(at)::date::text as first, max(at)::date::text as last,
        count(*) filter (where bulk_removed)::int as bulk from public.app_data_item_change where key = 'coverage_cases' group by change order by change""",
}

# ---------------------------------------------------------------------------------------------------------------- tables
def grid(say, title, rows, cols, cell, total=True):
    """rows: iterable of (slot_day, slot_part) keys; prints one line per on-call slot with the column counts."""
    say(f"  {title}")
    say("    " + f"{'slot':14}" + "".join(f"{c[:14]:>15}" for c in cols) + (f"{'total':>8}" if total else ""))
    for d in WD:
        for part in ("day", "night"):
            k = (d, part)
            vals = [cell(k, c) for c in cols]
            tot = sum(v for v in vals if isinstance(v, int))
            say("    " + f"{d + (' 7a-7p' if part == 'day' else ' 7p-7a'):14}" + "".join(f"{('' if v is None else v):>15}" for v in vals) + (f"{tot:>8}" if total else ""))

SUMMARY = {}

def main():
    os.environ.setdefault("SB_STEP", "1215")
    from cc_step_lib import start, say, bad, done, sql, fails   # noqa: E402  (the Desktop step's shared bones)
    REF = "zngsgedlsxinbygwmxwn"
    now = dt.datetime.now(dt.timezone.utc)
    since = (now.astimezone(CHI) - dt.timedelta(days=DAYS_BACK)).date()

    def read(name, q):
        assert is_select_only(q), f"{name}: refused to send a statement that is not a single SELECT"
        ok, rows = sql(REF, q)
        if not ok: bad(f"{name} could not be read: {str(rows)[:160]}"); return None
        return rows

    start("WHICH ON-CALL SHIFTS ARE NEEDED MOST (READ ONLY)")
    say(f"PART 1 · READ ONLY (nothing changes). Shifts starting {since} to today, Chicago time. 'day' = 7am-7pm start, 'night' = 7pm-7am start (the on-call shifts).")
    okE, exr = sql(REF, Q_EXISTS)
    if not okE or not exr:
        w = str(exr).lower()
        bad("couldn't read the Hub's records. " + ("Supabase didn't accept the access token (it may have expired or been revoked). Make a new one at supabase.com/dashboard/account/tokens and run this again."
            if ("unauthorized" in w or "jwt" in w or "401" in w or ("invalid" in w and "token" in w)) else "Supabase answered: " + str(exr)[:200]))
        say("  STOP. Nothing was changed."); done(3)
    ex = exr[0]

    # ---- A. coverage cases ------------------------------------------------------------------------------------------
    cases = read("coverage cases", q_cases(ex.get("prn_log"), ex.get("tracks"), ex.get("vh"))) or []
    say(); say("A · COVERAGE CASES (call-offs and open shifts)")
    first_open = min((ts(r["opened_at"]) for r in cases if ts(r["opened_at"])), default=None)
    say(f"  · {len(cases)} records ({sum(r['src'] == 'archive' for r in cases)} in the archive); earliest opened {first_open.date() if first_open else 'none'}")
    skipped = Counter(); per = defaultdict(Counter); fill_min = defaultdict(list); fill_from_first = defaultdict(list)
    by_notice = defaultdict(Counter); by_outcome = defaultdict(Counter); arch = Counter(); before_start = Counter()
    for r in cases:
        k = case_kind(r)
        if not k: skipped["not a staffing need (interest, flag, merged, not a call-in)"] += 1; continue
        st = start_of(r["shift_date"], r["shift_time"])
        if not st: skipped[f"{k}: start time unreadable"] += 1; continue
        if st.date() < since or st > now + dt.timedelta(days=1): skipped[f"{k}: outside the window"] += 1; continue
        d, part, _ = slot(st)
        raised = earliest(ts(r["opened_at"]), ts(r["said_at"]), ts(r["vh_first_empty"]))
        n, o = notice(st, raised), case_outcome(r)
        key = (k, d, part)
        per[key]["all"] += 1; by_notice[(k, d, part)][n] += 1; by_outcome[(k, d, part)][o] += 1
        if r["src"] == "archive": arch[k] += 1
        if o.startswith(("PRN", "filled")) and str(r.get("closed_after_shift")) != "true":
            done_at = ts(r["confirmed_at"]) or ts(r["resolved_at"])
            if done_at and ts(r["opened_at"]):
                fill_min[key].append((done_at - ts(r["opened_at"])).total_seconds() / 60)
                fill_from_first[key].append((done_at - raised).total_seconds() / 60 if raised else None)
                before_start[key] += int(done_at <= st)
    for why, n in skipped.most_common(): say(f"  · skipped {n}: {why}")
    for k in ("call-off", "open shift"):
        say(); say(f"  {k.upper()}S" + (f" ({arch[k]} of them from the testing-period archive)" if arch[k] else ""))
        grid(say, "by notice (shift start minus the first time we knew)", None, NOTICE, lambda s, c: by_notice[(k,) + s][c] or 0)
        grid(say, "by outcome", None, OUTCOMES, lambda s, c: by_outcome[(k,) + s][c] or 0)
        grid(say, "time to fill, median minutes (opened to confirmed; fills found only after the shift are left out)", None,
             ["median min", "filled n", "before start"], lambda s, c: (med(fill_min[(k,) + s]) if c == "median min"
             else len(fill_min[(k,) + s]) if c == "filled n" else before_start[(k,) + s]), total=False)
    # the short answer: where under-12-hour needs went unfilled or needed a late scramble
    say(); say("  RANKED · call-offs + open shifts with under 12 hours' notice (incl. after start), and how many were not filled")
    rank = []
    for d in WD:
        for part in ("day", "night"):
            short = sum(by_notice[(k, d, part)][n] for k in ("call-off", "open shift") for n in ("after start", "under 2h", "2-12h"))
            unf = sum(by_outcome[(k, d, part)][o] for k in ("call-off", "open shift") for o in ("left unfilled", "still open / no answer"))
            tot = sum(per[(k, d, part)]["all"] for k in ("call-off", "open shift"))
            rank.append((short, unf, tot, d, part))
    for short, unf, tot, d, part in sorted(rank, reverse=True):
        say(f"    {d} {'7a-7p' if part == 'day' else '7p-7a'}: {short} short-notice of {tot} needs, {unf} not filled")
    SUMMARY["rank"] = rank; SUMMARY["first_open"] = first_open

    # ---- B. visit_history (AxisCare, since 1108) --------------------------------------------------------------------
    if ex.get("vh"):
        say(); say("B · AXISCARE VISIT HISTORY (a caregiver taken off a visit; coverage-watch only sees the next 72 hours)")
        allv = read("visit history (all visits)", Q_VH_ALL) or []
        empt = read("visit history (became empty)", Q_VH_EMPTY) or []
        base = Counter(); ev = defaultdict(Counter)
        for r in allv:
            st = start_from_axis(r["start"])
            if st and st.date() >= since: base[slot(st)[:2]] += 1
        for r in empt:
            st = start_from_axis(r["start"])
            if not st or st.date() < since: continue
            s = slot(st)[:2]
            if not r["prev_state"]: ev[s]["seen empty first"] += 1; continue     # an open shift from the start, or empty before the 72-hour window
            n = notice(st, ts(r["seen_at"]))     # first look that showed it empty: within ~5 minutes of the change
            nxt = r["next_state"]
            o = ("filled again" if nxt == "caregiver" else "cancelled" if nxt in ("placeholder", "removed")
                 else "still empty when last seen" if nxt is None else "other")
            ev[s][n] += 1; ev[s][o] += 1
        say(f"  · {len(allv)} visits seen; {len(empt)} were empty at some point (open from the start or lost their caregiver). How far back: PART 2.")
        grid(say, "visits seen (denominator) and visits that lost their caregiver", None,
             ["visits seen", "seen empty first", "lost caregiver"] + NOTICE[:-1] + ["filled again", "cancelled", "still empty when last seen"],
             lambda s, c: base[s] if c == "visits seen" else sum(ev[s][x] for x in NOTICE) if c == "lost caregiver" else ev[s][c] or 0, total=False)

    # ---- C. missed clock-ins ------------------------------------------------------------------------------------------
    tk = read("missed clock-ins (timekeeper_cases)", Q_TK) or []
    say(); say("C · MISSED CLOCK-INS (timekeeper_cases; the case opens a few minutes after the start, so notice is always after start)")
    tkc = defaultdict(Counter); tklate = defaultdict(list)
    for r in tk:
        if r.get("kind") == "clock_out": continue
        st = start_of(r["shift_date"], r["shift_time"])
        if not st or st.date() < since: continue
        s = slot(st)[:2]
        how = r.get("how") or "open"
        tkc[s][{"clocked_in": "clocked in late", "became_confirm_times": "never clocked in", "coverage_case": "became a call-off",
                 "visit_changed": "caregiver changed", "visit_gone": "visit removed", "admin": "office resolved"}.get(how, "open/other")] += 1
        try: tklate[s].append(float(r["minutes_late"]))
        except (TypeError, ValueError): pass
    cols = ["clocked in late", "never clocked in", "became a call-off", "caregiver changed", "visit removed", "office resolved", "open/other"]
    grid(say, "by what happened", None, cols + ["median late"], lambda s, c: med(tklate[s]) if c == "median late" else tkc[s][c] or 0, total=False)

    # ---- D. running late / can't make it ----------------------------------------------------------------------------
    if ex.get("late"):
        lt = read("running late (late_notices)", Q_LATE) or []
        say(); say("D · RUNNING LATE AND CAN'T MAKE IT (late_notices; practice rows are real messages read while the switch was off)")
        lc = defaultdict(Counter)
        for r in lt:
            st = ts(r["shift_start"])
            if not st or st.astimezone(CHI).date() < since: continue
            s = slot(st)[:2]
            lc[s][r["kind"]] += 1; lc[s]["told " + notice(st, earliest(ts(r["first_said"]), ts(r["said_at"])))] += 1
        grid(say, "by kind and notice", None, ["late", "cant_make_it"] + ["told " + n for n in NOTICE],
             lambda s, c: lc[s][c] or 0, total=False)

    # ---- E. attendance call-ins (cross-check; includes ones typed on Performance > Attendance) ------------------------
    at = read("attendance call-ins", Q_ATT) or []
    say(); say("E · ATTENDANCE CALL-INS (a cross-check: most mirror a coverage case; typed ones may reach further back)")
    ac = defaultdict(Counter); oldest = None
    for r in at:
        st = start_of(r["shift_date"], r["shift_time"])
        if not st: ac[("?", "?")]["no start time"] += 1; continue
        oldest = min(oldest or st, st)
        if st.date() < since: continue
        try: nh = float(r["notice_hours"]); n = "after start" if nh < 0 else "under 2h" if nh < 2 else "2-12h" if nh <= 12 else "over 12h"
        except (TypeError, ValueError): n = notice(st, ts(r["reported_at"]))
        ac[slot(st)[:2]][n] += 1
    say(f"  · {len(at)} call-ins on file; oldest shift {oldest.date() if oldest else 'none'}; {ac[('?', '?')]['no start time']} have no readable start")
    grid(say, "by notice", None, NOTICE, lambda s, c: ac[s][c] or 0)

    # ---- F. open shift cards ---------------------------------------------------------------------------------------
    oc = read("open shift cards", Q_OPEN_CARDS) or []
    say(); say("F · OPEN SHIFT CARDS (ops_items open_shift: unassigned visits with no case, within 36 hours; live only if the switch is on)")
    occ = defaultdict(Counter)
    for r in oc:
        st = start_of(r["shift_date"], r["shift_time"])
        if not st or st.date() < since: continue
        s = slot(st)[:2]
        occ[s][notice(st, ts(r["created_at"]))] += 1
        w = r.get("why") or ""
        occ[s]["filled" if "caregiver" in w.lower() else "cancelled/gone" if re.search(r"cancel|went away|gone", w, re.I)
               else "became a case" if "case" in w.lower() else "open" if r.get("status") == "open" else "started/other"] += 1
    grid(say, "by notice and outcome", None, NOTICE[:-1] + ["filled", "became a case", "cancelled/gone", "started/other", "open"],
         lambda s, c: occ[s][c] or 0, total=False)

    # ---- PART 2 · how far back each record goes -----------------------------------------------------------------------
    say(); say("PART 2 · HOW FAR BACK EACH RECORD GOES")
    for name, q in Q_DEPTH.items():
        if (name.startswith("op_events") and not ex.get("ev")) or (name.startswith("app_data_item") and not ex.get("chg")): say(f"  · {name}: not installed"); continue
        for r in read(name, q) or []: say(f"  · {name}: {json.dumps(r)}")
    if ex.get("vh"):
        r = (read("visit history depth", "select min(seen_at)::text as first, max(seen_at)::text as last, count(*)::int as n from public.visit_history") or [{}])[0]
        say(f"  · visit_history: {r}")
    # ---- IN PLAIN WORDS (her question: which shifts need an on-call person most, and which are fine to leave) ------------
    say(); say("IN PLAIN WORDS")
    rank = SUMMARY.get("rank") or []
    word = lambda d, part: {"Mon": "Mondays", "Tue": "Tuesdays", "Wed": "Wednesdays", "Thu": "Thursdays", "Fri": "Fridays", "Sat": "Saturdays", "Sun": "Sundays"}[d] + (", daytime (7am to 7pm)" if part == "day" else ", overnight (7pm to 7am)")
    fo = SUMMARY.get("first_open")
    days = (now.astimezone(CHI).date() - fo.astimezone(CHI).date()).days if fo else 0
    say(f"  · This looks at about {days} days of call-offs and open shifts" + (" (still early: run it again each month for a clearer answer)." if days < 90 else "."))
    # which shifts are open for sign-up now (ops_settings.prn_oncall_offered; nothing set = Friday to Sunday 7am to 7pm)
    ofr = read("on-call shifts offered", "select data->'prn_oncall_offered' as v from public.app_data where key = 'ops_settings'") or [{}]
    offered = ofr[0].get("v") if ofr and isinstance(ofr[0].get("v"), dict) else {"fri:day": True, "sat:day": True, "sun:day": True}
    KEY = {"Mon": "mon", "Tue": "tue", "Wed": "wed", "Thu": "thu", "Fri": "fri", "Sat": "sat", "Sun": "sun"}
    is_open = lambda d, part: offered.get(f"{KEY[d]}:{'day' if part == 'day' else 'overnight'}") is True
    say("  · Open for sign-up now: " + ("; ".join(word(d, p) for d in WD for p in ("day", "night") if is_open(d, p)) or "none") + (" (the starting set)" if not (ofr and isinstance(ofr[0].get("v"), dict)) else "") + ".")
    need = [r for r in sorted(rank, key=lambda r: (r[0] + 2 * r[1], r[2]), reverse=True) if r[0] or r[1]]
    if need:
        say("  · MOST NEEDED for an on-call person (short-notice call-offs and open shifts; unfilled ones count double):")
        for short, unf, tot, d, part in need[:5]:
            say(f"      {word(d, part)}: {short} short-notice need{'s' if short != 1 else ''}, {unf} not filled, {tot} in all" + ("" if is_open(d, part) else "  (not open for sign-up now)"))
    else: say("  · No short-notice call-offs or open shifts in this window, so there's no clear most-needed time yet.")
    quiet = [r for r in rank if not r[2]]
    if quiet: say("  · FINE TO LEAVE WITHOUT ON CALL for now (no call-offs or open shifts at all in this window): " + "; ".join(word(d, part) for _, _, _, d, part in quiet))
    low = [r for r in rank if r[2] and not r[0] and not r[1]]
    if low: say("  · Probably fine too (needs came with more than 12 hours' notice and were filled): " + "; ".join(word(d, part) for _, _, _, d, part in low))
    say(); say("RESULT: " + ("LOOKED · nothing was changed." if not fails else "LOOKED, WITH ✗ LINES · nothing was changed."))
    done(0)

if __name__ == "__main__":
    main()
