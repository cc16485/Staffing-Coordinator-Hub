#!/usr/bin/env python3
# Rehearses Desktop 633 with stand-in live copies (file names as the live download gives them, "supabase/functions/...").
# python3 j1_read_after_lock_633_test.py <shas.json> <before.json>
import os, sys, json, runpy, tempfile
sys.path.insert(0, '.')
T = tempfile.mkdtemp()
os.environ.update({"SB_TOKEN": "sbp_t", "SB_SUPA_CLI": "/bin/ls", "SB_FNROOT": os.path.abspath("supabase/functions"), "SB_REPORT": T + "/r.txt", "SB_STEP": "633",
                   "SB_FN_SHAS": open(sys.argv[1]).read(), "SB_BEFORE_SHAS": open(sys.argv[2]).read()})
import cc_step_lib as L
BEFORE = json.loads(os.environ["SB_BEFORE_SHAS"]); P = "supabase/functions/"
WATCH = ["carematch-watch", "coverage-watch", "timekeeper-watch"]
def build(fn): return {k: L.sha(os.path.join(L.ROOT, k)) for k in L.need(L.FNROOT, fn)}
def run(case):
    deployed = []; L.lines.clear(); L.fails.clear()
    def live(fn):
        if fn in deployed: return build(fn)
        if fn not in WATCH:   # a function reinstalled from main today: the build versions, unless the case says otherwise
            d = build(fn)
            if case == 'not_live_elsewhere': d.pop(P + "_shared/send-problems.ts", None)
            return d
        d = {P + k.split("::", 1)[1]: h for k, h in BEFORE.items() if k.startswith(fn + "::")}
        if fn == 'carematch-watch': d[P + "_shared/events.ts"] = "old578"; d.pop(P + "_shared/verbs.js", None)
        if case in ('today', 'not_live_elsewhere') and fn in ('carematch-watch', 'timekeeper-watch'):
            d[P + "_shared/send-problems.ts"] = "older"; d[P + "_shared/optout.ts"] = "older"
            if fn == 'timekeeper-watch': d[P + "_shared/held-shift.ts"] = "older"
        if case == 'other' and fn == 'timekeeper-watch': d[P + "coverage-watch/../timekeeper-watch/index.ts"] = "x"; d[P + "timekeeper-watch/index.ts"] = "unreleased"
        return d
    L.fmeta = lambda ref, fn: (200, {"version": 9, "verify_jwt": True})
    L.live_files = lambda ref, fn: (True, live(fn))
    L.deploy = lambda ref, root, fn, vj: deployed.append(fn) or True
    L.http = lambda *a, **k: (401, '{}')
    code = None
    try: runpy.run_path('j1_read_after_lock_633.py', run_name='__main__')
    except SystemExit as e: code = e.code
    return code, deployed, open(T + '/r.txt').read()
res = []
code, dep, txt = run('today'); res.append(("today's real situation (578 helper + send-problems/optout/held-shift live elsewhere): installs all three", code == 0 and dep == WATCH and "is the version already live in coverage-run" in txt))
code, dep, txt = run('not_live_elsewhere'); res.append(("a changed shared file that isn't live anywhere: stops, nothing installed", code == 3 and dep == []))
code, dep, txt = run('other'); res.append(("an unreleased change to a watcher's own file: stops", code == 3 and dep == []))
code, dep, txt = run('known'); res.append(("only the 578 helper differs: installs", code == 0 and dep == WATCH))
for n, ok in res: print(("PASS  " if ok else "FAIL  ") + n)
print(f"{sum(ok for _, ok in res)}/{len(res)} passed")
