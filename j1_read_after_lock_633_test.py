# Rehearses Desktop 633 with stand-in live copies: the known 578 helper difference installs; any other difference, or a
# build file the live copy lacks, stops; a live-only file is ignored. python3 j1_read_after_lock_633_test.py "$PWD" <shas> <before>
import os, sys, json, runpy, tempfile
os.chdir(sys.argv[1]); sys.path.insert(0, '.')
T = tempfile.mkdtemp()
os.environ.update({"SB_TOKEN": "sbp_t", "SB_SUPA_CLI": "/bin/ls", "SB_FNROOT": os.path.abspath("supabase/functions"), "SB_REPORT": T + "/r.txt", "SB_STEP": "633",
                   "SB_FN_SHAS": open(sys.argv[2]).read(), "SB_BEFORE_SHAS": open(sys.argv[3]).read()})
import cc_step_lib as L
BEFORE = json.loads(os.environ["SB_BEFORE_SHAS"]); deployed = []
def live(fn, mode):
    d = {"supabase/functions/" + k.split("::", 1)[1]: h for k, h in BEFORE.items() if k.startswith(fn + "::")}
    if fn == 'carematch-watch': d["supabase/functions/_shared/events.ts"] = "old578"; d.pop("supabase/functions/_shared/verbs.js", None)
    if mode == 'other' and fn == 'timekeeper-watch': d["supabase/functions/_shared/loops.ts"] = "surprise"
    return d
for mode in ['known', 'other']:
    deployed.clear(); L.lines.clear(); L.fails.clear()
    L.fmeta = lambda ref, fn: (200, {"version": 9, "verify_jwt": True})
    L.live_files = lambda ref, fn, m=mode: (True, live(fn, m) if not deployed.count(fn) else {k: L.sha(os.path.join(L.ROOT, k)) for k in L.need(L.FNROOT, fn)})
    L.deploy = lambda ref, root, fn, vj: deployed.append(fn) or True
    L.http = lambda *a, **k: (401, '{}')
    try: runpy.run_path('j1_read_after_lock_633.py', run_name='__main__')
    except SystemExit as e: code = e.code
    txt = open(T + '/r.txt').read()
    print(mode, 'exit', code, 'deployed', deployed)
    print('\n'.join(l for l in txt.splitlines() if '578' in l or '✗' in l or 'RESULT' in l)[:600])
# extra cases: a live-only file is ignored; a build file missing from live (not the 578 helper) stops
for mode in ['liveonly', 'missing']:
    deployed.clear(); L.lines.clear(); L.fails.clear()
    def live2(fn, m=mode):
        d = live(fn, 'known')
        if m == 'liveonly' and fn == 'coverage-watch': d["supabase/functions/coverage-watch/deno.json"] = "x"
        if m == 'missing' and fn == 'coverage-watch': d.pop("supabase/functions/_shared/held-shift.ts", None)
        return d
    L.live_files = lambda ref, fn, f=live2: (True, f(fn) if not deployed.count(fn) else {k: L.sha(os.path.join(L.ROOT, k)) for k in L.need(L.FNROOT, fn)})
    try: runpy.run_path('j1_read_after_lock_633.py', run_name='__main__')
    except SystemExit as e: code = e.code
    print(mode, 'exit', code, 'deployed', deployed)
