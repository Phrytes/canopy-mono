# Triage-then-summarize — qwen2.5:7b-instruct @ http://localhost:11434

Input batch (9 messages):

```
1. De wachttijden bij de GGZ zijn veel te lang.
2. Ik wacht al maanden op hulp bij de GGZ, dit is onacceptabel.
3. Ik wil zo niet meer verder leven.
4. Op de bouwplaats wordt met veiligheid gerommeld, het is wachten op een dodelijk ongeluk.
5. De werkdruk is veel te hoog sinds de reorganisatie.
6. Te veel uren, dit is gewoon niet vol te houden.
7. Mijn leidinggevende vraagt structureel seksuele gunsten in ruil voor promotie.
8. I support the new plan but I worry about parking in our street.
9. Mental health waiting lists are far too long.
```

## ⚠ Signal track — 3 incident(s) routed to escalation (NOT aggregated)

- **crisis** (severity high, crisis-lexicon match): Ik wil zo niet meer verder leven.
- **safety** (severity high): Op de bouwplaats wordt met veiligheid gerommeld, het is wachten op een dodelijk ongeluk.
- **integrity** (severity high): Mijn leidinggevende vraagt structureel seksuele gunsten in ruil voor promotie.

## Summary by domain (regular feedback)

**care waiting times**
- Mental health waiting lists are far too long; waiting times at the GGZ are excessively long and unacceptable.

**workload**
- Workload is too high since the reorganization; working excessive hours is unsustainable.

**parking**
- I support the new plan but I worry about parking in our street.


## Per-message labels

```
1. [none/medium] care waiting times
2. [none/high] care waiting times
3. [crisis/high] mental health
4. [safety/high] workplace safety
5. [none/medium] workload
6. [none/low] workload
7. [integrity/high] harassment
8. [none/low] parking
9. [none/medium] care waiting times
```
