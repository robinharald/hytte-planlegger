# Status

Oppdatert 2026-10-11 (fase 1 integrert, rettinger etter gjennomgangen og etter den nye gjennomgangen integrert). Integratoren holder denne fila oppdatert: gjort / neste / kjente problemer.

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
    imellom (da blir den stående). Den løftede verdien lagres ikke som brukerens valg.
  - 3D-etiketter for bygningsdeler: skjules når bygningsdelen ikke synes (stråler mot tre punkt like over mønet
    treffer en annen bygningsdel først), og står over den synlige delen når bare noe av den synes. Nærmeste
    bygningsdel vinner (areal delt på avstanden i tredje), og en etikett som ville overlappe prøver ±8 / ±16 px
    til siden, så én eller to etiketthøyder opp, så under ankeret før den skjules. Fra «Framsiden»: «Ny tverrfløy»
    har navnet sitt, «Hytta, hoveddel» står over den, «Glassutbygg» (bak fløya) vises ikke, og «Bod-fløy» står over
    den nordre enden av bod-fløya, som synes til høyre for fløya. Den fastlåste rometiketten (rommet kameraet står i)
    står nå nede til høyre (12 px inn) og holder seg unna hjelpeteksten «Dra for å snu …» nede til venstre.
  - Lagring: når nettleserlagring er blokkert, kommer det ikke lenger et ekstra banner «Endringene kunne ikke
    lagres … (lite plass?)» ved første endring; banneret om at lagring ikke er tilgjengelig er nok.
- Testtall: `npm test` 782 tester i 37 filer, alle grønne; `npm run typecheck`, `npm run lint` og `npm run build` rene;
  `npm run e2e` 2 av 2 grønne (sjekker også at romskjemaet får plass, ≥ 15 romnavn med m² i planen og at «Del lenke» /
  «Hjelp» er synlige på telefon). Skjermbilder i `e2e/screenshots/`: `plan.png`, `plan-hems.png`, `3d-ute-oversikt.png`,
  `3d-ute-framsiden.png`, `3d-ute-langsiden.png`, `3d-ute-inne-stua.png` (Ute + «Inne i stua»: taket sett innenfra),
  `3d-inne-stua.png`, `phone.png`.

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

Arealer: BYA 245,46 m² (bygg 178,33 + terrasse 67,14; eks. 102,18 / nytt 143,28, av det bygg eks. 102,18 / nytt 76,15).
BRA 170,07 m² (underetasje 27,33, hovedplan 130,21, hems 12,54 målbart av 26,34 brutto; eks. 103,51 / nytt 66,56).
Aksemål 170,16 m² (98,00 + 72,16). Korridor nedre + øvre = 10,28 m² mot IFC-rommet 101 Korridor 10,1 m².

## Neste

1. Slå på GitHub Pages i repoet (Settings → Pages → Source: GitHub Actions), pushe `main` og verifisere den publiserte
   appen, også på telefon.
2. Robins avgjørelser:
   - Hva «Framsiden» skal vise: nå er det den nye fløyas langside mot øst med den hvite glassdøra (akse 4, som i den
     gamle modellen), ikke en gavl. «Langsiden (mot vannet)» viser fasaden mot vannet.
   - Den frie stolpen på (11,9; 3,1) i den gamle østgavlen, som nå står midt i stua.
   - Høyden på de eksisterende skilleveggene på hovedplanet: 2,5 m (toppen av hanebjelkene, som i IFC; før 2,3).
   - Himlingen i den nye fløya på 2,4 m (kald loft over). Da sitter de to høye gavlvinduene (`win-gavl-s/n`, brystning
     2,75) over himlingen og lyser bare opp kaldloftet: fjerne dem, senke dem eller droppe himlingen?
   - Badstudøra (`d-badstue`) er lagret med `side: 'right'` (åpner ut mot badet, +x) – briefen sa 'left'.
   - Ekte veggtykkelser i mellombygget (se under).
3. Vurdere å kjøre røyktesten i CI (`npx playwright install --with-deps chromium`) og legge `npm run lint` inn i `ci.yml`.
4. Geometri: gi reserve-advarslene en egen `ModelWarning`-type i stedet for `'generic'` med «geometry fallback:», og
   legge eks./nytt-delingen av bygg og terrasse inn i `AreaSummary` (UI-en regner den ut selv i `ui/areaFigures.ts`).
5. Fase 2: redigering etter invariantene i `docs/architecture.md` («Editing invariants»). Husk: enhver endring av
   innholdet i Forslag D må øke `SEED_REVISION`, ellers dekodes gamle delingslenker mot en endret seed.
6. Fase 3: møbelkatalog (`src/furniture/`).

## Kjente problemer

- **Mellombygg −0,14 m² mot IFC**: veggene der er i virkeligheten 0,11 m (uisolert) og bod-fløyas 0,16 m; seeden
  bruker felles oppbygging 0,27 / 0,11 på bod-fløyas blokk-kanter, så rommet blir ca. 5 cm for smått per side.
  Akseptert avvik (se `docs/kalibrering-ifc.md`), innenfor testens grense på 0,15 m².
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
  11 px/m, så der vises bare navn som får plass med liten skrift (standardvisningen er Plan under 1600 px).
  3D-rometiketter som ville overlappe en viktigere etikett skjules; etiketter for bygningsdeler flyttes litt først.
- Skjermbildene fra røyktesten (SwiftShader) har en kort grå strek øverst til venstre over målkjeden i planen; den finnes
  ikke i SVG-en og vises ikke uten SwiftShader (rasteriseringsfeil i den programvarebaserte GPU-en).
- Konflikt med en annen fane: denne fanen slutter å lagre til brukeren velger «Hent endringene» eller «Behold mine
  endringer»; lukkes fanen uten valg, mistes endringene som bare var i den.
- UI-innstillinger lagret før denne runden beholder alt unntatt visning og snitthøyde (de ble lagret selv om brukeren
  aldri valgte dem). «Lag min egen kopi» lagrer ikke lenger en sikkerhetsversjon (ingenting blir erstattet); tomta i
  eget prosjekt beholdes, tomta fra lenken slås ikke sammen.
- Uten terrengdata ligger den flate bakken 2 cm under blokkenes laveste grunnhøyde, som nå er ca. −1,1 under hele
  hytta (utgravingen under hovedhuset); det gjelder bare hvis terrengfila mangler.
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
