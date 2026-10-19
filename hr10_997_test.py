#!/usr/bin/env python3
# Rehearsal of 997 (hr10_997.py, missed notes stop drafting write-ups, HR step 10 piece 1): the 969 rehearsal's fake
# management API and supabase tool (whose "live" missed-notes is GitHub main's, or today's real live copy with
# REAL_LIVE), then 997. Never touches Supabase.   python3 hr10_997_test.py   (CMD=<Desktop .command> rehearses the launcher)
import os, json, re, subprocess, hashlib, glob, datetime, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
_src = open(os.path.join(HERE, "coaching_calls_969_test.py")).read()
exec(_src[:_src.index("code, out = run969()")])
res.clear()
FILES = ["missed-notes/index.ts"]
SHAS997 = {k: hsha(os.path.join(FNR, k)) for k in FILES}
t_ = os.path.join(TMP, "ls-mn"); shutil.rmtree(t_, ignore_errors=True); fake_live("missed-notes", t_); LIVE997 = bundle_shas(t_)
GATES["missed-notes"] = True
_og = F.do_GET
def _get(self):
    if self.path.endswith("/functions/missed-notes"): return self._send(200, {"version": 30, "verify_jwt": M.get("gate_missed-notes", True)})
    return _og(self)
F.do_GET = _get
def base997(drafts=False):
    seed961(True); run(); extra()
    c = conn()
    c.run("insert into public.app_data(key, data) values ('discipline_actions', '[{\"id\":\"w1\",\"status\":\"draft\"}]'::jsonb) on conflict (key) do nothing")
    c.run("insert into cron.job(jobname, schedule, command) values ('missed-notes', '*/5 * * * *', 'select net.http_post(url := ''x/functions/v1/missed-notes'')') on conflict do nothing")
    c.run("update public.app_data set data = data || cast(:d as jsonb) where key = 'ops_settings'", d=json.dumps({"missed_notes_live": True, **({"missed_notes_drafts": True} if drafts else {})}))
    c.close()
    for f in glob.glob(os.path.join(TMP, "dep-*")): os.remove(f)
    shutil.rmtree(os.path.join(TMP, "live"), ignore_errors=True)
def run997(shas=None, live_shas=None, fresh=True, **kw):
    if fresh: base997(**kw)
    M.clear()
    rep = os.path.join(TMP, "r997.txt")
    if os.path.exists(rep): os.remove(rep)
    p = subprocess.run(["python3", os.path.join(COPY, "hr10_997.py")], cwd=COPY, env=dict(ENVF(rep), SB_STEP="997", SB_FN_SHAS=json.dumps(shas or SHAS997), SB_LIVE_SHAS=json.dumps(live_shas or LIVE997)), capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else "") + p.stdout + p.stderr
code, out = run997()
ck("runs to DONE with no ✗", code == 0 and "RESULT: DONE" in out and "✗" not in out, out[-2000:])
got = bundle_shas(os.path.join(TMP, "live", "missed-notes")) if os.path.exists(os.path.join(TMP, "live", "missed-notes")) else {}
changed = {k for k in LIVE997 if got.get(k) != LIVE997[k]}
ck("it went out as the live copy plus ONLY the change to missed-notes/index.ts (nothing held back released)", changed == {"supabase/functions/missed-notes/index.ts"} and set(got) == set(LIVE997), (changed, set(got) ^ set(LIVE997)))
ck("...and the deployed missed-notes has the drafting switched off", "drafting: 'off (the HR agent decides)'" in open(os.path.join(TMP, "live", "missed-notes", "supabase", "functions", "missed-notes", "index.ts")).read())
code2, out2 = run997(live_shas={"supabase/functions/missed-notes/index.ts": "0" * 64})
ck("the live copy is not what was reviewed: stops before anything", code2 == 3 and "not what Claude reviewed" in out2 and not os.path.exists(os.path.join(TMP, "dep-missed-notes")), out2[-400:])
code3, out3 = run997(drafts=True)
ck("drafting switched on in settings: stops and says so", code3 == 3 and "missed_notes_drafts is on" in out3, out3[-400:])
code4, out4 = run997(shas={"missed-notes/index.ts": "0" * 64})
ck("not the reviewed build: stops before anything", code4 == 2, out4[-300:])
ck("no em dashes in the installer", "\u2014" not in open(os.path.join(COPY, "hr10_997.py")).read())
CMD = os.environ.get("CMD", "")
if CMD:
    src = open(CMD).read()
    P = re.search(r'^P="([^"]+)"', src, re.M).group(1); PIN = re.search(r'^PIN="([0-9a-f]{40})"', src, re.M).group(1)
    FH = os.path.join(TMP, "home997"); os.makedirs(os.path.join(FH, ".local", "bin"), exist_ok=True); os.makedirs(os.path.join(FH, "Desktop"), exist_ok=True)
    try: os.symlink(os.path.join(FAKEBIN, "supabase"), os.path.join(FH, ".local", "bin", "supabase"))
    except FileExistsError: pass
    FB = os.path.join(TMP, "fakebin997"); os.makedirs(FB, exist_ok=True); open(os.path.join(FB, "open"), "w").write("#!/bin/sh\nexit 0\n"); os.chmod(os.path.join(FB, "open"), 0o755)
    REPO = os.path.join(TMP, "repo997"); subprocess.run(["git", "clone", "-q", HERE, REPO], check=True)
    s2 = src.replace(P, REPO).replace("/Users/samantha/Desktop", os.path.join(FH, "Desktop"))
    ck("the launcher pins a commit that exists", subprocess.run(["git", "-C", REPO, "cat-file", "-e", PIN + "^{commit}"]).returncode == 0, PIN)
    LC = os.path.join(TMP, "launch997.command"); open(LC, "w").write(s2); os.chmod(LC, 0o755)
    base997(); M.clear()
    env = dict(ENVF(""), HOME=FH, PATH=FB + ":" + os.environ["PATH"]); [env.pop(k) for k in ("SB_REPORT", "SB_FNROOT", "SB_TOKEN", "SB_LIVE_SHAS")]
    env["REAL_LIVE"] = os.environ.get("REAL_LIVE", "")
    p = subprocess.run(["zsh", LC], input="sbp_fake_token\n\n", env=env, capture_output=True, text=True, timeout=300)
    reps = sorted(glob.glob(os.path.join(FH, "Desktop", "997 *report*.txt")))
    rep = open(reps[-1]).read() if reps else ""
    ck("the launcher runs the reviewed build to DONE", "RESULT: DONE" in rep and "✗" not in rep, p.stdout[-1500:] + p.stderr[-800:] + rep[-800:])
for n_, okk, note in res: print(("PASS  " if okk else "FAIL  ") + n_ + ("" if okk else "\n      " + str(note).replace("\n", "\n      ")))
print(f"{sum(1 for _, o, _ in res if o)}/{len(res)} passed"); raise SystemExit(0 if all(o for _, o, _ in res) else 1)
