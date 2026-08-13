// Supabase Edge Function: caregiver-intro  (shared hub project)
// -----------------------------------------------------------------------------
// Introduces a caregiver to a family before somebody walks into their mother's
// house. Sent by hand from the hub today; the same function is what the
// AxisCare trigger will call later, which is why the deciding is in here rather
// than in the button.
//
// WHO HEARS ABOUT IT
// circle_contacts, the list the Circles tab already keeps, so there is one
// family list rather than two that disagree. Each contact carries
// caregiver_intro_pref:
//
//   every     any change of caregiver
//   new_only  only somebody who has not been before   <- the default
//   never     nothing
//
// and intro_on_start, because the first caregiver is different: everybody meets
// them, even a family that wants silence afterwards.
//
// WHAT IT DOES NOT CLAIM
// No "Sarah has worked with your mother 3 times" yet. That count has to come
// from AxisCare visits, and until it does, saying it from anything else would
// be a guess printed as a fact to the person it is about. Phase 2 adds it.
//
// ?dry=1, or dry:true in the body, reports without sending.
// Deploy: supabase functions deploy caregiver-intro
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { contactForOutbound } from '../_shared/outreach.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const OFFICE = '(417) 234-8494'
const PROFILE_BASE = 'https://cc.mo-care.com/caregiver.html?id='

/* A family reading this is deciding whether to trust a stranger with their
   mother. It should sound like the office, not like marketing, and it should
   never be the first they have heard of a change. */
function wantsThis(c: Record<string, unknown>, reason: string) {
  if (c.stopped_at) return false                       // they replied STOP; GHL is blocking anyway
  const pref = String(c.caregiver_intro_pref ?? 'new_only')
  if (reason === 'start_of_care') return c.intro_on_start !== false
  if (pref === 'never') return false
  if (reason === 'change') return pref === 'every'     // a routine swap is not everybody's business
  return true                                          // first_time / manual: every and new_only both want it
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  /* Verifying the JWT is not the same as knowing who it is. Supabase accepts
     the anon key as a valid token, and the anon key is printed in the hub's
     page source, so "verify_jwt is on" would still have let anyone who read
     view-source call this. A message to a client's family has to come from a
     signed-in member of staff, so this asks who the caller actually is. */
  const authHeader = req.headers.get('Authorization') ?? ''
  const whoClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user } } = await whoClient.auth.getUser()
  if (!user?.email) {
    return json({ error: 'Sign in to the hub before sending to a family.' }, 401)
  }


  const url = new URL(req.url)
  const body = await req.json().catch(() => ({}))
  const dry = url.searchParams.get('dry') === '1' || body.dry === true
  const { profile_id, client_name, circle_id, reason = 'manual' } = body

  if (!profile_id || !client_name) return json({ error: 'need a profile and a client' }, 400)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Only a profile the office has approved is ever sent.
  const { data: p } = await supabase
    .from('caregiver_profiles')
    .select('id, first_name, preferred_name, published, status')
    .eq('id', profile_id).maybeSingle()
  if (!p) return json({ error: 'no such profile' }, 404)
  if (!p.published || p.status === 'withdrawn') {
    return json({ error: 'That profile is not approved yet, so it cannot be sent.' }, 409)
  }
  const cgName = p.preferred_name || p.first_name

  /* Contacts can be passed in for a client whose circle is empty, which is most
     of them at the moment. Passing them here also writes them into
     circle_contacts, so the list builds itself out of the work rather than out
     of an afternoon of data entry. */
  let contacts: Record<string, unknown>[] = []
  if (Array.isArray(body.contacts) && body.contacts.length) {
    for (const c of body.contacts) {
      if (!c?.name || (!c.phone && !c.email)) continue
      const row = {
        circle_id: circle_id ?? null,
        name: c.name, relationship: c.relationship ?? null,
        phone: c.phone ?? null, email: c.email ?? null,
        sms_consent: c.sms_consent === true,
        caregiver_intro_pref: ['every', 'new_only', 'never'].includes(c.pref) ? c.pref : 'new_only',
      }
      if (!dry && circle_id) {
        const { data: saved } = await supabase.from('circle_contacts').insert(row).select().maybeSingle()
        contacts.push(saved ?? row)
      } else {
        contacts.push(row)
      }
    }
  } else if (circle_id) {
    const { data } = await supabase.from('circle_contacts').select('*').eq('circle_id', circle_id)
    contacts = data ?? []
  }

  const wanted = contacts.filter((c) => wantsThis(c, reason))
  // A text needs consent; an email address is its own consent to be emailed.
  const reachable = wanted.filter((c) => (c.phone && c.sms_consent) || c.email)

  const link = PROFILE_BASE + p.id
  const smsFor = (first: string) =>
    `Hi ${first}, this is Caring Companions. ${cgName} will be caring for ${client_name}. ` +
    `Here is a little about them, so they are not a stranger at the door: ${link} ` +
    `Any questions, we are on ${OFFICE}.`

  if (dry) {
    return json({
      ok: true, dry: true, caregiver: cgName, client: client_name, reason,
      would_reach: reachable.map((c) => String(c.name)),
      by_text: reachable.filter((c) => c.phone && c.sms_consent).length,
      by_email: reachable.filter((c) => c.email).length,
      held_back: wanted.length - reachable.length,
      not_wanted: contacts.length - wanted.length,
      link,
      example: smsFor(String((reachable[0]?.name ?? 'there')).split(' ')[0]),
    })
  }

  const ghlToken = Deno.env.get('GHL_TOKEN')
  const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
  if (!ghlToken || !ghlLocation) return json({ error: 'GoHighLevel is not connected.' }, 503)
  const h = {
    Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28',
    'Content-Type': 'application/json', Accept: 'application/json',
  }

  let reached = 0
  const reachedNames: string[] = []
  for (const c of reachable) {
    const first = String(c.name ?? '').split(' ')[0] || 'there'
    try {
      /* Shared boundary: identity gate, then hours policy, then upsert.
         This function used to read c.phone straight off a person record and
         send to it with no check of any kind. */
      const dest = await contactForOutbound(
        supabase, { token: ghlToken!, locationId: ghlLocation! },
        { phone: c.phone, email: c.email, firstName: first },
        'caregiver-intro')
      if (!dest) continue
      const contactId = dest.contactId

      if (c.phone && c.sms_consent) {
        await fetch('https://services.leadconnectorhq.com/conversations/messages', {
          method: 'POST', headers: h,
          body: JSON.stringify({ type: 'SMS', contactId, message: smsFor(first) }),
        })
      }
      if (c.email) {
        await fetch('https://services.leadconnectorhq.com/conversations/messages', {
          method: 'POST', headers: h,
          body: JSON.stringify({
            type: 'Email', contactId,
            subject: `${cgName} will be caring for ${client_name}`,
            html:
              `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36">` +
              `<p>Hi ${first},</p>` +
              `<p><b>${cgName}</b> will be caring for ${client_name}.</p>` +
              `<p>We thought you would rather know who is coming than wonder. Here is a little about them, ` +
              `in their own words:</p>` +
              `<p><a href="${link}" style="background:#0D365F;color:#fff;text-decoration:none;` +
              `padding:11px 20px;border-radius:9px;display:inline-block;font-weight:700">Meet ${cgName}</a></p>` +
              `<p>Anything you would like us to know before the first visit, just ring.</p>` +
              `<p style="color:#57606a">Caring Companions In-Home Senior Care<br>${OFFICE}</p></div>`,
          }),
        })
      }
      reached++
      reachedNames.push(String(c.name))
    } catch (_) { /* one contact failing must not stop the rest */ }
  }

  await supabase.from('caregiver_intro_log').insert({
    profile_id: p.id, caregiver_name: cgName, client_name,
    circle_id: circle_id ?? null,
    sent_to: reachedNames.join(', ') || null,
    channel: reachable.some((c) => c.phone && c.sms_consent) && reachable.some((c) => c.email) ? 'both'
           : reachable.some((c) => c.email) ? 'email' : 'sms',
    reason, sent_by: user.email,
  })

  return json({ ok: true, caregiver: cgName, client: client_name, reached, who: reachedNames, link })
})
