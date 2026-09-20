// Supabase Edge Function: transcribe-recording  (shared hub project)
// -----------------------------------------------------------------------------
// Turns a recording made in the hub into a transcript with speaker labels.
//
// The hub records an interview or an in-home assessment, drops the audio in the
// private `recordings` bucket, and calls this with the row id. This downloads
// the audio, sends it to ElevenLabs Scribe with diarisation on, groups the
// words into speaker turns, and writes the result back onto the row.
//
// Why ElevenLabs rather than another transcriber: the agency already pays for
// ElevenLabs and uses it for the caregiver videos. This is the same account and
// the same key, so it is one fewer subscription than the Otter round trip it
// replaces.
//
// Secrets: ELEVENLABS_API_KEY
// Deploy:  supabase functions deploy transcribe-recording
//
// Needs recruit-recordings.sql to have been run first.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

type Word = { text: string; start?: number; end?: number; type?: string; speaker_id?: string }

/* Scribe returns words. People read conversations. Consecutive words from the
   same voice become one turn, and a gap of more than two seconds starts a new
   one even from the same speaker, because that is where a thought ended. */
function toTurns(words: Word[]) {
  const turns: { speaker: string; start: number; end: number; text: string }[] = []
  for (const w of words) {
    if (!w.text) continue
    const speaker = w.speaker_id || 'speaker_1'
    const last = turns[turns.length - 1]
    const gap = last ? (w.start ?? 0) - last.end : 0
    if (last && last.speaker === speaker && gap < 2) {
      last.text += (w.type === 'word' && !/^[,.!?;:]/.test(w.text) ? ' ' : '') + w.text
      last.end = w.end ?? last.end
    } else {
      turns.push({ speaker, start: w.start ?? 0, end: w.end ?? 0, text: w.text })
    }
  }
  return turns.map((t) => ({ ...t, text: t.text.replace(/\s+/g, ' ').trim() })).filter((t) => t.text)
}

const clock = (s: number) => {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const key = Deno.env.get('ELEVENLABS_API_KEY')
  if (!key) return json({ error: 'ELEVENLABS_API_KEY is not set on this project' }, 500)

  const { recording_id } = await req.json().catch(() => ({}))
  if (!recording_id) return json({ error: 'no recording given' }, 400)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: rec, error: recErr } = await supabase
    .from('recordings').select('*').eq('id', recording_id).maybeSingle()
  if (recErr) return json({ error: recErr.message }, 500)
  if (!rec) return json({ error: 'no such recording' }, 404)
  if (rec.status === 'done') return json({ ok: true, already: true, turns: rec.turns })

  // Nothing gets transcribed that nobody agreed to.
  if (!rec.consent_given) return json({ error: 'that recording has no consent recorded against it' }, 400)

  await supabase.from('recordings').update({ status: 'transcribing', error: null }).eq('id', recording_id)

  const fail = async (message: string, code = 500) => {
    await supabase.from('recordings')
      .update({ status: 'failed', error: message.slice(0, 500) }).eq('id', recording_id)
    return json({ error: message }, code)
  }

  try {
    const { data: file, error: dlErr } = await supabase.storage
      .from('recordings').download(rec.storage_path)
    if (dlErr || !file) return await fail(dlErr?.message || 'could not read the audio back')

    const form = new FormData()
    form.append('file', file, (rec.storage_path as string).split('/').pop() || 'audio.webm')
    form.append('model_id', 'scribe_v1')
    form.append('diarize', 'true')
    form.append('timestamps_granularity', 'word')

    const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST', headers: { 'xi-api-key': key }, body: form,
    })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) return await fail(body?.detail?.message || body?.detail || `transcriber said ${r.status}`)

    const turns = toTurns(body.words ?? [])

    /* Two people in a room is the normal case, so name them plainly rather
       than leaving speaker_0 and speaker_1 on the screen. Which one is which
       is a guess, so the hub lets you swap them. */
    const speakers = [...new Set(turns.map((t) => t.speaker))]
    const nameOf = (s: string) => speakers.length <= 2
      ? (s === speakers[0] ? 'Speaker A' : 'Speaker B')
      : 'Speaker ' + (speakers.indexOf(s) + 1)

    const text = turns.map((t) => `[${clock(t.start)}] ${nameOf(t.speaker)}: ${t.text}`).join('\n')

    await supabase.from('recordings').update({
      status: 'done',
      transcript: text,
      turns: turns.map((t) => ({ ...t, name: nameOf(t.speaker) })),
      language: body.language_code ?? null,
      seconds: Math.round(body.audio_duration_secs ?? rec.seconds ?? 0),
      transcribed_at: new Date().toISOString(),
      error: null,
    }).eq('id', recording_id)

    return json({ ok: true, turns: turns.length, seconds: Math.round(body.audio_duration_secs ?? 0) })
  } catch (e) {
    return await fail(String((e as Error)?.message || e))
  }
})
