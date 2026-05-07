Here's a practical rundown of lightweight local LLMs that anyone can realistically deploy on modest hardware.

### Models worth knowing

**Llama 3.1 8B (Meta)** — The all-rounder. It's a versatile open-source model with strong general and coding performance, and at Q4 quantization fits comfortably in around 7-8GB of memory [Apidog](https://apidog.com/blog/small-local-llm/). Good first pick if you don't know what you need.

**Mistral 7B / Mistral Small 3** — Fast and efficient. Highly optimized with Grouped-Query Attention and Sliding Window Attention, runs at Q4_K_M around 4.4GB on disk and ~7GB in memory, Apache 2.0 licensed which is great for commercial use [Apidog](https://apidog.com/blog/small-local-llm/). Best when throughput matters.

**Phi-4-mini (3.8B, Microsoft)** — The "runs on almost anything" pick. It runs on machines with just 8GB of RAM, consuming roughly 3.5GB at Q4_K_M quantization, while still scoring 68.5 on MMLU — within 4.5 points of models twice its size [SitePoint](https://www.sitepoint.com/best-local-llm-models-2026/). Ideal for older laptops or tiny VPS instances.

**Qwen 3 (4B and 7B, Alibaba)** — Strong on code and multilingual. Qwen 3 7B posts the highest HumanEval score (76.0) of any model under 8B parameters [SitePoint](https://www.sitepoint.com/best-local-llm-models-2026/), and Qwen3 4B 2507 is excellent for its size [Micro Center](https://www.microcenter.com/site/mc-news/article/best-local-llms-8gb-16gb-32gb-memory-guide.aspx).

**Gemma 2B / 7B (Google)** — Gemma models were built to deliver clear, controlled, predictable output without requiring heavy hardware. The 2B version is perfect for entry-level experimentation or mobile AI; the 7B version handles reasoning, automation, and coding [TechNow](https://tech-now.io/en/blogs/best-lightweight-llms-in-2026-speed-efficiency-and-innovation).

**GPT-OSS 20B (OpenAI)** — If you have a beefier machine. Practical on high-end consumer machines and good for reasoning-heavy tasks, tool calling workflows, and agent pipelines [DEV Community](https://dev.to/lightningdev123/top-5-local-llm-tools-and-models-in-2026-1ch5).

### Hardware reality check

The single biggest constraint is **VRAM** (or unified memory on Macs). When a model spills from VRAM into system RAM, performance can drop to 1-2 tokens per second versus 45+ tokens per second when running fully in VRAM [IT Rentals in India](https://www.rankcomputers.com/blog/minimum-hardware-specs-for-running-llms-locally-in-2026/) — so size your model to fit.

Rough guide for quantized (Q4) models:

- **8GB RAM/VRAM:** Phi-4-mini, Gemma 2B, Qwen3 4B
- **16GB:** Llama 3.1 8B, Mistral 7B, Qwen3 7B, Gemma 7B
- **24GB+:** Larger 13B–20B models, GPT-OSS 20B

A used RTX 3060 12GB, a Mac Mini M4 with 16GB, or even a decent CPU-only Linux box with 16-32GB RAM will run the 7-8B class fine. No need for an H100.

### Tools to actually run them

- **Ollama** — easiest CLI: `ollama run llama3.1` and you're done. Best for scripting and servers.
- **LM Studio** — desktop GUI, good for non-technical users.
- **llama.cpp** — the underlying engine, maximum control, runs on CPU/GPU/Apple Silicon.
- **Jan** — open-source ChatGPT-style desktop app, fully offline.

The **GGUF** format with Q4_K_M quantization is the de facto standard — it's the sweet spot between quality and size for most people.

If you're deploying on a server for a small team, an 8B model on a single mid-range GPU (or even CPU with enough RAM) handles chat, RAG, and basic agent workflows surprisingly well. Want me to go deeper on a specific use case (coding assistant, RAG, agents) or a particular hardware budget?