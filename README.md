# Hytteplanlegger – Merkesvatnet

Nettbasert 2D/3D-planlegger for utvidelsen av hytta ved Merkesvatnet (Hadsel, Vesterålen). Familien bruker den
til å utvikle «Forslag D»: se planen og huset i 3D (ute og inne, med sol for valgt dato og klokkeslett), følge med på
romskjema og arealer (BYA, BRA), og lage egne forslag der de flytter vegger, dører, vinduer og bygningsdeler, tegner
nye vegger og setter nye bygg (vedskjul, bod, badstue, anneks) på terrassen.

Appen kjører helt i nettleseren. Det finnes ingen server: prosjektet er ett JSON-dokument som lagres lokalt og kan
deles som lenke eller fil.

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

## Slik redigerer du (fase 2a)

- **Forslag D er grunnlaget og kan ikke endres.** Trykk «+ Nytt forslag» (eller «Nytt forslag» i hjelpelinja) for å få
  en kopi du kan endre. Alt i kopien kan endres, også hytta slik den er i dag.
- **Trykk for å velge, dra det valgte for å flytte.** En vegg, en dør, et hjørne eller et helt nytt bygg flyttes ved å
  trykke på det og så dra det. Første trykk på et nytt bygg med ett rom (et vedskjul) velger bygget, neste trykk
  rommet i det. Å dra på noe annet flytter planen; hjulet eller to fingre zoomer. Håndtakene (hvite
  sirkler) flytter hjørner og kanter; «+» på en terrassekant lager et nytt hjørne.
- **Verktøylinja:** Velg · Vegg (trykk der veggen begynner og der den slutter) · Dør/vindu (velg type, trykk på en
  vegg) · Nytt bygg (velg Vedskjul, Bod, Badstue, Anneks eller Eget bygg, «Roter», trykk der det skal stå – det fester
  seg til terrassekanten og veggene; et bygg som står kan roteres med «Roter 90°») · Møbler (kommer i fase 2b) · Mål
  (trykk på to punkter) · Angre / Gjør om. Angre i en toast angrer bare den handlingen toasten gjelder.
- **Egenskaper** (øverst til høyre, på telefon som et ark nedenfra) viser målene og lar deg skrive dem inn: «2,4»,
  «2,40» og «2.40» virker, −/+ endrer 10 cm. Dybde og bredde på et rom flytter veggen på den siden.
- **Vis hva som er nytt** (på som standard i planen): nye deler er oransje, og det som er flyttet eller fjernet fra
  hytta i dag vises stiplet («Fjernet»). Velg det stiplede og trykk «Ta tilbake» for å sette det tilbake. 3D viser
  naturlige farger; «Vis hva som er nytt i 3D» farger det nye der også.
- Trærne hører til forslaget: å flytte et tre i et forslag endrer ikke Forslag D.
- Hurtigtaster: Delete, piltastene (1 cm, med Shift 10 cm), R, Ctrl+D, Ctrl+Z / Ctrl+Y og Esc.

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
| `npm run e2e` | Playwright i Chromium (PC 1400 × 900 og iPhone 13 med berøring); lager skjermbildene i `e2e/screenshots/` |
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
  planen viser minst 15 romnavn med areal, at arealsummene vises og at «Send forslaget» og «Hjelp» er synlige på
  telefon. `e2e/editing.spec.ts` redigerer et nytt forslag på PC (flytter fløyas yttervegg, setter et vedskjul på
  terrassen og fester det til fløya, tegner en vegg og gir rommet navn, skriver inn en dybde, flytter en dør og sletter
  en vegg i hytta i dag og tar dem tilbake, sjekker at Forslag D nekter alt, flytter badestampen, korte drag, Angre i
  toasten, trær per forslag, vestgavlen flyttet, hele fløya flyttet, et vedskjul rotert; glassutbyggets østvegg og
  hjørne flyttet og tatt tilbake, en diagonal vegg flyttet og tatt tilbake, enden av en vegg dratt kort, et vedskjul
  inntil fløya dreid to ganger, et spøkelse valgt med et klikk, advarselstoasten som går når rommet får navn), og
  `e2e/phone-editing.spec.ts` gjør det samme på en iPhone 13 med berøring (panorering, dra en vegg, skrive inn et tall
  i arket nedenfra, sette inn en dør; ved startzoom: trykk på romnavn, dra en dør og et nytt bygg uten å endre
  størrelsen, arket lar det valgte synes, alle seks verktøy, trykk 4 px ved siden av vegger og en dør, et vedskjul
  som følger fingeren, første og andre trykk på et nytt bygg, toasten under verktøylinja). Skjermbildene i
  `e2e/screenshots/`
  sjekkes inn, slik at en diff viser hva som endret seg visuelt. Rapport og spor fra feilede kjøringer havner i
  `e2e/playwright-report/` og `e2e/test-results/` (ikke i git).
- Typesjekk av testoppsettet: `npx tsc --noEmit -p e2e/tsconfig.json`.

## Bygg og publisering

`npm run build` lager `dist/` med relativ base (`./` i `vite.config.ts`), så samme bygg virker både lokalt og under en
undermappe på GitHub Pages.

Publiseringen er automatisk: hver push til `main` kjører [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml),
som kjører enhetstestene, bygger og laster `dist/` opp til GitHub Pages. [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
kjører tester og bygg på alle push og pull requests.

Engangsoppsett i repoet på GitHub: *Settings → Pages → Build and deployment → Source: GitHub Actions*. Appen ligger
deretter på `https://<brukernavn>.github.io/hytte-planlegger/`.

## Hvor dataene bor

Alt ligger i nettleseren til den som bruker appen; ingenting sendes til noen server.

| Hva | Hvor | Merknad |
|---|---|---|
| Prosjektet du jobber med | `localStorage` → `hytte-planlegger:project` | Autolagres 500 ms etter hver endring. Andre faner overskriver ikke en nyere lagring. |
| Visningsvalg | `localStorage` → `hytte-planlegger:ui` | Aktiv visning, etasje, kamera, brytere, soltidspunkt. |
| Navngitte versjoner | `localStorage` → `hytte-planlegger:versions` | «Lagre versjon» / «Versjoner». Nyeste først, maks 30, størrelsen vises. |
| Eksport / import | JSON-fil | «Eksporter» / «Importer». Ta en eksport før du rydder nettleserdata; det er sikkerhetskopien din. |
| Delingslenke | `#d=` i adressen | Prosjektet pakket med lz-string. Som standard bare den aktive varianten («del alle varianter» kan slås på). Mottakeren åpner lenka skrivebeskyttet og kan velge «Lag min egen kopi». Over ca. 8 kB anbefales JSON-fil i stedet. |
| Forslag D (utgangspunktet) | `src/model/seed/forslagD.ts` | Låst: kan ikke endres, bare kopieres med «Nytt forslag». Når seeden oppdateres, tilbyr appen «Hent ny Forslag D» (legges til som et nytt, låst forslag) eller «Tilbakestill til Forslag D». |
| Sikkerhetskopi fra fase 1 | `localStorage` → `hytte-planlegger:project.backup-v1` | En autolagring fra før skjema 2 kopieres hit rett før den første lagringen i det nye formatet. |
| Terrenget | `src/model/seed/terrain-merkesvatnet.json` | Følger med appen. Er aldri en del av prosjektet, versjonene eller lenkene. |

Dokumentet har et `schemaVersion`. Eldre lagringer, versjoner, importer og lenker migreres automatisk
(`src/model/migrate.ts`); en nyere versjon enn appen kjenner gir beskjed om å laste siden på nytt.

## Mappeoversikt

```
src/
  model/       types.ts (skjema), derived.ts (det som rendres), migrate.ts, seed/ (Forslag D + terreng)
  geometry/    rene, enhetstestede funksjoner: polygon, planar graf, rom, tak, vegger, ute, arealer, derive, geo, terreng,
               redigeringsregler (edit.ts) og snapping (snap.ts)
  state/       zustand-store med angre/gjør om, utvalg, persistens (autolagring, versjoner, delingslenke),
               redigeringshandlingene (editActions.ts)
  plan2d/      SVG-planen med redigering (bevegelser, verktøy, håndtak)
  view3d/      3D-scenen (react-three-fiber), klikk for å velge
  ui/          app-skall, verktøylinje, Egenskaper, paneler, tema, tallformatering
  i18n/        nb.ts – alle tekster i grensesnittet
  furniture/   møbelkatalog (fase 3)
e2e/           Playwright: røyktest, redigering på PC og på iPhone, skjermbilder
docs/          arkitektur, IFC-kalibrering, seed-brief
data/geo/      rå høydedata fra Kartverket og IFC-uttrekket (inndata til scripts/)
scripts/       build-terrain.mjs
public/        favicon, selvhostede fonter
```

## Dokumentasjon

- [docs/architecture.md](docs/architecture.md) – arkitektur, koordinatsystemer, regler og kontrakter (les først)
- [docs/phase2-plan.md](docs/phase2-plan.md) – planen for fase 2 (redigering, møbler, delte forslag, offline)
- [docs/kalibrering-ifc.md](docs/kalibrering-ifc.md) – mål hentet fra arkitektens IFC-modell
- [docs/seed-brief-forslag-d.md](docs/seed-brief-forslag-d.md) – hva Forslag D-seeden inneholder
- [STATUS.md](STATUS.md) – gjort, neste, kjente problemer

Språk: brukergrensesnittet er på bokmål (komma som desimaltegn, m²). Kode, kommentarer og `docs/` er på engelsk;
README og STATUS er på norsk.
