// node push_notify_623_test.mjs · phone notifications (623): which items, who, quiet hours, told once, the VAPID signature.
import fs from 'fs'; import os from 'os'; import path from 'path'; import { stripTypeScriptTypes } from 'module'
const FN = path.join(path.dirname(new URL(import.meta.url).pathname), 'supabase/functions')
const R = []; const ck = (n, ok, d) => R.push([ok ? 'PASS' : 'FAIL', n, ok ? '' : JSON.stringify(d ?? '').slice(0, 300)])
// a real P-256 key for the signature check
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey), raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
const b64u = (u) => Buffer.from(u).toString('base64url')
const ENV = { VAPID_PRIVATE_JWK: JSON.stringify(jwk), VAPID_PUBLIC: b64u(raw), SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k' }
globalThis.Deno = { env: { get: (k) => ENV[k] ?? '' }, serve: () => {} }
let src = fs.readFileSync(path.join(FN, 'push-notify/index.ts'), 'utf8')
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => ({})')
  .replace(/^import \{ jobCaller \} from .*$/m, 'const jobCaller = async () => null')
  .replace(/^import \{ requireStaff, OFFICE_ROLES \} from .*$/m, 'const requireStaff = async () => ({ ok: false }); const OFFICE_ROLES = []')
  .replace(/^import \{ officeQuiet, afterHoursAllowed \} from .*$/m, "import { officeQuiet, afterHoursAllowed } from '" + path.join(FN, '_shared/quiet-hours.ts') + "'")
const tmp = path.join(os.tmpdir(), 'push623_' + process.pid + '.ts'); fs.writeFileSync(tmp, src)
const M = await import(tmp); fs.unlinkSync(tmp)
const mc = { id: 'mc1', status: 'open', kind: 'staffing_issue', opened_by: 'timekeeper-watch', owner: '' }
const urg = { id: 'u1', status: 'open', kind: 'request', urgency: 'urgent', owner: 'krystal@mo-care.com' }
const esc = { id: 'e1', status: 'open', kind: 'request', sub_state: 'escalated', owner: 'zach@mo-care.com', also_for: ['samantha@mo-care.com'] }
const plain = { id: 'p1', status: 'open', kind: 'request', urgency: 'high', owner: 'krystal@mo-care.com' }
const closed = { ...urg, id: 'c1', status: 'done' }
ck('Act Now: missed clock-in, urgent and escalated count; high, ordinary and closed do not', M.isActNow(mc) && M.isActNow(urg) && M.isActNow(esc) && !M.isActNow(plain) && !M.isActNow(closed))
const subs = ['krystal@mo-care.com', 'samantha@mo-care.com', 'zach@mo-care.com']
ck('an owned item goes to its owner (and also_for), only if they turned notifications on', JSON.stringify(M.recipients(urg, subs)) === '["krystal@mo-care.com"]' && JSON.stringify(M.recipients(esc, ['samantha@mo-care.com']).sort()) === '["samantha@mo-care.com"]')
ck('an item nobody owns goes to everyone with notifications on', M.recipients(mc, subs).length === 3)
let p = M.plan([mc, urg, esc, plain], subs, new Set(), false, {})
ck('daytime: one entry per person, listing their items', p.get('krystal@mo-care.com').sort().join() === 'mc1,u1' && p.get('zach@mo-care.com').sort().join() === 'e1,mc1' && p.size === 3, [...p])
p = M.plan([mc, urg], subs, new Set(['u1|krystal@mo-care.com', 'mc1|krystal@mo-care.com']), false, {})
ck('told once: an item already told to someone is not told again', !p.has('krystal@mo-care.com') && p.has('samantha@mo-care.com'))
p = M.plan([mc, urg, esc], subs, new Set(), true, {})
ck('quiet hours: only a missed clock-in still goes (its after-hours switch is on unless set off); the rest wait for morning', [...p.values()].every((ids) => ids.join() === 'mc1') && p.size === 3, [...p])
p = M.plan([mc], subs, new Set(), true, { missed_clockin_after_hours: false })
ck('...and with missed clock-ins after hours switched off, nothing goes at night', p.size === 0)
const auth = await M.vapidAuth('https://web.push.apple.com/abc')
const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(auth)
const claims = m && JSON.parse(Buffer.from(m[2], 'base64url').toString())
const sigOk = m && await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, Buffer.from(m[3], 'base64url'), new TextEncoder().encode(m[1] + '.' + m[2]))
ck('the VAPID signature: ES256 over the push service origin, verifies with the public key, expires within a day', !!m && claims.aud === 'https://web.push.apple.com' && sigOk && m[4] === b64u(raw) && claims.exp - Date.now() / 1000 < 86400)
const srcAll = fs.readFileSync(path.join(FN, 'push-notify/index.ts'), 'utf8')
ck('the push carries no payload (no names or details ever leave)', /'Content-Length': '0'/.test(srcAll) && !/body:\s*JSON\.stringify\(\{[^}]*title/.test(srcAll) && !/method: 'POST', headers: \{[^}]*\}, body/.test(srcAll))
for (const [s, n, d] of R) console.log(s + '  ' + n + (d ? '  ' + d : ''))
const bad = R.filter((r) => r[0] === 'FAIL').length
console.log(bad ? bad + ' OF ' + R.length + ' FAILED' : 'ALL ' + R.length + ' CHECKS PASS'); process.exit(bad ? 1 : 0)
