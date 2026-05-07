# Local LLM on a cheap European VPS

A weekend project: get a Dutch-speaking, tool-using LLM running on a small server I control.

## What I'm trying to do

Stand up a constantly-running European VPS that hosts a lightweight local LLM. It needs to handle Dutch input fluently and translate natural language into structured tool calls — basically "say something, make it act."

The whole thing should cost peanuts and be done in two weekends.

## The plan in one line

Hetzner CX32 (8 GB RAM, ~€6.50/month) running **Qwen3 4B** through Ollama, with **Qwen3 8B** as a heavier fallback when 4B isn't smart enough.

---

## Why this VPS

The thing that actually matters for CPU-only LLM inference is RAM and how reliably you can use the CPU. vCPU count looks important on spec sheets but isn't really the bottleneck.

A few things I learned while comparing:

- **Shared vs dedicated vCPU matters a lot.** Most cheap VPS plans use shared cores, which means a noisy neighbour can tank your inference speed at exactly the wrong moment. Hetzner gives you dedicated vCPUs at the price most others charge for shared.
- **Contabo has more RAM per euro** but their shared CPU model is a bit risky for steady inference workloads.
- **Jurisdiction matters if you care about it.** Hetzner, Netcup, OVH, Scaleway, Tilaa are all genuinely European. AWS/Azure/GCP "EU regions" still fall under the US CLOUD Act because their parent companies are American.

Quick comparison of what's out there:

| Provider | Entry price | 8 GB tier | Where | Notes |
|---|---|---|---|---|
| Hetzner | €3.79/mo | CX32 ~€6.50 | DE / FI | Best value, dedicated vCPU, 20 TB traffic |
| Netcup | €3.99/mo | ~€7 | DE | Reliable, generous SSD |
| Contabo | €4.99/mo | Cloud VPS S | DE | Most RAM/euro, but shared CPU |
| OVHcloud | €3.50/mo | VPS Value 4 | FR / DE / PL | Big provider, anti-DDoS included |
| Scaleway | ~€6/mo | DEV1-L | FR / NL / PL | Nice UI, slightly pricier |
| Tilaa | ~€7/mo | custom | NL | Useful if NL data residency matters |

Going with **Hetzner CX32** — €6.50 a month, 4 dedicated vCPU, 8 GB RAM, 80 GB NVMe. If I want to run two models at once or play with bigger contexts, CX42 (~€12, 16 GB) is the next step. GPU only if CPU latency becomes a real problem.

---

## Why this LLM

Quick reality check first: the dedicated Dutch models (Fietje, GEITje) made sense in early 2024 when the big open models were English-heavy. That's not really true anymore. Llama 3 was trained on 15 trillion multilingual tokens, Qwen3 covers 119 languages, Phi 3.5 and Gemma 3 are multilingual by default. So I don't need a Dutch-specific model — a good multilingual one will do better.

For tool calling specifically (which is the second half of what I want), Qwen 2.5 / Qwen3 is genuinely the best small open-source family right now. Qwen3 8B hits ~0.93 F1 on tool selection — not far off Claude Haiku.

| Model | Size | RAM (Q4) | Tool calling | Dutch notes |
|---|---|---|---|---|
| **Qwen3 4B** | 4B | ~3 GB | Excellent | Top pick. Good Dutch tokenizer, /think mode for harder tasks |
| **Qwen3 8B** | 8B | ~5 GB | Excellent (0.93 F1) | Same family, more reasoning power. Fallback option |
| Llama 3.1 8B | 8B | ~5 GB | Good, native | Solid Dutch, most documented option |
| Mistral Small 3 | ~7B | ~5 GB | Good, native | Strong on European languages |
| Gemma 3 4B | 4B | ~3 GB | Decent | Lightweight alternative |
| Phi-4 mini | 3.8B | ~3 GB | Limited | Decent Dutch, weaker on structured output |

Quantisation: GGUF Q4_K_M is the standard. ~4x smaller than full precision, basically no quality loss for chat/tool calling on this scale. No reason to use anything bigger on a CPU-only setup.

---

## The actual plan

Roughly two weekends of effort. ~9 hours of active work plus a week of letting it run.

### What "done" looks like

- Fluent Dutch on at least 20 test prompts
- ≥90% correct tool selection + valid JSON across 30 Dutch tool-calling prompts
- Median latency under 15 seconds for short responses
- Runs for 7 days straight without me touching it

### Phase 1 — Spin up the box (~2h)

1. Hetzner Cloud account → CX32 in Falkenstein or Helsinki, Ubuntu 24.04
2. SSH key on creation, no password login ever
3. UFW: only 22 (SSH) and 443 (reverse proxy). Block 11434 from the outside
4. Unattended-upgrades + fail2ban
5. Non-root user with sudo, disable root SSH

### Phase 2 — LLM stack (~1h)

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen3:4b
ollama pull qwen3:8b
ollama pull llama3.1:8b
```

Ollama installs as a systemd service by default — confirm it auto-restarts. Hit `http://localhost:11434/v1` to make sure the OpenAI-compatible API works.

### Phase 3 — Reverse proxy + auth (~1h)

Caddy in front of Ollama with HTTPS and basic auth. Caddy gets the cert from Let's Encrypt automatically.

```
llm.your-domain.example {
  basic_auth {
    your_user JDJhJDE0...   # bcrypt hash from `caddy hash-password`
  }
  reverse_proxy localhost:11434
}
```

Test from another machine that I can't get in without the password.

### Phase 4 — Dutch baseline (~2h)

Write 20 Dutch prompts covering:

- Casual conversational ("Vat dit artikel kort samen…")
- Formal/business ("Schrijf een professionele e-mail…")
- Domain vocabulary (legal, medical, technical)
- Idioms and ambiguous references
- Mixed Dutch/English (super common in real Dutch usage)

Send each to Qwen3 4B and 8B, score 1-5 on fluency, correctness, instruction-following. Not a formal benchmark — just a feel-check.

### Phase 5 — Tool calling (~3h)

Define 5 tools as JSON schemas. A personal-assistant flavour works well:

- search contacts
- schedule event
- send message
- set reminder
- check weather

Then 30 Dutch prompts:

- Direct: "Stuur een bericht aan Jan dat ik later ben."
- Indirect: "Het regent vast morgen — ik wil het zeker weten voor de fietstocht."
- Multi-step: "Plan een vergadering met Maria volgende week dinsdag en zet een herinnering een uur ervoor."
- Edge cases that should NOT trigger any tool: "Wat vind je van het weer in de winter?"

Score: (1) right tool, (2) valid JSON args, (3) Dutch entities (names, dates) parsed correctly.

Watch for the well-known small-model failure modes — repeating tool calls, hallucinated function names, wrong argument types. They're documented and will need guardrails in the calling code.

### Phase 6 — Let it cook (1 week)

Tiny script that fires one tool-calling request every 5 minutes for 7 days. Log latency, throughput, errors. On a CX32 with Qwen3 4B I'd expect median latency under 10 seconds, no OOMs, no Ollama crashes.

### Phase 7 — Decide

After the week:

- **Pass** → start building the actual app on top of this
- **Pass-ish** → Dutch is fine but tool calling under 90%. Try Outlines or Instructor for schema-enforced decoding
- **Too slow** → bump to CX42, or CCX dedicated-CPU, or GPU
- **Too dumb** → try Qwen3 14B on a bigger box, or accept that this use case actually needs a frontier model via API

---

## Money and time

- **VPS:** ~€6.50 for the test month
- **Domain:** ~€10/year if I don't already have one
- **Software:** all free (Ollama, Caddy, all the models)
- **Time:** ~9 hours active + a week of passive monitoring

---

## Stuff to look at later (only if the baseline passes)

- **Outlines or Instructor** for schema-enforced JSON — fixes most of the small-model JSON-validity issues at the decoding level
- **Small RAG layer** if I want grounded answers from my own docs
- **Speculative decoding / batch inference** if throughput becomes a bottleneck
- **Drop Ollama for raw llama.cpp** if I want fine-grained control over inference params

None of these matter until I know the baseline works. That's literally the whole point of the test.
