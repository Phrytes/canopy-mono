# Local LLM cost + feasibility for the household app

**Investigation note for project #7.**  Companion to
[`README.md`](./README.md).  Cross-project broader notes live in
[`../../LOCAL LLM OVERVIEW.md`](../../LOCAL%20LLM%20OVERVIEW.md);
this doc is specifically about whether self-hosting an LLM for
the household-app workload is practical and cheap enough.

**the author's question (verbatim):**

> Is een prive llm krachtig/snel/goedkoop genoeg hiervoor?
> Uiteindelijk staat dan de hele dag een server aan voor enkele
> requests per dag of zelfs minder.

## Short answer

**Yes, viable for the workload described, and probably cheap
enough for both testing and production — provided the right
hardware is picked.**

The household-app workload is unusually friendly to local
LLM: low frequency, low latency tolerance, simple
classification + extraction tasks.  Most of the economic
challenges of self-hosting LLMs (high concurrency, sub-second
response, GPU-class inference) don't apply.  The dominant cost
is **idle electricity**, and that's controllable.

---

## What the workload actually needs

The household app does:

- **Classify** Telegram messages: shopping / repair / errand /
  schedule / noise.
- **Extract** structured items from non-noise messages.
- **Match** "I bought milk" against open shopping items.
- **Compose** a clean reply ("you said you needed: bread,
  milk, …").

This is **classification + extraction**, not reasoning or
creative generation.  A 3B-parameter model is sufficient quality.
A 7B-8B model is more reliable but not necessary.  Above 13B is
overkill for this.

Latency tolerance: high.  "Few seconds per request" is fine.
Even "30 seconds for a complex extract" is acceptable for batch
household tasks.

Concurrency: 1.  At most one or two users interact with the
household bot at a time.  No queueing required for first
deployment.

Throughput: ~5–30 requests per day per household.  The dominant
cost is keeping the server *available*, not running it.

---

## Hardware options + monthly cost

Electricity cost assumption: **NL @ €0.30 / kWh** (consumer
rate, 2025).  Adjust for your locale.  Idle power figures are
typical-but-vendor-specific; treat as ballpark.

| Setup | Up-front cost | Idle power | Monthly electricity | Quality / speed for 3B model | Quality / speed for 7B-8B model |
|---|---|---|---|---|---|
| **Whatever laptop you already have**, ollama hosted | €0 | depends on existing usage | €0 marginal | Good (CPU 5-10 tok/s; GPU faster) | OK (3-5 tok/s on CPU) |
| **Raspberry Pi 5 (8GB)** | ~€100 | ~5 W | ~€1.10 | Acceptable (3-7 tok/s) | Slow (~1 tok/s) |
| **Used Mac mini M1 8GB** (refurb) | ~€350 | ~6 W | ~€1.30 | Fast (15-25 tok/s via MLX) | Good (8-12 tok/s) |
| **Used Mac mini M2 16GB** | ~€500 | ~8 W | ~€1.70 | Very fast (30+ tok/s) | Fast (15-20 tok/s) |
| **Mini PC with Intel iGPU + 16GB RAM** | ~€300 | ~10-15 W | ~€2.20-3.30 | Decent (5-15 tok/s with Vulkan) | Slower (3-8 tok/s) |
| **Desktop PC with consumer GPU (RTX 4060 16GB)** | ~€700+ used | ~80 W idle, ~250 W active | ~€18 idle / extra during active | Excellent | Excellent |
| **Cloud-rental dedicated GPU** (RunPod, Lambda) | n/a | n/a | ~€200-400 / mo | Excellent | Excellent |

**Best fit for testing:** whatever you already have.  Run
ollama, pull `qwen2.5:3b-instruct` or `phi3.5:mini`, point your
agent at `http://localhost:11434`.  Zero new hardware.  Verify
the household app actually works for you and your testers
before buying anything.

**Best fit for production:** **used Mac mini M2 16GB**, ~€500
once, ~€1.70/mo electricity.  Runs the LLM, can also host the
Solid pod, and can run any other always-on services for the
household.  Easy to plug-and-forget; ages well.

The Pi 5 is also viable for very-low-cost testing but the 3B
model performance is noticeably slower than on Apple Silicon.

---

## Comparison with cloud LLM API

For perspective:

- 20 requests/day × ~1 500 tokens/request = ~900 k tokens/month.
- gpt-4o-mini / Claude Haiku / Gemini Flash: ~€0.10 – €0.50/mo.
- *Cheaper than electricity for self-hosting on a Pi.*

But: every household conversation gets sent to a third party.
That's exactly the data this project promises to keep local.
**For project #7, "cheaper" is not the deciding factor — privacy
is.**  The cost-comparison-with-cloud is informational only.

If you ever build a non-household variant where privacy isn't
the headline (e.g., a public restaurant-bot), cloud LLM API is
the obvious choice.  But that's a different app.

---

## Model recommendations

Tested-as-of-the-time-of-writing.  Quality-vs-size has shifted
fast in 2024-2025; verify with current benchmarks.

- **Qwen 2.5 3B-Instruct** — strong classification, good Dutch
  support, decent tool-calling.  Recommended starting point.
- **Phi-3.5 mini (3.8B)** — comparable quality, Microsoft-built,
  also good at structured output.
- **Llama 3.2 3B** — cheaper to run but weaker tool-calling.
  Not recommended if the LLM needs to invoke other agent skills.
- **Qwen 2.5 7B-Instruct** — meaningful quality jump from 3B,
  hardware permitting.
- **Llama 3.1 8B** — strong general-purpose model; tool-calling
  better than 3.2 3B.
- **Mistral 7B / Mixtral 8x7B** — good but generally surpassed
  by Qwen / Llama for this size class.

For extraction tasks specifically, also try:

- **Local distilled models** (e.g., Qwen 2.5 1.5B, Phi-3.5
  mini) for the classification step + a slightly larger model
  for extraction.  Two-stage pipeline can run faster and use
  less memory.

Quality-bar test for picking a model: **give it 50 real
household messages, in your target language, and check that it
correctly extracts shopping items at 90%+ precision and 80%+
recall.**  If it can't, either improve the prompt or upgrade
the model.

---

## Idle-cost optimisation

The dominant monthly cost is keeping the server alive
when it's not doing anything.  Three tactics worth knowing:

1. **Just-on-existing-hardware.**  Already-on laptop / desktop
   adds zero idle cost.  For testing this is free.
2. **Auto-suspend with wake-on-LAN.**  Mac minis suspend at
   ~1 W, wake in ~3 seconds.  An incoming Telegram webhook can
   trigger a wake, the LLM runs, the system suspends again.
   Most of the day at 1 W.  Combined with a M2 mini, this is
   probably the cheapest credible setup.
3. **Co-host with the Solid pod.**  If you're going to have a
   Solid pod hosted somewhere always-on anyway (or a relay
   server, or both), put the LLM on the same hardware.
   Amortizes the always-on cost across multiple services.

Net: a real-world household-app deployment is plausibly
**€2-5 / month** in marginal electricity, on hardware that
costs ~€500 once.  Cheaper than most SaaS subscriptions.

---

## Risks worth flagging

- **Hallucination.**  Small LLMs can misclassify or invent
  items.  V0 needs explicit user-confirmation flow ("here's
  what I extracted, edit if wrong") before committing to the
  pod.  See README.md § Open Questions for the design
  decision.
- **Tool-calling reliability.**  3B models are inconsistent at
  structured tool-calling.  Verify with actual test data before
  picking a model.  Some 3B models (Qwen) are great; some
  (Llama 3.2) are mediocre.
- **Language drift.**  If the household chats in Dutch, English,
  or mixed, verify the model handles it.  Most modern small
  models do, but it's per-model.
- **Prompt fragility.**  Prompts that work today may need
  re-tuning when you upgrade the model.  Keep prompts in
  version control and run a regression test on real chat
  samples before deploying a new model.
- **Privacy regression.**  Make sure the LLM doesn't accidentally
  log conversations to disk in a way that leaks them outside
  the household pod.  Audit ollama / llama.cpp config.

---

## Verdict

For the household app's workload, **local LLM is feasible,
cheap, and aligned with the project's privacy posture**.

Recommended approach:

1. **Test on whatever you have** — run ollama with
   `qwen2.5:3b-instruct`, point the household-app agent at it.
   Verify the use case works.
2. **If it works, buy a used Mac mini M2** for ~€500 once.
   Marginal monthly cost ~€2.  Set-and-forget for years.
3. **Keep the model behind a clean skill interface** so swapping
   to a different model (or temporarily to a cloud API) is
   trivial.  Decouples LLM choice from the rest of the app.
4. **Don't ship cloud-API as the default.**  It's cheaper but
   defeats the project's reason for being.  Make local the
   default; cloud-API is an opt-in for users who explicitly
   accept the privacy trade.

For workloads beyond this app, see
[`../../LOCAL LLM OVERVIEW.md`](../../LOCAL%20LLM%20OVERVIEW.md)
for cross-project reasoning.
