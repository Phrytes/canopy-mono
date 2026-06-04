# Full pipeline — RAW → clean → translate → triage → summaries

clean v7, summarize v4, preferred language **Dutch**, model qwen2.5:7b-instruct, Ollama @ http://localhost:11434.
Rotating sample of 12/24 messages (new each run). All synthetic.

## 0. Raw input (12 messages)

1. Ik heb meegemaakt dat mijn baas structureel cijfers liet aanpassen, ik durfde niets te zeggen.
2. De werkdruk is niet te doen sinds de reorganisatie, we draaien 60 uur per week.
3. Workload since the restructuring is unsustainable, everyone is exhausted.
4. De speeltuin is onveilig geworden, er slingeren naalden rond.
5. The CI/CD pipeline takes 30+ minutes again, it's killing our deploy velocity.
6. After my surgery no one followed up, I started having dark thoughts.
7. Onze build-pipeline duurt veel te lang, het kost ons elke dag tijd.
8. Mijn teamleider Karin kleineert me constant in vergaderingen, bel haar op 0612345678.
9. Manager Karim vraagt structureel seksuele gunsten in ruil voor promotie.
10. Mijn ervaring met de jeugdzorg was traumatisch, mijn dochter van 8 werd uit huis geplaatst.
11. The scaffolding on site is a death trap, someone will get hurt.
12. Leverancier Acme levert structureel te laat, we moeten een alternatief zoeken.

## 1. ⚠ Signal track — 4 incident(s) routed to escalation (NOT aggregated)

- **safety** (severity high, via LLM): De speeltuin is onveilig geworden, er slingeren naalden rond.
- **crisis** (severity high, via crisis-lexicon): After my surgery no one followed up, I started having dark thoughts.
- **safety** (severity high, via LLM): Mijn ervaring met de jeugdzorg was traumatisch, mijn dochter van 8 werd uit huis geplaatst.
- **safety** (severity high, via safety-lexicon): The scaffolding on site is a death trap, someone will get hurt.

## 2. Per-message clean + translate (regular messages)

- **[workplace]** (nl)
  - RAW:        Ik heb meegemaakt dat mijn baas structureel cijfers liet aanpassen, ik durfde niets te zeggen.
  - CLEAN:      Mijn baas liet structureel cijfers aanpassen, ik durfde niets te zeggen.
- **[workplace]** (nl)
  - RAW:        De werkdruk is niet te doen sinds de reorganisatie, we draaien 60 uur per week.
  - CLEAN:      De werkdruk is niet te doen sinds de reorganisatie, we draaien 60 uur per week.
- **[workplace]** (en)
  - RAW:        Workload since the restructuring is unsustainable, everyone is exhausted.
  - CLEAN:      Workload since the restructuring is unsustainable, everyone is exhausted.
  - TRANSLATED: De workload sinds de structuurverandering is onduurbaar, iedereen is uitgeput.
- **[technology]** (en)
  - RAW:        The CI/CD pipeline takes 30+ minutes again, it's killing our deploy velocity.
  - CLEAN:      The CI/CD pipeline takes 30+ minutes again, it's killing our deploy velocity.
  - TRANSLATED: De CI/CD-pipeline duurt weer 30 minuten of langer, het vermoordt onze deploy-velociteit.
- **[technology]** (nl)
  - RAW:        Onze build-pipeline duurt veel te lang, het kost ons elke dag tijd.
  - CLEAN:      Ons build-pipeline duurt veel te lang, het kost ons elke dag tijd.
- **[workplace]** (nl, redacted: phone)
  - RAW:        Mijn teamleider Karin kleineert me constant in vergaderingen, bel haar op 0612345678.
  - CLEAN:      Karin kleineert me constant in vergaderingen, bel haar op [telefoonnummer].
- **[workplace]** (nl)
  - RAW:        Manager Karim vraagt structureel seksuele gunsten in ruil voor promotie.
  - CLEAN:      De manager vraagt structureel seksuele gunsten in ruil voor promotie.
- **[general]** (nl)
  - RAW:        Leverancier Acme levert structureel te laat, we moeten een alternatief zoeken.
  - CLEAN:      Leverancier Acme levert structureel te laat, we moeten een alternatief zoeken.

## 3. Final summaries by domain (built from the cleaned + translated messages)

**workplace**
- De werkdruk is te hoog sinds de reorganisatie; iedereen is uitgeput.
- Karin kleineert je constant in vergaderingen, bel haar op [telefoonnummer].
- Je baas vraagt structureel seksuele gunsten in ruil voor promotie.

**technology**
- De CI/CD-pipeline duurt te lang (30 minuten of langer), wat belemmert onze deploy-velociteit en werkt elke dag tijd in.

**general**
- Leverancier Acme levert structureel te laat, we moeten een alternatief zoeken.

