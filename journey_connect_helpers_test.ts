function jwtClaims(authHeader: string | null): { role: string | null; email: string | null } {
  const m = /^Bearer\s+(.+)$/.exec(authHeader ?? '')
  if (!m) return { role: null, email: null }
  const parts = m[1].split('.')
  if (parts.length !== 3) return { role: null, email: null }
  try {
    const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return { role: typeof p.role === 'string' ? p.role : null,
             email: typeof p.email === 'string' ? p.email.trim().toLowerCase() : null }
  } catch { return { role: null, email: null } }
}
// an escalated admission case is Owner / Decision's call; otherwise Client Intake is the routine seat
function chooseSeat(seats: string[], escalated: boolean): string | null {
  if (escalated) return seats.includes('owner_decision') ? 'owner_decision' : (seats.includes('client_intake') ? 'client_intake' : null)
  if (seats.includes('client_intake')) return 'client_intake'
  if (seats.includes('owner_decision')) return 'owner_decision'
  return null
}
function cleanId(v: unknown): string | null {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : ''
  return /^[0-9]{1,12}$/.test(s) ? s : null
}
function cleanLead(v: unknown): string | null {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : ''
  return s && s.length <= 80 ? s : null
}
function axisSummary(c: any): { name: string; phones: string[]; city: string; status: string } | null {
  if (!c) return null
  const name = [c.firstName, c.lastName].map((x: unknown) => String(x ?? '').trim()).filter(Boolean).join(' ')
  const phones = [c.mobilePhone, c.homePhone, c.otherPhone].map((x: unknown) => String(x ?? '').trim()).filter(Boolean)
  const addr = c.residentialAddress ?? c.address ?? {}
  const city = String(addr?.city ?? '').trim()
  const status = String(c.status?.label ?? c.status ?? '').trim()
  return { name, phones, city, status }
}


const b64u=(o: unknown)=>Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/,"").replace(/\+/g,"-").replace(/\//g,"_");
const T=(o: unknown)=>"Bearer h."+b64u(o)+".s";
const t: [string, unknown, unknown][]=[
 ["signed-in person: role + lowercased email",jwtClaims(T({role:"authenticated",email:" Kat@Example.COM "})),{role:"authenticated",email:"kat@example.com"}],
 ["junk reads as nobody",jwtClaims("Bearer junk"),{role:null,email:null}],
 ["seat: routine Client Intake first; escalated Owner / Decision first; none is null",[chooseSeat(["owner_decision","client_intake"],false),chooseSeat(["client_intake","owner_decision"],true),chooseSeat([],true)],["client_intake","owner_decision",null]],
 ["AxisCare ids: digits only (numbers accepted), anything else refused",[cleanId("295"),cleanId(295),cleanId(" 295 "),cleanId("29a"),cleanId(""),cleanId("1234567890123")],["295","295","295",null,null,null]],
 ["lead ids: trimmed, blank or huge refused",[cleanLead(" L1 "),cleanLead(""),cleanLead("x".repeat(81))],["L1",null,null]],
 ["AxisCare record summarised to name, phones, city, status; missing parts are blank; none is null",
   [axisSummary({firstName:"Peggy",lastName:"Thomason",mobilePhone:"417-555-0101",homePhone:"",residentialAddress:{city:"Nixa"},status:{label:"Active"}}),axisSummary({lastName:"Only"}),axisSummary(null)],
   [{name:"Peggy Thomason",phones:["417-555-0101"],city:"Nixa",status:"Active"},{name:"Only",phones:[],city:"",status:""},null]],
];
let ok=0; t.forEach(([n,a,e])=>{ const g=JSON.stringify(a)===JSON.stringify(e); if(g) ok++; console.log((g?"PASS  ":"FAIL  ")+n+(g?"":"  got "+JSON.stringify(a))); });
console.log("journey-connect helpers: "+ok+"/"+t.length+" pass");
