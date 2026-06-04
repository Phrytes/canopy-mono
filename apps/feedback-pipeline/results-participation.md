# Simulatie — Burgerparticipatie (Richting 5), feedback-pipeline

**Onderwerp:** Herinrichting van het Marktplein en omgeving (gemeentelijke participatie)

Model qwen2.5:7b-instruct, taal **Dutch**, Ollama @ http://localhost:11434. Synthetisch.

Pipeline: stap 2 (inname) → 3 (lokale filtering) → 4 (co-redactie: AUTO-GOEDGEKEURD, gebruiker akkoord) → 5 (aggregatie met k-drempel) → 6 (statistisch + signaal spoor).

**Deelnemers:** 12 · **berichten:** 18 · **k-drempel:** 3 (een thema verschijnt pas vanaf 3 verschillende deelnemers).

## 📊 Statistisch spoor (k-anoniem — alleen thema's van ≥ 3 deelnemers)

### parking  — 4 deelnemers (4 berichten)
- Er moeten voldoende parkeerplekken blijven om toegang tot de winkels mogelijk te maken.

### greenery  — 3 deelnemers (3 berichten)
- Er moet meer groen (bomen, plantenbakken) en bankjes geplaatst worden op het plein.

### redesign  — 3 deelnemers (3 berichten)
- De herinrichting van het plein wordt gesteund; het heeft jarenlang een update nodig geweest.

### accessibility  — 3 deelnemers (3 berichten)
- Looproutes moeten toegankelijk en drempelvrij blijven, aangezien er mensen zijn die slecht ter been zijn (voor rolstoelen).

## 🚨 Signaal spoor (geen drempel — één melding is genoeg)

- **safety** (ernst high, via safety-lexicon) — deelnemer p6: De oude speeltoestellen op het plein zijn levensgevaarlijk, straks valt er een kind naar beneden.
- **integrity** (ernst high, via LLM) — deelnemer p10: De gekozen aannemer is de zwager van de wethouder; dit stinkt naar vriendjespolitiek en corruptie.

## 🗑️ Onder de k-drempel weggegooid (transparantie)

Deze thema's haalden de drempel van 3 deelnemers niet en verschijnen NIET in de output:
- safety — 2 deelnemer(s), 2 bericht(en) → verwijderd
- noise — 1 deelnemer(s), 1 bericht(en) → verwijderd
