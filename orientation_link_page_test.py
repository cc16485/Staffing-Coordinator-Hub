"""Private applicant links (2026-10-04): the orientation booking page, in a real browser, with a fake Hub server.
python3 orientation_link_page_test.py"""
import json, os, base64
from playwright.sync_api import sync_playwright
PAGE = 'file://' + os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'orientation-booking.html'))
SESS = base64.b64encode(json.dumps([{"id": 7, "date": "2030-10-10", "time": "10:00", "remote": False, "spots": 3}]).encode()).decode()
R = []
def ck(n, c, d=''): R.append(('PASS' if c else 'FAIL', n, '' if c else str(d)[:600]))
def run(query, now_ms=None, open_ok=True):
    calls = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(); pg = b.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
        if now_ms: pg.add_init_script(f"Date.now = () => {now_ms};")
        def handle(route):
            u = route.request.url; body = route.request.post_data or ''
            calls.append((u, body))
            if '/functions/v1/applicant-link' in u:
                j = json.loads(body or '{}')
                if j.get('action') == 'open':
                    return route.fulfill(status=200 if open_ok else 401, content_type='application/json', body=json.dumps({"ok": True, "first": "Ava", "last": "A", "phone": "4175550199", "email": "ava@x.com", "office": "springfield", "candidate_id": "17"} if open_ok else {"ok": False}))
                return route.fulfill(status=200, content_type='application/json', body=json.dumps({"ok": True}))
            if '/functions/v1/' in u or '/rest/v1/' in u: return route.fulfill(status=201, content_type='application/json', body='{}')
            return route.continue_()
        pg.route('**/*supabase.co/**', handle)
        pg.goto(PAGE + query); pg.wait_for_timeout(1500)
        info = pg.evaluate("({ url: location.href, welcome: (document.getElementById('welcome-name')||{}).textContent||'', list: document.getElementById('sessions-list').innerText, btn: getComputedStyle(document.getElementById('confirm-btn')).display })")
        if pg.evaluate("!!document.querySelector('.session-option:not(.full)')"):
            pg.evaluate("document.querySelector('.session-option:not(.full)').click()"); pg.wait_for_timeout(200)
            pg.evaluate("window.alert=()=>{}; submitBooking()"); pg.wait_for_timeout(800)
        b.close()
        return info, calls, errs
ALLERR = []
_run = run
def run(*a, **k):
    r = _run(*a, **k); ALLERR.extend(r[2]); return r
code = f"?sessions={SESS}&c=17&e=1999999999&t={'A'*43}"
info, calls, errs = run(code)
book = [json.loads(c[1]) for c in calls if 'applicant-link' in c[0] and '"book"' in c[1]]
ck('with a private link: greets them by name (asked of the server)', 'Ava' in info['welcome'] and any('"open"' in c[1] for c in calls), info)
ck('...the booking is made by the server with the code (not saved from this page with typed details)', book and book[0].get('c') == '17' and book[0].get('t') == 'A' * 43 and not any('/rest/v1/orient_bookings' in c[0] for c in calls), [book, [c[0] for c in calls]])
ck('...and the confirmation text goes to the phone the server gave', any('send-candidate-message' in c[0] and '4175550199' in c[1] for c in calls))
ck('...the address keeps only the sessions and the code', 'first=' not in info['url'] and 'phone=' not in info['url'] and 'c=17' in info['url'], info['url'])
info, calls, errs = run(code, open_ok=False)
ck('a made-up or expired code: "ask the office for a new link", no booking possible', 'not valid or has run out' in info['list'] and info['btn'] == 'none' and not any('"book"' in c[1] for c in calls), info)
old = f"?sessions={SESS}&first=Old&last=L&phone=4175550100&email=o%40x.com&id=9"
info, calls, errs = run(old, now_ms=1791100000000)   # Oct 4, inside the 30 days
ck('an old link with details, inside the 30 days: still works as before', 'Old' in info['welcome'] and any('/rest/v1/orient_bookings' in c[0] for c in calls), info)
ck('...but the details are taken off the address bar straight away', 'first=' not in info['url'] and 'phone=' not in info['url'] and 'email=' not in info['url'], info['url'])
info, calls, errs = run(old, now_ms=1762300000000 + 86400000 * 400)   # well after Nov 3
ck('an old link with details after Nov 3: "ask the office for a new link"', 'not valid or has run out' in info['list'] and info['btn'] == 'none', info)
info, calls, errs = run(f"?sessions={SESS}")
gen = [json.loads(c[1]) for c in calls if 'applicant-link' in c[0] and '"book"' in c[1]]
ck('the office\'s all-sessions link (no person): still books, through the server', gen and 'c' not in gen[0], gen)
ck('no page errors in any of the runs', not ALLERR, ALLERR)
for s, n, d in R: print(s, '·', n, '' if s == 'PASS' else d)
print(sum(r[0] == 'PASS' for r in R), '/', len(R))
raise SystemExit(0 if all(r[0] == 'PASS' for r in R) else 1)
