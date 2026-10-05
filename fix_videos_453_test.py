#!/usr/bin/env python3
# Rehearsal of 453 against a FAKE Supabase (management API + storage) with MADE-UP videos and the real video tool. Never
# touches a real project. python3 fix_videos_453_test.py   (SB_FFMPEG=<path> if imageio_ffmpeg isn't installed)
import json, os, re, subprocess, sys, tempfile, threading, http.server, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
FF = os.environ.get("SB_FFMPEG") or subprocess.run([sys.executable, "-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"], capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
tmp = tempfile.mkdtemp(prefix="t453-")
def make(name, args):
    p = os.path.join(tmp, name); subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y"] + args + [p], check=True); return p
# 1. Grace-like: iPhone .mov, two sound tracks, normal level, small picture
grace = make("grace.mov", ["-f", "lavfi", "-i", "testsrc=size=480x360:rate=24:duration=6", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-f", "lavfi", "-i", "sine=frequency=880:duration=6",
                           "-map", "0", "-map", "1", "-map", "2", "-c:v", "libx264", "-c:a", "aac", "-shortest"])
# 2. Autumn-like: .mp4, one very quiet track, full HD, index at the end
autumn = make("autumn.mp4", ["-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=30:duration=5", "-f", "lavfi", "-i", "sine=frequency=300:duration=5",
                             "-af", "volume=0.01", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest"])
# 3. portrait phone video with no sound at all
mute = make("mute.mp4", ["-f", "lavfi", "-i", "testsrc=size=1080x1920:rate=30:duration=3", "-c:v", "libx264", "-preset", "ultrafast"])
U = lambda n: "00000000-0000-4000-8000-%012d" % n
ROWS = [{"id": U(1), "first_name": "Grace", "video_path": f"{U(1)}/video-1791227445793.mov", "published": False},
        {"id": U(2), "first_name": "Autumn", "video_path": f"{U(2)}/video-1791228990851.mp4", "published": True},
        {"id": U(3), "first_name": "Mia", "video_path": f"{U(3)}/video-1791200000000.mp4", "published": False},
        {"id": U(4), "first_name": "Done", "video_path": f"{U(4)}/video-1791200000001-std.mp4", "published": True},
        {"id": U(5), "first_name": "Odd", "video_path": "../../etc/passwd", "published": False}]
FILES = {}; SEEN = []; UP = []; M = {}
def reset():
    FILES.clear(); SEEN.clear(); UP.clear(); M.clear()
    for r, f in ((ROWS[0], grace), (ROWS[1], autumn), (ROWS[2], mute)): FILES[r["video_path"]] = open(f, "rb").read()
    FILES[ROWS[3]["video_path"]] = b"x"
    for r in ROWS: r["_vp"] = r["video_path"]
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj, raw=None):
        b = raw if raw is not None else json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/octet-stream" if raw is not None else "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": "eyJanon"}, {"name": "service_role", "api_key": "eyJsvcSECRET"}])
        m = re.match(r"/storage/v1/object/public/caregiver-profiles/(.+)$", p)
        if m and m.group(1) in FILES: return self._send(200, None, FILES[m.group(1)])
        self._send(404, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n); p = self.path
        if p.endswith("/database/query"):
            q = json.loads(raw)["query"]; SEEN.append(q)
            if q.startswith("select id, first_name, video_path"): return self._send(201, [{k: (r["_vp"] if k == "video_path" else r[k]) for k in ("id", "first_name", "video_path", "published")} for r in ROWS])
            m = re.match(r"update public\.caregiver_profiles set video_path = '([^']+)', updated_at = now\(\) where id = '([^']+)' and video_path = '([^']+)' returning id", q)
            if m:
                r = next(x for x in ROWS if x["id"] == m.group(2))
                if M.get("changed") == r["id"]: return self._send(201, [])
                if r["_vp"] == m.group(3): r["_vp"] = m.group(1); return self._send(201, [{"id": r["id"]}])
                return self._send(201, [])
            return self._send(201, [])
        m = re.match(r"/storage/v1/object/caregiver-profiles/(.+)$", p)
        if m:
            if self.headers.get("Authorization") != "Bearer eyJsvcSECRET": return self._send(403, {})
            if M.get("upfail"): return self._send(500, {})
            FILES[m.group(1)] = raw; UP.append((m.group(1), self.headers.get("Content-Type"), len(raw))); return self._send(200, {"Key": m.group(1)})
        self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
def run(stdin="", mode=None, **over):
    reset(); M.update(mode or {}); rep = os.path.join(tmp, "r.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_SUPA_URL=URL, SB_FFMPEG=FF, SB_ASK="1"); env.update(over)
    p = subprocess.run([sys.executable, os.path.join(HERE, "fix_videos_453.py")], env=env, input=stdin, capture_output=True, text=True, timeout=600)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
def probe(b):
    f = os.path.join(tmp, "probe.mp4"); open(f, "wb").write(b)
    e = subprocess.run([FF, "-hide_banner", "-i", f], capture_output=True, text=True).stderr
    v = subprocess.run([FF, "-hide_banner", "-i", f, "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True).stderr
    m = re.search(r"mean_volume: (-?[\d.]+)", v)
    return {"audio": len(re.findall(r"Stream #0:\d+[^:]*: Audio", e)), "size": re.search(r"Video: h264[^\n]*?(\d{2,5})x(\d{2,5})", e), "mean": float(m.group(1)) if m else None, "fast": b[:1 << 20].find(b"moov") < max(b[:1 << 20].find(b"mdat"), 10**9 if b[:1 << 20].find(b"mdat") == -1 else 0)}

rc, r = run(stdin="no\n")
ck("Part 1 lists each video and what is wrong, then asks; anything but yes changes NOTHING", rc == 0 and "you didn't type yes" in r and not UP and not any(q.startswith("update") for q in SEEN)
   and re.search(r"Grace: \d+ seconds, 2 sound tracks \(Safari can pick the wrong one\); not an \.mp4", r) and re.search(r"Autumn \(published\): \d+ seconds, very quiet \(-\d+ dB; normal is about -20\);.*1920x1080.*slow to start", r)
   and "Mia: 3 seconds, no sound recorded" in r and "Done: already the standard copy, left alone" in r and "Odd: the video address looks wrong, left alone" in r, r)
rc, r = run(stdin="yes\n"); print(r)
ck("yes: Grace, Autumn and Mia fixed; the already-standard one and the odd address left alone", "Grace: one standard copy" in r and "Autumn: one standard copy" in r and "Mia: one standard copy" in r and len(UP) == 3 and "Done: already" in r, r)
new = {x["first_name"]: x["_vp"] for x in ROWS}
ck("each profile now points at <its id>/video-<time>-std.mp4, uploaded as video/mp4", all(re.match(r"^%s/video-\d{13}-std\.mp4$" % U(i), new[n]) for i, n in ((1, "Grace"), (2, "Autumn"), (3, "Mia"))) and all(t == "video/mp4" for _, t, _ in UP), [new, UP])
ck("the originals are kept (nothing deleted)", all(ROWS[i]["video_path"] in FILES for i in range(3)))
g, a, mu = probe(FILES[new["Grace"]]), probe(FILES[new["Autumn"]]), probe(FILES[new["Mia"]])
ck("Grace's copy: ONE sound track, normal level, starts fast", g["audio"] == 1 and g["mean"] is not None and -30 <= g["mean"] <= -12 and g["fast"], g)
ck("Autumn's copy: the quiet sound is brought up to a normal level, 1080p becomes 720p, starts fast", a["audio"] == 1 and a["mean"] is not None and a["mean"] > -30 and a["size"] and int(a["size"].group(2)) == 720 and a["fast"], a)
ck("Mia's portrait video with no sound: still no sound, short side 720", mu["audio"] == 0 and mu["size"] and int(mu["size"].group(1)) == 720, mu)
ck("only the video address changes, guarded by the old address", all(re.match(r"update public\.caregiver_profiles set video_path = '[^']+', updated_at = now\(\) where id = '[^']+' and video_path = '[^']+' returning id$", q) for q in SEEN if q.startswith("update")), [q for q in SEEN if q.startswith("update")])
ck("the report has no keys, tokens, emails or video addresses", not re.search(r"eyJ|sbp_|SECRET|@|caregiver-profiles/|video-\d", r), r)
rc, r = run(stdin="yes\n", mode={"changed": U(2)})
ck("a video the caregiver replaced while this ran is left as they have it", "Autumn: their video changed while this ran" in r and ROWS[1]["_vp"] == ROWS[1]["video_path"] and "PARTLY DONE" in r, r)
rc, r = run(stdin="yes\n", mode={"upfail": True})
ck("an upload that fails changes no profile", "didn't upload" in r and not any(q.startswith("update") for q in SEEN) and rc != 0, r)
rc, r = run(SB_FFMPEG="/nope")
ck("no video tool: stops before reading anything", rc != 0 and "isn't on this Mac" in r and not SEEN, r)
H.shutdown(); shutil.rmtree(tmp, ignore_errors=True)
for n, ok, note in res: print(("PASS " if ok else "FAIL ") + n + ("" if ok else "\n      " + note))
print("ALL %d CHECKS PASS" % len(res) if all(x[1] for x in res) else "FAILED"); sys.exit(0 if all(x[1] for x in res) else 1)
