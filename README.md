# Hytteplanlegger – Merkesvatnet

Nettbasert 2D/3D-planlegger for utvidelsen av hytta ved Merkesvatnet (Hadsel, Vesterålen). Familien bruker den
til å utvikle «Forslag D»: se planen og huset i 3D (ute og inne, med sol for valgt dato og klokkeslett), følge med på
romskjema og arealer (BYA, BRA), og lage egne forslag der de flytter vegger, dører, vinduer og bygningsdeler, tegner
nye vegger, setter nye bygg (vedskjul, bod, badstue, anneks) på terrassen og møblerer rommene. Planen kan skrives ut
som PDF i målestokk, 3D-bildet lagres som PNG, du kan gå rundt i huset i øyehøyde, se hvor avløpene står i forhold til
avløpsstammen, og legge arkitektens IFC-modell av hytta i dag over planen og 3D.

Appen kjører i nettleseren og virker uten nett (PWA, kan legges på Hjem-skjermen). Forslagene ligger i familiens delte
plass (Firebase Firestore), så alle med familielenken ser og endrer de samme forslagene på PC og telefon; uten oppsett
lagres de bare i nettleseren. Hvert forslag er ett JSON-dokument.

## Slik henger det sammen

- **Alt er data.** Ett `Project`-dokument (`src/model/types.ts`) beskriver tomt, varianter, bygningskropper (blokker),
  vegger, åpninger, rom, uteområde og bæring.
- **Alt på skjermen avledes.** `deriveVariant` (`src/geometry/derive.ts`) lager en `DerivedVariant`
  (`src/model/derived.ts`) av dokumentet: yttervegger fra blokk-kantene, tak med automatisk møneforlengelse, rom
  funnet som flater i vegg-grafen, gulv, terrasser, arealer og advarsler. Plan, 3D og romskjema leser bare den
  avledede modellen.
- **Endringer går gjennom butikken.** Hver redigering er en handling i zustand-storen; angre/gjør om er historikk
  over JSON-en; lagring og deling er å lagre JSON-en.

Detaljene (koordinatsystemer, konvensjoner, pipeline, kontrakter mellom modulene) står i
[docs/architecture.md](docs/architecture.md). Les den før du endrer noe. Planen for fase 2 er
[docs/phase2-plan.md](docs/phase2-plan.md).

## Slik redigerer du (fase 2a og 2b)

- **Forslag D er grunnlaget og kan ikke endres.** Trykk «+ Nytt forslag» (eller «Nytt forslag» i hjelpelinja) for å få
  en kopi du kan endre. Alt i kopien kan endres, også hytta slik den er i dag.
- **Trykk for å velge, dra det valgte for å flytte.** En vegg, en dør, et hjørne eller et helt nytt bygg flyttes ved å
  trykke på det og så dra det. Første trykk på et nytt bygg med ett rom (et vedskjul) velger bygget, neste trykk
  rommet i det; på samme måte gir et nytt trykk på et valgt møbel rommet under det (og omvendt). Et teppe velges på
  kanten (midt på teppet velger du rommet). Å dra på noe annet flytter planen; hjulet eller to fingre zoomer.
  Håndtakene (hvite sirkler) flytter hjørner og kanter; «+» på en terrassekant lager et nytt hjørne.
- **Verktøylinja:** Velg · Vegg (trykk der veggen begynner og der den slutter) · Dør/vindu (velg type, trykk på en
  vegg) · Nytt bygg (velg Vedskjul, Bod, Badstue, Anneks eller Eget bygg, «Roter», trykk der det skal stå – det fester
  seg til terrassekanten og veggene; et vedskjul som settes med den åpne fronten mot et annet bygg, snus, og et
  vedskjul med ryggen mot et bygg får pulttaket høyt mot veggen; et bygg som står kan roteres med «Roter 90°»; settes,
  flyttes eller forstørres det over møbler på terrassen, skyves de ut. Et nytt bygg kan ikke stå oppå et annet: trykker
  du like utenfor en vegg, legges det inntil den; står skyggen oppå huset, sier hjelpelinja «Bygget kan ikke stå oppå
  et annet bygg» og trykket nektes; dras, flyttes eller forstørres det mot huset, stopper det ved veggen) · Møbler · Mål
  (trykk på to punkter) · Angre / Gjør om. Angre i en toast angrer bare den handlingen toasten gjelder; «+ Nytt
  forslag» er ikke noe angresteg, og når du lager eller bytter forslag, begynner Angre på nytt (det angrer bare
  endringer i forslaget på skjermen). På telefon står menyen ved det valgte (Egenskaper · Slett) bare med Velg.
- **Møbler** åpner møbelbiblioteket (venstre kolonne, på telefon et ark nedenfra): søk eller bla i kategoriene, trykk
  på et møbel for å sette det i det valgte rommet (ellers i rommet midt i planen slik du så den før biblioteket åpnet;
  er det fullt, i et rom ved siden av – da sier en melding hvor det havnet; et valgt nytt bygg brukes bare når det står
  nær midten av planen, så et vedskjul du nettopp satt, ikke får sengene), mot nærmeste ledige vegg – eller dra det inn i planen eller 3D-visningen (på
  telefon: hold fingeren på det først). Det valgte møbelet har et rotasjonshåndtak på en ledig side (står møbelet inntil vegger eller
  andre møbler på alle sider, vises det ikke – bruk «Roter 90°»; trykk: 90°, dra: 15°-trinn; på telefon først når du har zoomet inn, ellers «Roter» i menyen ved møbelet), viser plassbehovet foran
  seg, og Egenskaper har Størrelse, Bredde/Dybde (der møbelet kan strekkes), Farge, «Roter 90°», «Dupliser» (kopien
  havner på nærmeste ledige plass ved siden av; i et fullt rom i et rom en dør eller åpning fører til, høyst 3 m unna,
  og appen sier hvilket – «Kopien står i «Vindfang».»; er det ikke plass noe sted, sier appen fra) og «Slett». Møbler som
  står i en vegg, oppå hverandre eller i slaget til en dør blir røde og gir en advarsel; en stol kan skyves et stykke inn
  under et bord; toalett og dusj vil stå i et våtrom. «Plassbehov for møbler» under Vis viser plassbehovet for alle.
  Møbler mot en vegg som flyttes, følger med veggen; et nytt bygg tar bare med seg sine egne vegger, rom og møbler,
  aldri noe av huset.
- **Egenskaper** (øverst til høyre, på telefon som et ark nedenfra) viser målene og lar deg skrive dem inn: «2,4»,
  «2,40» og «2.40» virker, −/+ endrer 10 cm. Dybde og bredde på et rom flytter veggen på den siden.
- **Vis hva som er nytt** (på som standard i planen): nye deler er oransje, og det som er flyttet eller fjernet fra
  hytta i dag vises stiplet («Fjernet»). Velg det stiplede og trykk «Ta tilbake» for å sette det tilbake (en vegg du
  selv har flyttet for seg, blir stående – også når den ble flyttet med av en annen vegg; kommer et rom tilbake, sier en
  melding det). Stopper en vegg under et drag, sier hjelpelinja det. 3D viser
  naturlige farger; «Vis hva som er nytt i 3D» farger det nye der også.
- Trærne og møblene hører til forslaget: å flytte et tre eller et møbel i et forslag endrer ikke Forslag D.
- Hurtigtaster: Delete, piltastene (1 cm, med Shift 10 cm), R, Ctrl+D, Ctrl+Z / Ctrl+Y og Esc.

## Skriv ut, gå rundt, avløp og IFC (fase 3)

- **Skriv ut planen**: «Eksporter» øverst → «Eksporter plan som PDF …». Velg A3 eller A4, 1:50 eller 1:100, Plan 1,
  Hems eller begge, om romnavn og arealer, mål og møbler skal være med, og farger («Vis hva som er nytt») eller
  svart-hvitt. Dialogen sier hvor mange sider det blir. Trykk «Lag PDF»: på PC lastes fila ned
  (`hytta-<forslag>-<dato>.pdf`), på telefonen kan du dele den (e-post, meldinger, Filer) eller laste den ned. Skriv ut
  i **faktisk størrelse (100 %)**, ikke «tilpass til siden», så stemmer målestokken (1 m = 2 cm i 1:50). Er planen for
  stor for arket, deles den på flere ark med 1 cm overlapp. Siste side har romskjemaet og arealene — fint å gi til en
  håndverker eller arkitekt.
- **Bilde av 3D**: «Eksporter» → «Lagre 3D-bildet som PNG» lagrer det du ser i 3D akkurat nå, med forslagets navn og
  dato nederst. På telefonen åpnes delingsmenyen.
- **Gå rundt**: i 3D, trykk «Gå rundt» (under kameravinklene, eller knappen oppe til høyre i bildet). Du står i stua i
  øyehøyde (1,65 m) — eller der du sist trykket på et gulv i 3D, eller i rommet du har valgt i planen. På PC: gå med
  W A S D (eller piltastene), se deg rundt med musa, hold Shift for å løpe, Esc avslutter. På telefonen: gå med spaken
  nede til venstre, dra i bildet for å se deg rundt, «Avslutt» oppe til høyre. Du går gjennom dører og åpninger og opp
  og ned trapper, men ikke gjennom vegger og vinduer (møblene stopper deg ikke).
- **Sol og skygge**: trykk «Midtsommer», «Jevndøgn», «Midtvinter» eller «I dag», og dra i klokkeslettet. Den gule
  stripa viser når sola er oppe den dagen ved hytta. Slå av «Skygger» hvis 3D går tregt på telefonen.
- **Avløp og sluk**: slå på «Avløp og sluk» under Vis (med planen). Du ser et forslag til avløpsstamme og stiplede
  ledninger med avstand fra toaletter, dusjer, servanter og vaskemaskiner. Under bryteren står hva som er fint (i
  Forslag D: «WC og Hovedbad: toalettene står rygg mot rygg på veggen ved x 18,6 – det er fint.»). Flytter du et
  toalett langt unna, blir det rødt og kommer under Advarsler med avstanden. I ditt eget forslag kan du dra stammen
  langs veggene, trykke på den for å slette den, eller trykke «Legg til avløpsstamme».
- **IFC-modell**: åpne panelet «IFC-modell» (under Vis) og trykk «Last inn IFC-fil», og velg arkitektens IFC-fil. Den legges blått over planen og halvgjennomsiktig i 3D, så du kan se at
  hytta i dag stemmer. Du kan skru den av og på i plan og 3D, endre synligheten og flytte den 1 cm om gangen. Fila
  blir på enheten din: den lastes ikke opp og deles ikke med familien. «Fjern» tar den bort igjen.

## Delte forslag og offline (fase 2b)

- **Familielenken** `…/hytte-planlegger/#f=<familie-id>` er lenken dere sender hverandre: alle som åpner den, ser de
  samme forslagene. «Send forslaget» sender en lenke rett til forslaget som er åpent (`#f=…&p=…`). Oppsettet av
  Firebase står i [docs/firebase-oppsett.md](docs/firebase-oppsett.md) (gjort; reglene i `firestore.rules` er publisert).
- **Forslag-menyen** (øverst) viser Forslag D først og så familiens forslag med «sist endret av …». «+ Nytt forslag»
  lager en kopi av forslaget på skjermen. I den delte plassen spør appen én gang «Hva heter du?» — i samme vindu som
  navnet på det nye forslaget, eller i en stripe øverst når du har gjort en pause.
- **Lagring er automatisk.** Statusen øverst sier «Lagret for alle», «Lagrer …», «Lagret her – sendes når du er på
  nett» (uten nett, også etter at appen er lastet på nytt) eller «Kun på denne enheten …» (uten delt plass). Endrer to
  samme forslag samtidig, får den ene valget «Hent endringene» / «Lagre over» (utgaven som ikke vinner, legges under
  Tidligere versjoner), og statusen sier «Ikke lagret – velg Hent endringene eller Lagre over» til du har valgt.
  Endringene lagres også med en gang når appen legges bort (en annen app, Hjem-skjermen, låseknappen).
- **Slett** spør to ganger; forslaget ligger 30 dager i **Papirkurv** (under Mer og i Forslag-menyen) og kan hentes
  tilbake. En sletting gjort uten nett tar aldri med seg endringer andre har gjort i mellomtiden: den som endret,
  får beskjed og kan trykke «Hent tilbake». En lenke til en annen delt plass enn den enheten
  bruker, bytter aldri av seg selv: appen sier hva de to plassene har og spør («Bytt dit» / «Bli her»). En lenke til
  ett forslag i en annen plass gir «Hent «…» som en kopi hit», «Bytt dit» eller «Bli her». Bytter enheten plass i en
  annen fane, sier de andre fanene fra, kan ikke endres og lagrer ikke mer («Last på nytt»). «Lagre over» sier fra til den andre, og utgaven som ble lagt
  bort, er merket under Tidligere versjoner. **Tidligere versjoner** (Mer) har inntil 20 automatiske versjoner per forslag. Mer har også «Lagre som fil»,
  «Åpne fil» og «Eksporter JSON».
- **Uten nett** starter appen fra mellomlageret (service worker), og endringene sendes når nettet er tilbake (PDF og
  IFC-modellen virker uten nett når de er brukt én gang med nett). På
  iPhone: legg appen på Hjem-skjermen mens familielenken er åpen (kortet «Legg planleggeren på Hjem-skjermen» forklarer
  hvordan). Når en ny versjon av appen er publisert, kommer «Ny versjon av appen er klar. [Oppdater]»; har du appen
  åpen i flere faner, lastes bare den du trykket i på nytt, de andre sier fra.
- **Åpne bare familielenken.** En lenke som er kuttet av, starter ikke en ny plass (appen sier fra). Velger du «Bytt
  dit», tilbyr appen å hente forslagene du laget i den forrige plassen. En lenke til en tom plass spør «Denne plassen er
  tom. Er lenken hel?» før noe lagres.

## Kom i gang

Krav: Node 24 og npm.

```bash
npm install
npm run dev        # http://localhost:5173
```

### Skript

| Kommando | Hva den gjør |
|---|---|
| `npm run dev` | Utviklingsserver med HMR |
| `npm test` | Enhetstester (Vitest): geometri, romdeteksjon, tak, arealer, migrasjoner, seed-invarianter |
| `npm run test:watch` | Vitest i watch-modus |
| `npm run e2e` | Playwright i Chromium (PC 1400 × 900, iPhone 13 med berøring, og produksjonsbygget offline under `/hytte-planlegger/`); lager skjermbildene i `e2e/screenshots/` |
| `npm run typecheck` | `tsc -b` (typesjekk av `src/` og `vite.config.ts`) |
| `npm run lint` | oxlint |
| `npm run build` | Produksjonsbygg til `dist/` (typesjekk + Vite) |
| `npm run preview` | Serverer `dist/` lokalt |
| `npm run build-terrain` | Bygger terrengfila fra `data/geo/` (se `scripts/build-terrain.mjs`) |
| `npm run schedule` | Kjører Forslag D gjennom hele avledningen og skriver ut romskjema (mål, areal, avvik mot IFC) og arealsummer |

## Tester

- **Enhetstester** (`npm test`): all geometri i `src/geometry/` er rene funksjoner uten React/three og testes grundig,
  degenererte tilfeller inkludert. Seeden for Forslag D har egne invarianttester (aksemål 170,16 m², alle rom funnet
  og navngitt, møneforlengelser til y = 2,00 / 4,20 og x = 18,4 m). `src/model/seed/forslagD.derive.test.ts` kjører hele
  pipelinen på seeden: alle 27 rom funnet og navngitt, ingen advarsler, rommene innenfor 0,15 m² av IFC-arealene,
  ingen takflate inne i rommene, trappeåpningene fri for gulv, terrenget under alle gulv og hems-BRA 12,54 m².
  `robustness.test.ts` og `clipFailure.test.ts` sjekker at modellen tåler skjeve og ødelagte tegninger. Redigeringen
  testes regel for regel (`src/geometry/edit.test.ts`, `snap.test.ts`) og som handlinger på den ekte seeden
  (`src/state/editActions.test.ts`), planens bevegelser og verktøy i `src/plan2d/PlanView.edit.test.tsx` og panelene i
  `src/ui/`.
- **Røyktest** (`npm run e2e`): første gang må Chromium installeres med `npx playwright install chromium`. Testen
  starter dev-serveren selv (eller bruker en som allerede kjører på port 5173), venter til appen melder
  `window.__hytte.ready`, tar skjermbilder av plan, 3D ute (oversikt, framsiden, langsiden og taket sett fra
  stua), 3D inne (stua), hems og en telefonvisning (375 × 812), og sjekker at romskjemaet får plass i kolonnen, at
  planen viser minst 10 romnavn med areal (romnavn flytter seg bort fra møblene og mister da noen ganger arealet), at
  arealsummene vises og at «Send forslaget» og «Hjelp» er synlige på
  telefon. `e2e/editing.spec.ts` redigerer et nytt forslag på PC (flytter fløyas yttervegg, setter et vedskjul på
  terrassen og fester det til fløya, tegner en vegg og gir rommet navn, skriver inn en dybde, flytter en dør og sletter
  en vegg i hytta i dag og tar dem tilbake, sjekker at Forslag D nekter alt, flytter badestampen, korte drag, Angre i
  toasten, trær per forslag, vestgavlen flyttet, hele fløya flyttet, et vedskjul rotert; glassutbyggets østvegg og
  hjørne flyttet og tatt tilbake, en diagonal vegg flyttet og tatt tilbake, enden av en vegg dratt kort, et vedskjul
  inntil fløya dreid to ganger, et spøkelse valgt med et klikk, advarselstoasten som går når rommet får navn), og
  `e2e/phone-editing.spec.ts` gjør det samme på en iPhone 13 med berøring (panorering, dra en vegg, skrive inn et tall
  i arket nedenfra, sette inn en dør; ved startzoom: trykk på romnavn, dra en dør og et nytt bygg uten å endre
  størrelsen, arket lar det valgte synes, alle seks verktøy, trykk 4 px ved siden av vegger og en dør, et vedskjul
  som følger fingeren, første og andre trykk på et nytt bygg, toasten under verktøylinja).
  `e2e/furniture.spec.ts` (PC) setter et toalett i Hovedbad med møbelbiblioteket, drar det inn i dørslaget
  (advarsel), roterer, dupliserer og sletter det, drar senga i Soverom (ny fløy) tilbake mot veggen, flytter
  hovedhusets sørvegg og glassutbyggets østvegg og tar alt tilbake, og velger vinduet over et dørspøkelse;
  `e2e/phone-furniture.spec.ts` (iPhone) setter en stol fra arket og drar den, lager og gir nytt navn til et forslag i
  menyen, fester et vedskjul til fløya, flytter det 0,5 m ved startzoom og velger «Bod (ny)» på navnet;
  `e2e/proposals.spec.ts` sletter og henter tilbake et forslag (to bekreftelser, Papirkurv), åpner en gammel `#d=`-lenke
  og flytter en gammel autolagring inn i forslagene; `e2e/offline.spec.ts` (prosjektet `pwa`) bygger appen, serverer
  den under `/hytte-planlegger/` som på GitHub Pages, laster den på nytt uten nett og sjekker at «Oppdater» i én fane
  bare laster den fanen på nytt. Fikserunden etter 2b la til drag-forhåndsvisningen ved pekeren, Ctrl+D, «Ta tilbake»
  ett spøkelse om gangen og en stol under bordet (PC), trykk og knip ved rotasjonshåndtaket, biblioteket tre ganger
  etter Slett, et vedskjul midt på terrassen og dørhåndtak ved startzoom (iPhone), og en familielenke som er kuttet av
  og bytte av familieplass (forslagene). Runde 2 la til hele førstegangsflyten på iPhone (fra førstegangskortet til
  «Send», og lenken åpnet på en annen enhet), spisestolens rotasjonshåndtak, «Ta tilbake» som lar en annen flyttet vegg
  stå, vedskjul ved badstua og over utebordet, hintet når en vegg stopper (PC), Angre etter «+ Nytt forslag», «Lagre
  over» med to faner og den gamle fanen til en forlatt plass (forslagene). Siste runde la til at Nytt bygg ikke kan stå
  på huset (hintet, nektet trykk, et anneks dratt mot fløya stopper ved veggen), en bod som forstørres over utebordet,
  «Ta tilbake» på en hemsvegg som ble flyttet med, Dupliser til et naborom eller nektet (PC), et vedskjul trykket
  like utenfor badstuveggen og førstegangsflyten med vedskjulet fortsatt valgt (iPhone), og spørsmålet før bytte av
  plass, `&p=`-lenken som kopi og fanen som sier fra (forslagene). Fase 3 og runde 4 la til `e2e/phase3.spec.ts` (PDF
  i A3 1:50 med begge etasjer — sidene og A3-størrelsen lest fra fila —, PNG, «Gå rundt» med W, «Avløp og sluk» med et
  toalett flyttet til Soverom 1, og en liten syntetisk IFC-fil fra `e2e/fixtures/` gjennom filvelgeren),
  `e2e/phone-phase3.spec.ts` (spaken i «Gå rundt», «Eksporter» på telefonen), et vedskjul inntil huset med ny dybde og
  «Ta tilbake» i et hjørne (PC), og forslagslenkens «Bytt dit» og vinduet med to navn (forslagene). Prøvene mot den
  ekte Firestore kjøres bare med `E2E_FIRESTORE=1` (se
  [docs/firebase-oppsett.md](docs/firebase-oppsett.md)); ellers hoppes de over. Skjermbildene i `e2e/screenshots/`
  sjekkes inn, slik at en diff viser hva som endret seg visuelt. Rapport og spor fra feilede kjøringer havner i
  `e2e/playwright-report/` og `e2e/test-results/` (ikke i git).
- Typesjekk av testoppsettet: `npx tsc --noEmit -p e2e/tsconfig.json`.

## Bygg og publisering

`npm run build` lager `dist/` med relativ base (`./` i `vite.config.ts`), så samme bygg virker både lokalt og under en
undermappe på GitHub Pages. Bygget har en service worker (`sw.js`, scope `./`) som mellomlagrer hele appen
(fonter, ikoner og Firebase-delen også), og et manifest uten `start_url` (Hjem-skjerm-appen åpner adressen den ble lagt
til fra, med familielenken). Firebase lastes som en egen del bare når den delte plassen brukes. PDF-bibliotekene
(jsPDF, svg2pdf.js) og IFC-motoren (web-ifc med wasm, ca. 5 MB) er egne deler som lastes første gang de brukes, og
mellomlagres da — de lastes ikke ned når appen installeres.

Publiseringen er automatisk: hver push til `main` kjører [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml),
som kjører enhetstestene, bygger og laster `dist/` opp til GitHub Pages. [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
kjører tester og bygg på alle push og pull requests.

Engangsoppsett i repoet på GitHub: *Settings → Pages → Build and deployment → Source: GitHub Actions*. Appen ligger
deretter på `https://<brukernavn>.github.io/hytte-planlegger/`.

## Hvor dataene bor

| Hva | Hvor | Merknad |
|---|---|---|
| Familiens forslag | Firestore → `families/<familie-id>/proposals/<forslag-id>` (+ `revisions/`) | Hvert forslag som JSON-tekst med navn, «sist endret av» og tidspunkter. Lagres automatisk (1 s etter siste endring); uten nett i Firestores mellomlager i nettleseren og sendes senere. Se [docs/firebase-oppsett.md](docs/firebase-oppsett.md). |
| Forslag uten delt plass | `localStorage` → `hytte-planlegger:proposals` (+ `…:proposal-revisions`) | Når appen kjører uten Firebase (eller ikke får lastet det): samme regler, bare i denne nettleseren. Forslag som ble lagret her mens familiens plass ikke kunne nås, legges inn i den når den kan nås. |
| Familie-id, navn | `localStorage` → `hytte-planlegger:family`, `…:my-name` | Id-en fra familielenken og navnet fra «Hva heter du?». |
| Visningsvalg | `localStorage` → `hytte-planlegger:ui` | Aktiv visning, etasje, kamera, brytere (også «Plassbehov for møbler»), soltidspunkt. |
| Valg i PDF-dialogen, «Avløp og sluk», «Skygger» | `localStorage` → `hytte-planlegger:export.pdf`, `…:plumbing`, `hytte.view3d.shadows` | Per enhet. |
| Avløpsstammer | I forslaget (`plumbing`) | Følger forslaget til alle, som resten av det. |
| IFC-modellen | IndexedDB i nettleseren (den tolkede modellen) + `localStorage` → `hytte-planlegger:ifc-overlay` (valgene) | Bare på denne enheten. Selve IFC-fila lagres ikke og lastes aldri opp; «Fjern» sletter modellen. |
| Lagre som fil / Åpne fil | JSON-fil | Forslaget på skjermen som fil; en fil åpnes som nye forslag. «Eksporter JSON» lagrer hele prosjektet. |
| Gammel autolagring | `localStorage` → `hytte-planlegger:project.before-2b` | Prosjektet fra fase 1 / 2a, flyttet inn som forslag første gang 2b startet; beholdes som sikkerhetskopi. |
| Delingslenke | `#d=` i adressen | En kopi av et forslag i selve lenken (fra før 2b). Åpnes som et nytt forslag. |
| Forslag D (utgangspunktet) | `src/model/seed/forslagD.ts` | Følger med appen, er låst og alltid den nyeste utgaven (revisjon 6: møblert). Lagres aldri i den delte plassen. |
| Terrenget | `src/model/seed/terrain-merkesvatnet.json` | Følger med appen. Er aldri en del av forslagene eller lenkene. |

Dokumentet har et `schemaVersion`. Eldre lagringer, versjoner, importer og lenker migreres automatisk
(`src/model/migrate.ts`); en nyere versjon enn appen kjenner gir beskjed om å laste siden på nytt.

## Mappeoversikt

```
src/
  model/       types.ts (skjema), derived.ts (det som rendres), migrate.ts, seed/ (Forslag D + terreng)
  geometry/    rene, enhetstestede funksjoner: polygon, planar graf, rom, tak, vegger, ute, arealer, derive, geo, terreng,
               redigeringsregler (edit.ts) og snapping (snap.ts)
  state/       zustand-store med angre/gjør om, utvalg, familiens forslag (familyStore*.ts: lokal og Firestore,
               synkronisering), persistens (visningsvalg, lenker, filer), redigeringshandlingene (editActions.ts)
  plan2d/      SVG-planen med redigering (bevegelser, verktøy, håndtak), avløpslaget og IFC-omrissene
  view3d/      3D-scenen (react-three-fiber), klikk for å velge, «Gå rundt», solpanelet, IFC-modellen i 3D
  export/      PDF av planen (ark, tittelfelt, romskjema) og PNG av 3D-bildet
  ifc/         lesing av IFC-fila (web-ifc), kalibrering, hurtiglager
  ui/          app-skall, verktøylinje, Egenskaper, paneler, tema, tallformatering
  i18n/        nb.ts – alle tekster i grensesnittet
  furniture/   møbelkatalogen (50 møbler med størrelser, farger, plassbehov, symbol og 3D-modell)
e2e/           Playwright: røyktest, redigering og møbler på PC og på iPhone, forslag, offline, fase 3, skjermbilder
docs/          arkitektur, fase 2-planen, Firebase-oppsett, IFC-kalibrering, seed-brief
data/geo/      rå høydedata fra Kartverket og IFC-uttrekket (inndata til scripts/)
scripts/       build-terrain.mjs
public/        favicon, app-ikoner (PNG), selvhostede fonter
```

## Dokumentasjon

- [docs/architecture.md](docs/architecture.md) – arkitektur, koordinatsystemer, regler og kontrakter (les først)
- [docs/phase2-plan.md](docs/phase2-plan.md) – planen for fase 2 (redigering, møbler, delte forslag, offline)
- [docs/firebase-oppsett.md](docs/firebase-oppsett.md) – familiens delte plass: oppsett, familielenken, statusen, hva som lagres
- [docs/kalibrering-ifc.md](docs/kalibrering-ifc.md) – mål hentet fra arkitektens IFC-modell
- [docs/seed-brief-forslag-d.md](docs/seed-brief-forslag-d.md) – hva Forslag D-seeden inneholder
- [STATUS.md](STATUS.md) – gjort, neste, kjente problemer

Språk: brukergrensesnittet er på bokmål (komma som desimaltegn, m²). Kode, kommentarer og `docs/` er på engelsk;
README og STATUS er på norsk.
