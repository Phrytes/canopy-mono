
Two sets: 20 baseline prompts to gauge Dutch fluency, and 30 tool-calling prompts to test structured output. Use these against Qwen3 4B and 8B (and Llama 3.1 8B as a comparison baseline if you want).

---

## Phase 4 — Dutch fluency baseline (20 prompts)

Score each response 1-5 on three axes: **fluency** (does it sound like natural Dutch), **correctness** (factually right, doesn't hallucinate), **instruction-following** (did it actually do what you asked).

### Conversational (1-5)

1. Vat in drie zinnen samen waarom de Nederlandse Gouden Eeuw economisch zo bijzonder was.
2. Leg aan een tienjarige uit hoe een sluis werkt.
3. Wat zijn drie typisch Nederlandse gewoontes die buitenlanders vaak vreemd vinden? Houd het luchtig.
4. Schrijf een gezellig appje aan een vriend om af te spreken voor een biertje vrijdagavond.
5. Geef vijf tips om beter Nederlands te leren spreken voor iemand die het al redelijk leest.

### Formal / business (6-10)

6. Schrijf een professionele e-mail aan een leverancier om beleefd te klagen dat een levering twee weken te laat is, en vraag om een concrete nieuwe datum.
7. Stel een korte vacaturetekst op voor een junior softwareontwikkelaar bij een klein bedrijf in Amsterdam. Houd het toegankelijk maar zakelijk.
8. Schrijf een bedankmail na een sollicitatiegesprek waarin je nogmaals je interesse benadrukt zonder pluimstrijkerig te klinken.
9. Vat de belangrijkste punten samen die in een huurcontract voor een appartement zouden moeten staan vanuit het perspectief van de huurder.
10. Schrijf een korte LinkedIn-post over een bedrijfsjubileum van 10 jaar — professioneel, niet te plat.

### Domeinvocabulaire (11-15)

11. Leg het verschil uit tussen een eenmanszaak, een vof en een bv qua aansprakelijkheid en belasting. Houd het kort.
12. Wat betekent "voorlopige hechtenis" in het Nederlandse strafrecht en hoe lang mag die maximaal duren?
13. Een patiënt heeft last van "aanhoudende vermoeidheid, spierpijn en concentratieproblemen na een virale infectie". Welke aandoening zou een huisarts hierbij overwegen, en welke vervolgstappen zijn logisch?
14. Leg in jip-en-janneketaal uit wat een "hypotheekrenteaftrek" is en waarom die politiek omstreden is.
15. Wat is het verschil tussen "bruto" en "netto" salaris in Nederland, en welke posten zitten daar typisch tussen?

### Idiomatic / ambiguous (16-18)

16. Wat betekent het als iemand zegt: "Daar lust ik wel pap van"? Geef ook een voorbeeldzin.
17. Een collega zegt: "Nou, dat schiet lekker op zo." In welke twee heel verschillende stemmingen kan diegene zijn? Hoe herken je het verschil?
18. Verklaar de uitdrukking "met de gebakken peren zitten" en geef een moderne situatie waarin je hem zou gebruiken.

### Code-switching (19-20)

19. Ik moet straks een meeting joinen met de stakeholders, maar mijn deck is nog niet af. Kun je me helpen prioriteren wat ik echt nu moet doen versus wat kan wachten?
20. Mijn manager vroeg me om een quick win te leveren voor het einde van de sprint, maar ik heb eigenlijk geen idee wat dat in deze context zou kunnen zijn. Help me brainstormen — het gaat om een internal dashboard voor sales reporting.

### What to watch for

- **Tokenizer artefacts** — does it split common Dutch compound words badly? ("hypotheekrenteaftrek" is a good stress test)
- **Anglicisms creeping in** — small models sometimes default to English words mid-sentence
- **Register drift** — asks for casual, gets formal, or vice versa
- **Made-up Dutch** — small models occasionally invent words that look plausible but aren't real

---

## Phase 5 — Tool calling (30 prompts)

### The tools

Five tools, defined as JSON schemas. Drop these in your tool definitions:

```json
[
  {
    "name": "search_contacts",
    "description": "Zoek in de contactenlijst op naam of deel van een naam.",
    "parameters": {
      "type": "object",
      "properties": {
        "query": { "type": "string", "description": "Naam of deel ervan" }
      },
      "required": ["query"]
    }
  },
  {
    "name": "schedule_event",
    "description": "Plan een afspraak in de agenda.",
    "parameters": {
      "type": "object",
      "properties": {
        "title": { "type": "string" },
        "datetime": { "type": "string", "description": "ISO 8601 datum-tijd" },
        "duration_minutes": { "type": "integer" },
        "attendees": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["title", "datetime"]
    }
  },
  {
    "name": "send_message",
    "description": "Stuur een tekstbericht naar een contactpersoon.",
    "parameters": {
      "type": "object",
      "properties": {
        "recipient": { "type": "string" },
        "body": { "type": "string" }
      },
      "required": ["recipient", "body"]
    }
  },
  {
    "name": "set_reminder",
    "description": "Zet een herinnering op een bepaalde tijd.",
    "parameters": {
      "type": "object",
      "properties": {
        "text": { "type": "string" },
        "datetime": { "type": "string", "description": "ISO 8601 datum-tijd" }
      },
      "required": ["text", "datetime"]
    }
  },
  {
    "name": "get_weather",
    "description": "Haal de weersverwachting op voor een locatie.",
    "parameters": {
      "type": "object",
      "properties": {
        "location": { "type": "string" },
        "when": { "type": "string", "description": "vandaag, morgen, of ISO 8601 datum" }
      },
      "required": ["location"]
    }
  }
]
```

### Direct requests (1-10)

These should map cleanly to one tool. The model should pick the right one without ambiguity.

| # | Prompt | Expected tool | Key args to extract |
|---|---|---|---|
| 1 | Stuur een bericht aan Jan dat ik vanavond een uurtje later ben. | `send_message` | recipient="Jan", body about being late |
| 2 | Zoek het telefoonnummer van Maria de Vries. | `search_contacts` | query="Maria de Vries" |
| 3 | Plan morgen om 14:00 een vergadering van een uur met Pieter. | `schedule_event` | datetime=tomorrow 14:00, duration=60, attendees=["Pieter"] |
| 4 | Herinner me om 17:30 dat ik de was uit de droger moet halen. | `set_reminder` | datetime=today 17:30, text about laundry |
| 5 | Wat wordt het weer morgen in Utrecht? | `get_weather` | location="Utrecht", when="morgen" |
| 6 | App Sanne even of ze zin heeft om vrijdag te eten. | `send_message` | recipient="Sanne", body about Friday dinner |
| 7 | Boek een half uur in mijn agenda volgende week maandag om 10:00 voor "tandarts". | `schedule_event` | title="tandarts", datetime=next Mon 10:00, duration=30 |
| 8 | Geef me het mailadres van die nieuwe collega, ene Hendriks. | `search_contacts` | query="Hendriks" |
| 9 | Zet om kwart over zeven een herinnering: pillen innemen. | `set_reminder` | datetime=today 19:15, text="pillen innemen" |
| 10 | Hoe warm wordt het zaterdag in Amsterdam? | `get_weather` | location="Amsterdam", when=Saturday |

### Indirect / inference required (11-18)

The model has to figure out *which* tool fits — it's not stated literally. This is where small models start to wobble.

| # | Prompt | Expected tool | Notes |
|---|---|---|---|
| 11 | Het regent vast morgen — ik wil het zeker weten voor de fietstocht. | `get_weather` | when="morgen", location should ideally trigger a clarifying question or use a default |
| 12 | Ik vergeet altijd dat ik om half elf de oven uit moet zetten. Help me. | `set_reminder` | datetime=today 10:30, text about oven |
| 13 | Volgende week donderdag wil ik echt even een uur blokken om aan dat rapport te werken, anders komt het er nooit van. | `schedule_event` | next Thu, 60 min, title about report |
| 14 | Hoe heet die ene vriend van Bart ook alweer? Iets met een K. | `search_contacts` | query="K" — bonus if it asks for clarification |
| 15 | Laat ik Linda even een seintje geven dat de meeting verzet is naar dinsdag. | `send_message` | recipient="Linda", body about Tuesday |
| 16 | Moet ik morgen een jas mee naar Rotterdam? | `get_weather` | location="Rotterdam", when="morgen" |
| 17 | Ik moet eraan denken om volgende week dinsdag de auto naar de garage te brengen. | `set_reminder` OR `schedule_event` | either is defensible — watch how it handles ambiguity |
| 18 | Ben ik even de naam kwijt van die loodgieter die hier vorig jaar was. | `search_contacts` | query="loodgieter" |

### Multi-step / chained (19-23)

These need either two sequential tool calls or one tool call followed by another step. Real test of agentic capability.

| # | Prompt | Expected sequence |
|---|---|---|
| 19 | Plan een vergadering met Maria volgende week dinsdag om 11:00, en zet een herinnering een uur ervoor. | `schedule_event` → `set_reminder` |
| 20 | Stuur Tom een berichtje dat we afspreken op vrijdag, en zet die afspraak ook in mijn agenda voor 18:00. | `send_message` → `schedule_event` |
| 21 | Kijk even of ik het nummer van mijn tandarts heb, en zo ja, app hem dat ik maandag niet kan. | `search_contacts` → `send_message` |
| 22 | Check het weer voor zaterdag in Den Haag, en als het droog is, plan dan om 10:00 een wandeling van twee uur in mijn agenda. | `get_weather` → conditional `schedule_event` |
| 23 | Zoek Anna's nummer op, stuur haar dat de borrel doorgaat, en zet om 16:00 een herinnering om de wijn te halen. | `search_contacts` → `send_message` → `set_reminder` |

### Edge cases — should NOT call any tool (24-30)

This is where small models love to hallucinate tool calls when they shouldn't. Big tell of model quality.

| # | Prompt | Why it's a no-tool case |
|---|---|---|
| 24 | Wat vind je eigenlijk van het Nederlandse weer in de winter? | Opinion question, no action needed |
| 25 | Hoe werkt een digitale agenda eigenlijk onder de motorkap? | General knowledge, no action |
| 26 | Geef me een paar tips om herinneringen beter te onthouden zonder app. | Advice request, not an action |
| 27 | Waarom heten ze eigenlijk "contactpersonen" en niet gewoon "vrienden"? | Etymology / opinion |
| 28 | Wat zou een goede openingszin zijn in een berichtje aan een oude vriend die ik in geen jaren gesproken heb? | Wants writing help, not to send anything yet |
| 29 | Kan een AI eigenlijk het weer voorspellen, of haalt-ie dat ergens vandaan? | Question about how the system works |
| 30 | Welke functies kun je allemaal voor me uitvoeren? | Meta question about capabilities — should describe, not call |

### Scoring rubric

For each prompt, score:

- **Tool selection** — right tool? (or correctly nothing for 24-30): pass / fail
- **Argument validity** — JSON parses, required fields present, types correct: pass / fail
- **Entity extraction** — Dutch names, dates ("morgen", "volgende week dinsdag", "kwart over zeven") correctly parsed: pass / partial / fail

Aim for ≥90% on prompts 1-10, ≥80% on 11-18, ≥70% on 19-23, ≥90% on 24-30. If 24-30 fails badly, you have a hallucinating-tool-calls problem and probably need schema-constrained decoding (Outlines or Instructor) to fix it.

### Failure modes to watch for

- **Date parsing** — "kwart over zeven" → 19:15 or 07:15? Watch for AM/PM confusion. Dutch 24h is the cultural default but small models sometimes default to US conventions.
- **"volgende week dinsdag"** — does it pick the right Tuesday? Easy to be off by a week.
- **Compound names** — "Maria de Vries" extracted as "Maria" only is a common bug.
- **Empty tool calls** — the model invokes a tool but with empty or null required args. Validate strictly.
- **Repeated calls** — after a successful call, model calls the same tool again with slight variations. Cap your agent loop.

---

## Practical tips for running this

- **Run each prompt 3 times** and take the majority result. Small models are noisier than big ones.
- **Set temperature low** (0.1-0.3) for tool calling. Higher temps wreck JSON validity.
- **For the Dutch baseline, try temp 0.7** — you actually want some variation in language tasks.
- **Save raw outputs**, not just scores. You'll want to look at the failures later when deciding what to fix.
- **Use Ollama's `/api/chat` with `tools` param** rather than the bare `/api/generate` — it handles the tool-calling format properly per model.

Once you've run all 50 prompts on a model, you'll have a much sharper sense of whether it's good enough than any benchmark would tell you.
