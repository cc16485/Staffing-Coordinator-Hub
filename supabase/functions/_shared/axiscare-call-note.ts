// _shared/axiscare-call-note.ts
// -----------------------------------------------------------------------------
// Push a call's AI summary into AxisCare's CALL LOG, tagged to the matched
// person's profile. (v1 posted profile Notes; the Call Log is AxisCare's
// purpose-built record for phone calls — it carries callerName/callerPhone
// natively, keeps Notes clean, and the entry shows both on the tagged profile
// and in the agency-wide call log screen. POST /api/call-logs.)
//
// Called from call-disposition's ATTACH path (the "Call Transcript - Summarize -
// Add to Notes" GHL workflow posts {attach:true, id, phone, summary} minutes
// after every call). The summary here is GHL's own transcript summary — nothing
// extra is sent to any AI provider by this module.
//
// WHO gets tagged (identity layer decides, never GHL):
//   phone → phone_index → exactly ONE person, or nothing happens
//   person → person_source_id (system='axiscare', confirmed, no review flag)
//     entity priority: client > caregiver > lead > applicant
//   a client CONTACT (daughter, POA...) cannot be tagged (tags support
//     client/caregiver/lead/applicant only), so their call is logged under the
//     caller's own name and tagged to their ONE related client — two related
//     clients means we cannot know who the call was about: skip.
//   a shared household line (2+ people) is never guessed: skip, and say so.
//
// ⚠ DRY RUN BY DEFAULT. Nothing is written to AxisCare unless app_data key
//   'ops_settings' has axiscare_call_notes_live === true. Dry runs still match
//   and log exactly what WOULD have been posted, so the flag can be flipped on
//   evidence instead of hope. Every run (posted, skipped, dry) lands in
//   app_data 'axiscare_call_note_log' (last 100) and 'automation_log'.
//
// Dedupe: the same phone + same summary within 24h posts once (GHL workflows
// can retry, and two workflows may both carry the attach step someday).
// -----------------------------------------------------------------------------

// deno-lint-ignore-file no-explicit-any

const AXIS_UA = 'CaringCompanions-Hub/1.0 (+https://mo-care.com; samantha@mo-care.com)'
const ENTITY_PRIORITY = ['client', 'caregiver', 'lead', 'applicant'] as const

export interface CallNoteResult {
  outcome: 'posted' | 'dry_run' | 'skipped' | 'error'
  detail: string
  entity?: string
  entity_id?: string
  note_id?: number | string
  dry: boolean
}

/* Only a clean US number may match: a foreign or mangled number whose last
   10 digits happen to collide with a real US number would tag the WRONG
   person's profile with full confidence (review finding). */
const digitsOf = (p: string) => {
  const d = String(p || '').replace(/\D/g, '')
  if (d.length === 10) return d
  if (d.length === 11 && d.startsWith('1')) return d.slice(1)
  return ''
}

// Small stable hash for dedupe — not cryptographic, just "same call, same text".
function tinyHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

function chicagoISONow(): string {
  // The call-logs API wants full ISO 8601 with the offset, e.g.
  // 2025-07-01T15:23:45-05:00. Build the Chicago wall clock plus its offset.
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(now).reduce((a: Record<string, string>, p) => (a[p.type] = p.value, a), {})
  const offRaw = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', timeZoneName: 'longOffset' })
    .formatToParts(now).find((p) => p.type === 'timeZoneName')?.value || 'GMT-06:00'
  const m = offRaw.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
  const offset = m ? `${m[1]}${m[2].padStart(2, '0')}:${m[3] || '00'}` : '-06:00'
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`
}

async function logEverything(supabase: any, entry: Record<string, unknown>, ok: boolean, dry: boolean) {
  // The dedicated log is the health trail: every call seen, every decision.
  try {
    const { data } = await supabase.from('app_data').select('data').eq('key', 'axiscare_call_note_log').maybeSingle()
    const arr: any[] = Array.isArray(data?.data) ? data!.data : []
    arr.push({ at: new Date().toISOString(), ...entry })
    await supabase.from('app_data').upsert({ key: 'axiscare_call_note_log', data: arr.slice(-100), updated_at: new Date().toISOString() })
  } catch { /* logging must never block the phone pipeline */ }
  try {
    await supabase.rpc('upsert_app_data_item', {
      target_key: 'automation_log',
      item: {
        id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        at: new Date().toISOString(),
        automation: 'axiscare-call-note', ran_by: 'server',
        ok, dry,
        outcome: entry.outcome, detail: entry.detail,
        entity: entry.entity ?? null, entity_id: entry.entity_id ?? null,
      },
    })
  } catch { /* same */ }
}

export async function pushCallNote(
  supabase: any,
  args: { phone: string; summary: string; direction?: string; ghlContactId?: string },
): Promise<CallNoteResult> {
  const { phone, summary } = args
  const direction = (args.direction || '').toLowerCase() === 'outbound' ? 'outbound' : 'inbound'

  const finish = async (r: CallNoteResult, extra: Record<string, unknown> = {}): Promise<CallNoteResult> => {
    await logEverything(supabase, {
      outcome: r.outcome, detail: r.detail, entity: r.entity, entity_id: r.entity_id,
      note_id: r.note_id, phone_digits: digitsOf(phone), summary_len: summary.length, ...extra,
    }, r.outcome !== 'error', r.dry)
    return r
  }

  // ── The live flag. Dry by default; nothing reaches AxisCare until flipped. ──
  let live = false
  try {
    const { data } = await supabase.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
    live = data?.data?.axiscare_call_notes_live === true
  } catch { /* stay dry */ }
  const dry = !live

  const digits = digitsOf(phone)
  if (digits.length !== 10) return finish({ outcome: 'skipped', detail: 'no usable phone number on the call', dry })
  if (!summary || summary.length < 20) return finish({ outcome: 'skipped', detail: 'summary too short to be a real call summary', dry })

  // ── Dedupe: same phone + same summary in 24h posts once. ──
  const hash = tinyHash(digits + '|' + summary)
  try {
    const { data } = await supabase.from('app_data').select('data').eq('key', 'axiscare_call_note_log').maybeSingle()
    const arr: any[] = Array.isArray(data?.data) ? data!.data : []
    const dayAgo = Date.now() - 24 * 3600 * 1000
    if (arr.some((e) => e.hash === hash && new Date(e.at || 0).getTime() > dayAgo &&
                        (e.outcome === 'posted' || e.outcome === 'dry_run')))
      return finish({ outcome: 'skipped', detail: 'duplicate — this call summary was already handled', dry }, { hash })
  } catch { /* a broken log must not block a real note */ }

  // ── WHO: the identity layer, phone first, one person or nothing. ──
  const e164 = '+1' + digits
  const { data: phoneRows, error: phErr } = await supabase
    .from('phone_index').select('person_id').eq('phone', e164)
  if (phErr) return finish({ outcome: 'error', detail: 'phone_index read failed: ' + phErr.message, dry })
  const personIds: string[] = [...new Set((phoneRows || []).map((r: any) => String(r.person_id)))]
  if (personIds.length === 0)
    return finish({ outcome: 'skipped', detail: 'caller not recognised — no person on this number', dry }, { hash })
  if (personIds.length > 1)
    return finish({ outcome: 'skipped', detail: `shared line — ${personIds.length} people on this number, refusing to guess`, dry }, { hash })
  const personId = personIds[0]

  const { data: pi } = await supabase
    .from('person_identity').select('display_name').eq('id', personId).maybeSingle()
  const callerName = pi?.display_name || 'Unknown caller'

  // ── WHERE: a trusted AxisCare id on the caller, best entity first. ──
  const { data: srcRows } = await supabase
    .from('person_source_id').select('entity_type, source_id')
    .eq('person_id', personId).eq('system', 'axiscare')
    .eq('confidence', 'confirmed').eq('needs_review', false)
  const links: any[] = srcRows || []
  let entity = ''
  let entityId = ''
  let relationLine = ''
  for (const t of ENTITY_PRIORITY) {
    const hit = links.find((l) => l.entity_type === t)
    if (hit) { entity = t; entityId = String(hit.source_id); break }
  }

  // ── No AxisCare profile of their own: a client contact's note goes on the
  //    client, but only when there is exactly one client it could be about. ──
  if (!entity) {
    const { data: relRows } = await supabase
      .from('person_relationship').select('client_person_id, relationship')
      .eq('person_id', personId).eq('active', true)
    const rels: any[] = relRows || []
    const clientIds = [...new Set(rels.map((r) => String(r.client_person_id)))]
    if (clientIds.length === 0)
      return finish({ outcome: 'skipped', detail: `${callerName} is known but has no AxisCare profile and no client relationship`, dry }, { hash })
    if (clientIds.length > 1)
      return finish({ outcome: 'skipped', detail: `${callerName} is a contact for ${clientIds.length} clients — cannot know who the call was about`, dry }, { hash })
    const { data: cliSrc } = await supabase
      .from('person_source_id').select('source_id')
      .eq('person_id', clientIds[0]).eq('system', 'axiscare').eq('entity_type', 'client')
      .eq('confidence', 'confirmed').eq('needs_review', false).maybeSingle()
    if (!cliSrc?.source_id)
      return finish({ outcome: 'skipped', detail: `${callerName}'s client has no confirmed AxisCare id`, dry }, { hash })
    entity = 'client'
    entityId = String(cliSrc.source_id)
    const rel = rels.find((r) => String(r.client_person_id) === clientIds[0])?.relationship
    relationLine = rel ? `Caller is the client's ${rel}.` : 'Caller is a contact for this client.'
  }

  const entityIdNum = Number(entityId)
  if (!Number.isInteger(entityIdNum))
    return finish({ outcome: 'error', detail: `AxisCare id "${entityId}" for ${callerName} is not numeric — cannot tag a call log`, dry }, { hash })

  // A jump link straight to this caller's conversation (calls, recordings,
  // texts) in the phone system, so nobody hunts for the contact by hand.
  const ghlLoc = Deno.env.get('GHL_LOCATION_ID') || ''
  const historyLine = (args.ghlContactId && ghlLoc)
    ? `Full call history and recording: https://app.hirecara.com/v2/location/${ghlLoc}/contacts/detail/${args.ghlContactId}`
    : ''

  const notes = [
    relationLine,
    summary.slice(0, 4000),
    historyLine,
    'Logged automatically by the CC Hub phone system.',
  ].filter(Boolean).join('\n\n')
  const subject = `AI call summary (${direction})`

  if (dry) {
    return finish({
      outcome: 'dry_run', dry,
      detail: `would add a call log tagged to ${entity} ${entityId} (${callerName})`,
      entity, entity_id: entityId,
    }, { hash, would_post: notes.slice(0, 500) })
  }

  // ── The write: one Call Log entry, tagged to the matched profile. ──
  const token = Deno.env.get('AXISCARE_API_KEY') || Deno.env.get('AXISCARE_TOKEN') || ''
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  if (!token || !site) return finish({ outcome: 'error', detail: 'AxisCare credentials not set', dry })
  try {
    const r = await fetch(`https://${site}.axiscare.com/api/call-logs`, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-AxisCare-Api-Version': Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': AXIS_UA,
      },
      body: JSON.stringify({
        callerName,
        callerPhone: e164,
        followUp: false,          // follow-ups are owned by the hub pipeline
        dateTime: chicagoISONow(),
        subject,
        notes,
        tags: [{ type: entity, entityId: entityIdNum }],
      }),
    })
    const j = await r.json().catch(() => ({}))
    // Never trust a bare 200: AxisCare's envelope carries its own success flag.
    if (!r.ok || j?.success === false)
      return finish({
        outcome: 'error', dry, entity, entity_id: entityId,
        detail: `AxisCare refused (${r.status}): ${(j?.errors || []).join('; ') || 'no detail'}`,
      }, { hash })
    return finish({
      outcome: 'posted', dry,
      detail: `call log tagged to ${entity} ${entityId} (${callerName})`,
      entity, entity_id: entityId, note_id: j?.results?.data?.id,
    }, { hash })
  } catch (e) {
    return finish({ outcome: 'error', detail: 'AxisCare call failed: ' + String(e), dry, entity, entity_id: entityId }, { hash })
  }
}
