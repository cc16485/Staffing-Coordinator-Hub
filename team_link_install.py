#!/usr/bin/env python3
# Install Team Build linking: migration (sha-checked), journey-link-plan function (sha-checked),
# seat membership (routing config, from the owner's own answers), then verify.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt

MIG = open(os.environ["SB_MIGFILE"], "rb").read()
EXPECTED_SHA = os.environ["SB_EXPECTED_SHA"]
FN_DIR = os.environ.get("SB_FNDIR", "")
FN_SHA = os.environ.get("SB_FN_SHA", "")
REPORT = os.environ["SB_REPORT"]
LOCAL = os.environ.get("SB_LOCAL_SOCK")
SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "")
SUPA = os.environ.get("SB_SUPA_CLI", "")
INTAKE = [e.strip().lower() for e in os.environ.get("SB_INTAKE", "").split(",") if e.strip()]
OWNER = [e.strip().lower() for e in os.environ.get("SB_OWNER", "").split(",") if e.strip()]

lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)

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
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-team-link/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return True, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e:
        return False, "HTTP %s: %s" % (e.code, e.read().decode(errors="replace")[:600])
    except Exception as e:
        return False, "%s: %s" % (type(e).__name__, e)

EMAIL = re.compile(r"^[^@\s,']+@[^@\s,']+\.[a-z]{2,}$")
say("TEAM BUILD LINKING · INSTALL")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST TARGET)" if LOCAL else ""))
say()
bad = [e for e in INTAKE + OWNER if not EMAIL.match(e)]
if not INTAKE and not OWNER: say("  ✗ STOP: no seat holders given. Nothing was run."); done(2)
if bad: say("  ✗ STOP: these do not look like email addresses: " + ", ".join(bad) + ". Nothing was run."); done(2)
sha = hashlib.sha256(MIG).hexdigest()
say("  migration sha256 " + sha + ("  ✓ proven build" if sha == EXPECTED_SHA else "  ✗ NOT the proven build"))
if sha != EXPECTED_SHA: say("  STOP. Nothing was run."); done(2)
if not SKIP_FN:
    fsha = hashlib.sha256(open(os.path.join(FN_DIR, "index.ts"), "rb").read()).hexdigest()
    say("  journey-link-plan sha256 " + fsha + ("  ✓ reviewed source" if fsha == FN_SHA else "  ✗ differs"))
    if fsha != FN_SHA: say("  STOP. Nothing was run."); done(2)
ok, b = sql("select (select count(*) from journey_episode) as episodes, (select count(*) from staffing_need) as needs")
before = b[0] if ok else {}
ok, res = sql(MIG.decode())
if not ok: say("  ✗ STOPPED: the migration did not complete (guard or self-check): " + str(res)[:400]); done(4)
say("  ✓ migration committed: seat membership, plan links, Journey directory; guard + self-check passed")

vals = ",".join(f"('{e}','client_intake')" for e in INTAKE) + ("," if INTAKE and OWNER else "") + ",".join(f"('{e}','owner_decision')" for e in OWNER)
ok, res = sql(f"insert into public.journey_seat_member (email, seat) values {vals} on conflict do nothing")
if not ok: say("  ✗ seat membership was not saved: " + str(res)[:300]); done(5)
ok, m = sql("select seat, string_agg(email, ', ' order by email) as who from public.journey_seat_member group by seat order by seat")
say("  seat holders now:")
for r in (m if ok else []): say(f"    {r['seat']:15} {r['who']}")

fn_ok = True
if SKIP_FN:
    say("  (test target: function deploy skipped)")
else:
    p = subprocess.run([SUPA, "functions", "deploy", "journey-link-plan", "--project-ref", REF, "--use-api"],
                       cwd=os.path.dirname(os.path.dirname(os.path.dirname(FN_DIR))),
                       env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    fn_ok = p.returncode == 0
    say("  journey-link-plan deploy: " + ("✓ (browser-callable: CORS + OPTIONS included; signed-in staff only)" if fn_ok else "✗ " + (p.stderr or p.stdout)[-400:]))

ok, v = sql("""select has_function_privilege('authenticated','public.team_build_link_set(text,uuid,text,text)','execute') as browser_can_link,
                      has_table_privilege('authenticated','public.journey_seat_member','insert') as browser_can_seat,
                      (select count(*) from public.journey_directory) as directory_rows,
                      (select count(*) from public.team_build_link) as links,
                      (select count(*) from journey_episode) as episodes, (select count(*) from staffing_need) as needs""")
v = v[0] if ok else {}
safe = v.get("browser_can_link") is False and v.get("browser_can_seat") is False
unchanged = v.get("episodes") == before.get("episodes") and v.get("needs") == before.get("needs")
say("  security: " + ("✓ the browser cannot link or change seats directly" if safe else "✗ " + json.dumps(v)))
say(f"  Journey directory: {v.get('directory_rows')} active Journeys available to pick · links so far: {v.get('links')}")
say("  " + ("✓ no Journey episode or staffing need was created or changed" if unchanged else "✗ Journey/staffing counts changed"))
say()
allok = safe and unchanged and fn_ok
say("RESULT: " + ("INSTALLED · the hub update can go live next" if allok else "CHECK THE ✗ LINES"))
done(0 if allok else 6)
