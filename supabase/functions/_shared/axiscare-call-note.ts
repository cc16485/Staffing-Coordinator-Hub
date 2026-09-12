// _shared/axiscare-call-note.ts
// -----------------------------------------------------------------------------
// Push a call's AI summary onto the matched person's AxisCare profile as a note.
//
// Called from call-disposition's ATTACH path (the "Call Transcript - Summarize -
// Add to Notes" GHL workflow posts {attach:true, id, phone, summary} minutes
// after every call). The summary here is GHL's own transcript summary — nothing
// extra is sent to any AI provider by this module.
//
// WHO gets the note (identity layer decides, never GHL):
//   phone → phone_index → exactly ONE person, or nothing happens
//   person → person_source_id (system='axiscare', confirmed, no review flag)
//     entity priority: client > caregiver > lead > applicant
//   a client CONTACT (daughter, POA...) has no AxisCare notes endpoint, so the
//     note goes on their ONE related client's profile, prefixed "Call from ..."
//     — two related clients means we cannot know who the call was about: skip.
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

const digitsOf = (p: string) => String(p || '').replace(/\D/g, '').slice(-10)

// Small stable hash for dedupe — not cryptographic, just "same call, same text".
function tinyHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

function chicagoNaiveNow(): string {
  // AxisCare wants a timezone-less local timestamp: YYYY-MM-DDTHH:mm:ss
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date()).reduce((a: Record<string, string>, p) => (a[p.type] = p.value, a), {})
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
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
  args: { phone: string; summary: string; direction?: string },
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
  let callerLine = ''
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
    callerLine = `Call from ${callerName}${rel ? ' (' + rel + ')' : ''}.`
  }

  const note = [
    `Phone call (${direction}), AI summary:`,
    callerLine,
    '',
    summary.slice(0, 4000),
    '',
    'Posted automatically by the CC Hub phone system.',
  ].filter((l, i) => l !== '' || i > 1).join('\n')

  if (dry) {
    return finish({
      outcome: 'dry_run', dry,
      detail: `would post on ${entity} ${entityId} (${callerName})`,
      entity, entity_id: entityId,
    }, { hash, would_post: note.slice(0, 500) })
  }

  // ── The write. ──
  const token = Deno.env.get('AXISCARE_API_KEY') || Deno.env.get('AXISCARE_TOKEN') || ''
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  if (!token || !site) return finish({ outcome: 'error', detail: 'AxisCare credentials not set', dry })
  try {
    const r = await fetch(`https://${site}.axiscare.com/api/notes/${entity}/${encodeURIComponent(entityId)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-AxisCare-Api-Version': Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': AXIS_UA,
      },
      body: JSON.stringify({ note, dateTime: chicagoNaiveNow(), important: false }),
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
      detail: `note on ${entity} ${entityId} (${callerName})`,
      entity, entity_id: entityId, note_id: j?.results?.id,
    }, { hash })
  } catch (e) {
    return finish({ outcome: 'error', detail: 'AxisCare call failed: ' + String(e), dry, entity, entity_id: entityId }, { hash })
  }
}
