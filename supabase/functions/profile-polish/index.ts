// Supabase Edge Function: profile-polish  (shared hub project)
// -----------------------------------------------------------------------------
// Spellcheck for the caregiver profile form, and deliberately nothing more.
//
// WHY THE LINE IS WHERE IT IS
// The value of these profiles is that they sound like the person who wrote
// them. A family can tell the difference between "I looked after my grandma
// for four years and I just never stopped" and something a machine produced,
// and the second one is worth less than nothing, because it reads like every
// other agency's marketing. So this fixes spelling, punctuation and
// capitalisation, and leaves the words alone. It does not improve, expand,
// smooth, professionalise or add anything the caregiver did not say.
//
// It also matters who this is for. The people it helps most are the ones who
// left school early or are writing in their second language, and they are
// exactly the people a "let AI improve your writing" button would embarrass.
// The button says "check my spelling", because that is all it does.
//
// The caregiver always sees both versions and picks. Nothing is replaced
// silently.
//
// OPEN TO ANON, ON PURPOSE
// The form runs at orientation with nobody signed in, so this has to accept
// unauthenticated calls. That is abuse surface, so: input is hard-capped,
// output is capped, and there is nothing here worth stealing — it will not
// answer general questions, because the only thing it is asked to do is
// return a corrected copy of the text it was given.
//
// Deploy: supabase functions deploy profile-polish --no-verify-jwt
// -----------------------------------------------------------------------------

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

// Spelling and punctuation is not a job that needs a large model, and this is
// called from a phone at orientation where waiting is the whole cost.
const AI_MODEL = 'claude-haiku-4-5-20251001'
const MAX_IN = 1200        // a couple of paragraphs; more than any answer needs

const SYSTEM = `You correct spelling, punctuation and capitalisation in short pieces of writing by home care workers describing themselves. You are a spellchecker, not an editor.

Rules, in order of importance:
1. Keep the writer's own words. Do not swap a word for a fancier one. "Grandma" stays "grandma", never "grandmother".
2. Do not add anything. No new sentences, no detail they did not give, no closing flourish.
3. Do not remove anything, unless it is a duplicated word.
4. Do not reorder or merge sentences. Do not make it more formal, more professional, or more polished.
5. Keep the length within a few characters of what you were given.
6. Fix: misspellings, missing or wrong punctuation, missing capitals at the start of sentences and on names, obvious typing slips like doubled letters or a stray key.
7. Regional and casual usage is not an error. Contractions stay. Sentence fragments stay if that is how they wrote it.
8. If there is nothing to fix, return the text exactly as it came in.

Return only the corrected text. No preamble, no explanation, no quotation marks around it.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { text } = await req.json().catch(() => ({}))
    if (typeof text !== 'string' || !text.trim()) {
      return json({ error: 'Nothing to check.' }, 400)
    }
    if (text.length > MAX_IN) {
      // Not an error worth explaining to a caregiver; the form keeps their text.
      return json({ error: 'That is longer than this can check. Try one answer at a time.' }, 400)
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return json({ error: 'Spellcheck is not switched on yet.' }, 503)

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 700,
        temperature: 0,          // spelling has right answers; do not be creative
        system: SYSTEM,
        messages: [{ role: 'user', content: text }],
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('anthropic error', res.status, detail.slice(0, 400))
      return json({ error: 'Spellcheck could not run just now.' }, 502)
    }

    const body = await res.json()
    const out = (body?.content?.[0]?.text ?? '').trim()
    if (!out) return json({ error: 'Spellcheck came back empty.' }, 502)

    /* A guard against the model doing more than it was asked. If the reply is
       much longer than what went in, something has been added, and the safest
       thing is to hand back the original rather than a rewrite the caregiver
       did not ask for. */
    if (out.length > text.length * 1.35 + 40) {
      console.warn('polish rejected: grew from', text.length, 'to', out.length)
      return json({ polished: text, unchanged: true, note: 'rewrite rejected' })
    }

    return json({ polished: out, unchanged: out === text.trim() })
  } catch (e) {
    console.error(e)
    return json({ error: 'Spellcheck could not run just now.' }, 500)
  }
})
