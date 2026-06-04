# Stress-test dataset run — k=3, language Dutch

14 users · 24 messages · model qwen2.5:7b-instruct

## Statistical track (≥ 3 distinct users)

## Signal track

- **safety** (high, via safety-lexicon) — r2: Ik heb dit al een keer gemeld bij de afdeling Verkeer, ene meneer van Team Mobiliteit zei toen dat het 'op de lijst stond' maar er is helemaal niks veranderd. Hoeveel kinderen moeten er aangereden worden voordat jullie een verkeersdrempel of stoplicht plaatsen?? Straks gebeurt er een dodelijk ongeluk en dan is het te laat. Ik ben echt boos en bang tegelijk.
- **crisis** (high, via crisis-lexicon) — r4: Sinds mijn vrouw [naam] vorig jaar is overleden weet ik soms echt niet meer waar ik het voor doe. Dat buurthuis was het enige waar ik nog onder de mensen kwam. Ze hebben dat zomaar wegbezuinigd, die wethouder van het sociaal domein, en niemand vraagt aan ons hoe het nou verder moet. Ik lig 's avonds wakker en denk dan, laat maar. Sorry dat ik dit hier zo opschrijf, maar ik moest het ergens kwijt.
- **safety** (medium, via LLM) — r6: Ik zit in een rolstoel en ben volgens mij de enige die hier gebruikt maakt. De stoepranden hier zijn echt lastig. Bij de hoek van de Tulpstraat/Lindelaan is de stoep helemaal kapot en op andere plekken is de afrit veel te hoog. Ik kom er met geen mogelijkheid overheen zonder dat iemand me helpt duwen.
- **integrity** (high, via LLM) — r8: Ik wil iets melden over de evenementensubsidie die vorige maand is toegekend. Die is naar Van der Meulen Events BV gegaan en dat is gewoon het bedrijf van Patrick van der Meulen, die ZELF in de raad zit (fractie lokaal belang). Dat klopt toch van geen kant? Hij stemt mee over zijn eigen subsidie. Dit is pure vriendjespolitiek.
- **harassment** (medium, via LLM) — r8: Ik heb mailtjes en een screenshot van de gunning waar zijn naam in staat, kan dat laten zien. Bel me alsjeblieft op [telefoonnummer], dan leg ik het uit. Mijn collega werkt bij de afdeling subsidies en zegt ook dat het niet via de normale procedure is gegaan.
- **safety** (high, via safety-lexicon) — r9: Hallo, ik wil even melden dat de lantaarnpaal in de steeg tussen de Wilgenstraat en het parkeerterrein al zeker drie weken kapot is. Sindsdien is het er pikkedonker en als vrouw voel ik me er echt niet veilig om er doorheen te lopen. Kan hier alsjeblieft snel iemand naar kijken?

## ⚠ Review queue (sensitive, below threshold — quarantined, NOT deleted)

- **safety** (via domain, 2 user):
  - r2: Ik woon vlakbij basisschool De Regenboog aan de Lindenstraat en ik maak me enorme zorgen over de oversteekplaats daar bij de hoek met de Schoolstraat. Auto's scheuren elke ochtend langs als de kinderen naar binnen gaan, er is geen zebrapad meer dat goed zichtbaar is en de klaar-over (een vrijwilliger) staat er niet altijd. Mijn eigen zoon van 7 is vorige week bijna geschept toen hij overstak. Hier MOET iets gebeuren.
  - r9: Voor de zekerheid mijn e-mail als jullie nog iets willen vragen: [e-mailadres]. Ik heb het trouwens twee weken geleden ook al telefonisch doorgegeven aan ene meneer van de afdeling Openbare Ruimte, maar er is sindsdien niks gebeurd.
- **transport safety** (via domain, 1 user):
  - r7: BUT please can we talk about the bike lanes on Marktstraat?? It's terrifying. My kids (8 and 11) bike to school and cars do way over 50 there. There's just a painted line, no real separation. A guy named someone who works at the bakery got clipped by a van last month. We need proper separated lanes before someone dies. I emailed the verkeer department (a Mr. someone replied once) months ago and nothing happened.
- **discrimination** (via domain, 1 user):
  - r10: Ik kom al jaren naar die inspraakavonden over de Vogelbuurt, maar het heeft echt geen zin. Mevrouw iemand (participatie of zo) luistert alleen naar de mensen van de bewonersvereniging, allemaal hoogopgeleide types die mooi kunnen praten. Ik ben zelf van Marokkaanse afkomst en als ik wat zeg over de speeltuin of de troep in onze straat wordt het gewoon weggewuifd of ze gaat snel door naar de volgende. Mijn buurman iemand heeft het ook opgegeven.

## 📇 Contact-request track (PII-only "contact me" messages — handle per protocol)


## 🚫 Rejected (prompt-injection / exfiltration attempts — not feedback)

- x4: prompt-injection

## Dropped under threshold (non-sensitive)

- parking — 2 user(s), 3 msg(s)
- administration — 1 user(s), 2 msg(s)
- social — 1 user(s), 1 msg(s)
- waste management — 1 user(s), 2 msg(s)
- mobility — 1 user(s), 1 msg(s)
- community projects — 1 user(s), 1 msg(s)
- communication — 1 user(s), 1 msg(s)
- privacy — 1 user(s), 1 msg(s)
- finance — 1 user(s), 1 msg(s)
