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

/* The second mode, and the reason this function exists in two halves.
   "Help me write it" and "fix my spelling" are the two obvious things to build
   and both are wrong: the first takes the caregiver's voice away, and the
   second does nothing for somebody who has written one flat line and cannot
   think what else to say, which is the commoner problem.
   So this asks them one short question instead. They answer it themselves, in
   their own words, and nothing they wrote is touched. */
const ASK_SYSTEM = `A home care worker is writing a short profile about themselves that families will read. Your job is to decide whether it needs anything more, and it usually does not.

Start from ENOUGH. Reply with exactly the word ENOUGH unless something a family would genuinely want is obviously missing. If it already tells a family what kind of care this person has done, or what they are like to have in the house, that is enough. Two or three specific sentences is a good profile, not a first draft. Being short is not a fault. Plain writing is not a fault.

Only if it is genuinely thin, one bare line with nothing specific in it, ask ONE short question. Rules for the question:

1. One question, under fifteen words, plain and warm, the way a colleague would ask across a desk.
2. About something they already mentioned, never a new topic. "Nursing homes" becomes what kind of care they did most there.
3. Never suggest the answer, never give an example, never write any of it for them.
4. Never ask for anything a family should not see: no surnames, addresses, phone numbers, employers' names, medical details about real people, or anything about their own health or money.

Return only the word ENOUGH, or only the question. No preamble, no explanation.`

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
    const { text, mode = 'spelling' } = await req.json().catch(() => ({}))
    if (typeof text !== 'string' || !text.trim()) {
      return json({ error: 'Nothing to check.' }, 400)
    }
    if (text.length > MAX_IN) {
      // Not an error worth explaining to a caregiver; the form keeps their text.
      return json({ error: 'That is longer than this can check. Try one answer at a time.' }, 400)
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return json({ error: 'Spellcheck is not switched on yet.' }, 503)

    const asking = mode === 'ask'

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: asking ? 60 : 700,
        // Spelling has right answers. A question has several good ones, but not
        // so many that it should wander.
        temperature: asking ? 0.4 : 0,
        system: asking ? ASK_SYSTEM : SYSTEM,
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

    if (asking) {
      // A question, or nothing. Anything longer than a question is the model
      // starting to write the profile, which is the one thing it must not do.
      if (/^ENOUGH\b/i.test(out) || out.length > 140) {
        return json({ enough: true })
      }
      return json({ question: out })
    }

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
