export function jwtClaims(authHeader: string | null): { role: string | null; email: string | null } {
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

// first link: Client Intake (or Owner / Decision if that is all they hold);
// re-link: Owner / Decision only
export function chooseSeat(seats: string[], hasCurrentLink: boolean): string | null {
  if (hasCurrentLink) return seats.includes('owner_decision') ? 'owner_decision' : (seats.includes('client_intake') ? 'client_intake' : null)
  if (seats.includes('client_intake')) return 'client_intake'
  if (seats.includes('owner_decision')) return 'owner_decision'
  return null
}


const b64u=(o: unknown)=>Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/,"").replace(/\+/g,"-").replace(/\//g,"_");
const T=(o: unknown)=>"Bearer h."+b64u(o)+".s";
const t: [unknown, unknown][]=[[jwtClaims(T({role:"authenticated",email:" Kat@example.com "})),{role:"authenticated",email:"kat@example.com"}],
 [jwtClaims(T({role:"anon"})),{role:"anon",email:null}],[jwtClaims("Bearer junk"),{role:null,email:null}],[jwtClaims(null),{role:null,email:null}],
 [chooseSeat(["client_intake"],false),"client_intake"],[chooseSeat(["owner_decision"],false),"owner_decision"],
 [chooseSeat(["client_intake","owner_decision"],false),"client_intake"],[chooseSeat(["client_intake","owner_decision"],true),"owner_decision"],
 [chooseSeat(["client_intake"],true),"client_intake"],[chooseSeat([],false),null]];
let ok=0; t.forEach(([a,e],i)=>{ if(JSON.stringify(a)===JSON.stringify(e)) ok++; else console.log("FAIL",i,JSON.stringify(a),JSON.stringify(e)); });
console.log("edge helpers: "+ok+"/"+t.length+" pass");
