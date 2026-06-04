# Sentence-level trace — Richting 3 stress run (input → final output)

Each of the 18 raw input messages and where it ended up, with its cleaned text,
reconstructed from `/tmp/stress-r3.json` (input) and `/tmp/stress-out4.json`
(final output). k=3, language Dutch. **All text below is verbatim from those
files — nothing paraphrased or invented.**

**One honest gap:** the pipeline *summarizes* the statistical-track messages, so
their per-message cleaned text is **not retained** — only the aggregate fraud
summary survives. Those messages are listed with their RAW text and marked
accordingly; everything else (signals / review / contact) retains per-message
cleaned text.

---

## 📊 Statistical track — fraud (3 distinct users, 5 messages)

Per-message cleaned text **not retained** (folded into the summary). The raw
messages that fed it:

- **w1** — "…ik denk dat mijn afdelingshoofd Jansen van Inkoop facturen aan het vervalsen is. Er kloppen bedragen niet…"
- **w1** — "Ik ben echt bang dat als dit uitkomt dat ze weten dat ik het ben, ik zit zo'n beetje als enige op die boekingen…tienduizenden euros die wegsluizen via valse facturen."
- **w2** — "…een leverancier (Van der Meer Techniek BV) factureerde 2x bijna hetzelfde bedrag van rond de 14.500 euro voor onderhoud dat volgens mij nooit is uitgevoerd."
- **w2** — "…die facturen werden altijd goedgekeurd door Marcel Dijkstra…Bij elkaar gaat het denk ik om 40 a 50 duizend euro het afgelopen halfjaar."
- **w3** — "…there's this vendor \"NorthBay Supplies\" that keeps billing us for stuff we never received…our finance manager Daniel Okonkwo is the one who keeps signing them off…"

**Aggregate summary (the only output for this track):**
> Er wordt vermoedelijk over vervalsde facturen gesproken; mogelijke bedragen van tienduizenden tot vijftigduizenden euro. Anonieme melding vereist.

---

## 🚨 Signal track (escalated)

**w5 — safety/high (via safety-lexicon)**
- RAW: ik moet dit kwijt want het is gewoon niet meer veilig hier. ik werk als steigerbouwer voor Van Dijk Bouw op het project aan de Maasboulevard in Rotterdam. mijn ploegbaas Kevin Tromp en de uitvoerder Hassan el Amrani lopen al weken te knoeien met de VCA certificaten…
- CLEAN: Ik moet dit kwijt want het is gewoon niet meer veilig hier. Ik werk als steigerbouwer voor Van Dijk Bouw op het project aan de Maasboulevard in Rotterdam. Mijn ploegbaas Kevin Tromp en de uitvoerder Hassan el Amrani lopen al weken te knoeien met de VCA certificaten… *(accused names kept by policy; org/site kept)*

**w5 — safety/high**
- RAW: vorige week is er al een plank naar beneden gekomen vlak naast Pawel (zo'n Poolse uitzendkracht via Flexforce)…ik heb het gemeld bij de directie (Gerard van Dijk zelf)…het is wachten op een dode hier, echt waar.
- CLEAN: Vorige week is er al een plank naar beneden gekomen vlak naast **iemand** (zo'n uitzendkracht)…Ik heb het gemeld bij de directie (**een manager**)…Het is wachten op een dode hier, echt waar. *(bystander "Pawel"→iemand; director name→"een manager"; severity "wachten op een dode" kept)*

**w6 — safety/high**
- RAW: basically my supervisor Mark Delaney keeps telling me to log the QC samples as passed before the readings are even done…someone could get hurt if those batches go out wrong.
- CLEAN: basically my supervisor **someone** keeps telling me to log the QC samples as passed…someone could get hurt if those batches go out wrong. *(full name "Mark Delaney"→someone)*

**w11 — crisis/high (via crisis-lexicon)**
- RAW: De werkdruk hier is echt niet meer te doen…Soms wil ik er gewoon niet meer zijn. Maar goed, het gaat me vooral om die werkdruk…
- CLEAN: *(unchanged — the buried self-harm line "Soms wil ik er gewoon niet meer zijn" is preserved and the message was escalated as crisis)*

---

## 🔎 Review queue (sensitive, below threshold — quarantined)

**w3 — REVIEW/harassment · flags: self-identifying ("only X") · via domain**
- RAW: i'm honestly not the only one who's worried. me, Priya from AP and at least two others…Daniel is tight with the regional director…
- CLEAN: i'm honestly not the only one who's worried. **some colleagues** and at least two others on my team have talked about it quietly over lunch…Daniel is tight with the regional director… *(bystander "Priya from AP"→some colleagues)*

**w4 — REVIEW/sexual harassment · flags: sensitive content · via domain**
- RAW: …mijn teamlead Marco Brouwer op de afdeling Logistiek (DC Tilburg) vraagt al maanden seksuele gunsten in ruil voor promotie…ik werk daar als orderpicker…
- CLEAN: …mijn teamlead Marco Brouwer op de afdeling Logistiek (DC Tilburg) vraagt al maanden seksuele gunsten in ruil voor promotie…ik werk daar als orderpicker… *(accused "Marco Brouwer" kept by policy)*

**w4 — REVIEW/sexual harassment · flags: self-identifying ("only X")**
- RAW: en ik ben niet de enige. Sanne en nog twee anderen…omdat Marco al jaren bevriend is met de vestigingsmanager Peter…
- CLEAN: **Iemand** heeft hetzelfde meegemaakt, maar iedereen is doodsbang…omdat de vestigingsmanager **[naam]** al jaren bevriend is met Marco… *(bystander "Sanne"→Iemand; "Peter"→[naam]; accused "Marco" kept)*

**w6 — REVIEW/safety · flags: self-identifying ("only X") · via domain**
- RAW: …i work nights in the lab, im actually the only night-shift lab technician on the whole site so if this gets back to anyone they'll know exactly who it was.
- CLEAN: Hi, I don't really know if this is safe but I need to say something. Please don't share my name. **I work nights in the lab.** *(the "only night-shift lab technician on the whole site" self-identifier generalized away)*

**w8 — REVIEW/corruption (×3, the sybil) · flags: sensitive content · via domain**
- RAW (1): Ik wil melden dat afdelingshoofd Jansen corrupt is en echt moet vertrekken…Jansen moet weg.
- CLEAN (1): Ik wil melden dat afdelingshoofd **[naam]** corrupt is en echt moet vertrekken…**[naam]** moet weg.
- RAW (2): Nogmaals over Jansen, het hoofd van onze afdeling…
- CLEAN (2): Over **de manager**, het hoofd van onze afdeling: de man is door en door corrupt…
- RAW (3): Het afdelingshoofd (Jansen) pleegt al maanden corruptie…hoe eerder hoe beter.
- CLEAN (3): Het afdelingshoofd pleegt al maanden corruptie…hoe eerder hoe **better**. *(3 near-duplicate messages, 1 user → quarantined, not surfaced statistically. Note: "better" is an LLM typo of "beter".)*

**w9 — REVIEW/workload · flags: self-identifying ("only X") · via content/re-id**
- RAW: I am the only female engineer at the Eindhoven depot and my manager keeps passing me over…Everyone knows exactly who I am because there is literally no one else like me here…
- CLEAN: I am **an engineer** at the Eindhoven depot and my manager keeps passing me over…Everyone knows who I am because there is no one else like me here… *(LLM mislabelled the theme "workload"; the deterministic re-id detector quarantined it anyway and flagged it; "only female" generalized)*

---

## 📇 Contact-request track (PII-only "contact me")

**w10**
- RAW: …Je kunt me bereiken op het buitenlandse nummer +49 171 2345678…het mijne is 1234 56 789. En anders mag je altijd mailen naar jan dot devries at gmail dot com, dan stuur ik de bewijzen door.
- CLEAN: …Je kunt me bereiken op het buitenlandse nummer **[telefoonnummer]**…het mijne is **[bsn]**. En anders mag je altijd mailen naar **[e-mailadres]**, dan stuur ik de bewijzen door. *(all three smuggled PII redacted — foreign phone, spaced BSN, obfuscated email; routed out of the fraud aggregate)*

---

## 🗑️ Dropped (non-sensitive)

_empty — nothing silently deleted._

---

*Source: `/tmp/stress-r3.json`, `/tmp/stress-out4.json`. Regenerate the output
with `node scripts/run-dataset.js /tmp/stress-r3.json 3`.*
