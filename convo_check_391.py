#!/usr/bin/env python3
# 391 · READ ONLY: do the Hub's texts and emails show in GoHighLevel Conversations? (2026-10-01, Samantha: "yes do the
# check"). A temporary helper (convo-check) takes the Hub's own "this went out" stamps from the last 7 days and, for each
# person + channel, looks the contact up in GoHighLevel (never creates one) and checks whether that contact's
# conversation shows the outgoing message; also whether a person's text and email sit on two different contacts.
# Then the helper is removed. Counts only: no names, numbers, emails or ids. Nothing is sent or changed.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, time
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip(); REF = "zngsgedlsxinbygwmxwn"; SUPA = os.environ.get("SB_SUPA_CLI", "")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co"); FN = "convo-check"
lines = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def http(method, url, body=None, headers=None, timeout=170):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-391/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    try: return json.loads(b) if s in (200, 201) else {"error": b[:200]}
    except Exception: return {"error": b[:200]}
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
say("391 · DO HUB MESSAGES SHOW IN GOHIGHLEVEL? (read only)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
for n, w in SHAS.items():
    p = os.path.join(FNROOT, n + ".ts") if n.startswith("_shared/") else os.path.join(FNROOT, n, "index.ts")
    if sha(p) != w: say(f"  ✗ {n} is not the reviewed build. Nothing was run."); done(2)
say("  ✓ the read-only helper is the reviewed build")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api", "--no-verify-jwt"], cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: say("  ✗ couldn't put up the helper: " + (p.stderr or p.stdout)[-200:]); done(4)
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)} if s == 200 else {}
SVC, ANON = keys.get("service_role", ""), keys.get("anon", ""); HIDE += [SVC, ANON]; time.sleep(10)
try:
    s0, _ = http("POST", f"{FNB}/functions/v1/{FN}", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
    say(("  ✓" if s0 == 401 else "  ✗") + f" it refuses the public key ({s0})")
    res, total, off = [], None, 0
    while total is None or off < total:
        s, b = http("POST", f"{FNB}/functions/v1/{FN}?offset={off}&limit=10", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
        try: j = json.loads(b)
        except Exception: j = {}
        if s != 200 or not j.get("ok"): say(f"  ✗ the helper stopped at {off} ({s}): {b[:120]}"); break
        total = j["total"]; res += j["results"]; off += 10
    say(); say(f"WHAT THE HUB SENT IN THE LAST 7 DAYS: {total} person + channel pairs checked: {len(res)}")
    for label, after in (("AFTER this afternoon's fix (these should all show)", True), ("BEFORE the fix (many were held back by the mix-up, so some missing is expected)", False)):
        part = [r for r in res if bool(r.get("after_fix")) == after]
        say(); say(f"  {label}: {len(part)}")
        tally = {}
        for r in part: tally[(r["channel"], r["result"])] = tally.get((r["channel"], r["result"]), 0) + 1
        for (ch, rr), n in sorted(tally.items()): say(f"      {'texts' if ch == 'sms' else 'emails'} · {rr}: {n}")
        by = {}
        for r in part: by.setdefault(r["source"], [0, 0]); by[r["source"]][0] += 1; by[r["source"]][1] += r["result"] == "shown"
        for k, (n, sh) in sorted(by.items()): say(f"      {k}: {sh} of {n} shown")
    both = [r for r in res if "split" in r and r.get("other_found")]
    say(); say(f"  SPLIT CONTACTS: of {len(both)} people whose text and email are both in GoHighLevel, {sum(1 for r in both if r['split'])} are on two different contacts")
    errs = [r for r in res if r["result"] == "could not check"]
    if errs: say(f"  · could not check: {len(errs)} (GoHighLevel answers: {sorted(set(str(r.get('lookup_status')) for r in errs))})")
finally:
    http("DELETE", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
    s2, _ = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
    say(); say(("  ✓" if s2 == 404 else "  ✗") + " the temporary helper is removed")
say(); say("RESULT: DONE · read only; nothing was sent or changed. Tell Claude it's done.")
done(0)
