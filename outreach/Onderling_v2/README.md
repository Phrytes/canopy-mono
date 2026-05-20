# Onderling_v2 — bron voor de publieke site

Dit is de **bron** voor de publieke site (gepubliceerd onder
`outreach/onderling-v2-publiek`). Platte HTML + `_chrome.css`, geen
build-stap. `layout-proposals/` bevat alternatieve lay-outs van dezelfde
pagina's, niet de live versie.

Pagina's: `index`, `hoe`, `waarom`, `thuis`, `buurt`, `maatschappij`,
`techniek`, `waarborgen`, `over`, `stand`. De `werk-*`-pagina's zijn de
varianten onder de Maatschappij-tak (meedenken / zorg / melden / onderzoek /
overheid / eigen-versie).

## Ideeën / geplande varianten

### Maatschappij-variant: gebruik van de apps terugkoppelen aan de maker

Idee: gegevens over hóe de apps gebruikt worden — voor zover die in de eigen
pod staan — kunnen doorzoekbaar worden voor de maker, **alleen als de
gebruiker daar per geval mee instemt**. Doel: leren wat werkt, zonder een
centrale verzamelplek.

Dit hoort uitdrukkelijk **bij de Maatschappij-tak**, niet bij het gewone
delen tussen mensen (Thuis). Voorwaarde, gelijk aan de andere
Maatschappij-varianten en aan wat op `hoe.html` staat beschreven:

- geanonimiseerd en geaggregeerd;
- via een onafhankelijke tussenpartij, niet rechtstreeks naar de maker;
- met de "jij geeft het vrij"-stap: je ziet eerst wat er zou meegaan;
- pas zichtbaar als meer mensen hetzelfde laten zien (k-anonimiteit);
- **nooit** als directe ontwikkelaar-toegang tot pod-gegevens — dat zou
  precies de belofte ondergraven waar de site op staat.

Status: nog geen pagina. Wordt het er een, dan staat hij naast de andere
`werk-*`-varianten onder `maatschappij.html`.

> Het technische ontwerp voor app/web/chat-eenwording (manifesten,
> deelkringen, modulariteit) staat los hiervan in
> `VOORSTEL-uniforme-representatie.md` in de repo-root; dit idee is daar
> bewust **buiten scope** gehouden.
