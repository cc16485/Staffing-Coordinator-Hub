#!/usr/bin/env python3
# Baseline-open: current-state Journey initialization for confirmed current clients.
#   SB_MODE=dry     read-only list + eligibility hash (writes nothing)
#   SB_MODE=commit  opens baselines ONLY if eligibility still hashes to SB_APPROVED_HASH;
#                   all-or-nothing in one transaction through the episode_open_for_person Door.
import json, os, hashlib, urllib.request, urllib.error, datetime as dt

MODE = os.environ.get("SB_MODE", "dry")
ELIG = open(os.environ["SB_ELIGFILE"]).read().strip().rstrip(";")
REPORT = os.environ["SB_REPORT"]
APPROVED = os.environ.get("SB_APPROVED_HASH", "")
LOCAL = os.environ.get("SB_LOCAL_SOCK")
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "")

lines = []
def say(s=""): print(s); lines.append(s)

def sql(q):
    if LOCAL:
        from pg8000.native import Connection, DatabaseError
        c = Connection(user="postgres", database="postgres", unix_sock=LOCAL)
        try:
            rows = c.run(q); cols = [d["name"] for d in (c.columns or [])]
            return True, [dict(zip(cols, r)) for r in (rows or [])]
        except DatabaseError as e:
            d = e.args[0] if e.args and isinstance(e.args[0], dict) else {}
            return False, str(d.get("M", e))
        finally:
            try: c.close()
            except Exception: pass
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query",
        data=json.dumps({"query": q}).encode(), method="POST",
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-baseline-open/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return True, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e:
        return False, "HTTP %s: %s" % (e.code, e.read().decode(errors="replace")[:600])
    except Exception as e:
        return False, "%s: %s" % (type(e).__name__, e)

def elig_hash(rows):
    refs = sorted((r["ref"] for r in rows if r["decision"] == "ELIGIBLE"), key=lambda s: s.encode())
    return hashlib.md5(",".join(refs).encode()).hexdigest(), refs

def show(rows):
    for kind in ("ELIGIBLE", "SKIP", "EXCLUDED", "ADMISSION"):
        sel = [r for r in rows if r["decision"] == kind]
        say(f"  {kind} · {len(sel)}")
        for r in sel:
            say(f"    {r['ref']}  [{r['labels']}]  {r['reason']}"
                + (f"  · began no later than {r['began_not_after']}" if kind == "ELIGIBLE" else ""))

say("BASELINE-OPEN · " + ("DRY RUN (read only, nothing written)" if MODE == "dry" else "COMMIT"))
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST TARGET)" if LOCAL else ""))
say("Creates, for each eligible confirmed current client, ONLY: a new episode in state established;")
say("begin = before observation (no later than the date shown); prior history = unobserved; provenance.")
say("It infers no start date, ordinal, earlier episode, lead, payer, authorization, staffing or assignment.")
say()

ok, rows = sql(ELIG)
if not ok:
    say("  ✗ could not read eligibility: " + str(rows)); open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(3)
h, refs = elig_hash(rows)
show(rows)
say()
say("  eligibility hash " + h + f"  ({len(refs)} eligible)")

if MODE == "dry":
    say()
    say("Nothing was written. Approve this exact list to receive the commit run, which refuses")
    say("if the eligible list no longer hashes to " + h + ".")
    open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(0)

# ---------------------------------------------------------------- commit
say()
if h != APPROVED:
    say("  ✗ REFUSED: eligibility changed since the approved dry run (approved " + APPROVED + "). Nothing was written.")
    open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(4)
if not refs:
    say("  Nothing to open."); open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(0)

commit_sql = f"""
begin;
do $g$ declare h text; begin
  select md5(coalesce(string_agg(ref, ',' order by ref collate "C"), '')) into h
    from ({ELIG}) x where decision = 'ELIGIBLE';
  if h is distinct from '{APPROVED}' then
    raise exception 'baseline-open refused: eligibility changed since the approved dry run (now %)', h;
  end if;
end $g$;
create temp table _baseline_open_results as
select x.ref as person_id,
       public.episode_open_for_person(
         p_person_id        => x.ref::uuid,
         p_state            => 'established',
         p_began_basis      => 'before_observation',
         p_began_not_after  => x.began_not_after::date,
         p_began_evidence   => x.evidence,
         p_prior_history    => 'unobserved',
         p_prior_evidence   => 'already in care when Journey observation began; nothing earlier is on record',
         p_evidence_ref     => x.evidence_ref,
         p_workflow         => 'baseline_open',
         p_acting_staff     => 'baseline-open (authorized)',
         p_acting_seat      => 'system') as result
  from ({ELIG}) x where x.decision = 'ELIGIBLE';
do $c$ begin
  if exists (select 1 from _baseline_open_results where result->>'outcome' <> 'opened') then
    raise exception 'baseline-open refused: not every eligible client opened cleanly (%). Nothing was written.',
      (select string_agg(person_id || ':' || (result->>'outcome'), ', ') from _baseline_open_results where result->>'outcome' <> 'opened');
  end if;
end $c$;
drop table _baseline_open_results;
commit;
"""
ok, res = sql(commit_sql)
if not ok:
    say("  ✗ STOPPED. Nothing was written: " + str(res)[:500])
    open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(5)
say("  ✓ committed")

# verify ---------------------------------------------------------------------------
idlist = ",".join("'" + r + "'" for r in refs)
ok, v = sql(f"""
  select c.person_id::text as p, c.state, c.began_basis, c.began_hi::text as not_after, c.prior_history_status,
         c.lifetime_ordinal, c.lifetime_ordinal_reason,
         (select count(*) from episode_fact f where f.episode_id = c.episode_id) as facts,
         (select count(*) from episode_source s where s.episode_id = c.episode_id) as sources
    from journey_episode_current c where c.person_id::text in ({idlist})""")
good = ok and len(v) == len(refs) and all(
    r["state"] == "established" and r["began_basis"] == "before_observation" and r["prior_history_status"] == "unobserved"
    and r["lifetime_ordinal"] is None and int(r["facts"]) == 2 and int(r["sources"]) == 0 for r in v)
ok2, t = sql("select (select count(*) from journey_episode) as eps, (select count(*) from episode_fact) as facts, "
             "(select count(*) from episode_source) as sources, (select count(*) from episode_review) as reviews")
say("  verification: " + ("✓ %d established baselines, each with exactly a before-observation begin fact and an "
                         "unobserved prior-history fact, no ordinal, no sources" % len(v) if good else "✗ " + str(v)[:400]))
say("  Journey totals now: " + (str(t[0]) if ok2 else str(t)))
ok3, rows2 = sql(ELIG)
say("  rerun check: " + ("✓ every opened client now shows SKIP (idempotent)" if ok3 and
     all(r["decision"] == "SKIP" for r in rows2 if r["ref"] in refs) else "✗ " + str(rows2)[:200]))
say()
say("RESULT: " + ("BASELINES OPENED AND VERIFIED" if good else "CHECK THE ✗ LINES"))
open(REPORT, "w").write("\n".join(lines) + "\n")
raise SystemExit(0 if good else 6)
