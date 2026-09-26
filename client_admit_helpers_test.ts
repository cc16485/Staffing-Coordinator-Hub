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
// an escalated case is Owner / Decision's call; otherwise Client Intake is the routine seat
function chooseSeat(seats: string[], escalated: boolean): string | null {
  if (escalated) return seats.includes('owner_decision') ? 'owner_decision' : (seats.includes('client_intake') ? 'client_intake' : null)
  if (seats.includes('client_intake')) return 'client_intake'
  if (seats.includes('owner_decision')) return 'owner_decision'
  return null
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function uuidOrNull(v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === '') return null
  return typeof v === 'string' && UUID.test(v) ? v : undefined      // undefined = invalid
}
function textOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null
}
function cleanId(v: unknown): string | null {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : ''
  return /^[0-9]{1,12}$/.test(s) ? s : null
}

const b64u=(o: unknown)=>Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/,"").replace(/\+/g,"-").replace(/\//g,"_");
const T=(o: unknown)=>"Bearer h."+b64u(o)+".s";
const U="33e69299-6bde-4aef-b01c-01379d750430";
const t: [string, unknown, unknown][]=[
 ["signed-in person: role + lowercased email",jwtClaims(T({role:"authenticated",email:" Kat@Example.COM "})),{role:"authenticated",email:"kat@example.com"}],
 ["junk and missing headers read as nobody",[jwtClaims("Bearer junk"),jwtClaims(null)],[{role:null,email:null},{role:null,email:null}]],
 ["routine case: Client Intake first; Owner / Decision alone works; no seat is null",[chooseSeat(["owner_decision","client_intake"],false),chooseSeat(["owner_decision"],false),chooseSeat([],false)],["client_intake","owner_decision",null]],
 ["escalated case: Owner / Decision first; Client Intake alone still reaches the Door (which refuses it)",[chooseSeat(["client_intake","owner_decision"],true),chooseSeat(["client_intake"],true)],["owner_decision","client_intake"]],
 ["ids: blank is null, a uuid passes, anything else is invalid",[uuidOrNull(""),uuidOrNull(null),uuidOrNull(U),uuidOrNull("123"),uuidOrNull(5)].map(v=>v===undefined?"INVALID":v),[null,null,U,"INVALID","INVALID"]],
 ["AxisCare ids: digits only",[cleanId("295"),cleanId(295),cleanId("x9"),cleanId("")],["295","295",null,null]],
 ["text: trimmed, blank is null, capped at 500",[textOrNull(" hi "),textOrNull("  "),(textOrNull("x".repeat(900))||"").length],["hi",null,500]],
];
let ok=0; t.forEach(([n,a,e])=>{ const g=JSON.stringify(a)===JSON.stringify(e); if(g) ok++; console.log((g?"PASS  ":"FAIL  ")+n+(g?"":"  got "+JSON.stringify(a))); });
console.log("client-admit (step 3) helpers: "+ok+"/"+t.length+" pass");
