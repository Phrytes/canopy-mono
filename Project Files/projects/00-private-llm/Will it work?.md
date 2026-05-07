Honest answer: **yes, but with caveats** — and the caveats are mostly about expectations.

## What "chatbot speed" actually means

Humans read at roughly 5-8 words per second, or about **7-10 tokens/sec** for English (Dutch is similar). That's the perceptual threshold where streaming output feels natural — you read at roughly the speed it generates, no awkward waiting. Below ~3 tokens/sec it feels sluggish; above ~15 it's faster than you can read anyway.

So the question becomes: what does Qwen3 4B actually do on a Hetzner CX32?

## Realistic numbers for a CPU-only VPS

For a Hetzner CX32 (4 dedicated AMD vCPUs, 8 GB RAM) running Qwen3 4B at Q4_K_M, you can expect roughly:

- **Prompt processing:** 30-60 tokens/sec (the model "reading" your message)
- **Generation:** 6-10 tokens/sec (the model writing back)
- **Time to first token:** 1-3 seconds for short prompts, longer if context is big

For Qwen3 8B on the same box, halve those generation numbers — roughly **3-5 tokens/sec**. That's where it starts to feel slow.

These are rough — your actual numbers depend on the specific CPU model, what else is running, and how long the conversation gets. Worth measuring on your own setup rather than trusting any single estimate.

## What this feels like in practice

**Qwen3 4B on CX32:** genuinely usable as a chatbot. A 100-token answer (a normal paragraph) streams in ~10-15 seconds. If you're streaming the output token-by-token to the user (which Ollama does by default), it feels like watching someone type — which is, weirdly, fine. People are used to that from ChatGPT.

**Qwen3 8B on CX32:** the same answer takes 25-40 seconds. That's the "I'll go check this and come back" zone, not the "have a conversation" zone. Fine for a tool-calling assistant where you fire one request and wait, less fine for a back-and-forth chat.

**Above 8B on CPU:** forget it. A 13B model at 1-2 tokens/sec is unusable for chat.

## Things that make it feel faster than the raw numbers suggest

1. **Streaming output** — by far the biggest one. A 5 token/sec model that streams feels much better than a 5 token/sec model that waits and dumps. Ollama streams by default; just make sure your frontend doesn't buffer.
    
2. **Short, punchy responses** — if you prompt the model to keep answers brief ("antwoord kort"), most chat-style queries finish in 2-5 seconds total. The pain only kicks in for long generations.
    
3. **Context length matters more than you'd think** — every token of conversation history has to be reprocessed. A chat that's been going for 50 turns will feel meaningfully slower than turn 1, even with the same model. Practical limit on a small VPS is maybe 4-8k tokens of context before it starts dragging.
    
4. **No cold starts with Ollama** — once the model is loaded into RAM, it stays there. First request after a reboot is slow; every request after is fast.
    

## The CPU vs GPU honesty

If chatbot UX is the actual goal — like, real users talking to it interactively — a small GPU changes everything. A €30/month GPU instance (Hetzner GEX44 with an RTX 4000 SFF, or a used 3060 12GB on a home server) gives you 30-50 tokens/sec on the same models. That's not "barely usable," that's "snappy."

The CPU-on-cheap-VPS setup is genuinely good for:

- Personal use where you're the only user
- Tool calling / agent workflows where latency matters less than reliability
- Background tasks (summarisation, classification, batch processing)
- Low-volume APIs (a few requests per minute)

It starts to hurt when:

- Multiple users hit it concurrently (no parallelism on CPU)
- You need consistent sub-5-second responses
- Conversations get long
- You're showing it to others who haven't been told to expect "thinking" speed

## So, a chatbot?

For your stated use case — testing, private purposes, you using it yourself — **yes, Qwen3 4B on a CX32 works as a chatbot**, and you'll probably be pleasantly surprised at how natural it feels with streaming. The same setup hosting a chatbot for a small team of 5 people would already feel cramped during peak times.

If at any point you find yourself thinking "this would be great if it were just a bit snappier," that's the signal to either:

1. Drop to **Qwen3 4B exclusively** and accept slightly weaker tool calling
2. Bump to a **Hetzner CCX line** (dedicated AMD EPYC cores, ~€15/month for 4 cores, noticeably faster than CX)
3. Move to a **GPU instance** (Hetzner GEX44 or similar, €30-50/month range)

But don't pre-optimise. The CX32 + Qwen3 4B baseline is genuinely worth running first — you might find it's already fast enough, in which case you've saved yourself money and complexity. If it's not, you'll know exactly _what_ is slow, and that makes the next decision easy.