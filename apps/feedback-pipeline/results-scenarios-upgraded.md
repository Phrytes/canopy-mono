# Scenario results — UPGRADED pipeline

clean prompt v6 (de-intensify), deterministic BSN, triage (signal track + per-domain summarize v4).
Model qwen2.5:7b-instruct, Ollama @ http://localhost:11434. All fixtures synthetic.


---

# Scenario A — OR-feedbacktool — works council / workplace

## Per-message clean (user default language: nl)

### A1  (lang nl→nl)
- **RAW:** Mijn teamleider Karin maakt me constant belachelijk in vergaderingen, ik word er echt gek van. Haar nummer is 0612345678 als jullie het willen checken.
- **REDACTED** (regex+names caught: phone): Mijn teamleider Karin maakt me constant belachelijk in vergaderingen, ik word er echt gek van. Haar nummer is [telefoonnummer] als jullie het willen checken.
- **CLEAN:** Mijn teamleider iemand maakt me constant belachelijk in vergaderingen, ik word er echt gek van.

### A2  (lang nl→nl)
- **RAW:** De werkdruk op afdeling Logistiek is niet te doen sinds de reorganisatie, we draaien 60 uur en HR (hr@bedrijf.nl) doet niks.
- **REDACTED** (regex+names caught: email): De werkdruk op afdeling Logistiek is niet te doen sinds de reorganisatie, we draaien 60 uur en HR ([e-mailadres]) doet niks.
- **CLEAN:** De werkdruk op afdeling Logistiek is niet te doen sinds de reorganisatie, we draaien 60 uur en HR ([e-mailadres]) doet niks.

### A3  (lang nl→nl)
- **RAW:** Ik verdien €2400 bruto terwijl mijn collega Ahmed voor exact hetzelfde werk €3100 krijgt, dat is gewoon klote.
- **REDACTED** (regex+names caught: none): Ik verdien €2400 bruto terwijl mijn collega Ahmed voor exact hetzelfde werk €3100 krijgt, dat is gewoon klote.
- **CLEAN:** Ik verdien €2400 bruto terwijl mijn collega Ahmed voor exact hetzelfde werk €3100 krijgt, dat is gewoon een rotzooi.

### A4  (lang nl→en)
- **RAW:** My manager keeps making inappropriate comments and it's a hostile environment. I'm scared to report this under my own name.
- **REDACTED** (regex+names caught: none): My manager keeps making inappropriate comments and it's a hostile environment. I'm scared to report this under my own name.
- **CLEAN:** My manager keeps making inappropriate comments and it's a hostile environment. I'm scared to report this under my own name.

### A5  (lang nl→nl)
- **RAW:** Godverdomme alweer verplichte teambuilding op zaterdag, en wie klaagt wordt door manager Pietersen weggezet als 'niet teamplayer'.
- **REDACTED** (regex+names caught: none): Godverdomme alweer verplichte teambuilding op zaterdag, en wie klaagt wordt door manager Pietersen weggezet als 'niet teamplayer'.
- **CLEAN:** Alweer verplichte teambuilding op zaterdag, en wie klaagt wordt door manager Pietersen weggezet als 'niet teamplayer'.

## Triage of the batch (7 messages)

**Input messages:**

1. De reorganisatie heeft de werkdruk enorm verhoogd, niemand houdt dit zo vol.
2. Sinds de reorg draaien we veel te veel uren, het is niet vol te houden.
3. Workload since the restructuring is simply unsustainable.
4. Teamleider Karin gedraagt zich kleinerend richting haar team.
5. Ik voel me vernederd door mijn leidinggevende in meetings.
6. De salarisverschillen tussen collega's voor hetzelfde werk zijn oneerlijk.
7. Verplichte teambuilding in het weekend valt heel slecht.

### ⚠ Signal track — 0 incident(s) routed to escalation (NOT aggregated)

_none_

### Summary by domain (regular feedback)

**workload**
- The workload since the restructuring has increased dramatically and is unsustainable.

**management**
- Team leader Karin is perceived as demeaning towards her team, and a team member feels undermined by their leader during meetings.

**pay**
- De salarisverschillen tussen collega's voor hetzelfde werk zijn oneerlijk.

**leisure**
- Verplichte teambuilding in het weekend valt heel slecht.

<details><summary>per-message triage labels</summary>

```
1. [none/medium] workload
2. [none/medium] workload
3. [none/medium] workload
4. [none/low] management
5. [none/low] management
6. [integrity/medium] pay
7. [none/low] leisure
```
</details>

---

# Scenario B — Emotion-heavy sectors — care / UWV (special category)

## Per-message clean (user default language: nl)

### B1  (lang nl→nl)
- **RAW:** Tijdens mijn opname in het Radboud kreeg ik van dokter Smeets de verkeerde medicatie, ik was doodsbang. Mijn BSN is 123456782 voor het dossier.
- **REDACTED** (regex+names caught: bsn): Tijdens mijn opname in het Radboud kreeg ik van dokter Smeets de verkeerde medicatie, ik was doodsbang. Mijn BSN is [bsn] voor het dossier.
- **CLEAN:** Tijdens mijn opname in het Radboud kreeg ik van dokter Smeets de verkeerde medicatie, ik was dodelijk bang. Mijn BSN is [bsn] voor het dossier.

### B2  (lang nl→nl)
- **RAW:** De wachttijd bij de GGZ is hier 8 maanden, mijn depressie wordt alleen maar erger en niemand helpt.
- **REDACTED** (regex+names caught: none): De wachttijd bij de GGZ is hier 8 maanden, mijn depressie wordt alleen maar erger en niemand helpt.
- **CLEAN:** De wachttijd bij de GGZ is hier 8 maanden, mijn depressie wordt alleen maar erger en niemand helpt.

### B3  (lang nl→nl)
- **RAW:** Bij het UWV werd ik als fraudeur behandeld terwijl ik gewoon ziek ben (reuma), bel me op 0687654321.
- **REDACTED** (regex+names caught: phone): Bij het UWV werd ik als fraudeur behandeld terwijl ik gewoon ziek ben (reuma), bel me op [telefoonnummer].
- **CLEAN:** Bij het UWV werd ik als fraudeur behandeld terwijl ik gewoon ziek ben (reuma). Bel me op [telefoonnummer].

### B4  (lang nl→en)
- **RAW:** After my surgery at the clinic no one followed up. I felt completely abandoned and started having dark thoughts.
- **REDACTED** (regex+names caught: none): After my surgery at the clinic no one followed up. I felt completely abandoned and started having dark thoughts.
- **CLEAN:** After my surgery at the clinic, no one followed up. I felt completely abandoned and started having dark thoughts.

### B5  (lang nl→nl)
- **RAW:** Ik wil zo niet meer verder, de zorg heeft me volledig in de steek gelaten.
- **REDACTED** (regex+names caught: none): Ik wil zo niet meer verder, de zorg heeft me volledig in de steek gelaten.
- **CLEAN:** Ik wil zo niet meer verder, de zorg heeft me volledig in de steek gelaten.

## Triage of the batch (6 messages)

**Input messages:**

1. De wachttijden bij de GGZ zijn veel te lang.
2. Ik wacht al maanden op hulp bij de GGZ, dit is onacceptabel.
3. Mental health waiting lists are far too long.
4. Ik kreeg de verkeerde medicatie tijdens mijn ziekenhuisopname.
5. Medicatiefouten in het ziekenhuis komen veel te vaak voor.
6. Bij het UWV voelde ik me als verdachte behandeld terwijl ik ziek ben.

### ⚠ Signal track — 1 incident(s) routed to escalation (NOT aggregated)

- **integrity** (severity high): Bij het UWV voelde ik me als verdachte behandeld terwijl ik ziek ben.

### Summary by domain (regular feedback)

**care waiting times**
- Mental health waiting lists are far too long; waiting times at the GGZ are excessively long and unacceptable.

**medication errors**
- There was a medication error during hospital stay; such errors occur frequently.

<details><summary>per-message triage labels</summary>

```
1. [none/medium] care waiting times
2. [none/high] care waiting times
3. [none/medium] care waiting times
4. [none/low] medication errors
5. [none/medium] medication errors
6. [integrity/high] workplace treatment
```
</details>

---

# Scenario C — Onderzoek & interviews — qualitative research respondents

## Per-message clean (user default language: nl)

### C1  (lang nl→nl)
- **RAW:** Ik heb meegemaakt dat mijn leidinggevende bij de Belastingdienst structureel cijfers liet aanpassen, ik durfde er nooit iets van te zeggen.
- **REDACTED** (regex+names caught: none): Ik heb meegemaakt dat mijn leidinggevende bij de Belastingdienst structureel cijfers liet aanpassen, ik durfde er nooit iets van te zeggen.
- **CLEAN:** Ik heb meegemaakt dat mijn leidinggevende bij de Belastingdienst structureel cijfers liet aanpassen, ik durfde er nooit iets van te zeggen.

### C2  (lang nl→nl)
- **RAW:** In het interview zei ik dat mijn collega Fatima werd gepest, maar ik wil haar naam er eigenlijk uit hebben.
- **REDACTED** (regex+names caught: none): In het interview zei ik dat mijn collega Fatima werd gepest, maar ik wil haar naam er eigenlijk uit hebben.
- **CLEAN:** In het interview zei ik dat mijn collega [naam] werd gepest, maar ik wil haar naam er eigenlijk uit hebben.

### C3  (lang nl→en)
- **RAW:** Honestly the management at my previous employer, a mid-size logistics firm in Tilburg, was toxic and burned people out.
- **REDACTED** (regex+names caught: none): Honestly the management at my previous employer, a mid-size logistics firm in Tilburg, was toxic and burned people out.
- **CLEAN:** Honestly, the management at my previous employer, a mid-size logistics firm in Tilburg, was toxic and burned people out.

### C4  (lang nl→nl)
- **RAW:** Mijn ervaring met de jeugdzorg was traumatisch, mijn dochter van 8 werd uit huis geplaatst zonder goede reden.
- **REDACTED** (regex+names caught: none): Mijn ervaring met de jeugdzorg was traumatisch, mijn dochter van 8 werd uit huis geplaatst zonder goede reden.
- **CLEAN:** Mijn ervaring met de jeugdzorg was traumatisch, mijn dochter van 8 werd uit huis geplaatst zonder goede reden.

## Triage of the batch (6 messages)

**Input messages:**

1. Veel respondenten noemen een angstcultuur waarin niemand durft te melden.
2. Mensen durven misstanden niet aan te kaarten uit angst.
3. A culture of fear prevents people from speaking up.
4. Burn-out door structureel te hoge werkdruk komt vaak terug.
5. Respondenten beschrijven hoge werkdruk die tot uitputting leidt.
6. Wantrouwen richting de directie is een rode draad.

### ⚠ Signal track — 0 incident(s) routed to escalation (NOT aggregated)

_none_

### Summary by domain (regular feedback)

**workload**
- A culture of fear prevents people from reporting misconduct; high workload leads to burnout.

**trust**
- Wantrouwen richting de directie is een rode draad.

<details><summary>per-message triage labels</summary>

```
1. [none/medium] workload
2. [none/medium] workload
3. [none/medium] workload
4. [none/high] workload
5. [none/high] workload
6. [none/low] trust
```
</details>

---

# Scenario D — Klokkenluiden & integriteit — whistleblowing reports

## Per-message clean (user default language: nl)

### D1  (lang nl→nl)
- **RAW:** Ik meld dat afdelingshoofd Van Dijk facturen vervalst en geld doorsluist naar een eigen BV (KvK 12345678).
- **REDACTED** (regex+names caught: none): Ik meld dat afdelingshoofd Van Dijk facturen vervalst en geld doorsluist naar een eigen BV (KvK 12345678).
- **CLEAN:** Ik meld dat afdelingshoofd [naam] facturen vervalst en geld doorsluist naar een eigen BV.

### D2  (lang nl→nl)
- **RAW:** Manager Karim vraagt structureel om seksuele gunsten in ruil voor promotie, meerdere collega's durven niets te zeggen.
- **REDACTED** (regex+names caught: none): Manager Karim vraagt structureel om seksuele gunsten in ruil voor promotie, meerdere collega's durven niets te zeggen.
- **CLEAN:** De manager vraagt structureel om seksuele gunsten in ruil voor een promotie, meerdere collega's durven niets te zeggen.

### D3  (lang nl→en)
- **RAW:** Our CFO approved payments to a shell company; I have the invoices but I'm terrified of retaliation.
- **REDACTED** (regex+names caught: none): Our CFO approved payments to a shell company; I have the invoices but I'm terrified of retaliation.
- **CLEAN:** Our CFO approved payments to a shell company; I have the invoices but I'm terrified of retaliation.

### D4  (lang nl→nl)
- **RAW:** Op de bouwplaats wordt stelselmatig met veiligheidscertificaten gerommeld, het is wachten op een dodelijk ongeluk.
- **REDACTED** (regex+names caught: none): Op de bouwplaats wordt stelselmatig met veiligheidscertificaten gerommeld, het is wachten op een dodelijk ongeluk.
- **CLEAN:** Op de bouwplaats wordt stelselmatig met veiligheidscertificaten gerommeld, het is wachten op een levensgevaarlijk ongeluk.

## Triage of the batch (5 messages)

**Input messages:**

1. Meerdere meldingen over intimidatie door hetzelfde afdelingshoofd.
2. Collega's klagen over een leidinggevende die mensen kleineert en bedreigt.
3. Reports of financial irregularities in procurement keep surfacing.
4. Er wordt geknoeid met inkoopfacturen, meerdere mensen zien het.
5. Veiligheidsprocedures worden stelselmatig genegeerd op de werkvloer.

### ⚠ Signal track — 2 incident(s) routed to escalation (NOT aggregated)

- **integrity** (severity high): Reports of financial irregularities in procurement keep surfacing.
- **integrity** (severity high): Er wordt geknoeid met inkoopfacturen, meerdere mensen zien het.

### Summary by domain (regular feedback)

**harassment**
- Multiple reports of intimidation by the same department head; colleagues complain about a leader who bullies and threatens people.

**safety**
- Veiligheidsprocedures worden stelselmatig genegeerd op de werkvloer.

<details><summary>per-message triage labels</summary>

```
1. [none/medium] harassment
2. [none/medium] harassment
3. [integrity/high] fraud
4. [integrity/high] fraud
5. [none/medium] safety
```
</details>

---

# Scenario E — Lerende organisatie — operational observations (low-PII)

## Per-message clean (user default language: en)

### E1  (lang en→en)
- **RAW:** The CI/CD pipeline takes 30+ minutes again, it's killing our deploy velocity.
- **REDACTED** (regex+names caught: none): The CI/CD pipeline takes 30+ minutes again, it's killing our deploy velocity.
- **CLEAN:** The CI/CD pipeline takes 30+ minutes again, it's killing our deploy velocity.

### E2  (lang en→nl)
- **RAW:** Stap 4 van de onboarding-procedure klopt niet meer sinds de migratie naar Salesforce.
- **REDACTED** (regex+names caught: none): Stap 4 van de onboarding-procedure klopt niet meer sinds de migratie naar Salesforce.
- **CLEAN:** Stap 4 van de onboarding-procedure klopt niet meer sinds de migratie naar Salesforce.

### E3  (lang en→nl)
- **RAW:** Leverancier Acme levert structureel te laat, we moeten een alternatief zoeken.
- **REDACTED** (regex+names caught: none): Leverancier Acme levert structureel te laat, we moeten een alternatief zoeken.
- **CLEAN:** Leverancier Acme levert structureel te laat, we moeten een alternatief zoeken.

### E4  (lang en→en)
- **RAW:** Customers keep asking for the same export feature; support is overwhelmed by it.
- **REDACTED** (regex+names caught: none): Customers keep asking for the same export feature; support is overwhelmed by it.
- **CLEAN:** Customers keep asking for the same export feature; support is overwhelmed by it.

## Triage of the batch (6 messages)

**Input messages:**

1. The CI/CD pipeline is too slow and blocks deploys.
2. Onze build-pipeline duurt veel te lang, het kost ons elke dag tijd.
3. Multiple devs flagged the deploy pipeline as a bottleneck this month.
4. Klanten vragen herhaaldelijk om dezelfde export-functie.
5. Support wordt overspoeld door dezelfde feature-vraag.
6. De documentatie loopt achter op de laatste release.

### ⚠ Signal track — 0 incident(s) routed to escalation (NOT aggregated)

_none_

### Summary by domain (regular feedback)

**deployment**
- The CI/CD pipeline is too slow and blocking deploys; multiple developers have flagged it as a bottleneck this month.

**feature requests**
- Customers frequently ask about the same export function; support is overwhelmed by these requests.

**documentation**
- De documentatie loopt achter op de laatste release.

<details><summary>per-message triage labels</summary>

```
1. [none/medium] deployment
2. [none/medium] deployment
3. [none/medium] deployment
4. [none/low] feature requests
5. [none/low] feature requests
6. [none/low] documentation
```
</details>

---

# Scenario F — Burgerparticipatie — citizen feedback on local policy

## Per-message clean (user default language: nl)

### F1  (lang nl→nl)
- **RAW:** Ik ben vóór de herinrichting van het Marktplein, maar maak me zorgen over parkeerplekken voor mijn moeder die slecht ter been is en op de Lindenlaan 8 woont.
- **REDACTED** (regex+names caught: address): Ik ben vóór de herinrichting van het Marktplein, maar maak me zorgen over parkeerplekken voor mijn moeder die slecht ter been is en op de [adres] woont.
- **CLEAN:** Ik ben vóór de herinrichting van het Marktplein, maar maak me zorgen over parkeerplekken voor mijn moeder die slecht ter been is en op het [adres] woont.

### F2  (lang nl→nl)
- **RAW:** De nieuwe woonvisie is prima, maar 200 woningen in onze wijk Overvecht is veel te veel voor de bestaande infrastructuur.
- **REDACTED** (regex+names caught: none): De nieuwe woonvisie is prima, maar 200 woningen in onze wijk Overvecht is veel te veel voor de bestaande infrastructuur.
- **CLEAN:** De nieuwe woonvisie is prima, maar 200 woningen in onze wijk Overvecht zijn veel te veel voor de bestaande infrastructuur.

### F3  (lang nl→en)
- **RAW:** I support the energy transition but the proposed wind turbines near our village will ruin the view from my house on Dorpsstraat 23.
- **REDACTED** (regex+names caught: address): I support the energy transition but the proposed wind turbines near our village will ruin the view from my house on [adres].
- **CLEAN:** I support the energy transition but the proposed wind turbines near our village will ruin the view from my house on [adres].

### F4  (lang nl→nl)
- **RAW:** Mijn buurman Klaas en ik vinden allebei dat de speeltuin onveilig is geworden, er slingeren naalden rond.
- **REDACTED** (regex+names caught: none): Mijn buurman Klaas en ik vinden allebei dat de speeltuin onveilig is geworden, er slingeren naalden rond.
- **CLEAN:** Buurman iemand en ik vinden allebei dat de speeltuin onveilig is geworden, er slingeren naalden rond.

## Triage of the batch (6 messages)

**Input messages:**

1. Veel bewoners maken zich zorgen over parkeerdruk na de herinrichting.
2. Parkeerplekken verdwijnen en dat baart mensen zorgen.
3. Residents worry there will not be enough parking.
4. De voorgestelde woningdichtheid wordt als te hoog ervaren.
5. Mensen steunen de energietransitie maar vrezen horizonvervuiling door windmolens.
6. De speeltuin wordt als onveilig ervaren.

### ⚠ Signal track — 0 incident(s) routed to escalation (NOT aggregated)

_none_

### Summary by domain (regular feedback)

**parking**
-Residents worry about parking issues due to reorganization, with concerns about fewer parking spots.

**housing density**
- De voorgestelde woningdichtheid wordt als te hoog ervaren.

**energy transition**
- Mensen steunen de energietransitie maar vrezen horizonvervuiling door windmolens.

**playground safety**
- De speeltuin wordt als onveilig ervaren.

<details><summary>per-message triage labels</summary>

```
1. [none/low] parking
2. [none/low] parking
3. [none/low] parking
4. [none/medium] housing density
5. [none/low] energy transition
6. [none/low] playground safety
```
</details>
