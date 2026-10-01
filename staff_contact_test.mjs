// One contact for office staff (2026-10-01). node staff_contact_test.mjs
import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const S = await import(path.join(process.cwd(), 'supabase/functions/_shared/staff-contact.ts'))
const ghl = { token: 't', locationId: 'loc' }
const fake = (dup = {}, byId = {}, upsertId = 'NEW') => { const calls = []; const f = async (url, init) => { calls.push([init?.method ?? 'GET', url, init?.body ? JSON.parse(init.body) : null])
  let body; if (url.includes('/contacts/search/duplicate')) { const q = decodeURIComponent(url.split('&').slice(1).join('&')); body = dup[q] ? { contact: { id: dup[q] } } : {} }
  else if (url.endsWith('/contacts/upsert')) body = { contact: { id: upsertId } }
  else { const id = decodeURIComponent(url.split('/contacts/')[1]); body = init?.method === 'PUT' ? { contact: { id } } : { contact: byId[id] } }
  return { ok: true, json: async () => body } }; f.calls = calls; return f }
// Samantha's real case: phone contact with NO email, email on another contact
let f = fake({ 'number=+14175550001': 'P', 'email=sam@x.com': 'E' })
let id = await S.ghlStaffContact(ghl, { channel: 'email', phone: '417-555-0001', email: 'Sam@X.com', firstName: 'Samantha' }, f)
ck('an alert EMAIL goes to the contact that HAS the email (not the phone contact without one)', id === 'E' && !f.calls.some((c) => c[0] === 'PUT'), f.calls)
f = fake({ 'number=+14175550001': 'P', 'email=sam@x.com': 'E' })
id = await S.ghlStaffContact(ghl, { channel: 'sms', phone: '417-555-0001', email: 'sam@x.com', firstName: 'Samantha' }, f)
ck('an alert TEXT goes to the contact that has the phone', id === 'P', f.calls)
f = fake({ 'email=new@x.com': 'E2' }, { E2: { id: 'E2', firstName: 'Nia', email: 'new@x.com' } })
id = await S.ghlStaffContact(ghl, { channel: 'sms', phone: '4175550009', email: 'new@x.com', firstName: 'Nia' }, f)
const put = f.calls.find((c) => c[0] === 'PUT')
ck('a new staff phone is ADDED to their email contact (one contact), not a second contact', id === 'E2' && put && put[2].phone === '+14175550009' && !f.calls.some((c) => c[1].endsWith('/upsert')), f.calls)
f = fake({}, {}, 'U1'); id = await S.ghlStaffContact(ghl, { channel: 'email', email: 'only@x.com', firstName: 'Only' }, f)
const up = f.calls.find((c) => c[1].endsWith('/upsert'))
ck('nobody has it and no other address: found/created by this address ALONE (never phone + email together)', id === 'U1' && up[2].email === 'only@x.com' && !('phone' in up[2]), f.calls)
f = fake({ 'email=x@x.com': 'E' }, { E: { id: 'E', firstName: 'Margaret', email: 'x@x.com' } }, 'U2')
id = await S.ghlStaffContact(ghl, { channel: 'sms', phone: '4175550010', email: 'x@x.com', firstName: 'Dana' }, f)
ck('a different first name is left alone', id === 'U2' && !f.calls.some((c) => c[0] === 'PUT'), f.calls)
id = await S.ghlStaffContact(ghl, { channel: 'sms', phone: '12' }, f); ck('an unusable number: no contact, no call', id === '')
id = await S.ghlStaffContact(ghl, { channel: 'sms', phone: '4175550011' }, async () => { throw new Error('down') }); ck('GoHighLevel down: empty, never throws', id === '')
let all = true; console.log('\nSTAFF ONE CONTACT · TEST\n' + '='.repeat(50)); for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED')
