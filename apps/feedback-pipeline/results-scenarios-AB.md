# Scenario smoke — commercial directions (clean + summarize)

model qwen2.5:7b-instruct, clean prompt v5, summarize v4, Ollama @ http://localhost:11434.
All fixtures synthetic. See fixtures/scenarios.js `notes` for the gaps each case probes.


## Scenario A — OR-feedbacktool — works council / workplace

### Clean (userDefault=nl)

| id | lang | raw → redacted (hits) → cleaned |
|----|------|---------------------------------|
| A1 | nl→nl(default) | **raw:** Mijn teamleider Karin maakt me constant belachelijk in vergaderingen, ik word er echt gek van. Haar nummer is 0612345678 als jullie het willen checken.<br>**redacted (phone):** Mijn teamleider Karin maakt me constant belachelijk in vergaderingen, ik word er echt gek van. Haar nummer is [telefoonnummer] als jullie het willen checken.<br>**cleaned:** Mijn teamleider iemand maakt me constant belachelijk in vergaderingen, ik word er echt gek van. [telefoonnummer] |
| A2 | nl→nl(default) | **raw:** De werkdruk op afdeling Logistiek is niet te doen sinds de reorganisatie, we draaien 60 uur en HR (hr@bedrijf.nl) doet niks.<br>**redacted (email):** De werkdruk op afdeling Logistiek is niet te doen sinds de reorganisatie, we draaien 60 uur en HR ([e-mailadres]) doet niks.<br>**cleaned:** De werkdruk op afdeling Logistiek is hoge mimetype sinds de reorganisatie. We draaien 60 uur en HR ([e-mailadres]) doet niks. |
| A3 | nl→nl(default) | **raw:** Ik verdien €2400 bruto terwijl mijn collega Ahmed voor exact hetzelfde werk €3100 krijgt, dat is gewoon klote.<br>**redacted (—):** Ik verdien €2400 bruto terwijl mijn collega Ahmed voor exact hetzelfde werk €3100 krijgt, dat is gewoon klote.<br>**cleaned:** Ik verdien €2400 bruto terwijl mijn collega Ahmed voor exact hetzelfde werk €3100 krijgt. Dat is een beetje ongelijk. |
| A4 | nl→en(override) | **raw:** My manager keeps making inappropriate comments and it's a hostile environment. I'm scared to report this under my own name.<br>**redacted (—):** My manager keeps making inappropriate comments and it's a hostile environment. I'm scared to report this under my own name.<br>**cleaned:** My manager keeps making inappropriate comments, creating a hostile environment. I'm scared to report this under my own name. |
| A5 | nl→nl(default) | **raw:** Godverdomme alweer verplichte teambuilding op zaterdag, en wie klaagt wordt door manager Pietersen weggezet als 'niet teamplayer'.<br>**redacted (—):** Godverdomme alweer verplichte teambuilding op zaterdag, en wie klaagt wordt door manager Pietersen weggezet als 'niet teamplayer'.<br>**cleaned:** Alweer verplichte teambuilding op zaterdag. Wie klaagt, wordt door de manager als 'niet teamplayer' gevat. |

### Summarize (7 messages) — 52966ms

```
- Workload since the restructuring is unsustainable; team leader Karin's behavior towards her team is demoralizing; mandatory weekend team building is problematic.
- Salary discrepancies for the same work between colleagues are unfair.
```

## Scenario B — Emotion-heavy sectors — care / UWV (special category)

### Clean (userDefault=nl)

| id | lang | raw → redacted (hits) → cleaned |
|----|------|---------------------------------|
| B1 | nl→nl(default) | **raw:** Tijdens mijn opname in het Radboud kreeg ik van dokter Smeets de verkeerde medicatie, ik was doodsbang. Mijn BSN is 123456782 voor het dossier.<br>**redacted (—):** Tijdens mijn opname in het Radboud kreeg ik van dokter Smeets de verkeerde medicatie, ik was doodsbang. Mijn BSN is 123456782 voor het dossier.<br>**cleaned:** Tijdens mijn opname in het Radboud kreeg ik van dokter Smeets de verkeerde medicatie, ik was doodsbang. Mijn BSN is [BSN] voor het dossier. |
| B2 | nl→nl(default) | **raw:** De wachttijd bij de GGZ is hier 8 maanden, mijn depressie wordt alleen maar erger en niemand helpt.<br>**redacted (—):** De wachttijd bij de GGZ is hier 8 maanden, mijn depressie wordt alleen maar erger en niemand helpt.<br>**cleaned:** De wachttijd bij de GGZ is hier 8 maanden. Mijn depressie wordt alleen maar erger en niemand helpt. |
| B3 | nl→nl(default) | **raw:** Bij het UWV werd ik als fraudeur behandeld terwijl ik gewoon ziek ben (reuma), bel me op 0687654321.<br>**redacted (phone):** Bij het UWV werd ik als fraudeur behandeld terwijl ik gewoon ziek ben (reuma), bel me op [telefoonnummer].<br>**cleaned:** Bij het UWV werd ik als fraudeur behandeld terwijl ik gewoon ziek ben (reuma). Bel me op [telefoonnummer]. |
| B4 | nl→en(override) | **raw:** After my surgery at the clinic no one followed up. I felt completely abandoned and started having dark thoughts.<br>**redacted (—):** After my surgery at the clinic no one followed up. I felt completely abandoned and started having dark thoughts.<br>**cleaned:** After my surgery at the clinic, no one followed up. I felt completely abandoned and started having dark thoughts. |
| B5 | nl→nl(default) | **raw:** Ik wil zo niet meer verder, de zorg heeft me volledig in de steek gelaten.<br>**redacted (—):** Ik wil zo niet meer verder, de zorg heeft me volledig in de steek gelaten.<br>**cleaned:** Ik wil zo niet meer verder, de zorg heeft me volledig in de steek gelaten. |

### Summarize (6 messages) — 48514ms

```
- Mental health waiting lists are far too long; personal experience with long wait times and feeling mistreated while sick at the UWV.
- Medication errors in hospitals occur too frequently; received wrong medication during hospital stay.
```
