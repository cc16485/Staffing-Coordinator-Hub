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

// Client Intake is the routine seat for promises; Owner / Decision may also record
function chooseSeat(seats: string[]): string | null {
  if (seats.includes('client_intake')) return 'client_intake'
  if (seats.includes('owner_decision')) return 'owner_decision'
  return null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
function dateOrNull(v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === '') return null
  return typeof v === 'string' && DATE.test(v) ? v : undefined     // undefined = invalid
}
function textOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 2000) : null
}


const b64u=(o: unknown)=>Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/,"").replace(/\+/g,"-").replace(/\//g,"_");
const T=(o: unknown)=>"Bearer h."+b64u(o)+".s";
const t: [string, unknown, unknown][]=[
 ["signed-in person: role + lowercased email",jwtClaims(T({role:"authenticated",email:" Kat@Example.COM "})),{role:"authenticated",email:"kat@example.com"}],
 ["anon token has no email",jwtClaims(T({role:"anon"})),{role:"anon",email:null}],
 ["junk and missing headers read as nobody",[jwtClaims("Bearer junk"),jwtClaims(null)],[{role:null,email:null},{role:null,email:null}]],
 ["Client Intake preferred; Owner / Decision alone works; no seat is null",[chooseSeat(["owner_decision","client_intake"]),chooseSeat(["owner_decision"]),chooseSeat([])],["client_intake","owner_decision",null]],
 ["dates: blank is null, YYYY-MM-DD passes, anything else is invalid",[dateOrNull(""),dateOrNull(null),dateOrNull("2026-10-05"),dateOrNull("10/5/2026"),dateOrNull(20261005)].map(v=>v===undefined?"INVALID":v),[null,null,"2026-10-05","INVALID","INVALID"]],
 ["text: trimmed, blank is null, capped at 2000",[textOrNull("  hi "),textOrNull("   "),textOrNull(5),(textOrNull("x".repeat(3000))||"").length],["hi",null,null,2000]],
];
let ok=0; t.forEach(([n,a,e])=>{ const g=JSON.stringify(a)===JSON.stringify(e); if(g) ok++; console.log((g?"PASS  ":"FAIL  ")+n+(g?"":"  got "+JSON.stringify(a))); });
console.log("start-contract helpers: "+ok+"/"+t.length+" pass");
