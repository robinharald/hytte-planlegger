# Hytteplanlegger – Merkesvatnet

Nettbasert 2D/3D-planlegger for utvidelsen av hytta ved Merkesvatnet (Hadsel, Vesterålen). Familien bruker den
til å utvikle «Forslag D»: se planen og huset i 3D (ute og inne, med sol for valgt dato og klokkeslett), følge med på
romskjema og arealer (BYA, BRA) og etter hvert flytte vegger, åpninger og blokker selv.

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
[docs/architecture.md](docs/architecture.md). Les den før du endrer noe.

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
| `npm run e2e` | Playwright-røyktest i Chromium; lager skjermbildene i `e2e/screenshots/` |
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
  pipelinen på seeden: alle 27 rom funnet og navngitt, ingen løse vegger, rommene innenfor 0,15 m² av IFC-arealene.
- **Røyktest** (`npm run e2e`): første gang må Chromium installeres med `npx playwright install chromium`. Testen
  starter dev-serveren selv (eller bruker en som allerede kjører på port 5173), venter til appen melder
  `window.__hytte.ready`, tar skjermbilder av plan, 3D ute (oversikt, framsiden), 3D inne (stua), hems og en
  telefonvisning (375 × 812), og sjekker at romskjemaet og arealsummene vises. Skjermbildene i `e2e/screenshots/`
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
| Forslag D (utgangspunktet) | `src/model/seed/forslagD.ts` | Når seeden oppdateres, tilbyr appen «Hent ny Forslag D» (legges til som ny variant) eller «Tilbakestill til Forslag D». |
| Terrenget | `src/model/seed/terrain-merkesvatnet.json` | Følger med appen. Er aldri en del av prosjektet, versjonene eller lenkene. |

Dokumentet har et `schemaVersion`. Eldre lagringer, versjoner, importer og lenker migreres automatisk
(`src/model/migrate.ts`); en nyere versjon enn appen kjenner gir beskjed om å laste siden på nytt.

## Mappeoversikt

```
src/
  model/       types.ts (skjema), derived.ts (det som rendres), migrate.ts, seed/ (Forslag D + terreng)
  geometry/    rene, enhetstestede funksjoner: polygon, planar graf, rom, tak, vegger, ute, arealer, derive, geo, terreng
  state/       zustand-store med angre/gjør om, utvalg, persistens (autolagring, versjoner, delingslenke)
  plan2d/      SVG-planen
  view3d/      3D-scenen (react-three-fiber)
  ui/          app-skall, paneler, tema, tallformatering
  i18n/        nb.ts – alle tekster i grensesnittet
  furniture/   møbelkatalog (fase 3)
e2e/           Playwright-røyktest og skjermbilder
docs/          arkitektur, IFC-kalibrering, seed-brief
data/geo/      rå høydedata fra Kartverket og IFC-uttrekket (inndata til scripts/)
scripts/       build-terrain.mjs
public/        favicon, selvhostede fonter
```

## Dokumentasjon

- [docs/architecture.md](docs/architecture.md) – arkitektur, koordinatsystemer, regler og kontrakter (les først)
- [docs/kalibrering-ifc.md](docs/kalibrering-ifc.md) – mål hentet fra arkitektens IFC-modell
- [docs/seed-brief-forslag-d.md](docs/seed-brief-forslag-d.md) – hva Forslag D-seeden inneholder
- [STATUS.md](STATUS.md) – gjort, neste, kjente problemer

Språk: brukergrensesnittet er på bokmål (komma som desimaltegn, m²). Kode, kommentarer og `docs/` er på engelsk;
README og STATUS er på norsk.
