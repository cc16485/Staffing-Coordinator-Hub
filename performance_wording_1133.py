# 1133 · PERFORMANCE WORDING ON MY WORK CARDS (Samantha 2026-10-26: "change the coaching cards and labels to say
# Performance page instead of HR page"). The HR page was renamed Performance on 2026-10-26 (Hub #645), but four
# database functions still write "HR" into My Work cards: coaching talks, coaching side cards, the coaching
# follow-through and Zach's write-up step reminders.
# This reads each function as it is live, checks it is exactly the version read on 2026-10-26, swaps only those words,
# and reads it back. If a function changed since, it stops before touching anything. Texts nobody. Safe to run again.
# hr_performance_wording.sql in this repo is the same result, kept for the record.
import os, sys, json, hashlib, urllib.request, urllib.error, datetime as dt

API, REF = "https://api.supabase.com", "zngsgedlsxinbygwmxwn"
TOKEN, REPORT = os.environ.get("SB_TOKEN", ""), os.environ.get("SB_REPORT", "/tmp/1133 report.txt")
LINES = []
def say(s):
    print("  " + s); LINES.append(s)
def done(code):
    with open(REPORT, "w") as f: f.write("1133 Performance wording\n%s\n\n%s\n" % (dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "\n".join(LINES)))
    sys.exit(code)
def sql(q):
    req = urllib.request.Request(API + f"/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-1133/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read().decode(errors="replace") or "null")
    except urllib.error.HTTPError as e:
        try: return False, json.loads(e.read().decode(errors="replace") or "null")
        except Exception: return False, "HTTP %s" % e.code
    except Exception as e: return False, type(e).__name__

# the live versions read on 2026-10-26 (md5 of pg_get_functiondef)
PINNED = {"hr_coach_side_card": "4021092029ca96a625ea413c9a7e29bc", "hr_coaching_card": "828b0731059c909b39dca270259dcf45",
          "hr_coaching_followthrough": "fccb10a17d9aad887f12e2d3bf0adf29", "hr_sop_reminders": "cd98418e2c18078f10e0ec9d76846f05"}
SWAPS = [("on the HR page", "on the Performance page"), ("Answer it on HR, Coaching", "Answer it on Performance, Coaching"),
         ("Decide the next step on HR.", "Decide the next step on Performance."),
         ("Open it on HR, Formal cases", "Open it on Performance, Formal cases"), ("Do this step on HR, Formal cases", "Do this step on Performance, Formal cases")]
OLD = [a for a, _ in SWAPS]

def defs():
    ok, r = sql("select p.proname as n, pg_get_functiondef(p.oid) as d from pg_proc p join pg_namespace s on s.oid = p.pronamespace "
                "where s.nspname = 'public' and p.proname in (%s)" % ",".join("'%s'" % k for k in PINNED))
    if not ok or not isinstance(r, list): say("✗ Could not read the functions: %s. Nothing changed." % str(r)[:200]); done(1)
    return {x["n"]: x["d"] for x in r}

if not TOKEN.startswith("sbp_"): say("✗ No Supabase token. Nothing changed."); done(1)
live = defs()
if set(live) != set(PINNED): say("✗ Expected 4 functions, found: %s. Nothing changed." % ", ".join(sorted(live))); done(1)
if all(not any(o in d for o in OLD) for d in live.values()):
    say("✓ Already done: no function still says HR. Nothing changed."); say("RESULT: DONE"); done(0)
for n, d in live.items():
    h = hashlib.md5(d.encode()).hexdigest()
    if h != PINNED[n]: say("✗ %s changed since Claude read it (%s). Nothing changed. Tell Claude." % (n, h)); done(1)
say("✓ All 4 functions are the versions Claude read on 2026-10-26.")

new = {}
for n, d in live.items():
    t = d
    for a, b in SWAPS: t = t.replace(a, b)
    new[n] = t
ok, r = sql("begin;\n" + ";\n".join(new[n] for n in sorted(new)) + ";\ncommit;")
if not ok: say("✗ The change was refused: %s. Nothing changed." % str(r)[:300]); done(1)

after = defs()
bad = [n for n, d in after.items() if any(o in d for o in OLD)]
same = [n for n in after if after[n].strip() == new[n].strip()]
if bad: say("✗ Still says HR: %s. Tell Claude." % ", ".join(bad)); done(1)
say("✓ Read back: none of the 4 says HR any more (%d of 4 match the new wording exactly)." % len(same))
for a, b in SWAPS: say("   \"%s\"  →  \"%s\"" % (a, b))
say("Cards made from now on use the new words. Zach's existing write-up reminder cards update on tomorrow morning's run.")
say("RESULT: DONE")
done(0)
