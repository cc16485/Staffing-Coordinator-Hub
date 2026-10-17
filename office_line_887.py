#!/usr/bin/env python3
# 887 · EVERY HUB TEXT GOES OUT FROM (417) 234-8494 (Samantha 2026-10-17: "We REALLY want to make sure that everything calls
#  and texts are being sent out from 417-234-8494"). Texts were going out from Krystal's 647-4127 because the Hub named no
#  sender and GoHighLevel picked the contact owner's own number.
#  Redeploys every function that sends a text (the ones that use _shared/send-problems.ts or _shared/office-from.ts, plus the
#  7 that send directly), each keeping its gateway setting. A function is skipped, and listed, when its live copy is not a
#  build from GitHub (someone's unmerged work is never overwritten) or when newer work merged since the review touches it.
#  No database change. Nothing is sent by this step.
import json, os, subprocess
os.environ.setdefault("SB_STEP", "887")
import cc_step_lib as L
from cc_step_lib import say, bad, done, start, check_build, fmeta, live_files, deploy, sha

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
CHANGED = {"supabase/functions/_shared/office-from.ts", "supabase/functions/_shared/send-problems.ts"} | {
    f"supabase/functions/{f}/index.ts" for f in ("ops-escalate", "coverage-run", "team-ask", "kind-tell", "applicant-invite", "send-candidate-message", "reference-send")}
TESTS = ["office_line_sender_test.mjs"]
ok = lambda s: say("  ✓ " + s)
def run(args): p = subprocess.run(args, capture_output=True); return p.returncode, p.stdout
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)

start("EVERY HUB TEXT GOES OUT FROM (417) 234-8494")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
mainf = lambda k: run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
for k in sorted(CHANGED):
    c, b = mainf(k)
    if c != 0 or b != open(os.path.join(ROOT, k), "rb").read(): stop(f"{k.split('functions/')[-1]} isn't on GitHub's main yet (merge the pull request first)")
ok("the reviewed change is what is on GitHub's main")
NODE = next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "") or subprocess.run(["/bin/zsh", "-lc", "command -v node"], capture_output=True, text=True).stdout.strip()
if NODE:
    for t in TESTS:
        p = subprocess.run([NODE, t], cwd=ROOT, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0: stop(f"{t} failed: {last}")
        ok(f"{t}: {last}")
else: say("  · node is not on this Mac, so the sender test was not re-run here (it passed when built)")

FNS = sorted(d for d in os.listdir(FNROOT) if not d.startswith(("_", ".")) and os.path.exists(os.path.join(FNROOT, d, "index.ts")) and L.need(FNROOT, d) & CHANGED)
say(f"  · {len(FNS)} functions send texts through the changed code")
HIST = {}
def history(k):
    if k not in HIST:
        out = set()
        c, b = run(["git", "-C", ROOT, "log", "--format=%H", MAIN, "--", k])
        for cm in b.decode().split():
            c2, b2 = run(["git", "-C", ROOT, "show", f"{cm}:{k}"])
            if c2 == 0: import hashlib; out.add(hashlib.sha256(b2).hexdigest())
        HIST[k] = out
    return HIST[k]
PLAN, SKIP = [], []
for fn in FNS:
    need = L.need(FNROOT, fn)
    drift = [k for k in need - CHANGED if (lambda r: r[0] != 0 or r[1] != open(os.path.join(ROOT, k), "rb").read())(mainf(k))]
    if drift: SKIP.append((fn, "newer work merged since the review: " + ", ".join(x.split("functions/")[-1] for x in drift)[:160])); continue
    s, m = fmeta(REF, fn)
    if s == 404: SKIP.append((fn, "not deployed (nothing to change)")); continue
    if s != 200 or not m or "verify_jwt" not in m: SKIP.append((fn, f"couldn't read how it is set up live ({s})")); continue
    okd, live = live_files(REF, fn)
    if not okd: SKIP.append((fn, "couldn't download the live copy")); continue
    if all(live.get(k) == sha(os.path.join(ROOT, k)) for k in need): SKIP.append((fn, "already has it")); continue
    odd = [k for k, v in live.items() if k.endswith((".ts", ".js")) and v not in history(k)]
    if odd: SKIP.append((fn, "the live copy is not a build from GitHub (someone's unmerged work): " + ", ".join(x.split("functions/")[-1] for x in odd)[:160])); continue
    PLAN.append((fn, bool(m["verify_jwt"])))
ok(f"{len(PLAN)} to redeploy; {len(SKIP)} left as they are")
for fn, why in SKIP: say(f"  · {fn}: {why}")
if not PLAN and not any("already has it" in w for _, w in SKIP): stop("nothing could be redeployed")

say(); say("PART 2 · CHANGE (redeploy, gateway settings kept)")
for fn, vj in PLAN:
    if not deploy(REF, FNROOT, fn, vj):
        say(f"  RESULT: STOPPED at {fn}. Everything above it is in and safe on its own. Tell Claude."); done(7)

say(); say("PART 3 · PROOF (read only)")
for fn, _ in PLAN:
    okd, live = live_files(REF, fn)
    if not (okd and all(live.get(k) == sha(os.path.join(ROOT, k)) for k in L.need(FNROOT, fn))): bad(f"{fn}: the live copy is not the reviewed build")
if not L.fails: ok(f"all {len(PLAN)} redeployed functions: the live copy is exactly the reviewed build")
held = [fn for fn, why in SKIP if "already has it" not in why and "not deployed" not in why]
say(); say("Nothing was sent by this step. The next text the Hub sends goes out from (417) 234-8494: check it in GoHighLevel Conversations.")
if held: say(f"  · {len(held)} function(s) above were left as they are and still let GoHighLevel pick the number. Tell Claude: " + ", ".join(held))
say("RESULT: DONE" if not L.fails else f"RESULT: {len(L.fails)} PROBLEM(S) ABOVE. Tell Claude.")
done(0 if not L.fails else 4)
