# Status

Oppdatert 2026-10-12 (fikserunde 2a, runde 2 integrert etter den andre gjennomgangen av fase 2a). Integratoren holder
denne fila oppdatert: gjort / neste / kjente problemer.

Faser:
- **Fase 1** – Forslag D vises riktig i plan og 3D med romskjema og arealer; lagring, versjoner, deling og publisering.
- **Fase 2a** – redigering: egne forslag, vegger, dører/vinduer, rom, bygningsdeler, nye bygg på terrassen, terrassen,
  badestampen; spøkelser for det som er flyttet/fjernet fra hytta i dag; PC og iPhone (`docs/phase2-plan.md`, rev. 3).
- **Fase 2b** – møbler, delte forslag for familien (Firestore), offline/PWA.

## Fikserunde 2a, runde 2 (12. okt 2026)

Den andre gjennomgangen (redigeringskjernen og brukervennlighet, PC og iPhone) bekreftet at funnene fra første runde
var rettet (dra-ytelsen delvis), og fant 3 store og 12 mindre feil som var igjen eller nye. De er rettet i tre
parallelle deler (redigeringskjernen, planen, UI) og satt sammen her; dra-ytelsen for vegger og kanter er fortsatt
bare delvis rettet (se «Ytelse»).

### Gjort

- **Glassutbygget (Leseskrok) følger status- og arealreglene** (stort funn). Det var den eneste delen av hytta i dag
  uten egen «i dag»-del, så en flyttet glassvegg ble stående som «Hytta i dag» og alt Leseskrok fikk, ble regnet som
  eksisterende areal.
  - Seeden (`SEED_REVISION` 5) gir glassutbygget delen `part-glass-old` «Glassutbygg i dag» over hele omrisset.
    Romskjema, arealer og farger for Forslag D er uendret (BYA 235,50, BRA 170,07, aksemål 170,16, 27 rom).
  - En eksisterende bygningsdel uten deler (en kopi lagret før revisjon 5) får omrisset sitt som del «Hytta i dag»
    første gang en endring flytter omrisset (`edit.ts todayPart`).
  - Når en åpen sammenføyning dekker en ny bit av en vegg fra hytta i dag, får biten et spøkelse (glassets østvegg
    +0,5 m åpner hovedhusets sørvegg x 9–9,5). «Ta tilbake» på det flytter den andre kanten tilbake.
  - Østveggen +0,5 m: den flyttede veggen er ny med spøkelse, BRA og aksemål for hytta i dag står (103,51 / 98,00).
    BYA i dag går 102,18 → 101,905, fordi de gamle kledningsstripene nå ligger inne i bygget (samme regel som for
    vestgavlen).
  - Et hjørne dratt ut og «Ta tilbake» på spøkelsene, i begge rekkefølger: ingen spøkelser igjen, seeden igjen (før:
    et løst «Fjernet»-spøkelse utenfor bygget som gjorde glasset bredere igjen uten spøkelse).
- **«Ta tilbake» etter at en vegg er flyttet** henter også naboveggen som flyttingen la like ved siden av linja
  (`w-105-diag` → `w-104-diag`, `w-103-korr` → `w-104-103`). Alle eksisterende vegger flyttet ±0,2 / ±0,5 m og tatt
  tilbake gir seeden igjen: 98 av 98 (før 82 av 86).
- **Dører og vinduer som en kortere kant klemte**, går tilbake på plass og blir «Hytta i dag» igjen når kanten flyttes
  tilbake for hånd (`door-green-e` ved nordkanten +0,5 / −0,5, `win-glass-e` / `-w`, `win-105-s`). En dør brukeren
  selv har flyttet langs veggen, blir stående.
- **Drag av dører og vinduer er raske**: åpningene er et eget, lite avledningstrinn (`derive.ts`), så et bilde i et
  dør-drag gjenbruker vegger, rom, tak og arealer: 0,9 ms i Node (før ca. 47 ms; se «Ytelse»).
- **«Roter 90°» holder kontakten**: en enhet med en kant mot en annen bygningsdel eller terrassekanten dreies om
  midten og skyves tilbake på den linja. En Vedskjul inntil fløyas nordvegg står inntil etter to drei, uten
  overlapp-advarsel, og står der den startet. En Vedskjul på terrassens nordkant blir stående på kanten.
- **Telefon: vegger, dører og spøkelser kan trykkes igjen** (stort funn). Treffbåndet er 0,25 m, men minst 10 px og
  høyst 24 px. Romnavnenes treffflater ligger nå under vegger, åpninger og spøkelser. Ved startzoom (11,6 px/m) velger
  et trykk ±4 px fra en vegg eller dør den (før ±1,4 px), og 23 av 24 romnavn velger rommet.
- **Snapping når hele ting flyttes** (stort funn), for enheter, bygningsdeler, terrassen og badestampen
  (`snapPolygon` / `snapFootprint` / `snapCircle`): et mål trekker høyst 0,25 m, aldri tilbake til egen startlinje,
  tar aldri tilbake mer enn halve draget og legger aldri til mer enn halvparten av det. Telefon: en Vedskjul dratt 2 m
  vest flytter seg 2 ± 0,25 m (før 4 m), 1 m nord ca. 1 m (før 0). PC: hele fløya 0,4 m øst flytter seg 0,4 m.
- **Punktsnapping ved endepunkt-drag**: ingen punkter ved startpunktet, høyst 0,25 m, aldri mer enn halve draget
  tilbake, og Alt slår punktene av. Det gjelder også hjørnene på bygningsdeler og terrassen og frie vegger. Enden av
  `w-vf-korr` dratt 0,36 m ved startzoom på PC flytter seg (før: ingenting).
- **Endehåndtak** på vegger og åpninger vises fra én håndtaksdiameter på skjermen (døra `door-mellom-vf` har dem ved
  startzoom på PC). Hjørne- og kanthåndtak vises fortsatt fra tre.
- **Velge en satt ut enhet igjen**: første trykk velger enheten (den kan dras og dreies med en gang), neste trykk
  rommet, så enheten igjen. På telefon har rommets mini-linje også «Roter 90°» og «Velg bygningsdelen».
- **Romnavn dekker ikke spøkelser**: med «Vis hva som er nytt» holder etikettene seg unna spøkelsene, og spøkelsene
  ligger over etikettenes treffflater. Et klikk midt på spøkelset av en slettet `w-104-103` velger spøkelset.
- **Advarselstoaster**: lukkes ved neste steg, og så snart advarselen er borte (veggen tegnet, rommet navngitt:
  toasten går). Det er bare én om gangen.
- **Advarsler sier hvor**: «Vinduet i ytterveggen mot øst i Soverom (ny fløy) sitter i en vegg som nå er dekket av
  «Vedskjul».»; taket «i enden mot øst»; «Trappa fra terrassen mot sør står der det nå er «Vedskjul»»; en løs vegg
  «Veggen i «Ny tverrfløy» …».
- **Telefon: toaster dekker ikke verktøylinja**: de står 8 px under verktøylinja og hjelpelinja, og følger med når
  siden rulles.
- **Ordbruk**:
  - «Herav hytta i dag»; i lesefeltene «Høyde over gulv» og «Trinn», som i redigererne.
  - «Dør/vindu» for en valgt dør eller et vindu, og «Slik bruker du planleggeren» i Hjelp.
  - «eget bygg» i verktøytipset for Nytt bygg, og førstegangskortet nevner ikke møbler.
  - Ingen «Klikk» igjen, heller ikke i kommentarer.
- **Planen tegner mindre under drag**: uendrede lag og elementer gjenbrukes mellom bildene (React, dev-bygg i jsdom):
  - et `w-gang-n`-drag går fra 16 til 7–8 ms per bilde, uten at konstruksjon, mål, ute, møbler, bygningsdeler og
    spøkelser tegnes på nytt;
  - et dør-drag går fra 3 til ca. 4,5 ms per bilde, som er kostnaden ved gjenbruken.
- **Tester**: `npm test` 1245 tester i 65 filer, alle grønne (1184 før runden). `npm run typecheck`, `npm run lint`,
  `npm run build` og `npx tsc --noEmit -p e2e/tsconfig.json` er rene. `npm run e2e` gir 31 av 31 grønne (22 før):
  - `editing.spec.ts` (PC) har fått disse testene:
    - (o) glassets østvegg 0,5 m: ny vegg med spøkelse, BRA og aksemål i dag uendret, BYA i dag 101,9;
    - (p) et glasshjørne dratt ut og «Ta tilbake» på hvert spøkelse: ingen igjen, seeden igjen;
    - (q) `w-105-diag` flyttet 0,2 m og tatt tilbake: seeden igjen, naboen også;
    - (r) endehåndtaket på `w-vf-korr` dratt 0,36 m ved startzoom;
    - (s) en Vedskjul inntil fløya dreid to ganger: fortsatt inntil, ingen overlapp;
    - (t) et klikk midt på spøkelset av `w-104-103` velger det.

    I tillegg sjekker (c) at advarselstoasten går når rommet får navn, (e) at døra har endehåndtak, og (n) at
    Vedskjulen blir stående på terrassekanten.
  - `phone-editing.spec.ts` (iPhone, startzoom) har fått:
    - trykk ±4 px ved tre vegger og en dør;
    - Vedskjul 2 m vest = 2 ± 0,25 m og 1 m nord ≈ 1 m;
    - første trykk gir enheten, andre rommet, og «Velg bygningsdelen»;
    - slette-toasten dekker verken verktøylinja eller hjelpelinja.
  - Nye skjermbilder: `plan-glass-bump.png` (glassets østvegg flyttet: ny vegg, gammel vegg stiplet) og
    `phone-toast.png` (toasten under verktøylinja). `phone-edit.png` er tatt på nytt.

### Ytelse (målt 12. okt på denne maskinen)

| Hva | Før runden | Nå |
|---|---|---|
| Avledning, bare en åpning endret (Node, 20 kjøringer) | ca. 40 ms | 0,2–0,9 ms (median 0,3) |
| Avledning, en vegg flyttet (`w-gang-n`) | – | ca. 41 ms (40–48) |
| Avledning, en blokk-kant flyttet (fløyas østkant) | 35–40 ms (fase 2a) | ca. 40 ms (39–42) |
| Avledning, badestampen flyttet | – | ca. 4 ms |
| Ett dra-bilde i Node, dør (`updateDrag` + avledningen ved tegning) | ca. 47 ms | 0,9 ms |
| Ett dra-bilde i Node, `w-gang-n` / fløyas østkant | 52 / 57 ms (gjennomgangen, annen last) | 46 ms (i praksis uendret) |
| Nettleser (dev-bygg, PC 1400 × 900, 30 musebevegelser), dør-drag | lange oppgaver ca. 95 ms | 16–18 ms per bilde, ingen lange oppgaver |
| Nettleser, badestamp-drag | 17 ms per bilde | 17 ms (p90 22) |
| Nettleser, `w-gang-n`-drag | lange oppgaver ca. 95 ms | lange oppgaver median 70 ms (p90-bilde 76 ms) |
| Nettleser, fløyas østkant | lange oppgaver ca. 95 ms | lange oppgaver median 63 ms (p90-bilde 65 ms) |

Ærlig sagt:
- Dører, vinduer, badestampen, terrassen og trær dras nå jevnt.
- Vegger og kanter avleder fortsatt hele byggetrinnet (vegger, rom, tak, arealer) én gang per bilde. Det gir ca. 13–15
  bilder i sekundet i dev-bygget på denne PC-en, og færre på en telefon.
- Det neste steget er å gjøre vegg- og romavledningen inkrementell (se «Kjente problemer»).

### Avgjort i runde 2 (Robin kan endre)

- **Glassutbygget har en egen «i dag»-del** (`SEED_REVISION` 5).
  - Eksisterende autolagringer får «Forslag D er oppdatert (revisjon 5)» med «Hent ny Forslag D».
  - Egne forslag lagret før dette beholder glassutbygget uten del. Det får delen fra omrisset første gang det endres.
  - Et glassutbygg som alt var gjort større før revisjon 5, beholder den økningen som «hytta i dag».
- **BYA i dag kan synke litt** når en gammel kant flyttes ut: kledningsstripa som havner inne i bygget, telles som ny
  (glassets østvegg +0,5: 102,18 → 101,905), som vedtatt for vestgavlen.
- **Treffbåndet ved berøring er minst 10 px, ikke 12.** Ved 11,6 px/m ligger hvert punkt i «Bod (ny)» innenfor 5,5 px
  av en vegglinje, så 12 px ville gitt bare 21 av 24 romnavn.
- **Snapping når ting flyttes** legger aldri til mer enn halve draget (`SNAP_ADD_FRACTION` 0,5). Skyggen fra Nytt bygg
  fester seg innen 0,25 m (Vedskjul satt ut 5 cm fra terrassekanten fester seg fortsatt).
- **En enhet som dreies inntil noe**, kan bli stående 5 cm utenfor 10 cm-rutenettet; frie enheter dreies på
  rutenettet som før.
- **Snapping (erstatter «Punkter … beholder 12 / 24 px» fra første runde)**:
  - Under et drag gjelder samme regler for punkter som for linjer: høyst 0,25 m, ikke ved startpunktet, aldri mer enn
    halve draget tilbake, og Alt slår dem av.
  - Ingen snapping (heller ikke hjelpelinjene) tar tilbake mer enn halve draget.
  - Uten drag (Vegg-, Mål- og plasseringsverktøyet) beholder punktene og hjelpelinjene 12 / 24 px.

## Fikserunde 2a (12. okt 2026)

Gjennomgangen av fase 2a (redigering og brukervennlighet, PC og iPhone) fant 10 store og 11 mindre feil. Alle er
rettet (dra-ytelsen delvis, se «Kjente problemer») i tre parallelle deler (redigeringskjernen, planen, UI) og satt
sammen her.

### Gjort

- **Rom under redigering** (`geometry/edit.ts`):
  - En usynlig romdeler dratt rett på et romanker byttet eller mistet rom uten melding (6 av 88 flytt). Et anker på
    (eller innen 1 cm av) kanten av en flate regnes nå som utenfor og flyttes til flatens etikettpunkt.
  - Å flytte hele fløya 3 m øst (eller 2 m på skrå) stokket romnavnene. `moveBlock` / `rotateBlock` gir nå rommene
    de bærer med seg til `reconcileRooms` (`EditContext.carried`), som flytter deres forrige omriss likt før
    matchingen: alle 27 rom beholder navnet.
- **Statusbokføring for blokk-kanter**: vinduer og dører i hytta i dag som følger med en flyttet kant eller klemmes
  av en kortere kant, blir nå «Nytt» og etterlater et spøkelse der de sto (vestgavlen til x −1: `win-104-w`,
  `win-hems-w1`, `win-hems-w2`). Biter en kant mister (også stumpene på bod-fløya ved nordkanten +1) får
  kant-spøkelser. Spøkelsene står i et stiplet «gammel vegg»-bånd med spøkelsesvinduer (`ensureGhostHost`). «Ta
  tilbake» på kant-spøkelset flytter kanten tilbake og setter åpningene på plass.
- **«Ta tilbake» etter et endepunkt-drag** drar først endene tilbake gjennom de samme kaskadene, så veggene som ble
  dratt med, trimmet eller forlenget kommer tilbake (før: `dv-kjk-w` dinglet og Vindfang ble slått sammen med
  Kjøkken). En åpning i hytta i dag som klemmes når en vegg flyttes, bokføres som en flyttet åpning.
- **Trær per forslag**: trærne lå på tomta, så et tre flyttet i «Mitt forslag» flyttet seg også i Forslag D. Nå får
  et forslag sin egen kopi (`Variant.trees`) første gang et tre endres; tomta og Forslag D endres aldri. Alle som
  leser trær går gjennom `treesOf(project, variant)`.
- **Areal**: stripa der en gammel yttervegg sto, er «ny» også i BRA (som i BYA). Vestgavlen til −1: BRA eks. blir
  stående på 103,51 (før 104,95), BYA eks. 101,47 som før. Nordkanten +1: BRA eks. 104,72 (før 106,62; den stiger
  litt fordi det høyere taket gir hemsen mer målbar høyde).
- **«Fjern hjørne»** som ville gjort at terrassen krysser seg selv, får toasten «Hjørnet kan ikke fjernes –
  terrassen ville krysse seg selv.» (før: ingenting skjedde).
- **«Roter 90°»** for nye bygg etter at de er satt ut (`rotateBlock`): i mini-linja, i Egenskaper for bygningsdelen
  og med R. Rommet, veggene, åpningene og taket dreies med; hytta i dag kan ikke dreies.
- **«Gi navn»** velger det nye rommet etterpå (før: «Det som var valgt finnes ikke lenger»).
- **Håndtak skjuler ikke små ting**: ende-, hjørne- og kanthåndtak vises ikke når tingen er kortere enn tre
  håndtak på skjermen (runde 2: endehåndtak fra én), endehåndtak på vegger og åpninger står utenfor endene, og et
  trykk inne i tingen flytter den.
  En dør dratt 1,5 m på telefonen beholder bredden; en ny Vedskjul dras etter kroppen.
- **Snapping slåss ikke med korte drag**: en vegg snapper aldri tilbake til sin egen linje (eller linjer på linje
  med den), linjer trekker høyst 0,25 m, en snap tar aldri tilbake mer enn halve draget, og Alt slår av
  linjesnapping. `w-gang-n` dratt 0,3 m ved startzoom havner på 3,7.
- **Trykk på telefonen velger rom**: treffbåndet rundt vegger og åpninger er min(24 px, 0,25 m) ved berøring, og
  romnavnet i planen er et treff for rommet: 23 av 24 rom ved startzoom (før 6). Unntaket er Korridor (øvre), der
  etikettpunktet ligger i trappa. (Runde 2: båndet ble bare ±1,4 px ved startzoom; nå minst 10 px, og romnavnene
  ligger under veggene.)
- **Forslag D**: et drag av det valgte viser låsetoasten én gang og verken panorerer eller flytter.
- **Dra-sløyfa**: pekerbevegelser samles til én oppdatering per skjermbilde; drag av åpninger og ting ute (terrasse,
  trapp, badestamp, trær) hopper over romavstemmingen og dens avledning. Rettelse (runde 2): et dør-drag ble likevel
  ikke raskere, fordi planen avledet hele byggetrinnet når den tegnet (ca. 47 ms per bilde); det er rettet i runde 2
  (0,9 ms).
- **Telefon**: Egenskaper-arket åpner lavt (40 % av høyden, bare de viktigste feltene; «Vis mer» gir resten), siden
  rulles så verktøylinja står øverst, og planen panorerer så det valgte står synlig over arket (`viewportInsets`).
  Mini-linja følger det valgte når siden rulles, legger seg under det når det ikke er plass over, og dekker aldri
  verktøylinja, hjelpelinja eller arket. Alle seks verktøy får plass på 390 px (ikon over navn).
- **Toaster**: én melding per handling («Slettet. «Soverom 1» og «Bad» er nå ett rom.») med én Angre, som bare
  angrer den handlingen og bare så lenge den er siste steg; neste endring lukker toasten. «Nytt forslag» har ingen
  Angre lenger og lukker førstegangskortet; toaster legger seg over kortet så lenge det er åpent.
- **Advarsler**: nye advarsler vises én gang som toast «Ny advarsel: …» med «Vis», og verktøylinja har et merke med
  antallet. Teksten sier hva og hvor («døra i veggen mellom Gang og Soverom (ny fløy)», retning etter virkelig nord),
  aldri en intern id. Dør/vindu som ville overlappe en åpning i samme veggbit flyttes til nærmeste ledige plass.
- **Ordbruk**: «Trykk» overalt, «Roter» som eneste verb for å dreie, «Angre» på telefon og «Angre eller Ctrl+Z» med
  tastatur, én kilde per tekst (hjelpelinje, tegnforklaring, låsetekst), spøkelser merkes «Fra hytta i dag»,
  Romskjema og overskrift sier «i dag», Møbler-hintet sier at biblioteket kommer i neste oppdatering. Hjelpelinja og
  førstegangskortet sier at Forslag D er det faste grunnlaget og at «+ Nytt forslag» lager en kopi.
- **3D** har sin egen bryter «Vis hva som er nytt i 3D», av som standard (naturlige farger); planen beholder «Vis hva
  som er nytt» på (`PREFS_VERSION` 4).
- **Tester**: `npm test` 1184 tester i 63 filer, alle grønne (1089 før runden); `npm run typecheck`, `npm run lint`,
  `npm run build` og `npx tsc --noEmit -p e2e/tsconfig.json` rene. `npm run e2e` 22 av 22 grønne:
  - `editing.spec.ts` (PC) har fått: (i) kort drag 0,3 m av `w-gang-n` → 3,7; (j) toastens Angre etter sletting av
    `w-104-103` angrer bare slettingen, og en ny endring tar bort knappen; (k) et tre flyttet i «Mitt forslag» –
    tomta og Forslag D er uendret; (l) vestgavlen til −1 – de tre vinduene blir nye med spøkelser; (m) hele fløya 3 m
    øst – alle rom beholder navnet; (n) Vedskjul rotert 90°. (g) sjekker toasten etter hvert forsøk for seg (dra det
    valgte: toast og ingen panorering), (c) at det nye rommet er valgt etter «Gi navn».
  - `phone-editing.spec.ts` (iPhone) ved startzoom: trykk på 8 romnavn velger rommet (minst 7), en dør dratt 1,5 m
    beholder bredden, en ny Vedskjul dratt etter kroppen beholder størrelsen, arket for en vegg lar veggen stå synlig
    over arket, alle seks verktøy synes.
  - Nye/oppdaterte skjermbilder: `plan-editing.png`, `plan-ghosts.png`, `phone-edit.png`, `phone-sheet.png` (lavt
    ark), `phone-tools.png` (ny); 3D-bildene er i naturlige farger.

### Avgjort i fikserunden (Robin kan endre)

- **Trær per forslag, kopi ved første endring** (`Variant.trees`, valgfritt felt, ingen skjemaendring): Forslag D og
  tomta endres aldri; et forslag uten egne trær viser tomtas.
- **3D i naturlige farger som standard**; «Vis hva som er nytt i 3D» er en egen bryter. Planen viser det nye som før.
- **BYA og BRA regner stripa der en gammel vegg sto som ny** (den gamle veggen er borte). En kant som flyttes inntil
  en eksisterende nabobygningsdel kan krympe den eksisterende delen (bod-fløya når hovedhusets nordkant går +1);
  bitene den mister får spøkelser.
- **Snapping**: linjer trekker høyst 0,25 m (uansett zoom), aldri tilbake til sin egen startlinje, og Alt slår av
  linjesnapping. (Punktene og hjelpelinjene ble skjerpet i runde 2, se «Avgjort i runde 2».)
- Dør/vindu som settes oppå en åpning i samme veggbit flyttes til nærmeste ledige plass (10 cm-rutenett); finnes
  ingen, blir den stående og overlapp-advarselen vises.
- Bygg satt ut med «Nytt bygg» kan roteres 90° om midten; hytta i dag kan ikke (samme regel som flytting).

## Fase 2a – redigering (integrert 12. okt 2026)

### Gjort

- **Skjema 2** (`src/model/types.ts`, `migrate.ts`): terrassen har hjørner med id-er, rekkverk langs alle frie kanter
  (det følger byggene automatisk, `noRailingEdges` slår det av per kant) og trapper som sitter på en kant som en åpning;
  `Outdoor.railings` er borte. `Variant.locked` (Forslag D), `Variant.ghosts`, `Block.template`, møbel-`size`. Migrering
  v1 → v2 er feltvis idempotent; en migrert fase-1-variant er ikke låst. Fase 1-seeden er fryst i
  `src/model/seed/frozen/forslagD.schema1.json`, så gamle `#d=`-lenker dekodes mot den (rekkverk og tre trapper beholdes).
  En autolagring fra fase 1 kopieres til `hytte-planlegger:project.backup-v1` rett før første lagring i skjema 2.
- **Seeden** (`SEED_REVISION` 4; 5 etter fikserunde 2a, runde 2): Forslag D er låst; terrassen er uendret (fra x 9, glassrekkverk 1,05 m, tre trapper),
  rekkverket går nå (9; −2,11) → … → (9,11; 12,1) – 11 cm kortere i hver ende enn før, fordi frie kanter stopper ved
  kledningen. Eksisterende autolagringer får «Forslag D er oppdatert (revisjon 4)» med «Hent ny Forslag D» (legges til
  som et nytt, låst forslag). BYA 235,50 (bygg 178,33 + terrasse 57,18, eks. 102,18), BRA 170,07, aksemål 170,16.
- **Avledning** delt i tre trinn (bygg / ute / møbler) memoisert på delsamlingene: en møbel- eller terrasseendring
  gjenbruker vegger, rom og gulv. Blokk-kant ca. 35–40 ms, møbel 0,01 ms. Terrassen trimmes av alle byggenes yttermål
  (hull der et bygg står på den), frie kanter → rekkverk, trapper som står der det nå er et bygg får advarselen
  «En trapp fra terrassen står der det nå er et bygg …» og ingen åpning i rekkverket. Spøkelser er med i planen, men
  ikke i romdeteksjon, arealer eller 3D. `levelAt` for nivået på et punkt.
- **Redigeringskjernen** (`src/geometry/edit.ts`, `snap.ts`, `src/state/editActions.ts`): alle handlingene i planen §3.6
  med dra-protokollen, låsen (Forslag D nekter alt med toast og «Nytt forslag»), statusbokføring (flyttet eller slettet
  del av hytta i dag blir «Nytt» og etterlater et «Fjernet»-spøkelse; tilbake på plass = eksisterende igjen; «Ta
  tilbake»), dra-regler for vegger, blokk-kanter/-hjørner, åpninger, terrasse, trapper, badestamp og trær, nye bygg
  (`placeUnit`: Vedskjul, Bod, Badstue, Anneks, Eget bygg), rom under redigering (`reconcileRooms`: slå sammen med toast,
  «Gi navn» for en ny flate), `resizeRoom` (Bredde/Dybde flytter veggen på den siden), én angre-handling per drag og per
  rekke med piltaster.
- **Planen** (`src/plan2d/`): trykk for å velge, dra det valgte for å flytte (5 px mus / 10 px berøring), alt annet
  panorerer; håndtak for hjørner, kanter, «+» på terrassekanter, veggender og åpningskanter; verktøyene Vegg, Dør/vindu,
  Nytt bygg (skygge som snapper), Møbler (plassholder), Mål; snapping med indikatorer og målbrikker; tegnforklaring
  «Hytta i dag / Nytt / Fjernet»; spøkelser stiplet med grå fyll og valgbare.
- **UI** (`src/ui/`): verktøylinje med Angre/Gjør om, hjelpelinje, Egenskaper øverst i høyre kolonne med redigerere for
  rom, vegg, åpning, bygningsdel, terrasse/kant/hjørne, trapp, badestamp, tre, møbel og spøkelse («Ta tilbake»); tallfelt
  («2,4», «2,40», «2.40», −/+ 10 cm, Enter/Tab/blur, Esc angrer feltet); toaster med Angre / «Nytt forslag»; «+ Nytt
  forslag», «Grunnlag»-merket, «Gi nytt navn», «Slett» (spør to ganger); førstegangskortet; telefon: verktøylinja
  ruller, mini-linje over det valgte (Egenskaper · Roter · Slett) og Egenskaper som ark nedenfra; ny ordbruk «Forslag»,
  «Hytta i dag / Nytt / Fjernet», «Vis hva som er nytt», «Send forslaget»; Hjelp med verktøy og hurtigtaster.
- **3D** (`src/view3d/`): klikk for å velge (yttervegg → bygningsdelens kant, vegg, åpning, rom, tak/fundament →
  bygningsdel, terrasse, rekkverk, trapp, badestamp, tre, møbel), markering med gjennomsiktig lag og blå kontur, 10 px
  toleranse for berøring; gruppene bygg / ute / møbler / tomt gjenbrukes når innholdet er likt; spøkelser og blokkerte
  trapper bygges ikke; mottak for møbler som slippes (kobles i 2b).
- **Integrasjon** (denne runden):
  - Tekstene fra `plan2d/editStrings.ts`, `state/editStrings.ts` og byggmalene ligger i `src/i18n/nb.ts`
    (`nb.plan2d.edit`, `nb.editor`, `nb.editor.units`, `copyName`); 3D-hjelpeteksten nevner «trykk for å velge».
  - Planen er standardvisningen på alle skjermer (også over 1600 px), og «Vis hva som er nytt» er på som standard
    (`PREFS_VERSION` 3: en lagret `highlightNew` fra fase 1 var bare den gamle standarden og leses ikke).
  - Rom under redigering: en vegg dratt forbi midten av rommet ved siden av (f.eks. `w-gang-n` fra 3,4 til 5,0) gjorde
    at det største rommet «tok» den voksende flaten og naborommet ble slått sammen bort («Gang» forsvant og «Soverom»
    havnet i gangen). Nå matches rommene mot flatene slik at flest mulig rom beholdes, deretter størst samlet overlapp
    (`matchRoomsToFaces`, eksakt per komponent); sammenslåing skjer bare når det er færre flater enn rom (en slettet vegg).
  - «+» på en terrassekant: å dra den setter inn hjørnet og drar det i ÉN angre-handling (kjernens `'insert'`-håndtak;
    før to).
  - Dør/vindu settes med midten på 10 cm-rutenettet langs veggen (1 cm med Alt), ikke på en tilfeldig desimal.
  - «Fjernet»-spøkelser er tydeligere: mørkere grå strek (#6f6f6f) og grå fyll (18 %), 2 px for flyttede ytterkanter.
  - Telefonarket har bare én lukkeknapp (redigererens × er skjult der).
  - `window.__hytte.selection` for Playwright; tidstesten for avledningen tåler parallelle testfiler (× 1,5 lokalt).
- **Tester**: `npm test` 1089 tester i 55 filer, alle grønne (782 før fase 2); `npm run typecheck`, `npm run lint`,
  `npm run build` og `npx tsc --noEmit -p e2e/tsconfig.json` rene. `npm run e2e` 11 av 11 grønne (prosjektene
  `chromium` 1400 × 900 og `iphone` = iPhone 13 med berøring i Chromium):
  - `smoke.spec.ts`: seeden (låst, terrassen fra x 9, trappene på kant v0 / v1 / v1, ingen blokkert), planen som
    standard, eldre revisjon → «Hent ny Forslag D» (låst), telefon 375 px;
  - `editing.spec.ts` (hvert scenario fra et ferskt «Nytt forslag»): (a) fløyas østvegg dratt 1 m – fløya følger,
    rommene vokser, ett angre-steg; (b) Vedskjul på terrassen ved nordkanten – terrassen mister flaten, rekkverket får
    en åpning, flyttet 1 m, festet til fløyas nordvegg (felles vegg); (c) ny vegg tvers over Soverom (ny fløy) – det
    største stykket beholder navnet, det andre får «Kontor» med «Gi navn»; (d) Dybde 2,40 → `w-gang-n` til y 3,58;
    (e)+(f) døra `door-mellom-vf` flyttet 0,5 m blir ny med spøkelse, veggen `w-104-103` slettet → Soverom 1 og Bad
    slås sammen, Angre og «Ta tilbake» setter alt tilbake; (g) Forslag D nekter verktøy, drag, Delete, tallfelt og
    piltaster med toasten, og «Nytt forslag» i toasten lager en kopi; (h) badestampen flyttes, terrassen viser håndtak;
  - `phone-editing.spec.ts` (iPhone): «Nytt forslag», panorering med én finger og zoom med to flytter ingenting, en ny
    vegg trykkes og dras, tykkelsen skrives inn i arket nedenfra, en dør settes med et trykk.
  - Nye skjermbilder: `plan-editing.png` (terrassen valgt med håndtak), `plan-unit-on-deck.png`, `plan-ghosts.png`,
    `phone-edit.png`, `phone-sheet.png`; de gamle er tatt på nytt (planen med verktøylinje, 3D med «Vis hva som er nytt»).

### Avgjort ved integrasjonen (Robin kan endre)

- Gammel vestgavl flyttet fra x 0 til −1: aksemålet for eksisterende blir 98,00 (nytt +6,20), men BYA eksisterende går
  fra 102,18 til 101,47, fordi kledningsstripa på 0,11 m langs den gamle gavlen nå ligger inne i det nye tilbygget og
  telles som nytt. Planen sa 102,18; tallet som vises er det fysisk riktige (den kledningen er borte).
- Når `dv-stue-n` dras, følger den delte enden av `dv-kjk-w` med (fri node), linja og den andre enden står. Planen sa
  «uendret», men det ville latt en stump stå igjen.
- En hel eksisterende bygningsdel kan ikke flyttes (samme regel og toast som for å slette den): hytta i dag endres
  gjennom veggene og kantene.
- Planen er standardvisning også på store skjermer; «Begge» huskes når brukeren velger den.

### Neste

1. Robin ser over skjermbildene og prøver redigeringen (lokalt med `npm run dev`, eller etter push på nettsiden).
   3D starter nå i naturlige farger med en egen bryter (se «Avgjort i fikserunden»). Seeden er revisjon 5, så en
   autolagring fra før får «Hent ny Forslag D» (se «Avgjort i runde 2»).
2. Kjøre fase 2b (`docs/workflows/phase2b-furniture-offline.workflow.js`): møbelkatalog (biblioteket er en plassholder
   nå; 3D-mottaket for slipp finnes), delte forslag i Firestore med Papirkurv og revisjoner, statuspillen, «Send
   forslaget» med familielenke, PWA/offline.
3. Pushe `main` for å publisere når 2b (eller 2a alene) er godkjent.

### Kjente problemer (fase 2a)

- Spøkelser for flyttede ytterkanter tegnes i alle etasjer (også på Hems).
- 3D: å velge et hjørne, en terrassekant/-hjørne eller et spøkelse markerer ingenting i 3D; ingen markering ved
  hover; et klikk på et dekke (slab) eller trappeåpning fjerner valget i stedet for å se gjennom; ingen dra i 3D.
- Å flytte `w-106-korr` eller `lw-106-top` (ved trapperepoet på hemsen) på tvers av seg selv river opp reposet: rommene
  slås sammen med toast, og Angre retter det (eneste unntak i robusthetstesten).
- Et bygg satt inntil gavlen på en større bygningsdel gir `roof-no-meet` på den (takregelen i `roof.ts`).
- Ingen advarsel når badestampen står utenfor terrassen.
- Når fløyas østvegg flyttes, blir de høye gavlvinduene (`win-gavl-s/n`) stående der de var mens mønet flytter seg:
  advarselen «stikker opp i taket». Flytt dem i Egenskaper eller i planen.
- En vegg langs en gulvsone-kant (f.eks. trinnet i korridoren) etterlater en smal flate med «Gi navn» når den flyttes
  (gulvtrinnet står der det står).
- En NY åpning som klemmes av flere separate endringer som krymper veggen, kommer ikke tilbake av seg selv når veggen
  blir lengre igjen (ett sammenhengende drag gjør det). Åpninger fra hytta i dag kommer tilbake til spøkelset sitt
  (runde 2), men nye åpninger har ikke noe spøkelse å gå tilbake til.
- Når glassutbygget gjøres mindre, vises biten av hovedhusets vegg som lukker åpningen som «Hytta i dag», selv om den
  er ny.
- Et eksisterende vindu på en vegg-bit som en åpen sammenføyning nå dekker, får ingen egen bokføring (bare
  `opening-on-removed-edge`-advarselen); vegg-biten får spøkelse.
- Tasten R på rommet i en satt ut enhet gjør ingenting (mini-linja og Egenskaper for bygningsdelen har «Roter 90°»).
- Telefon: topplinja med forslagsknappene bruker ca. 250 px før planen begynner (når Egenskaper-arket åpnes, rulles
  siden så verktøylinja står øverst).
- Telefon: et trykk på etikettpunktet til Korridor (øvre) treffer trappa (etikettpunktet ligger i trappa).
- Dra-ytelse for vegger og blokk-kanter: hvert bilde avleder hele byggetrinnet (ca. 40–48 ms i Node; lange
  oppgaver ca. 65–70 ms i dev-bygget på PC, ca. 13–15 bilder i sekundet, tregere på telefon). Et bilde der
  avstemmingen endrer rommene, avleder fortsatt to ganger. Neste steg: inkrementell vegg- og romavledning (bare den
  delen av vegg-grafen som endres), eller et lettere forhåndsbilde under draget og full avledning ved slipp. Dører,
  vinduer og ting ute er raske (se «Ytelse»).
- BRA eks. kan stige litt når en gammel kant flyttes ut, fordi det høyere taket gir hemsen mer målbar høyde
  (nordkanten +1: 103,51 → 104,72).
- Møbler: bare plassholdere (rektangel med navn, 1 × 1 × 1 m uten katalog); biblioteket er tomt (fase 2b).
- Førstegangskortet sier at alt deles med familien; det gjelder først når fase 2b (Firestore) er på plass.
- Midtknappen på musa virker som et trykk i plasseringsverktøyene.
- iPhone-testen kjører i Chromium med iPhone 13-emulering (WebKit er ikke installert); berøring sendes gjennom
  DevTools-protokollen.

## Fase 1 – gjort

- Prosjektoppsett: Vite 8, React 19, TypeScript 6 (strict, `verbatimModuleSyntax`, ingen enums), Vitest, Playwright, oxlint.
- `docs/architecture.md`: prinsipp («alt er data»), koordinatsystemer, konvensjoner, avledningspipeline, takregler,
  arealregler, kontrakter mellom modulene og test-id-er. Oppdatert ved integrasjonen der implementasjonen avviker
  (sol med suncalc v2, `computeAreas` med tilbakekall, `opts`-argumenter, regler for yttervegger på hemsen,
  takforlengelse klippet mot de andre blokkene, etiketter i 3D, testtall).
- Geometri (`src/geometry/`), alle rene og enhetstestet:
  - `polygon.ts` (74 tester), `planarGraph.ts` + `rooms.ts` + `areas.ts` (72), `roof.ts` + `geo.ts` + `terrain.ts` (74),
    `walls.ts` + `outdoor.ts` (72), robusthet (`robustness.test.ts` 9, `clipFailure.test.ts` 2).
  - `derive.ts` (ny ved integrasjonen, 13 tester): hele pipelinen – blokker, tak, vegger og åpninger, rom per etasje
    (vegg-graf + sonekanter, nivå fra sonen ved etikettpunktet, hems-flater utenfor `add`-sonen forkastes), rom-poster
    festet på anker, gulv (rom, terskler under dører/åpninger, dekke under hemsen med trappeåpning), uteområde,
    bæring, arealer, fundamenter, trær på terrenget, målkjeder per side + totalmål, grenser, vegg-unioner per etasje
    og status, advarsler. Memoisert på (variant, tomt, terreng).
- Forslag D-seeden (`src/model/seed/forslagD.ts`, 28 tester) og terrengfila; `forslagD.derive.test.ts` (17 tester) kjører
  seeden gjennom hele pipelinen: alle 27 rom funnet og navngitt, ingen advarsler, aksemål 170,16 m² (98,00 eks. +
  72,16 nytt), rommene innenfor 0,15 m² av IFC-arealene. `npm run schedule` skriver ut romskjemaet.
- Tilstand og UI (`src/state/`, `src/ui/`, `src/i18n/nb.ts`), 2D-plan (`src/plan2d/`), 3D-visning (`src/view3d/`).
- Rettet ved integrasjonen:
  - 3D-etiketter: drei `<Html>` lagde en React-rot per etikett og krasjet med React 19 («removeChild … not a child»
    når etikettene byttes). Erstattet med et eget DOM-lag over lerretet: projisering per bilde, skjult bak bygget
    (stråle mot bygningsgruppen) og når de ville overlappe en nærmere etikett.
  - 3D-vegger: to vinduer over hverandre (soverom + høyt gavlvindu i den nye fløyens gavler) – bare det første ble
    skåret ut. Nå skjæres alle åpningene i en vegg-skive.
  - Tak: hovedtakets forlengelse mot tverrfløya stakk ut under fløyens gavlutstikk som en torvkloss. Forlengelser
    klippes nå mot de andre blokkenes polygon (innenfor veggene), ikke mot takomrisset deres.
  - Yttervegger deltar nå bare i hems-etasjen der de går langs hems-sonen; før dinglet resten av hovedhusets vegger i
    hemsens vegg-graf, og planen for Hems tegnet dem som vegger.
  - Planen: tilpasses på nytt når ruten endrer størrelse (Begge → Plan) så lenge brukeren ikke har panorert/zoomet;
    romnavn tilpasses rommet (detaljer droppes, navnet brytes, ellers ingen etikett før man zoomer inn) og overlapper
    aldri hverandre.
  - 3D-kamera: forhåndsvisningene trekkes bakover i smale ruter (3D-halvdelen av «Begge»), så hele hytta er med.
  - Plan- og 3D-tekstene ligger nå i `i18n/nb.ts` (`nb.plan2d`, `nb.view3d`).
  - Rester fra Vite-malen (`src/assets/*`, `public/icons.svg`) er fjernet.
- Verktøy og drift: `playwright.config.ts` + `e2e/smoke.spec.ts`, `.github/workflows/ci.yml` og `deploy.yml`, `README.md`,
  `index.html`, favicon.
- Rettet etter gjennomgangen (runde 2, fem parallelle rettinger + integrasjon):
  - Geometri: polygon-clipping kalles bare fra `polygon.ts`, med koordinater snappet til 1e-7 m og nye forsøk på
    grovere rutenett; hver boolsk operasjon har en lokal reserve, så en feil gjør aldri hele modellen tom (testet med
    seeden rotert, flyttede og byttede hjørner, og polygon-clipping som alltid feiler). Ny advarsel
    `block-self-intersecting`. Takflater henger ikke lenger inne i rom: utstikk inne i andre blokker droppes og hver
    takflate kuttes eksakt langs dalene. Trappeåpningene skjæres ut av gulvene (nivåtrappa er et hakk i Korridor
    (øvre), med gulv på −1 under). Terrenget graves ut under hver blokk (`gw-<blokk>`), så det ikke lenger stikker
    opp gjennom badet nede. Blokker kan ha flatt himlingsnivå (`ceilingHeight`): den nye fløya har himling på 2,4.
    Dobbeltdører får to fløyer. Tetting av fjernede åpninger dekker ikke lenger åpninger som blir stående. BRA på
    hemsen regnes nå eksakt (12,54 m², før 11,22).
  - Seed (`SEED_REVISION` 2): gavlutstikk 0,51 (som i IFC), eksisterende skillevegger 2,5 m, veggen mellom stua og
    den nye fløya går helt opp under mønet (3,87), veggen korridor | vindfang går til x 9, de diagonale soveromsdørene
    på IFC-plassene, terrassedøra i stua har to fløyer, `OFL.txt` for Barlow ligger ved fontene.
  - Tilstand: autolagring kjenner igjen sin egen lagring (`id@updatedAt`), så angre, gjenoppretting og import blir
    lagret og tolkes ikke som en annen fane; transaksjoner nullstilles riktig; et prosjekt lagres ved oppstart, så
    versjoner lagret før første endring finnes etter omlasting. «Lag min egen kopi» legger den delte varianten TIL i
    eget prosjekt. Delingslenker er en differanse mot Forslag D: ca. 210 tegn for uendret Forslag D (før 11,8 kB).
  - UI: romskjemaet får plass (Rom · Bygningsdel · Status · Mål · Areal, bredere sidekolonne), overskriften viser
    bygg og terrasse hver for seg (bygg 178,3: eks. 102,2 · nytt 76,1), Egenskaper står over Arealer og åpnes ved
    klikk i romskjemaet, «Del lenke» og «Hjelp» er ikoner i tittelraden på telefon og resten ligger i «Mer»,
    verktøytips på knappene, Plan som standardvisning under 1600 px, språkretting.
  - Plan: romnavn med mål og areal fra 20 px/m (navn fra 8), tekstbredder fra Barlow-fontens egne mål, etikettene
    holdes inne i rommet og unna trapper, pipe og stolper; nøytrale gulvfarger; trappa vises også på hemsen; nordpila
    plasseres der den dekker minst; dobbeltdører tegnes med to fløyer.
  - 3D: etiketter prioriteres etter romareal, rommet kameraet står i mister aldri navnet sitt, og avkuttede etiketter
    vises ikke; ny vinkel «Langsiden (mot vannet)»; «Inne i stua» står nå i stua (øyehøyde 1,55) og løfter
    snitthøyden til minst 2,30 m; himlingen i den nye fløya vises (bare i Ute); terrenget følger utgravingene med et
    finere rutenett under huset; dobbeltdører med to fløyer.
  - Integrasjon: norske tekster for `block-self-intersecting` og for reserve-advarslene, 3D-terrenget bruker
    `terrainZAt(…, derived.groundWorks)`, standard snitthøyde 1,3 m (og 2,3 m når «Inne i stua» velges), røyktesten
    utvidet (se under).
- Rettet etter den nye gjennomgangen (runde 3):
  - Hemsplanen: da de eksisterende skilleveggene ble 2,5 m høye, kom to korridorvegger (`w-vf-korr` og `w-korr-stue`)
    med i hemsetasjen (2,47 < 2,50) og ble tegnet som tykke snittvegger ut i det åpne rommet over korridoren og
    kjøkkenet. Nå blir en lagret vegg med i en høyere etasje bare når toppen når minst etasjens høyde + 1,0 + 0,3 m
    OG midtpunktet ligger på et gulv i den etasjen (for hemsen: i `add`-sonen; vegger langs sonekanten teller).
    Veggene som går til taket langs hemsen (`w-106-korr`, `w-103-102`, `w-106-stue`) er fortsatt med. Yttervegger
    som før. `plan-hems.png` viser ikke lenger korridorveggene.
  - Snitthøyden etter «Inne i stua»: forhåndsvisningen husker snitthøyden den løftet fra (`cutHeightBeforePreset`) og
    setter den tilbake når en annen visning velges (1,3 → 2,3 → 1,3), med mindre brukeren har flyttet glidebryteren
    imellom (da blir den stående). Den løftede verdien lagres ikke som brukerens valg. (Glidebryteren er senere
    fjernet, se runde 4.)
  - 3D-etiketter for bygningsdeler: skjules når bygningsdelen ikke synes (stråler mot tre punkt like over mønet
    treffer en annen bygningsdel først), og står over den synlige delen når bare noe av den synes. Nærmeste
    bygningsdel vinner (areal delt på avstanden i tredje), og en etikett som ville overlappe prøver ±8 / ±16 px
    til siden, så én eller to etiketthøyder opp, så under ankeret før den skjules. Fra «Framsiden»: «Ny tverrfløy»
    har navnet sitt, «Hytta, hoveddel» står over den, «Glassutbygg» (bak fløya) vises ikke, og «Bod-fløy» står over
    den nordre enden av bod-fløya, som synes til høyre for fløya. Den fastlåste rometiketten (rommet kameraet står i)
    står nå nede til høyre (12 px inn) og holder seg unna hjelpeteksten «Dra for å snu …» nede til venstre.
  - Lagring: når nettleserlagring er blokkert, kommer det ikke lenger et ekstra banner «Endringene kunne ikke
    lagres … (lite plass?)» ved første endring; banneret om at lagring ikke er tilgjengelig er nok.
- Etter Robins gjennomgang av fase 1 (runde 4):
  - Terrassen kuttet (`SEED_REVISION` 3): terrassen går ikke lenger foran glassutbygget (leseskroken, x 5–9), men
    starter ved glassutbyggets østvegg (x = 9). Stripa x 5–9 × y −4,6..−2 (4 × 2,6 m) er borte; rekkverket starter i
    (9; −2), og stykket langs glassutbyggets østvegg (y 0 til −2) er vegg, ikke rekkverk. Trappa ned fra sørkanten er
    flyttet fra x 7–8,4 til x 11,6–13,0, rett øst for terrassedøra i stua (x 9,7–11,3); åpningene i rekkverket er
    [5,2; 6,6], [23,5; 24,9] og [29,8; 31,2] langs stien. Badestampen står der den sto (21,7; −3,2). Terrassens BYA
    går fra 67,14 til 57,18 m² (−9,96: stripa minus kledningsstripa på 0,11 m sør for glassutbygget, som alt var
    regnet som bygg). Eksisterende autolagringer får «Forslag D er oppdatert (revisjon 3)» med «Hent ny Forslag D».
  - Glidebryteren «Snitthøyde (over gulvet)» er fjernet (Robin syntes den var forvirrende). Inne kutter veggene
    1,3 m over gulvet i hver etasje og 2,3 m med «Inne i stua» (`cutHeightFor(preset)` i `state/store.ts`); snitthøyden
    er ikke lenger en del av UI-tilstanden og lagres ikke (`cutHeightBeforePreset` og `presetUi` er borte, en lagret
    `cutHeight` fra før ignoreres og fjernes ved neste lagring). Tekstene for glidebryteren er fjernet, og
    hjelpeteksten og verktøytipsene nevner ikke lenger snitthøyden.
  - Robins avgjørelser er ført inn (se «Avgjort av Robin»).
  - Røyktesten sjekker nå at en ny start får gjeldende `SEED_REVISION` (terrassen fra x 9 og de tre trappeåpningene),
    og at en autolagring med eldre revisjon får banneret og at «Hent ny Forslag D» legger den nye seeden til som
    aktiv variant ved siden av brukerens egen.
- Testtall: `npm test` 782 tester i 37 filer, alle grønne; `npm run typecheck`, `npm run lint` og `npm run build` rene;
  `npm run e2e` 3 av 3 grønne (sjekker også at romskjemaet får plass, ≥ 15 romnavn med m² i planen, at en eldre
  autolagring får «Hent ny Forslag D» og at «Del lenke» / «Hjelp» er synlige på telefon). Skjermbilder i
  `e2e/screenshots/`: `plan.png`, `plan-hems.png`, `3d-ute-oversikt.png`, `3d-ute-framsiden.png`,
  `3d-ute-langsiden.png`, `3d-ute-inne-stua.png` (Ute + «Inne i stua»: taket sett innenfra), `3d-inne-stua.png`,
  `phone.png`.

### Romskjema Forslag D (avledet) mot IFC

| Rom | Nivå | Mål (m) | Areal (m²) | IFC (m²) | Avvik |
|---|---|---|---|---|---|
| Bad | Underetasje | 1,88 × 1,74 | 3,27 | 3,27 | 0,00 |
| Korridor (nedre) | Underetasje | ca. 1,97 × 1,94 | 3,08 | – | |
| Soverom 1 | Underetasje | ca. 2,83 × 2,88 | 7,73 | 7,69 | +0,04 |
| Soverom 2 | Underetasje | ca. 2,88 × 2,88 | 7,93 | 7,92 | +0,01 |
| Soverom 3 | Underetasje | 1,88 × 1,96 | 3,68 | 3,68 | 0,00 |
| Badstue | Hovedplan | 2,38 × 1,78 | 4,24 | – | |
| Bod | Hovedplan | 1,28 × 2,18 | 2,80 | 2,79 | +0,01 |
| Bod (ny) | Hovedplan | 3,68 × 0,83 | 3,05 | – | |
| Do | Hovedplan | 0,98 × 2,18 | 2,14 | 2,16 | −0,02 |
| Gang | Hovedplan | 4,58 × 1,08 | 4,95 | – | |
| Hovedbad | Hovedplan | 1,98 × 3,98 | 7,88 | – | |
| Kjøkken | Hovedplan | ca. 3,59 × 3,84 | 12,55 | – | |
| Korridor (øvre) | Hovedplan | ca. 4,70 × 1,94 | 7,20 | – | |
| Leseskrok | Hovedplan | 3,68 × 1,84 | 6,77 | – | |
| Mellombygg | Hovedplan | 3,68 × 1,17 | 4,32 | 4,46 | −0,14 |
| Pantry | Hovedplan | 1,28 × 2,08 | 2,66 | – | |
| Passasje | Hovedplan | 3,94 × 1,20 | 4,73 | – | |
| Soverom (ny fløy) | Hovedplan | 4,58 × 2,58 | 11,82 | – | |
| Spiseplass | Hovedplan | 3,94 × 2,64 | 10,40 | – | |
| Stue | Hovedplan | ca. 10,78 × 3,04 | 24,10 (16,06 eks. + 8,04 nytt) | – | |
| Teknisk / vask | Hovedplan | 1,18 × 2,18 | 2,58 | 2,55 | +0,03 |
| Ved | Hovedplan | 3,68 × 0,78 | 2,87 | – | |
| Vindfang | Hovedplan | 3,18 × 1,74 | 5,53 | 5,53 | 0,00 |
| WC | Hovedplan | 1,08 × 2,08 | 2,25 | – | |
| Hems 1 (soverom) | Hems | ca. 4,88 × 2,88 | 11,80 | 11,8 | 0,00 |
| Hems 2 (soverom) | Hems | ca. 4,83 × 2,88 | 12,49 | 12,5 | −0,01 |
| Trapperepos | Hems | 1,14 × 0,80 | 0,91 | – | |

Arealer: BYA 235,50 m² (bygg 178,33 + terrasse 57,18; eks. 102,18 / nytt 133,32, av det bygg eks. 102,18 / nytt 76,15).
BRA 170,07 m² (underetasje 27,33, hovedplan 130,21, hems 12,54 målbart av 26,34 brutto; eks. 103,51 / nytt 66,56).
Aksemål 170,16 m² (98,00 + 72,16). Korridor nedre + øvre = 10,28 m² mot IFC-rommet 101 Korridor 10,1 m².

## Fase 1 – åpne punkter

1. Vurdere å kjøre røyktesten i CI (`npx playwright install --with-deps chromium`) og legge `npm run lint` inn i `ci.yml`.
2. Geometri: gi reserve-advarslene en egen `ModelWarning`-type i stedet for `'generic'` med «geometry fallback:», og
   legge eks./nytt-delingen av bygg og terrasse inn i `AreaSummary` (UI-en regner den ut selv i `ui/areaFigures.ts`).
3. Husk: enhver endring av innholdet i Forslag D må øke `SEED_REVISION`, ellers dekodes gamle delingslenker mot en endret
   seed (revisjon 4 er skjema 2, revisjon 5 glassutbyggets «i dag»-del; møblene i fase 2b blir revisjon 6).

## Avgjort av Robin

Robin svarte «resten ser bra ut» på rapporten etter fase 1 (2026-10-11). Avgjort:

- Terrassen går ikke foran glassutbygget; trappa ned fra sørkanten står rett øst for terrassedøra i stua (runde 4).
- Snitthøyden er ikke en innstilling: Inne kutter veggene på 1,3 m (2,3 m i «Inne i stua»).
- «Framsiden» beholder den gamle modellens østvisning: den nye fløyas langside mot øst med den hvite glassdøra
  (akse 4), ikke en gavl. «Langsiden (mot vannet)» viser fasaden mot vannet.
- Den frie stolpen på (11,9; 3,1) i den gamle østgavlen blir stående (midt i stua).
- De eksisterende skilleveggene på hovedplanet er 2,5 m høye (toppen av hanebjelkene, som i IFC).
- Den nye fløya beholder himlingen på 2,4 m med kaldloft over; de høye gavlvinduene (`win-gavl-s/n`, brystning 2,75)
  sitter over himlingen og lyser opp kaldloftet.
- Avviket i veggtykkelsene i mellombygget godtas (se under).
- Badstudøra åpner ut mot badet (`d-badstue` med `side: 'right'`, 11. okt kveld).
- Fase 2 (11. okt kveld, `docs/phase2-plan.md` revisjon 3): hytta i dag kan redigeres i alle forslag, bare Forslag D er
  låst; flyttet eller fjernet del av hytta i dag vises stiplet som «Fjernet» (ingen «rives»); nye bygg kan stå fritt
  eller inntil andre, endres og slettes; alt nytt kan flyttes (badestampen også); forslagene deles i familien (2b);
  pappa bruker iPhone; delt nivå bekreftet; vanlig BYA/BRA.

## Kjente problemer (fase 1)

- **Mellombygg −0,14 m² mot IFC**: veggene der er i virkeligheten 0,11 m (uisolert) og bod-fløyas 0,16 m; seeden
  bruker felles oppbygging 0,27 / 0,11 på bod-fløyas blokk-kanter, så rommet blir ca. 5 cm for smått per side.
  Akseptert avvik (godtatt av Robin, se `docs/kalibrering-ifc.md`), innenfor testens grense på 0,15 m².
- Takflatene er rektangulære over blokkens omriss: i en rotert eller skjev tegning blir arealet av hemsrommene ca.
  0,1 m² annerledes enn i den rette (robusthetstesten utelater derfor hemsrommene).
- Når en polygonberegning feiler, brukes en enklere geometri og det vises en advarsel («En del av geometrien er
  forenklet …»); advarselen bruker foreløpig den generelle typen `'generic'`.
- Veggtopper er flate over tykkelsen: innenfra med tak på er det en stripe på ca. 8 cm under taket ved innsiden av
  langveggene.
- Innervegger som vender bort fra sola er bare lyst av himmellyset og ser grå-beige ut (som i den gamle modellen); se
  `3d-inne-stua.png`.
- Små rom får ingen etikett i planen ved standard zoom: på 1400 × 900 (Plan) mangler Soverom 3, Korridor (nedre) og
  Teknisk / vask (og Trapperepos på hemsen) – de dukker opp når man zoomer inn. I «Begge» på 1400 px er planen ca.
  11 px/m, så der vises bare navn som får plass med liten skrift (standardvisningen er Plan).
  3D-rometiketter som ville overlappe en viktigere etikett skjules; etiketter for bygningsdeler flyttes litt først.
- Skjermbildene fra røyktesten (SwiftShader) har en kort grå strek øverst til venstre over målkjeden i planen; den finnes
  ikke i SVG-en og vises ikke uten SwiftShader (rasteriseringsfeil i den programvarebaserte GPU-en).
- Konflikt med en annen fane: denne fanen slutter å lagre til brukeren velger «Hent endringene» eller «Behold mine
  endringer»; lukkes fanen uten valg, mistes endringene som bare var i den.
- UI-innstillinger lagret før runde 2 beholder alt unntatt visningen (den ble lagret selv om brukeren aldri valgte
  den); en lagret snitthøyde fra den fjernede glidebryteren ignoreres og fjernes ved neste lagring. «Lag min egen
  kopi» lagrer ikke lenger en sikkerhetsversjon (ingenting blir erstattet); tomta i eget prosjekt beholdes, tomta fra
  lenken slås ikke sammen.
- Uten terrengdata ligger den flate bakken 2 cm under blokkenes laveste grunnhøyde, som nå er ca. −1,1 under hele
  hytta (utgravingen under hovedhuset); det gjelder bare hvis terrengfila mangler.
- Planar graf: et snappet vegg-endepunkt flyttes inntil 5 cm uten ny kryssingssjekk; sammenslåing av noder innen
  1 cm er rekkefølgeavhengig.
- Vegger (`walls.ts`): en åpning som strekker seg over to veggbiter festes bare til biten med midtpunktet; hull i
  klippede deler/soner droppes (bare ytre ring).
- Tak: ingen valmtak; L-formede blokker må deles i to blokker. Et klokkeslett som hoppes over ved sommertid flyttes én
  time fram.
- Ingen arealbegrenser i fase 1 (`areaLimit = null`); advarselen `area-limit` virker hvis en grense settes.
- React Three Fiber logger en advarsel om at `THREE.Clock` er foreldet (fra biblioteket, ikke fra appen).
- `tsc -b` typesjekker bare `src/` og `vite.config.ts`. `e2e/` og `playwright.config.ts` sjekkes med
  `npx tsc --noEmit -p e2e/tsconfig.json`.
- Playwright: Chromium må installeres manuelt første gang. 3D rendres med SwiftShader i headless-modus – tregt, men likt
  på alle maskiner; derfor rause tidsfrister i `playwright.config.ts`.
- GitHub Actions-versjonene (`checkout@v4`, `setup-node@v4`, `configure-pages@v5`, `upload-pages-artifact@v3`,
  `deploy-pages@v4`) bør bumpes når GitHub varsler om utfasing.
