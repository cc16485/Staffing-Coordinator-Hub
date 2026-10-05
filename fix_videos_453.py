#!/usr/bin/env python3
# 453 · FIX CAREGIVER PROFILE VIDEOS. Samantha, 2026-10-05: "i cant hear grace's video", "i can't hear autumn", "im
# using safari", "yes build it". Found: Grace's iPhone video carries a second "spatial audio" track that Safari can pick;
# Autumn's sound is about 16 dB quieter than normal and the file is 48 MB for 19 seconds.
# Every profile video becomes ONE standard copy: H.264 video no bigger than 720 on its short side, ONE AAC sound track
# evened out to a normal speaking level (EBU R128, -16 LUFS), and set to start playing straight away (faststart).
# The new copy is saved next to the original as <profile>/video-<time>-std.mp4 and the profile points at it. The ORIGINAL
# IS KEPT (rollback = point video_path back). Nothing is texted or emailed; no other field changes.
# Part 1 (read only): every profile with a video, what is wrong with each. She types yes. Part 2: fix, check each copy
# (one sound track, normal loudness, small, starts fast), upload, point the profile at it only if it still has the same
# video. Part 3: each new copy opens from the public link.
import json, os, re, sys, subprocess, tempfile, shutil, urllib.request, urllib.error, datetime as dt, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); REF = "zngsgedlsxinbygwmxwn"
SUPA = os.environ.get("SB_SUPA_URL", f"https://{REF}.supabase.co"); BUCKET = "caregiver-profiles"
FFMPEG = os.environ.get("SB_FFMPEG", ""); ASK = os.environ.get("SB_ASK", "1") == "1"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=300, raw=False):
    data = body if isinstance(body, (bytes, bytearray)) else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-453/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            b = r.read(); return r.status, (b if raw else b.decode(errors="replace"))
    except urllib.error.HTTPError as e: return e.code, (b"" if raw else e.read().decode(errors="replace"))
    except Exception as e: return None, (b"" if raw else type(e).__name__)
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict)}
        if usable(got.get("service_role")): return got["service_role"]
    return ""
lit = lambda v: "'" + str(v).replace("'", "''") + "'"
chk = lambda good, msg: (say if good else bad)(("  ✓ " if good else "") + msg)

# ── looking at a video ──
GOOD_AUDIO = ("aac", "mp3", "opus", "vorbis", "alac", "flac", "pcm_")
def probe(path):
    """streams and loudness, from ffmpeg's own report (no ffprobe needed)"""
    p = subprocess.run([FFMPEG, "-hide_banner", "-i", path], capture_output=True, text=True)
    info = {"audio": [], "video": None, "seconds": 0.0, "bytes": os.path.getsize(path)}
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", p.stderr)
    if m: info["seconds"] = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    for st in re.finditer(r"Stream #0:(\d+)[^:]*: (Audio|Video): (\w+)([^\n]*)", p.stderr):
        idx, kind, codec, rest = int(st.group(1)), st.group(2), st.group(3), st.group(4)
        if kind == "Audio": info["audio"].append({"index": idx, "codec": codec})
        elif info["video"] is None:
            wh = re.search(r"(\d{2,5})x(\d{2,5})", rest); info["video"] = {"codec": codec, "w": int(wh.group(1)) if wh else 0, "h": int(wh.group(2)) if wh else 0}
    usable = [a for a in info["audio"] if a["codec"].startswith(GOOD_AUDIO)]
    info["sound"] = usable[0]["index"] if usable else None
    info["mean_db"] = None
    if info["sound"] is not None:
        v = subprocess.run([FFMPEG, "-hide_banner", "-i", path, "-map", f"0:{info['sound']}", "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True)
        mm = re.search(r"mean_volume: (-?[\d.]+) dB", v.stderr); info["mean_db"] = float(mm.group(1)) if mm else None
    return info
def starts_fast(path):
    """the index (moov) comes before the picture data (mdat), so a phone can start playing before it has it all"""
    b = open(path, "rb").read(1 << 20); mo, md = b.find(b"moov"), b.find(b"mdat")
    return mo != -1 and (md == -1 or mo < md)
def problems(info, path):
    out = []
    if len(info["audio"]) > 1: out.append(f"{len(info['audio'])} sound tracks (Safari can pick the wrong one)")
    if info["sound"] is None: out.append("no sound track we can play" if info["audio"] else "no sound recorded")
    elif info["mean_db"] is not None and info["mean_db"] < -28: out.append(f"very quiet ({info['mean_db']:.0f} dB; normal is about -20)")
    elif info["mean_db"] is not None and info["mean_db"] > -10: out.append(f"very loud ({info['mean_db']:.0f} dB)")
    if info["bytes"] > 12 * 1024 * 1024: out.append(f"big ({info['bytes'] / 1048576:.0f} MB)")
    v = info["video"] or {}
    if v and min(v.get("w", 0), v.get("h", 0)) > 720: out.append(f"{v['w']}x{v['h']} (more than a phone needs)")
    if not path.endswith(".mp4"): out.append("not an .mp4")
    if not starts_fast(path): out.append("slow to start (must download first)")
    return out
def standardise(src, dst, info):
    cmd = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-map", "0:v:0"]
    if info["sound"] is not None: cmd += ["-map", f"0:{info['sound']}"]
    cmd += ["-vf", "scale=w='if(gt(iw,ih),-2,min(720,iw))':h='if(gt(iw,ih),min(720,ih),-2)'",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-profile:v", "high"]
    cmd += (["-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11"] if info["sound"] is not None else ["-an"])
    cmd += ["-movflags", "+faststart", "-map_metadata", "-1", dst]
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.returncode == 0 and os.path.exists(dst), p.stderr[-300:]

say("453 · FIX CAREGIVER PROFILE VIDEOS"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
if not FFMPEG or not os.path.exists(FFMPEG): bad("the video tool (ffmpeg) isn't on this Mac. Nothing was changed. Tell Claude."); done(2)
enc = subprocess.run([FFMPEG, "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
fil = subprocess.run([FFMPEG, "-hide_banner", "-filters"], capture_output=True, text=True).stdout
if "libx264" not in enc or " aac " not in enc or "loudnorm" not in fil: bad("the video tool can't make the standard copy (libx264, aac, loudnorm). Nothing was changed."); done(2)
say("  ✓ the video tool on this Mac can make the standard copy")
SERVICE = keys(); HIDE.append(SERVICE)
if not SERVICE: bad("couldn't read the Hub's server key. Nothing was changed."); done(3)
ok, rows = sql("select id, first_name, video_path, published from public.caregiver_profiles where video_path is not null and status <> 'withdrawn' order by updated_at")
if not ok: bad(f"couldn't read the profiles ({rows}). Nothing was changed."); done(3)
say(f"  · {len(rows)} profile{'' if len(rows) == 1 else 's'} with a video")
TMP = tempfile.mkdtemp(prefix="cc453-")
PLAN = []
for r in rows:
    nm = (r.get("first_name") or "someone").split()[0]
    vp = str(r["video_path"])
    if not re.match(r"^[0-9a-f-]{36}/[\w.\-]+$", vp) or not vp.startswith(str(r["id"]) + "/"): bad(f"{nm}: the video address looks wrong, left alone"); continue
    if vp.endswith("-std.mp4"): say(f"  · {nm}: already the standard copy, left alone"); continue
    s, b = http("GET", f"{SUPA}/storage/v1/object/public/{BUCKET}/{vp}", headers={}, raw=True)
    if s != 200 or not b: bad(f"{nm}: couldn't download the video ({s}), left alone"); continue
    src = os.path.join(TMP, str(r["id"]) + "-in" + os.path.splitext(vp)[1]); open(src, "wb").write(b)
    info = probe(src)
    if not info["video"]: bad(f"{nm}: that file has no picture we can read, left alone"); continue
    pr = problems(info, src)
    say(f"  · {nm}{' (published)' if r.get('published') else ''}: {info['seconds']:.0f} seconds, " + ("; ".join(pr) if pr else "fine already, made standard anyway"))
    PLAN.append({"row": r, "name": nm, "src": src, "info": info})
if not PLAN: say(); say("RESULT: nothing to fix. Nothing was changed."); shutil.rmtree(TMP, ignore_errors=True); done(0 if not fails else 8)

say()
if ASK:
    try: a = input(f"  Fix these {len(PLAN)} video{'' if len(PLAN) == 1 else 's'} now? The originals are kept. Type yes and press Enter: ").strip().lower()
    except EOFError: a = ""
    if a != "yes": say("  · you didn't type yes, so nothing was changed."); shutil.rmtree(TMP, ignore_errors=True); done(0)
say("PART 2 · CHANGE (each new copy is checked before the profile points at it)")
S = {"Authorization": "Bearer " + SERVICE, "apikey": SERVICE}
FIXED = []
for it in PLAN:
    r, nm, src = it["row"], it["name"], it["src"]
    dst = os.path.join(TMP, str(r["id"]) + "-std.mp4")
    good, err = standardise(src, dst, it["info"])
    if not good: bad(f"{nm}: the standard copy couldn't be made ({err.strip()[:120]}), left alone"); continue
    o = probe(dst)
    sound_ok = (it["info"]["sound"] is None and not o["audio"]) or (len(o["audio"]) == 1 and o["mean_db"] is not None and -30 <= o["mean_db"] <= -12)
    short = min((o["video"] or {}).get("w", 0), (o["video"] or {}).get("h", 0))
    if not (sound_ok and o["video"] and o["video"]["codec"] == "h264" and 0 < short <= 720 and starts_fast(dst) and abs(o["seconds"] - it["info"]["seconds"]) < 1.5):
        bad(f"{nm}: the new copy didn't pass its checks, left alone"); continue
    path = f"{r['id']}/video-{int(time.time() * 1000)}-std.mp4"
    s, b = http("POST", f"{SUPA}/storage/v1/object/{BUCKET}/{path}", open(dst, "rb").read(), dict(S, **{"Content-Type": "video/mp4", "x-upsert": "false", "cache-control": "3600"}))
    if s not in (200, 201): bad(f"{nm}: the new copy didn't upload ({s}), left alone"); continue
    ok, up = sql(f"update public.caregiver_profiles set video_path = {lit(path)}, updated_at = now() where id = {lit(r['id'])} and video_path = {lit(r['video_path'])} returning id")
    if not ok or not up: bad(f"{nm}: their video changed while this ran, so it was left as they have it now"); continue
    loud = f"sound now {o['mean_db']:.0f} dB" if o["mean_db"] is not None else "no sound (none was recorded)"
    say(f"  ✓ {nm}: one standard copy, {o['bytes'] / 1048576:.1f} MB (was {it['info']['bytes'] / 1048576:.1f} MB), {loud}, starts straight away")
    FIXED.append((nm, path, o["bytes"]))

say(); say("PART 3 · PROOF")
for nm, path, size in FIXED:
    s, b = http("GET", f"{SUPA}/storage/v1/object/public/{BUCKET}/{path}", headers={}, raw=True)
    chk(s == 200 and len(b) == size, f"{nm}: the new copy opens from the public link families get")
shutil.rmtree(TMP, ignore_errors=True)
say()
say(f"RESULT: " + (f"DONE · {len(FIXED)} video{'' if len(FIXED) == 1 else 's'} fixed. Play them again in Safari (their card, or ▶ Their video)." if not fails else f"PARTLY DONE · {len(FIXED)} fixed; the ✗ lines above need Claude."))
say("Nothing was texted or emailed. The originals are kept next to the new copies.")
say("Rollback: Claude can point any profile back at its original video.")
done(0 if not fails else 8)
