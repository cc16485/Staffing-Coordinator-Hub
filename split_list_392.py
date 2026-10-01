#!/usr/bin/env python3
# 392 · READ ONLY: the list of people split across two GoHighLevel contacts (Samantha 2026-10-01: "yes build both").
# A temporary helper (split-list) looks each known person's phone and email up in GoHighLevel separately (never creates
# a contact) and lists the people whose texts and emails land on two different contacts, with a link to each, so the
# office can merge each pair in GoHighLevel. The list is written to the Desktop; the helper is removed. Nothing is sent
# or changed.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, time
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip(); REF = "zngsgedlsxinbygwmxwn"; SUPA = os.environ.get("SB_SUPA_CLI", "")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co"); FN = "split-list"
lines = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def http(method, url, body=None, headers=None, timeout=170):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-392/1.0"}, **(headers or {})))
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
say("392 · PEOPLE SPLIT ACROSS TWO GOHIGHLEVEL CONTACTS (read only)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
for n, w in SHAS.items():
    p = os.path.join(FNROOT, n + ".ts") if n.startswith("_shared/") else os.path.join(FNROOT, n, "index.ts")
    if sha(p) != w: say(f"  ✗ {n} is not the reviewed build. Nothing was run."); done(2)
say("  ✓ the read-only helper is the reviewed build")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api", "--no-verify-jwt"], cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: say("  ✗ couldn't put up the helper: " + (p.stderr or p.stdout)[-200:]); done(4)
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)} if s == 200 else {}
SVC, ANON = keys.get("service_role", ""), keys.get("anon", ""); HIDE += [SVC, ANON]; time.sleep(10)
LIST = os.path.join(os.path.dirname(REPORT), "GoHighLevel contacts to merge.txt")
try:
    s0, _ = http("POST", f"{FNB}/functions/v1/{FN}", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
    say(("  ✓" if s0 == 401 else "  ✗") + f" it refuses the public key ({s0})")
    split, total, off, checked, errors = [], None, 0, 0, 0
    while total is None or off < total:
        s, b = http("POST", f"{FNB}/functions/v1/{FN}?offset={off}&limit=15", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
        try: j = json.loads(b)
        except Exception: j = {}
        if s != 200 or not j.get("ok"): say(f"  ✗ the helper stopped at {off} ({s})"); break
        total = j["total"]; split += j["split"]; checked += j["checked"]; errors += j["errors"]; off += 15
    say(f"  · people with both a phone and an email in the Hub: {total} · checked in GoHighLevel: {checked}" + (f" · could not check: {errors}" if errors else ""))
    say(f"  · on two different contacts: {len(split)}")
    out = ["PEOPLE ON TWO GOHIGHLEVEL CONTACTS (" + dt.datetime.now().strftime("%b %-d, %Y") + ")", "",
           "Each person below has their texts on one contact and their emails on another.",
           "To fix one: open the first link, then in GoHighLevel use Merge (Contacts → select both → Merge),",
           "keeping the contact that has the name filled in. Both conversation histories stay.", ""]
    for i, x in enumerate(split, 1):
        out += [f"{i}. {x['name']}", f"   texts:  {x['texts_contact']}", f"   emails: {x['emails_contact']}", ""]
    if not split: out.append("Nobody is split. Nothing to merge.")
    open(LIST, "w").write("\n".join(out) + "\n")
    say(f"  ✓ the list is on your Desktop: {os.path.basename(LIST)}")
finally:
    http("DELETE", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
    s2, _ = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
    say(); say(("  ✓" if s2 == 404 else "  ✗") + " the temporary helper is removed")
say(); say("RESULT: DONE · read only; nothing was sent or changed. Open 'GoHighLevel contacts to merge.txt'.")
try: subprocess.run(["open", LIST])
except Exception: pass
done(0)
