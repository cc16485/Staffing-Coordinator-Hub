/**
 * 588 · The texts a person sent us, read from GoHighLevel (Samantha, 2026-10-11: "build the hub version", so no
 * GoHighLevel workflow is needed for interview replies). The same lookups the Hub's ghl-thread uses: find the contact by
 * phone, their conversations, the messages in them. Returns only INBOUND texts newer than `since`, oldest first.
 * Never throws: anything it cannot read comes back as { ok: false } and the caller does nothing.
 */
const GHL = 'https://services.leadconnectorhq.com'
const digits = (t: unknown) => String(t ?? '').replace(/\D/g, '').slice(-10)
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>

export async function inboundTextsSince(token: string, loc: string, phone: unknown, since: string, send: typeof fetch = fetch)
  : Promise<{ ok: boolean; texts: Array<{ at: string; body: string }> }> {
  const want = digits(phone)
  if (want.length !== 10 || !token || !loc) return { ok: false, texts: [] }
  const h = { Authorization: `Bearer ${token}`, Version: '2021-07-28', Accept: 'application/json' }
  try {
    let contactId = ''
    for (const url of [`${GHL}/contacts/lookup?locationId=${encodeURIComponent(loc)}&phone=${encodeURIComponent(want)}`,
                       `${GHL}/contacts/?locationId=${encodeURIComponent(loc)}&query=${encodeURIComponent(want)}&limit=20`]) {
      const r = await send(url, { headers: h })
      if (!r.ok) continue
      const j = await r.json().catch(() => ({}))
      const list: Row[] = j?.contacts ?? (j?.contact ? [j.contact] : [])
      const hit = list.find((c) => digits(c.phone) === want)       // the same number, never "the first one"
      if (hit?.id) { contactId = hit.id; break }
    }
    if (!contactId) return { ok: true, texts: [] }
    const r = await send(`${GHL}/conversations/search?locationId=${encodeURIComponent(loc)}&contactId=${encodeURIComponent(contactId)}&limit=10`, { headers: h })
    if (!r.ok) return { ok: false, texts: [] }
    const convos: Row[] = (await r.json().catch(() => ({})))?.conversations ?? []
    const after = Date.parse(since)
    const out: Array<{ at: string; body: string }> = []
    for (const c of convos.slice(0, 5)) {
      const m = await send(`${GHL}/conversations/${encodeURIComponent(c.id)}/messages?limit=30`, { headers: h })
      if (!m.ok) return { ok: false, texts: [] }      // half a picture is worse than none
      const body = await m.json().catch(() => ({}))
      const msgs: Row[] = body?.messages?.messages ?? body?.messages ?? []
      for (const x of msgs) {
        const sms = Number(x.type) === 1 || /SMS/i.test(String(x.messageType || ''))
        const at = String(x.dateAdded ?? x.dateUpdated ?? '')
        if (x.direction === 'inbound' && sms && Date.parse(at) > after && String(x.body || '').trim()) out.push({ at, body: String(x.body).slice(0, 500) })
      }
    }
    out.sort((a, b) => a.at.localeCompare(b.at))
    return { ok: true, texts: out }
  } catch { return { ok: false, texts: [] } }
}
