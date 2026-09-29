#!/usr/bin/env python3
# S1 · A NEW AXISCARE KEY (Desktop 327). The old key is readable in this public repository's history, so it is replaced.
# The owner makes the new key in AxisCare and pastes it into this script's own prompt (it is never printed or saved
# anywhere but Supabase's secrets).
# Part 1 (read only): which AxisCare key names each project holds (fingerprints only); the new key is tried against
#   AxisCare directly (clients, caregivers, visits: status codes only). Anything but a working key stops here.
# Part 2: the new key is saved under every AxisCare key name each project already has (AXISCARE_API_KEY, AXISCARE_TOKEN,
#   AXISCARE_VISITS_TOKEN). AXISCARE_SITE is never touched.
# Part 3 (read back): every name now holds the new key (by fingerprint), and AxisCare still answers.
import json, os, hashlib, urllib.request, urllib.error, datetime as dt, sys, getpass
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
AX = os.environ.get("AX_BASE", "https://16485.axiscare.com")
PROJECTS = [("the Hub", os.environ.get("SB_REF_HUB", "zngsgedlsxinbygwmxwn")), ("Training", os.environ.get("SB_REF_TRAINING", "rdqujxiycycwhskyvrwa"))]
NAMES = ["AXISCARE_API_KEY", "AXISCARE_TOKEN", "AXISCARE_VISITS_TOKEN"]
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def api(ref, path, method="GET", body=None):
    req = urllib.request.Request(API + f"/v1/projects/{ref}" + path, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-s1/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, json.loads(r.read().decode(errors="replace") or "null")
    except urllib.error.HTTPError as e: return e.code, None
    except Exception: return None, None
def ax(key, path):
    req = urllib.request.Request(AX + path, headers={"Authorization": "Bearer " + key, "Accept": "application/json",
        "X-AxisCare-Api-Version": "2023-10-01", "User-Agent": "cc-s1/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: r.read(); return r.status
    except urllib.error.HTTPError as e: return e.code
    except Exception: return None
fp = lambda v: hashlib.sha256(v.encode()).hexdigest()
def secrets(ref):
    st, out = api(ref, "/secrets")
    if st != 200 or not isinstance(out, list): return None
    return {s.get("name"): str(s.get("value") or "") for s in out if isinstance(s, dict)}
def tryax(key):
    today = dt.date.today().isoformat()
    r = {"clients": ax(key, "/api/clients"), "caregivers": ax(key, "/api/caregivers"),
         "visits": ax(key, f"/api/visits?startDate={today}&endDate={today}")}
    return r, r["clients"] == 200 and r["caregivers"] == 200 and r["visits"] in (200, 404)

say("S1 · A NEW AXISCARE KEY"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
have = {}
for label, ref in PROJECTS:
    s = secrets(ref)
    if s is None: say(f"  ✗ could not read {label}'s secret names. Nothing was changed."); done(4)
    have[ref] = {n: s[n] for n in NAMES if n in s}
    say(f"  ✓ {label}: AxisCare key names held: " + (", ".join(f"{n} ({v[:8]})" for n, v in have[ref].items()) or "none")
        + (" · site number set" if "AXISCARE_SITE" in s or "AXISCARE_SITE_NUMBER" in s else " · ✗ no site number"))
if not any(have.values()): say("  ✗ neither project holds an AxisCare key. Nothing was changed."); done(4)
new = os.environ["AX_NEW_KEY"] if "AX_NEW_KEY" in os.environ else getpass.getpass("\n  Paste the NEW AxisCare key (it won't show), then Enter: ")
new = new.strip().strip('"').strip("'")
print()
if not new: say("  ✗ no key came through. Nothing was changed."); done(3)
if new.isdigit(): say("  ✗ that looks like the site number, not a key. Nothing was changed."); done(3)
if len(new) < 20 or any(c.isspace() for c in new): say("  ✗ that doesn't look like an AxisCare key. Nothing was changed."); done(3)
nf = fp(new)
if any(v and (v == nf or v.startswith(nf[:16])) for h in have.values() for v in h.values()):
    say("  ✗ that is the key already saved (the old one). Make a new one in AxisCare. Nothing was changed."); done(3)
res, ok = tryax(new)
say(("  ✓ " if ok else "  ✗ ") + "the new key works in AxisCare: " + ", ".join(f"{k} {v}" for k, v in res.items()))
if not ok: say("  STOP. It needs the same permissions as the current key (clients, caregivers, visits). Nothing was changed."); done(3)

say(); say("PART 2 · CHANGE")
for label, ref in PROJECTS:
    names = list(have[ref])
    if not names: say(f"  · {label}: no AxisCare key held, nothing to replace"); continue
    st, _ = api(ref, "/secrets", "POST", [{"name": n, "value": new} for n in names])
    good = st in (200, 201)
    say(("  ✓ " if good else "  ✗ ") + f"{label}: new key saved under " + ", ".join(names) + ("" if good else f" (answered {st})"))
    if not good: say("  STOP. Projects above this line have the new key; the old key still works everywhere until you switch it off, so nothing is broken."); done(5)

say(); say("PART 3 · CHECK (read back)")
allok = True
olds = {v for h in have.values() for v in h.values()}
now = {}
for label, ref in PROJECTS:
    s = secrets(ref) or {}
    for n in have[ref]: now[(label, n)] = s.get(n)
vals = set(now.values())
one = len(vals) == 1 and None not in vals and not (vals & olds)   # every name, both projects: the same value, and not an old one
allok = allok and one
for label, ref in PROJECTS:
    if have[ref]: say(("  ✓ " if one else "  ✗ ") + f"{label}: every AxisCare key name now holds the new key (the same fingerprint everywhere, none of the old ones)")
res, ok = tryax(new); allok = allok and ok
say(("  ✓ " if ok else "  ✗ ") + "AxisCare still answers the new key: " + ", ".join(f"{k} {v}" for k, v in res.items()))
say()
say("RESULT: " + ("DONE · the Hub and Training now use the new key. NEXT (you): in AxisCare, switch the OLD key off (and any older one). Then tell me, and I remove the copies on this Mac." if allok else "CHECK THE ✗ LINES. The old key still works until you switch it off, so nothing is broken."))
say("The key itself was never printed or written to this report.")
done(0 if allok else 7)
