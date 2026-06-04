# Scenario smoke — commercial directions (clean + summarize)

model qwen2.5:7b-instruct, clean prompt v5, summarize v4, Ollama @ http://localhost:11434.
All fixtures synthetic. See fixtures/scenarios.js `notes` for the gaps each case probes.


## Scenario C — Onderzoek & interviews — qualitative research respondents

### Clean (userDefault=nl)

| id | lang | raw → redacted (hits) → cleaned |
|----|------|---------------------------------|
| C1 | nl→nl(default) | **raw:** Ik heb meegemaakt dat mijn leidinggevende bij de Belastingdienst structureel cijfers liet aanpassen, ik durfde er nooit iets van te zeggen.<br>**redacted (—):** Ik heb meegemaakt dat mijn leidinggevende bij de Belastingdienst structureel cijfers liet aanpassen, ik durfde er nooit iets van te zeggen.<br>**cleaned:** Ik heb meegemaakt dat mijn leidinggevende bij de Belastingdienst structureel cijfers liet aanpassen. Ik durfde er nooit iets van te zeggen. |
| C2 | nl→nl(default) | **raw:** In het interview zei ik dat mijn collega Fatima werd gepest, maar ik wil haar naam er eigenlijk uit hebben.<br>**redacted (—):** In het interview zei ik dat mijn collega Fatima werd gepest, maar ik wil haar naam er eigenlijk uit hebben.<br>**cleaned:** In het interview zei ik dat mijn collega [naam] werd gepest, maar ik wil haar naam er eigenlijk uit hebben. |
| C3 | nl→en(override) | **raw:** Honestly the management at my previous employer, a mid-size logistics firm in Tilburg, was toxic and burned people out.<br>**redacted (—):** Honestly the management at my previous employer, a mid-size logistics firm in Tilburg, was toxic and burned people out.<br>**cleaned:** Honestly, the management at my previous employer, a mid-size logistics firm in Tilburg, was challenging and stressful for everyone. |
| C4 | nl→nl(default) | **raw:** Mijn ervaring met de jeugdzorg was traumatisch, mijn dochter van 8 werd uit huis geplaatst zonder goede reden.<br>**redacted (—):** Mijn ervaring met de jeugdzorg was traumatisch, mijn dochter van 8 werd uit huis geplaatst zonder goede reden.<br>**cleaned:** Mijn ervaring met de jeugdzorg was traumatisch, mijn dochter van 8 werd uit huis geplaatst zonder goede redenen. |

### Summarize (6 messages) — 41448ms

```
- A culture of fear prevents people from speaking up and addressing misdeeds; high workload leads to burn-out.
- Suspicion towards management is a recurring theme.
```

## Scenario D — Klokkenluiden & integriteit — whistleblowing reports

### Clean (userDefault=nl)

| id | lang | raw → redacted (hits) → cleaned |
|----|------|---------------------------------|
| D1 | nl→nl(default) | **raw:** Ik meld dat afdelingshoofd Van Dijk facturen vervalst en geld doorsluist naar een eigen BV (KvK 12345678).<br>**redacted (—):** Ik meld dat afdelingshoofd Van Dijk facturen vervalst en geld doorsluist naar een eigen BV (KvK 12345678).<br>**cleaned:** Ik meld dat afdelingshoofd iemand facturen vervalst en geld doorsluist naar een eigen BV (KvK 12345678). |
| D2 | nl→nl(default) | **raw:** Manager Karim vraagt structureel om seksuele gunsten in ruil voor promotie, meerdere collega's durven niets te zeggen.<br>**redacted (—):** Manager Karim vraagt structureel om seksuele gunsten in ruil voor promotie, meerdere collega's durven niets te zeggen.<br>**cleaned:** De manager vraagt structureel om seksuele gunsten in ruil voor een promotie, meerdere collega's durven niets te zeggen. |
| D3 | nl→en(override) | **raw:** Our CFO approved payments to a shell company; I have the invoices but I'm terrified of retaliation.<br>**redacted (—):** Our CFO approved payments to a shell company; I have the invoices but I'm terrified of retaliation.<br>**cleaned:** Our CFO approved payments to a shell company; I have the invoices but I'm concerned about potential retaliation. |
| D4 | nl→nl(default) | **raw:** Op de bouwplaats wordt stelselmatig met veiligheidscertificaten gerommeld, het is wachten op een dodelijk ongeluk.<br>**redacted (—):** Op de bouwplaats wordt stelselmatig met veiligheidscertificaten gerommeld, het is wachten op een dodelijk ongeluk.<br>**cleaned:** Op de bouwplaats wordt stelselmatig met veiligheidscertificaten gerommeld, het is wachten op een ongeluk. |

### Summarize (5 messages) — 44566ms

```
- Multiple reports of intimidation by the same department head; colleagues complain about bullying and threats.
- Reports of financial irregularities in procurement are surfacing; invoices are being tampered with.
- Safety procedures are systematically ignored on the work floor.
```

## Scenario E — Lerende organisatie — operational observations (low-PII)

### Clean (userDefault=en)

| id | lang | raw → redacted (hits) → cleaned |
|----|------|---------------------------------|
| E1 | en→en(default) | **raw:** The CI/CD pipeline takes 30+ minutes again, it's killing our deploy velocity.<br>**redacted (—):** The CI/CD pipeline takes 30+ minutes again, it's killing our deploy velocity.<br>**cleaned:** The CI/CD pipeline is taking 30+ minutes again, which is slowing down our deploy velocity. |
| E2 | en→nl(override) | **raw:** Stap 4 van de onboarding-procedure klopt niet meer sinds de migratie naar Salesforce.<br>**redacted (—):** Stap 4 van de onboarding-procedure klopt niet meer sinds de migratie naar Salesforce.<br>**cleaned:** Stap 4 van de onboarding-procedure klopt niet meer sinds de migratie naar Salesforce. |
| E3 | en→nl(override) | **raw:** Leverancier Acme levert structureel te laat, we moeten een alternatief zoeken.<br>**redacted (—):** Leverancier Acme levert structureel te laat, we moeten een alternatief zoeken.<br>**cleaned:** Leverancier Acme levert structureel te laat, we moeten een alternatief zoeken. |
| E4 | en→en(default) | **raw:** Customers keep asking for the same export feature; support is overwhelmed by it.<br>**redacted (—):** Customers keep asking for the same export feature; support is overwhelmed by it.<br>**cleaned:** Customers keep asking about the same export feature; support is overwhelmed with it. |

### Summarize (6 messages) — 45403ms

```
- The CI/CD pipeline is too slow and blocks deploys; multiple developers flagged it as a bottleneck this month.
- Customers repeatedly ask for the same export function, overwhelming support.
- Documentation is behind the latest release.
```

## Scenario F — Burgerparticipatie — citizen feedback on local policy

### Clean (userDefault=nl)

| id | lang | raw → redacted (hits) → cleaned |
|----|------|---------------------------------|
| F1 | nl→nl(default) | **raw:** Ik ben vóór de herinrichting van het Marktplein, maar maak me zorgen over parkeerplekken voor mijn moeder die slecht ter been is en op de Lindenlaan 8 woont.<br>**redacted (address):** Ik ben vóór de herinrichting van het Marktplein, maar maak me zorgen over parkeerplekken voor mijn moeder die slecht ter been is en op de [adres] woont.<br>**cleaned:** Ik ben vóór de herinrichting van het Marktplein, maar maak me zorgen over parkeerplekken voor mijn moeder die slecht ter been is en op het [adres] woont. |
| F2 | nl→nl(default) | **raw:** De nieuwe woonvisie is prima, maar 200 woningen in onze wijk Overvecht is veel te veel voor de bestaande infrastructuur.<br>**redacted (—):** De nieuwe woonvisie is prima, maar 200 woningen in onze wijk Overvecht is veel te veel voor de bestaande infrastructuur.<br>**cleaned:** De nieuwe woonvisie is prima, maar 200 woningen in onze wijk Overvecht zijn veel te veel voor de bestaande infrastructuur. |
| F3 | nl→en(override) | **raw:** I support the energy transition but the proposed wind turbines near our village will ruin the view from my house on Dorpsstraat 23.<br>**redacted (address):** I support the energy transition but the proposed wind turbines near our village will ruin the view from my house on [adres].<br>**cleaned:** I support the energy transition but the proposed wind turbines near our village will affect the view from my house at [adres]. |
| F4 | nl→nl(default) | **raw:** Mijn buurman Klaas en ik vinden allebei dat de speeltuin onveilig is geworden, er slingeren naalden rond.<br>**redacted (—):** Mijn buurman Klaas en ik vinden allebei dat de speeltuin onveilig is geworden, er slingeren naalden rond.<br>**cleaned:** iemand en ik vinden allebei dat de speeltuin onveilig is geworden, er slingeren naalden rond. |

### Summarize (6 messages) — 42799ms

```
- Residents worry about parking shortages due to proposed housing density and fear for children's safety at the playground.
- People support energy transition but are concerned about potential horizon pollution from wind turbines.
```
