#!/usr/bin/env python3
# 396b · READ ONLY: office staff whose GoHighLevel contact is missing their email (Samantha 2026-10-01: "yes do both").
# An office alert email failed with GoHighLevel's "Contact has no email". A temporary helper (staff-contacts-check) looks
# up everyone on the alert lists by phone and by email separately (never creates or changes a contact) and lists who
# has what, with links. The list is written to the Desktop; the helper is removed. Nothing is sent or changed.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, time
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip(); REF = "zngsgedlsxinbygwmxwn"; SUPA = os.environ.get("SB_SUPA_CLI", "")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co"); FN = "staff-contacts-check"
lines = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def http(method, url, body=None, headers=None, timeout=170):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-396b/1.0"}, **(headers or {})))
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
say(); say("396b · OFFICE STAFF CONTACTS IN GOHIGHLEVEL (read only)"); say()
for n, w in SHAS.items():
    if n not in ("staff-contacts-check", "_shared/job-auth"): continue
    p = os.path.join(FNROOT, n + ".ts") if n.startswith("_shared/") else os.path.join(FNROOT, n, "index.ts")
    if sha(p) != w: say(f"  ✗ {n} is not the reviewed build. Nothing was run."); done(2)
say("  ✓ the read-only helper is the reviewed build")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api", "--no-verify-jwt"], cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: say("  ✗ couldn't put up the helper: " + (p.stderr or p.stdout)[-200:]); done(4)
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)} if s == 200 else {}
SVC, ANON = keys.get("service_role", ""), keys.get("anon", ""); HIDE += [SVC, ANON]; time.sleep(10)
LIST = os.path.join(os.path.dirname(REPORT), "Office staff GoHighLevel contacts.txt")
try:
    s0, _ = http("POST", f"{FNB}/functions/v1/{FN}", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
    say(("  ✓" if s0 == 401 else "  ✗") + f" it refuses the public key ({s0})")
    s, b = http("POST", f"{FNB}/functions/v1/{FN}", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
    try: j = json.loads(b)
    except Exception: j = {}
    if s != 200 or not j.get("ok"): say(f"  ✗ the helper didn't answer ({s})")
    else:
        say(f"  · people on the office alert lists: {j['people']} · with something to fix: {j['with_problem']}")
        out = ["OFFICE STAFF WHO GET HUB ALERTS: THEIR GOHIGHLEVEL CONTACTS (" + dt.datetime.now().strftime("%b %-d, %Y") + ")", "",
               "Email alerts fail with \"Contact has no email\" when the contact the Hub reaches by phone has no email.",
               "Fix: add the email to the phone contact, or merge the two contacts, in GoHighLevel.", ""]
        for x in j["results"]:
            out.append(f"{'⚠ ' if x.get('problem') else '✓ '}{x['name']}  ({', '.join(x['lists'])})")
            if x.get("problem"): out.append(f"   {x['problem']}")
            if x.get("phone_contact"): out.append(f"   phone contact: {x['phone_contact']}" + ("" if x.get("phone_contact_has_email") is None else (" (has email)" if x["phone_contact_has_email"] else " (NO email)")))
            if x.get("email_contact"): out.append(f"   email contact: {x['email_contact']}")
            out.append("")
        open(LIST, "w").write("\n".join(out) + "\n")
        say(f"  ✓ the list is on your Desktop: {os.path.basename(LIST)}")
finally:
    http("DELETE", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
    s2, _ = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
    say(("  ✓" if s2 == 404 else "  ✗") + " the temporary helper is removed")
say(); say("RESULT: DONE · read only; nothing was sent or changed.")
try: subprocess.run(["open", LIST])
except Exception: pass
done(0)
