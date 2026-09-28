#!/usr/bin/env python3
# P1 · THE COVERED AI KEY (Desktop 317) · puts a new Anthropic key, created in the account the BAA covers, in place
# of ANTHROPIC_API_KEY on the shared project. Every AI feature (call-followup, call-disposition, ai-draft-followup,
# ai-draft-careplan, profile-polish, ai-ltc-policy, score-interview, and any other function reading that setting)
# uses it from its next run.
# Part 1 (read only): the key looks like an Anthropic key; it works, tested with one message that contains no client
#   information ("Reply with the word ready."); the setting exists today.
# Part 2: the setting is replaced.
# Part 3: read back: the setting now holds the new key (compared by fingerprint; neither key is ever printed).
import json, os, sys, hashlib, urllib.request, urllib.error, datetime as dt
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
NEW = os.environ.get("SB_NEW_KEY", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
ANTH = os.environ.get("SB_ANTHROPIC_BASE", "https://api.anthropic.com"); MODEL = "claude-haiku-4-5-20251001"
NAME = "ANTHROPIC_API_KEY"
lines = []
def say(s=""):
    s = str(s).replace(NEW, "(hidden)") if NEW else str(s); print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__); say("  If Part 2 had not started, nothing changed.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def req(method, url, body=None, headers=None):
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-p1/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(r, timeout=90) as x: return x.status, json.loads(x.read().decode(errors="replace") or "null")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode(errors="replace") or "null")
        except Exception: return e.code, None
    except Exception: return None, None
sb = lambda method, path, body=None: req(method, API + f"/v1/projects/{REF}" + path, body, {"Authorization": "Bearer " + TOKEN})
def secret_digest():
    st, sec = sb("GET", "/secrets")
    if st != 200 or not isinstance(sec, list): return st, None
    row = next((s for s in sec if s.get("name") == NAME), None)
    return st, (str(row.get("value") or "") if row else "")
sha = hashlib.sha256(NEW.encode()).hexdigest() if NEW else ""

say("P1 · THE COVERED AI KEY"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
if not NEW.startswith("sk-ant-") or len(NEW) < 40: say("  ✗ That doesn't look like an Anthropic API key (they start with sk-ant-). Nothing was changed."); done(2)
say("  ✓ the new key looks like an Anthropic API key (not shown)")
st, out = req("POST", ANTH + "/v1/messages", {"model": MODEL, "max_tokens": 10, "messages": [{"role": "user", "content": "Reply with the word ready."}]},
              {"x-api-key": NEW, "anthropic-version": "2023-06-01"})
works = st == 200 and isinstance(out, dict) and out.get("type") == "message"
say(("  ✓ " if works else "  ✗ ") + f"the new key works (one test message with no client information: {st})")
if not works:
    say("  STOP. Nothing was changed. Check that the key was copied whole and that its account has credit.")
    done(3)
st, before = secret_digest()
if before is None: say(f"  ✗ could not read the project's settings ({st}). Nothing was changed."); done(4)
say(f"  ✓ the AI key setting exists today: {'yes' if before else 'no (it will be created)'}")
if before and before in (NEW, sha): say("  · the setting already holds this key; nothing to change."); done(0)

say(); say("PART 2 · CHANGE")
st, _ = sb("POST", "/secrets", [{"name": NAME, "value": NEW}])
ok = st in (200, 201)
say(("  ✓ " if ok else "  ✗ ") + f"the AI key setting is replaced ({st})")
if not ok: say("  STOP. The old key is still in place; nothing changed."); done(5)

say(); say("PART 3 · CHECK (read back; fingerprints only)")
st, after = secret_digest()
same = after in (NEW, sha) if after else False
changed = bool(after) and after != before
good = same or (changed and len(after) != 64)
say(("  ✓ " if good else "  ✗ ") + "the setting now holds the new key" + ("" if same else " (it changed; the project reports it in a form I can't match exactly)" if good else ""))
say()
say("RESULT: " + ("DONE · every AI feature uses the key from the account your BAA covers, from its next run." if good else "CHECK THE ✗ LINE."))
say("Next: once the Hub's AI features have worked for a day (a care plan draft, a follow-up draft), delete the OLD key in your Anthropic console.")
say("Undo, only until you delete the old key: put the old key back the same way.")
done(0 if good else 6)
