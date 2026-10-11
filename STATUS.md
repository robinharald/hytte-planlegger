# Status

Oppdatert 2026-10-11 (fase 1 integrert). Integratoren holder denne fila oppdatert: gjort / neste / kjente problemer.

Faser:
- **Fase 1** – Forslag D vises riktig i plan og 3D med romskjema og arealer; lagring, versjoner, deling og publisering.
- **Fase 2** – redigering (dra blokkhjørner, vegger og åpninger; nye vegger, åpninger og rom).
- **Fase 3** – møbelkatalog.

## Gjort

- Prosjektoppsett: Vite 8, React 19, TypeScript 6 (strict, `verbatimModuleSyntax`, ingen enums), Vitest, Playwright, oxlint.
- `docs/architecture.md`: prinsipp («alt er data»), koordinatsystemer, konvensjoner, avledningspipeline, takregler,
  arealregler, kontrakter mellom modulene og test-id-er. Oppdatert ved integrasjonen der implementasjonen avviker
  (sol med suncalc v2, `computeAreas` med tilbakekall, `opts`-argumenter, regler for yttervegger på hemsen,
  takforlengelse klippet mot de andre blokkene, etiketter i 3D, testtall).
- Geometri (`src/geometry/`), alle rene og enhetstestet:
  - `polygon.ts` (74 tester), `planarGraph.ts` + `rooms.ts` + `areas.ts` (69), `roof.ts` + `geo.ts` + `terrain.ts` (69),
    `walls.ts` + `outdoor.ts` (66).
  - `derive.ts` (ny ved integrasjonen, 10 tester): hele pipelinen – blokker, tak, vegger og åpninger, rom per etasje
    (vegg-graf + sonekanter, nivå fra sonen ved etikettpunktet, hems-flater utenfor `add`-sonen forkastes), rom-poster
    festet på anker, gulv (rom, terskler under dører/åpninger, dekke under hemsen med trappeåpning), uteområde,
    bæring, arealer, fundamenter, trær på terrenget, målkjeder per side + totalmål, grenser, vegg-unioner per etasje
    og status, advarsler. Memoisert på (variant, tomt, terreng).
- Forslag D-seeden (`src/model/seed/forslagD.ts`, 25 tester) og terrengfila; `forslagD.derive.test.ts` (9 tester) kjører
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
- Testtall: `npm test` 623 tester i 33 filer, alle grønne; `npm run typecheck`, `npm run lint` og `npm run build` rene;
  `npm run e2e` 2 av 2 grønne. Skjermbilder i `e2e/screenshots/`: `plan.png`, `plan-hems.png`, `3d-ute-oversikt.png`,
  `3d-ute-framsiden.png`, `3d-inne-stua.png`, `phone.png`.

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
| Kjøkken | Hovedplan | ca. 3,59 × 3,84 | 12,58 | – | |
| Korridor (øvre) | Hovedplan | ca. 4,70 × 2,00 | 7,24 | – | |
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

Arealer: BYA 245,46 m² (bygg 178,33 + terrasse 67,14; eks. 102,18 / nytt 143,28). BRA 168,76 m² (underetasje 27,33,
hovedplan 130,21, hems 11,22 målbart av 26,34 brutto). Aksemål 170,16 m² (98,00 + 72,16). Korridor nedre + øvre =
10,32 m² mot IFC-rommet 101 Korridor 10,1 m².

## Neste

1. Slå på GitHub Pages i repoet (Settings → Pages → Source: GitHub Actions), pushe `main` og verifisere den publiserte
   appen, også på telefon.
2. Robins avgjørelser: badstudøra (`d-badstue`) er lagret med `side: 'right'` (åpner ut mot badet, +x) – briefen sa
   'left'; den frie stolpen på (11,9; 3,1) i den gamle østgavlen; ekte veggtykkelser i mellombygget (se under).
3. Legge `public/fonts/OFL.txt` (full lisenstekst for Barlow) ved siden av fontene; `public/fonts/README.md` har
   kreditering og kilde, men selve lisensfila er ikke lastet ned.
4. Vurdere å kjøre røyktesten i CI (`npx playwright install --with-deps chromium`) og legge `npm run lint` inn i `ci.yml`.
5. Fase 2: redigering etter invariantene i `docs/architecture.md` («Editing invariants»).
6. Fase 3: møbelkatalog (`src/furniture/`).

## Kjente problemer

- **Mellombygg −0,14 m² mot IFC**: veggene der er i virkeligheten 0,11 m (uisolert) og bod-fløyas 0,16 m; seeden
  bruker felles oppbygging 0,27 / 0,11 på bod-fløyas blokk-kanter, så rommet blir ca. 5 cm for smått per side.
  Akseptert avvik (se `docs/kalibrering-ifc.md`), innenfor testens grense på 0,15 m².
- **BRA på hemsen er litt lav**: fri høyde ≥ 1,9 m + 0,6 m-stripe regnes på et 0,25 m-rutenett; stripa blir 0,375–0,625 m
  (0,5 m i snitt). Testhems: 8,76 m² mot eksakt 9,34 m².
- **Takdaler beregnes ikke**: der hovedtaket møter tverrfløya ligger takflatene over hverandre; utenfra ser det riktig ut,
  men fra enkelte vinkler sees en «trapp» i torva i dalen.
- Veggtopper er flate over tykkelsen: innenfra med tak på er det en stripe på ca. 8 cm under taket ved innsiden av
  langveggene.
- Innervegger som vender bort fra sola er bare lyst av himmellyset og ser grå-beige ut (som i den gamle modellen); se
  `3d-inne-stua.png`.
- Små rom får ingen navn i planen ved standard zoom (Teknisk / vask, Pantry, Korridor (nedre), Trapperepos) – de dukker
  opp når man zoomer inn. 3D-etiketter som ville overlappe en nærmere etikett skjules.
- Skjermbildene fra røyktesten (SwiftShader) har en kort grå strek øverst til venstre over målkjeden i planen; den finnes
  ikke i SVG-en og vises ikke uten SwiftShader (rasteriseringsfeil i den programvarebaserte GPU-en).
- På telefon ruller knappene for lagring/deling sidelengs i toppfeltet.
- Planar graf: et snappet vegg-endepunkt flyttes inntil 5 cm uten ny kryssingssjekk; sammenslåing av noder innen
  1 cm er rekkefølgeavhengig.
- Vegger (`walls.ts`): en åpning som strekker seg over to veggbiter festes bare til biten med midtpunktet; hull i
  klippede deler/soner droppes (bare ytre ring).
- Tak: ingen valmtak; L-formede blokker må deles i to blokker. Et klokkeslett som hoppes over ved sommertid flyttes én
  time fram.
- Stolpen på (11,9; 3,1) står i østgavlen som rives sammen med stueforlengelsen; den beholdes som frittstående stolpe
  til Robin bestemmer noe annet.
- Ingen arealbegrenser i fase 1 (`areaLimit = null`); advarselen `area-limit` virker hvis en grense settes.
- React Three Fiber logger en advarsel om at `THREE.Clock` er foreldet (fra biblioteket, ikke fra appen).
- `tsc -b` typesjekker bare `src/` og `vite.config.ts`. `e2e/` og `playwright.config.ts` sjekkes med
  `npx tsc --noEmit -p e2e/tsconfig.json`.
- Playwright: Chromium må installeres manuelt første gang. 3D rendres med SwiftShader i headless-modus – tregt, men likt
  på alle maskiner; derfor rause tidsfrister i `playwright.config.ts`.
- GitHub Actions-versjonene (`checkout@v4`, `setup-node@v4`, `configure-pages@v5`, `upload-pages-artifact@v3`,
  `deploy-pages@v4`) bør bumpes når GitHub varsler om utfasing.
