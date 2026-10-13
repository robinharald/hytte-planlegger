# Status

Oppdatert 2026-10-13 (fase 2b integrert: møbler, delte forslag i Firestore, offline/PWA og finpuss av redigeringen;
fikserunde 2b etter den tredje gjennomgangen, runde 2 etter den fjerde, runde 3 etter den femte, runde 4 etter den
sjette; fase 3: eksport, gå-modus, sol, avløp og IFC-modellen).
Integratoren holder denne fila oppdatert: gjort / neste / kjente problemer.

Faser:
- **Fase 1** – Forslag D vises riktig i plan og 3D med romskjema og arealer; lagring, versjoner, deling og publisering.
- **Fase 2a** – redigering: egne forslag, vegger, dører/vinduer, rom, bygningsdeler, nye bygg på terrassen, terrassen,
  badestampen; spøkelser for det som er flyttet/fjernet fra hytta i dag; PC og iPhone (`docs/phase2-plan.md`, rev. 3).
- **Fase 2b** – møbler, delte forslag for familien (Firestore), offline/PWA (integrert 12. okt 2026).
- **Fase 3** – resten av oppdraget (§4–§6): PDF av planen og PNG av 3D, «Gå rundt», sol-panelet, «Avløp og sluk» og
  IFC-modellen som overlegg (integrert 13. okt 2026).

## Neste

Det som faktisk gjenstår (alt annet i oppdraget er gjort):

1. **Prøve på en ekte iPhone** (pappas): alt er prøvd i Chromium på PC og med iPhone 13-emulering, ikke i Safari.
   Særlig: delingsmenyen for PDF og PNG, spaken og dra-for-å-se i «Gå rundt», to fingre som starter på mini-linja,
   å velge en .ifc-fil fra Filer, og at «Hva heter du?»-banneret ikke kommer i veien.
2. **Dra-ytelse**: inkrementell vegg- og romavledning (bare den delen av vegg-grafen som endres), så drag av vegger,
   kanter og bygg blir jevne også på telefon (70–90 ms per oppdatering på PC, 360–670 ms med 4 × tregere CPU).
3. Små rester (se «Kjente problemer» under): Barlow i PDF-en (trenger en TTF-utgave), 3D-etikettene i PNG-bildet,
   møbler og lukkede dører i «Gå rundt», terrengfoten til trinnene fra terrassen (`geometry/outdoor.ts`), avløp i 3D,
   de gjenværende tilfellene av «Ta tilbake» i hjørner.

## Fase 3 – eksport, gå-modus, sol, avløp, IFC (13. okt 2026)

Bygd i fire parallelle deler (eksport, gå-modus + sol, avløp, IFC) samtidig med fikserunde 4 (tre deler), og satt
sammen her.
Ingenting er prøvd på en ekte iPhone.

### Gjort

- **«Eksporter» → «Eksporter plan som PDF …»** (ny meny ved siden av «Mer»; `src/export`, `ui/ExportMenu.tsx`,
  `ui/ExportDialog.tsx`): A4 eller A3, 1:50 eller 1:100, Plan 1, Hems eller begge, «Romnavn og arealer»,
  «Målsetting», «Møbler», og farger («Vis hva som er nytt») eller svart-hvitt. Stående eller liggende velges av seg
  selv; dialogen sier hvor mange sider det blir og varsler når en etasje må deles på flere ark (1 cm overlapp, «Ark 2
  av 7 · rad 1, kolonne 2», med råd om å skrive ut i «faktisk størrelse»). Planen tegnes med appens egne symboler i
  riktig målestokk (1 m = 2 cm i 1:50, 1 cm i 1:100) med rutenett på 1 m, tittelfelt (Hytta ved Merkesvatnet,
  forslaget, etasjen, målestokk og papir, dato, BYA og BRA, nordpil, målestokkstrek, «Hytteplanlegger · sist endret av
  …», fargeforklaring) og romskjema med arealer på det siste arket. Fila heter `hytta-<forslag>-<dato>.pdf`; på PC
  lastes den ned, på telefon gir dialogen «Del …» og «Last ned». Valgene huskes på enheten. Forslag D: A3 1:100 = 3
  sider (ett ark per etasje + romskjema), A3 1:50 begge etasjer = 9 sider, A4 1:50 begge = 14.
- **«Lagre 3D-bildet som PNG»**: det du ser i 3D akkurat nå, i skjermens oppløsning (høyst 3 × og 16 Mpx), med en
  tekststripe nederst (forslaget, «3D · Ute · Oversikt · dato», «Hytteplanlegger»), som `hytta-3d-<dato>.png`. På
  telefon går bildet rett til delingsmenyen fra trykket; er 3D ikke åpnet ennå, byttes det til 3D først og bildet lastes
  ned.
- **«Gå rundt»** (knapp under kameravinklene og oppe til høyre i 3D-bildet; `view3d/walk.ts`, `WalkControls.tsx`,
  `WalkOverlay.tsx`): gå gjennom rommene i øyehøyde (1,65 m over gulv, terrasse, trappetrinn eller terreng; trappene
  glir jevnt, du dukker under den lave hemsen, går aldri under terrenget og ikke ut i vannet). Vegger stopper deg (du
  glir langs dem), dører og åpninger med lav terskel slipper deg gjennom, vinduer (også glassboksen), rekkverk,
  badestampen, stolper og pipa stopper deg. Starter i Stue 1,6 m innenfor glassdøra med blikket mot terrassen, der du
  sist trykket på et gulv i 3D, eller midt i et rom som er valgt i planen. PC: musa styres av 3D-bildet (pekerlås; ellers
  dra for å se), W A S D eller piltastene, Shift for å løpe, Esc avslutter, og tastene flytter aldri noe i planen.
  Telefon: spaken nede til venstre, dra i høyre del av bildet for å se rundt, «Avslutt» oppe til høyre, hintet øverst,
  og 3D-bildet rulles fram. En kameravinkel eller Plan-fanen avslutter; kameraet glir tilbake. Mens du går vises alle
  etasjer hele, og trykk velger ingenting.
- **Sol og skygge**: «Midtsommer» (21. juni), «Jevndøgn» (20. mars), «Midtvinter» (21. desember) i valgt år og «I
  dag»; under klokkeslett-glideren en gul stripe for når sola er oppe den dagen, med soloppgang og solnedgang ved hytta
  («Sola er oppe hele døgnet» 21. juni, «Sola er under horisonten» 21. desember); bryteren «Skygger». På telefon står
  de fire dagene på én rad og det er ikke noe eget klokkeslett-felt.
- **«Avløp og sluk»** (Vis, med planen; `geometry/plumbing.ts`, `plan2d/layers/PlumbingLayer.tsx`,
  `state/plumbingActions.ts`, `ui/PlumbingToggle.tsx`): avløpsstammen (et forslag, eller de lagrede), stiplede
  ledninger med avstand fra toaletter, dusjer, servanter og vaskemaskiner, og under bryteren: «WC og Hovedbad:
  toalettene står rygg mot rygg på veggen ved x 18,6 – det er fint.», «De andre 4 avløpene står innen 3,0 m fra
  avløpsstammen – det er fint.» og «Bad, Do og Teknisk / vask bruker avløpet som er der i dag.». Et toalett flyttet til
  Soverom 1 blir rødt med avstanden (ca. 23 m langs veggene) og står under Advarsler («Toalettet i «Soverom 1» står
  23,3 m fra avløpsstammen.», også i tallet i verktøylinja) mens bryteren er på. Stammen dras langs veggene (fester seg
  til nærmeste vegg, utenfor dører og vinduer), et trykk gir × for å slette den, og «Legg til avløpsstamme» lagrer en
  ny. Lagres i forslaget (`Variant.plumbing`, uten ny skjemaversjon), følger fil, lenke og familiens plass; Forslag D
  nekter med den vanlige meldingen.
- **«IFC-modell»** (eget panel etter Vis; `src/ifc`, `ui/IfcPanel.tsx`): «Last inn IFC-fil» leser arkitektens fil fra
  enheten (sjekker STEP-hodet, så web-ifc); blå omriss av vegger, vinduer og dører i planen (Plan 1 kuttet ved 0,9 m,
  Hems ved 2,1 m med bare etasjen over), halvgjennomsiktig modell med blå kanter i 3D (vegger, tak og dekker for seg;
  i «Inne» uten tak og kuttet som resten). Synlighet, «Juster plassering» (1 cm om gangen, høyst 10 cm), «Bytt fil»,
  «Fjern». Fila lastes aldri opp og lagres ikke; den tolkede modellen hurtiglagres i nettleseren (IndexedDB), så den er
  der etter en omlasting. Målt mot den ekte fila: de ti ytterveggene i dag ligger innen 0,1 cm på begge sider.
  Forskjeller overlegget viser (riktige): østgavlen ved x 12 (fjernet i Forslag D) og en vegg ved hemstrappa (y ≈ 3,1)
  som seed-modellen ikke har. Lasting: ca. 0,5 s på denne PC-en, 1,5 s med 4 × tregere CPU, 2–6 ms fra hurtiglageret.
- **Integrasjonen**: tekstene ligger i `nb.ts` (`nb.export`, `nb.walk`, utvidet `nb.sun`, `nb.plumbing`, `nb.ifc`,
  `nb.library.placedFarToast`; de midlertidige tekstfilene er borte), og avløpshjelpens advarsel er en `ModelWarning`
  ('drain-far') med tekst og mål i Advarsler. Hjelp har nye avsnitt om «Gå rundt», sol og skygge, «Eksporter», «Avløp og
  sluk» og «IFC-modell», og W A S D under hurtigtaster; førstegangskortet er uendret. `window.__hytte` har `lastExport`
  og `walk` for testene, og 3D-lerretet sier hvor mange IFC-deler det tegner (`data-ifc-meshes`).
- **Startpakken vokser ikke med PDF og IFC**: jsPDF, svg2pdf.js, react-dom/server, web-ifc og wasm-fila, PDF-dialogen,
  PNG-koden, innholdet i IFC-panelet og IFC-leseren er egne biter som lastes først når de trengs (PNG-koden når
  Eksporter-menyen åpnes, så delingsmenyen fortsatt kommer fra trykket). JavaScript ved oppstart: 1 084 kB (332 kB
  gzip) mot 1 022 kB (309 kB) før fase 3 og runde 4 — forskjellen er avløpshjelpen, rettingene, tekstene og menyene;
  av PDF og IFC er bare ca. 8 kB (meny, panelskall, lagring av valg) med. PWA-en laster heller ikke ned disse bitene ved
  installasjon (ca. 6 MB, `vite.config.ts LAZY_LIBS_*`), men hurtiglagrer dem første gang de brukes: forhåndslagringen
  er 3 012 KiB (før: 2 902 KiB; med alt hadde den blitt 9 074 KiB).
- **Rettet ved integrasjonen**: stammens trykkflate i planen var 0,5 m større enn tegnet (`pointer-events: all` med en
  1 m bred usynlig strek), så WC-toalettet ved siden av ikke kunne velges når «Avløp og sluk» var på — nå høyst 12 px
  (16 på telefon) og høyst 0,25 m; dev-serveren lastet siden på nytt ved første «Lag PDF» (Vite oppdaget jsPDF først da;
  nå forhåndsbygd, `optimizeDeps`); «klikk» i gå-hintet ble «trykk»; avløpshjelpen regnes ikke ut når bryteren er av;
  tidsmålet i `derive.schema2.test.ts` har mer slakk lokalt (× 2,5; CI uendret × 3), fordi hele testsettet nå er
  tyngre.
- **Tester**: `npm test` 1984 tester i 122 filer, alle grønne. `npm run typecheck`, `npm run lint`, `npm run build` og
  `npx tsc --noEmit -p e2e/tsconfig.json` er rene. `npm run e2e`: 90 av 90 grønne i tre prosjekter (PC, iPhone, `pwa`), 8 hoppet over (de mot den ekte
  Firestore). PDF-en fra Chromium (A3 1:50, begge etasjer, 9 sider) er rastret og sett over side for side. Nye i e2e:
  - PC (`phase3.spec.ts`): PDF i A3 1:50 med begge etasjer — antall sider som dialogen lovet, lest både fra
    `lastExport` og fra fila selv (sideobjekter og A3-størrelse); PNG lastes ned som `hytta-3d-<dato>.png`; «Gå rundt»
    med W i 0,5 s flytter deg i øyehøyde, Esc avslutter; «Avløp og sluk» med stammen og «fint»-linja, WC-toalettet
    dratt til Soverom 1 gir advarselen, Angre gjør alt fint igjen; en liten syntetisk IFC-fil (`e2e/fixtures/test-cabin.ifc`,
    laget av `src/ifc/testIfc.ts`, ikke arkitektens) gjennom filvelgeren gir omriss i planen på husets vegger og
    modellen i 3D. Skjermbildet `ifc-overlay.png` er tatt med arkitektens ekte fil (lest fra OneDrive gjennom
    filvelgeren når den finnes på maskinen, aldri kopiert inn i repoet);
  - iPhone (`phone-phase3.spec.ts`): spaken holdt fremover i 0,7 s går i øyehøyde og stopper når den slippes, et drag
    til høyre i bildet snur blikket, «Avslutt»; «Eksporter» er på skjermen, PDF-dialogen med «Lag PDF» innen rekkevidde
    og PNG-valget er der;
  - skjermbilder: `export-dialog.png`, `3d-walk.png`, `plan-avlop.png`, `ifc-overlay.png`, `phone-walk.png`.
- **Prøvd mot den ekte Firestore** (`E2E_FIRESTORE=1`, engangsfamilier `e2e-…`, slettet etterpå, 0 dokumenter igjen):
  alle 8 er grønne (`family-firestore.spec.ts` 6 av 6 med scenario H og J, `phone-family-firestore.spec.ts` med «Ikke
  startet» på en ny enhet, og `family-offline.spec.ts`).

### Avgjort i fase 3 (Robin kan endre)

- PDF og PNG ligger i en egen meny «Eksporter» ved siden av «Mer». Standard er A3 1:100 (Forslag D får ett ark per
  etasje). PDF-en bruker Helvetica (bare woff2-utgaven av Barlow følger med appen). Hems-arkene bruker samme utsnitt
  som Plan 1, så etasjene ligger over hverandre.
- «Gå rundt»: øyehøyde 1,65 m; piltastene går sidelengs (som A og D) i stedet for å snu; trinnene fra terrassen kan gås
  opp fra 0,9 m under (de ender 0,77 m over terrenget, se kjente problemer). «I dag» setter både dagens dato og
  klokkeslettet nå ved hytta; de andre dagene beholder klokkeslettet. «Skygger» huskes på enheten.
- «Avløp og sluk»: oppdragets regel «én stamme per etasje» kan ikke gjøre seeden fin (Bad, Do og Teknisk står ca. 10 m
  fra den nye fløyen), så avløp i rom som fortsatt er mest hytta i dag og var våtrom i Forslag D, bruker avløpet som er
  der i dag (ingen ledning, ingen advarsel); toaletter regnes bare slik i bad og WC. Forslaget til stamme går dit flest
  avløp står innen 3 m av hverandre, der flest når den (toaletter teller tre ganger, vegger mellom våtrom foretrekkes,
  yttervegger trekkes fra for frost). Toaletter måles langs veggen (på tvers, så langs: en L), andre avløp i rett
  linje. Fint er: et toalett innen 1,0 m fra stammen, to toaletter rygg mot rygg eller side om side innen 2,5 m, andre
  avløp innen 3,0 m. Hver etasje uten lagret stamme får et forslag. Bryteren
  huskes på enheten, og advarselen finnes bare mens den er på.
- IFC: fila blir på enheten (ingen opplasting, ikke i delte forslag); bare ±10 cm justering. PDF-bibliotekene og
  IFC-motoren lastes ikke ned når appen installeres, men første gang de brukes; etter det virker de uten nett.

### Kjente problemer (fase 3)

- Ikke prøvd i Safari eller på en ekte iPhone: delingsmenyen, pekerlåsen, spaken, bildet fra WebGL og tekstmålingen i
  svg2pdf. WebKit er ikke installert her; alt er prøvd i Chromium (PC og iPhone 13-emulering).
- PDF: Helvetica er 5–10 % bredere enn navnelappene er lagt ut for, så noen få blir trange; A4 1:50 gir seks nesten
  tomme Hems-ark; å lage PDF-en holder siden 0,4 s (A3 1:100) til 1,2 s (A4 1:50, 14 sider) på PC, lenger på telefon;
  uten nett virker «Lag PDF» først når den er brukt én gang med nett.
- PNG: 3D-etikettene (romnavnene) er HTML og kommer ikke med i bildet.
- «Gå rundt»: møbler stopper deg ikke, og dører går du gjennom selv om de er tegnet lukket. Trinnene fra terrassen
  ender 0,77 m over det skrå terrenget fordi `geometry/outdoor.ts` tar terrenghøyden ved terrassekanten, ikke ved
  foten. Pekerlåsen bes om rett etter trykket (nekter nettleseren, gjelder dra-og-trykk). Skjules 3D på annen måte enn
  Plan-fanen, avsluttes gåturen først ved neste tast.
- «Avløp og sluk»: ingenting i 3D, ingen fall eller rørdimensjoner; hemsens stamme er uavhengig av Plan 1; hvor dagens
  avløp faktisk sitter, vet vi ikke (alt i dagens Bad, Do, Teknisk og Kjøkken regnes som fint); en stamme kan ikke
  slettes med tastaturet; på telefon kan × ligge over et møbel i nærheten.
- IFC: ingen automatisk tilpasning for andre filer (bare ±10 cm); dører og knutepunkter er ikke målt (avviket på 5 cm
  på innsiden i mellombygget er ikke sjekket); web-ifc er en bit på 3,5 MB (392 kB gzip) som lastes når en fil velges.

## Fikserunde 2b, runde 4 (13. okt 2026)

Den sjette gjennomgangen (redigeringskjernen i Node, delte forslag mot den ekte Firestore, iPhone 13 og en 1366 ×
768-PC) fant 1 blokkerende, 3 store og 12 mindre feil. Alle er rettet i tre parallelle deler (redigeringskjernen, den
delte lagringen, planen på telefon og PC) og satt sammen her med fase 3. Det som gjenstår, står under «Kjente problemer
(runde 4)».

### Gjort

- **Et bygg inntil huset flytter aldri huset** (blokkerende; `edit.ts carriesThrough`, `unitAwarePlan`,
  `blockSizeMove`, `restoreEdgeOnBlock`): før flyttet «Bredde/Dybde» eller et drag av den festede kanten eller et hjørne
  husets yttervegg, med vegger, vinduer og rom. Nå: «Dybde/Bredde» på et bygg inntil et annet endrer den frie siden, og
  nektes med «Bygget kan ikke stå oppå et annet bygg» hvis det ville vokse inn i bygget; den festede kanten dratt inn i
  huset nektes med hintet, et hjørne glir langs veggen (også i forhåndsvisningen); dras kanten bort, løsner bygget, og
  husets skillevegger strekkes ikke. «Ta tilbake» på en kant av huset skyver et bygg som står inntil, unna i ett, eller
  nektes med meldingen uten at noe endres. Kjernens sveip: 4 860 endringer på 135 festede bygg endret huset 0 ganger.
- **«Ta tilbake» i hjørner** (stor; `editActions.ts keptJunctions`, `closeJunctions`, `Wall.carriedBy.from`): en vegg
  som ble tatt med, går tilbake dit den sto før, ikke til seeden; et hjørne eller en T med en annen flyttet vegg lukkes
  igjen der linjene krysser; nye vegger uten spøkelse som brukeren flyttet (som dv-stue-n) regnes også som flyttet. D1,
  D3, D5, E2 og E3 fra gjennomgangen ender med 27 navn, uten `wall-dangling` og uten melding om sammenslåing, med og uten
  omlasting. Én vegg om gangen: 117 av 117 tilbake nøyaktig til seeden.
- **Et sammenslått rom husker navnet etter omlasting**: posten i `Variant.mergedRooms` beholdes når rommet bare får ny
  form, og glemmes bare når rommet deles, eller når stedet den husker nå ligger i et annet rom.
- **Forslag lagret før runde 3** (uten `carriedBy`) bruker den gamle geometriske regelen for «Ta tilbake» igjen (6 av 6
  tilfeller tilbake nøyaktig).
- **Fløyen** tar med `w-wing-w` og døråpningen Stue → Gang når den flyttes eller slettes; bare et bygg fra «Nytt bygg»
  lar en vegg langs et annet bygg bli igjen.
- **Møbler på terrassen** som et nytt bygg treffer med veggene (ikke bare midten), skyves ut med meldingen: et vedskjul
  trykket sør for huset ved x 11 eller 14 skyver Loungesofaen ut.
- **En forslagslenke (`&p=`) til en annen plass** (stor): banneret gir «Hent … som en kopi hit», «Bytt dit» og «Bli
  her» («Bytt dit» uthevet etter samme regel som for plass-lenker), og etter «Bytt dit» vises forslaget fra lenken. En
  kopi fra en forslagslenke regnes som hentet så lenge den er urørt, og som laget her når den er endret på enheten —
  da tilbys den med ved et senere bytte (gjennomgangens T2: endringene ble liggende igjen i den private plassen).
- **Tilbudet om å hente forslag** etter «Bytt dit» uthever ingen knapp når plassen du forlater har forslag fra andre,
  og sier «Den plassen har også forslag fra andre. Henter du det hit, ser ikke familien det der lenger.»; teksten sier
  «i plassen du byttet fra» i stedet for «denne familielenken».
- **En fane som er stoppet av en annen fane** blir skrivebeskyttet med en gang (ingen verktøy, ingen «+ Nytt
  forslag»), og det som ble endret like før byttet, lagres likevel.
- **En gammel lenke `#f=<forrige>&p=X`** der X alt er i denne plassen, åpner X her uten banner, med en kort melding.
- **Statusen** sier «Ikke startet – plassen i lenken er tom» (kort: «Ikke startet») mens plassen i lenken ikke er
  bekreftet, også etter «Lukk» — ikke lenger «Lagret».
- **«Hva heter du?» avbryter ikke**: etter den første lagringen uten navn kommer et banner («Skriv navnet» / «Hopp
  over») når ingenting er endret eller valgt på 3 s, og «+ Nytt forslag» i den delte plassen spør om begge navn i ett
  vindu («Navn på forslaget» og «Hva heter du?»). Et tomt navn spørres ikke om igjen i samme økt.
- **Biblioteket etter «Nytt bygg»** (stor; `furniturePlacer.ts unitNearMiddle`): et valgt bygg får møbelet bare når
  midten av planen ligger inni rommet; ellers går det til rommet i midten, uten melding. Havner et møbel i et nytt
  byggs rom mens et annet rom er i midten, sier meldingen det («Kommode er satt inn i «Vedskjul».»). Førstegangsflyten
  med vedskjulet mot fløyens nordvegg (18,4, 6,5) og soverommet knepet inn i midten: kommoden havner i Soverom (ny
  fløy), og «Dupliser» får plass.
- **Biblioteket i et fullt rom** prøver alle rom i etasjen, nærmeste først, og sier fra: «Ingen plass i rommene i
  nærheten: Seng 180 er satt inn i «Stue».»; bare når ingen rom har plass, står møbelet i rommet i midten med
  advarslene.
- **Rotasjonshåndtaket på telefon** brukes aldri på siden som vender opp på skjermen (der ligger mini-linja); da
  skjules det, og «Roter» i mini-linja gjør det samme (de 9 møblene gjennomgangen fant).
- **To fingre gjennom mini-linja**: en knipe eller panorering som starter på mini-linja (eller med én finger på linja og
  én på planen) går til planen; et enkelt trykk på linja virker som før.
- **Tester**: `editActions.fix6.test.ts` (24 nye), familietestene (+14), biblioteket, møbellaget og mini-linja; i e2e:
  `editing.spec.ts` (ab) vedskjul ved (12,8, −0,9) og Dybde 2,0 — huset står stille; (ac) hjørnet D1 — 27 navn, ingen
  løs vegg; `proposals.spec.ts` forslagslenkens «Bytt dit», kopien som ble endret følger med, den stoppede fanen,
  den gamle lenken, «Ikke startet», navnebanneret og vinduet med to felt; `phone-editing.spec.ts` vedskjulet mot fløyen
  og soverommet i midten; `phone-furniture.spec.ts` to fingre gjennom mini-linja og håndtaket som skjules.

### Avgjort i runde 4 (Robin kan endre)

- Et bygg fra «Nytt bygg» som står inntil et annet bygg, endrer alltid den frie siden ved «Bredde/Dybde»; den festede
  kanten kan ikke dras inn i bygget; «Ta tilbake» på husets kant skyver bygget unna i stedet for å krympe det.
- En forslagslenke kan også bytte plass («Bytt dit»), med samme uthevingsregel som en plass-lenke.
- En fane som en annen fane har stoppet, er skrivebeskyttet til den lastes på nytt.
- «Hva heter du?» er et banner etter 3 s ro (det skyver planen litt ned når det kommer), eller et felt i «Nytt
  forslag»-vinduet.
- Et valgt bygg får møbelet fra biblioteket bare når midten av planen ligger inni det; et møbel uten plass i nærheten
  kan havne i et hvilket som helst rom i etasjen (med melding).
- Rotasjonshåndtaket skjules på telefon når den eneste ledige siden vender opp; to fingre som starter på mini-linja går
  til planen.

### Kjente problemer (runde 4)

- «Ta tilbake»: lw-106-top −0,3, så w-106-korr −0,3, så «Ta tilbake» på den ene gir fortsatt `wall-dangling`. I kjernens
  sveip (560 rekkefølger med flytt, 564 med drag og omlasting) gir 5–6 bare en ny `door-blocked`; w-104-103 og så
  w-104-diag (begge +0,3) har mistet et navn før tilbaketakingen, og «Ta tilbake» på w-104-103 slår da også sammen
  «Bad».
- Møbler som skyves når «Ta tilbake» skyver et bygg unna, nevnes ikke i en melding.
- En gammel forslagslenke sjekker denne plassens liste bare ved oppstart og når lenken limes inn; kommer forslaget
  senere, står banneret.
- To fingre gjennom mini-linja bygger på at `setPointerCapture` tar over en berøring fra en syntetisk `pointerdown`:
  prøvd i Chromium, ikke i Safari (linja sender ellers bevegelsene videre selv). En panorering med én finger som
  starter på linja gjør fortsatt ingenting.
- Når ingen rom i etasjen har plass, prøver biblioteket alle rom: ca. 100 ms på denne PC-en, 3–4 ganger mer på en
  telefon (sjelden).
- Ved oppstart på PC med et vedskjul nettopp satt ut tar ikke vedskjulet lenger møbelet fra biblioteket (en Vedstabel
  går til rommet i midten, uten melding).

## Fikserunde 2b, runde 3 (13. okt 2026)

Den femte gjennomgangen (delte forslag mot den ekte Firestore, iPhone 13 og en 1366 × 768-PC, redigeringskjernen i
Node) fant 1 blokkerende, 4 store og 12 mindre feil. Alle er rettet i tre parallelle deler (redigeringskjernen, den
delte lagringen, planen på telefon og PC) og satt sammen her. Det som gjenstår, står under «Kjente problemer (runde 3)».

### Gjort

- **Et nytt bygg kan ikke stå oppå et annet, og tar aldri noe av huset** (blokkerende; `edit.ts blockOwnership`,
  `unitOverlaps` / `unitMoveFraction` / `unitClearShift`): et bygg fra Nytt bygg eier bare sine egne vegger (begge ender
  i det, ingen del inne i eller langs et annet bygg), romposter laget med det (`Room.unitId`) og møbler og bæring med
  midten i det og i ingen andre bygg; flytting, dreiing og drag av hele bygget lar ingenting følge veggene. Står
  skyggen oppå huset, sier hjelpelinja «Bygget kan ikke stå oppå et annet bygg» og trykket nektes med samme melding; et
  trykk like utenfor en vegg legger bygget inntil den (innen halve byggets størrelse når trykket er utenfor alle bygg);
  et drag stopper ved veggen (med hintet), «Roter 90°» skyver det inntil 0,25 m klar eller nekter, kant- og
  hjørnedrag stopper ved veggen; «Dupliser» på et bygg setter kopien 0,5 m ved siden av. Før: et anneks satt over
  huset tok med seg (eller slettet) eksisterende vegger, romnavn og husets møbler når det ble flyttet, dreid eller
  slettet.
- **Et bygg som forstørres over terrassemøbler, skyver dem ut** (stor; `applyUnitPolygons`): også ved kant- og
  hjørnedrag, «Bredde/Dybde» og kant-/hjørneflytting, med toasten «Utebord» er flyttet ut av «Bod».
- **«Ta tilbake» flytter bare det som ble flyttet med** (stor; `Wall.carriedBy`): en vegg som en annen veggs flytting
  tok med, husker hvem og hvor (lagret i forslaget); «Ta tilbake» på den rører aldri veggen som tok den med, og «Ta
  tilbake» på den som tok med, henter den bare hvis den fortsatt står der flyttingen satte den. Vegger brukeren har
  flyttet selv, holdes utenfor (gjettingen fra angreloggen og regelen «flyttet nøyaktig like mye» er borte). Kjernens
  sveip: ingen av 174 tilbaketakinger av vegger i flukt endrer den andre veggen lenger.
- **Romnavn kommer bare tilbake i flater «Ta tilbake» endret**, og en melding sier det («Rommet «WC» er tilbake.»);
  en lagret sammenslåing glemmes når en annen endring tegner flaten om (`MergedRoom.face`).
- **Pulttaket på et vedskjul med ryggen mot et bygg** heller nå bort fra veggen (høyt mot veggen), også når det ble
  satt slik uten at appen snudde det.
- **En lenke til en annen delt plass bytter aldri av seg selv** (stor; `appStore.ts`, `StatusPill.tsx`): på en enhet
  som har en plass, spør appen ved oppstart og når lenken limes inn: «Denne lenken går til en annen delt plass. Plassen i
  lenken har 1 forslag (Mamma); plassen du bruker nå har 1.» med «Bytt dit» / «Bli her» (uthevet «Bytt dit» bare når
  plassen i lenken har forslag fra andre enheter og den du bruker ikke har det). En lenke til ett forslag (`&p=`) gir
  «Hent «Mammas idé» som en kopi hit» og bytter aldri. Tilbudet om å hente forslag kommer bare etter «Bytt dit», og
  bare for forslag denne enheten laget. Andre åpne faner hører byttet (`storage`), sier «Denne enheten har byttet delt
  plass i en annen fane.», lagrer ikke mer (statusen «Ikke lagret – last siden på nytt») og har «Last på nytt». Før: en
  «Send forslaget»-lenke fra en privat plass flyttet enheten og tilbød å flytte familiens forslag ut, og en gammel fane
  lagret videre i den gamle plassen med «Lagret for alle».
- **Lenker med `_` eller `-` bak** (fra kursiv i en chat) leses som id-en uten tegnet; en lenke til en tom plass på en
  ny enhet spør «Denne plassen er tom. Er lenken hel?» før noe lagres («Begynn her»).
- **«Lagre over» sier fra til den andre** («… ble lagret over av X. Din utgave ligger under Tidligere versjoner.»), og
  Tidligere versjoner merker «din» og «lagt bort ved Lagre over», med sekunder når to er fra samme minutt.
- **Angre etter «+ Nytt forslag»** eller bytte av forslag: angrelisten tømmes (Angre er grå til neste endring), og
  toasten sier det. Før: Angre hoppet til forrige forslag og angret en endring der, for hele familien.
- **En urørt «Forslag D (kopi)»** fra en gammel autolagring flyttes ikke inn i familiens plass.
- **Biblioteket etter Nytt bygg** (stor; `furniturePlacer.ts unitNearMiddle`): et valgt bygg får møbelet bare når
  rommet står innen 100 px fra midten av planen; ellers går det til rommet i midten, som uten noe valgt. Ved
  integrasjonen: et valgt bygg trekkes ikke fram over biblioteksarket (`PlanView.tsx`), for den panoreringen flyttet
  midten – i førstegangsflyten havnet kommoden i Spiseplass. Havner et møbel i et annet rom enn det valgte eller det i
  midten, sier en toast hvor («Kommode er satt inn i «Gang».»), og på PC panoreres et nytt møbel (eller en kopi) som
  havner utenfor bildet, inn.
- **«Dupliser» i et fullt rom** går bare til et rom en dør eller åpning fører til, høyst 3 m unna, og et møbel som
  trenger avløp bare til et våtrom; toasten sier hvor («Kopien står i «Vindfang».»). Ellers «Ingen ledig plass til en
  kopi.» (badstubenken, vaskemaskinen, spisebordet, toalettet, senga i Soverom 3, hylla i Pantry, teppet i Leseskrok,
  høyskapet i Kjøkken).
- **Rotasjonshåndtaket** står aldri på en vegg eller et møbel: en side der sirkelen eller stilken treffer en vegg,
  eller midten står på et møbel, brukes ikke; uten ledig side vises ikke håndtaket («Roter 90°» finnes). Ved startzoom
  på PC (23,5 px/m) mangler 19 av 57 håndtak, ved 40 px/m 6.
- **Integrasjonen**: tekstene ligger i `nb.ts` (`nb.editor.unitOnBlock`, `roomsBack`, `copyIn`,
  `nb.library.placedInToast`; de midlertidige `editCoreStrings.ts`, `duplicateStrings.ts` og
  `furniturePlacerStrings.ts` er borte); hintet til Nytt bygg-skyggen vises i hjelpelinja (`usePlanEditing.ts
  ghostHint`); toasten fra biblioteket er koblet til (`useFurniturePlacer`); statusen «elsewhere» har samme farge som
  «failed»; kodekommentarene fra runden heter «last fix round, fifth review».
- **Tester**: `npm test` 1786 tester i 102 filer, alle grønne. `npm run typecheck`, `npm run lint`, `npm run build` og
  `npx tsc --noEmit -p e2e/tsconfig.json` er rene. `npm run e2e` 75 av 75 grønne i tre prosjekter, 8 hoppet
  over (de mot den ekte Firestore). Nye:
  - PC (`editing.spec.ts` (y)–(aa)): skyggen over huset gir hintet og trykket nektes; et anneks dratt 4 m inn i fløya
    stopper ved veggen med hintet, uten overlappsadvarsel; en bods nordkant dratt over utebordet skyver det ut med
    toasten, og når boden flyttes og slettes, står bordet; w-106-korr +0,3 (tar med lw-106-top), lw-106-top +0,3, «Ta
    tilbake» på lw-106-top: w-106-korr står; `furniture.spec.ts` (I): benken i Mellombygg kopieres til Vindfang med
    toasten, badstubenken nektes;
  - iPhone: vedskjul trykket 0,2 m utenfor badstuveggen på tre steder legger seg inntil, flytter ingen møbler; trykket
    inne i badstua nektes med meldingen; førstegangsflyten i virkelig rekkefølge uten Esc (vedskjulet fortsatt valgt):
    kommoden havner i Soverom (ny fløy);
  - forslagene (den falske familieplassen): en lenke limt inn spør først («Bli her» uthevet når plassen er tom); en
    plass enheten aldri har brukt, med et forslag fra en annen enhet, gir «Bytt dit» uthevet og hva de to plassene har;
    etter «Bytt dit» sier den gamle fanen fra, lagrer ikke mer og lastes på nytt i den nye plassen; en `&p=`-lenke gir
    én kopi og bytter ikke; nytt skjermbilde `family-other-space.png`.
- **Prøvd mot den ekte Firestore** (`E2E_FIRESTORE=1`, engangsfamilier `e2e-…`, slettet etterpå, 0 dokumenter igjen):
  alle 8 er grønne (`family-firestore.spec.ts` 6 av 6, `phone-family-firestore.spec.ts` og `family-offline.spec.ts`),
  også scenario H (en fane som sto åpen under et bytte, lagrer ingenting mer; lastet på nytt bytter den ingenting) og J
  (en lenke til ett forslag i en annen plass kopieres hit, plassen der beholder det).

### Avgjort i runde 3 (Robin kan endre)

- **En lenke til en hvilken som helst annen delt plass spør** før bytte (det erstatter «bare plasser enheten har byttet
  bort fra»); en `&p=`-lenke til en annen plass gir en kopi, aldri et bytte.
- **Å lage eller bytte forslag tømmer angrelisten.**
- **Et nytt bygg kan ikke stå oppå et annet.** Et trykk utenfor alle bygg kan flytte det inntil halve byggets størrelse
  for å legge det inntil en vegg i stedet for å nekte; «Dupliser» på et bygg legger kopien 0,5 m ved siden av.
- **Et valgt bygg** får møbelet fra biblioteket bare når det står nær midten av planen (100 px); et valgt bygg
  panoreres ikke fram når biblioteket åpnes.
- **«Dupliser»** går bare gjennom dører og åpninger, høyst 3 m, ellers nektes det.
- **Rotasjonshåndtaket skjules** når ingen side er ledig.
- **Et vedskjul med ryggen mot et bygg** får pulttaket høyt mot veggen, også når brukeren satte det slik selv.

### Kjente problemer (runde 3)

- Redigering:
  - lw-106-top −0,3, så w-106-korr −0,3, så «Ta tilbake» på den ene av dem gir `wall-dangling` (begge er flyttet av
    brukeren; 4 av 174 tilbaketakinger i kjernens sveip).
  - w-106-korr flyttet 0,3 m nord (flytt eller drag) slår sammen «Hems 1 (soverom)» og «Trapperepos» på hemsen og gir
    `opening-outside-host` og to `wall-dangling` (lw-106-top blir en stubb på 0,2 m); det var slik før runden også
    (c861e45). «Ta tilbake» på lw-106-top lar nå w-106-korr stå, så rommene forblir slått sammen til w-106-korr tas
    tilbake.
  - (Rettet i runde 4: forslag uten `carriedBy` bruker den gamle regelen for «Ta tilbake» igjen.) Forslag lagret før
    denne runden har ingen `Room.unitId`: et bygg eier det som ligger i det og ikke i et annet bygg.
  - Rotasjonshåndtaket sjekker ikke skillevegger (planen får bare `data.pieces`): fu-spiseplass-8 får håndtaket over
    dv-kjk-e.
- (Rettet i runde 4: biblioteket bruker et valgt bygg bare når midten av planen ligger inni det.)
- Delte forslag: `updatedAt` og `lastRevisionAt` kan gå bakover når en lagring uten nett kommer fram etter en nyere
  (bare «sist endret» påvirkes).
- De andre punktene under «Kjente problemer (runde 2)», «(fikserunde 2b)» og «(fase 2b)» gjelder fortsatt (ytelsen
  ved drag med 4 × tregere CPU, ender som dras ut og inn igjen, vegger som snur retning).

## Fikserunde 2b, runde 2 (12. okt 2026)

Den fjerde gjennomgangen (delte forslag mot den ekte Firestore, brukervennlighet på iPhone 13 og en 1366 × 768-PC,
redigeringskjernen) fant at de fleste rettingene fra fikserunde 2b holdt, men også 10 store og 15 mindre feil som var
igjen eller nye. Alle er rettet i tre parallelle deler (den delte lagringen, planen på telefon og PC,
redigeringskjernen) og satt sammen her. Ett avvik står under «Kjente problemer» (`updatedAt` kan gå bakover).

### Gjort

- **En gammel fane eller lenke til en plass enheten har byttet bort fra, bytter ikke tilbake** (`appStore.ts`
  `chooseFamilyId` / `onHash`, `StatusPill.tsx` `FamilyBanners`): banneret «Denne lenken går til en plass du har byttet
  bort fra.» med «Bytt tilbake» / «Bli her». «Bli her» setter familiens lenke tilbake i adresselinja; «Bytt tilbake»
  bytter og laster på nytt uten tilbud om å hente forslag. Kopier som er hentet fra en annen plass, huskes
  (`hytte-planlegger:family.carried-in`) og tilbys aldri igjen, og et bytte husker hva som var laget før byttet
  (`…:family.switch-offer`). Før: en gammel Safari-fane som iOS lastet på nytt, flyttet enheten tilbake til den gamle
  plassen og tilbød å flytte familiens forslag dit.
- **Konfliktknappene mister ingen utgave** (`familyStore.sync.ts` `resolveConflict`): «Lagre over» legger alltid den
  andre utgaven under Tidligere versjoner (også innen 5 minutter etter forrige versjon); «Hent endringene» legger din
  der når den er ulik (også når forslaget ble slettet). Banneret sier det: «… «Lagre over» legger den andre utgaven der.»
- **Lagring når appen går i bakgrunnen**: forslagene og innstillingene lagres med en gang på `visibilitychange` →
  hidden (det eneste iOS sender når man bytter app); `pagehide` / `beforeunload` som før.
- **Meldingene om en utgave som ble skrevet over eller slettet usett virker etter en innlasting**: de siste 5
  stemplene per forslag (høyst 100 forslag) ligger i `hytte-planlegger:own-versions:<familie>`.
- **Listen over tidligere versjoner skrives ikke over** (`familyStore.firestore.ts`): en lagring over et dokument som
  finnes, er en merge-set uten `revisions` / `lastRevisionAt`, og den nye versjonen legges til med `arrayUnion`
  (beskårne med `arrayRemove`); et nytt dokument skrives helt. Stempelet går aldri under den nyeste versjonen enheten
  har sett.
- **Familielenke med tegn bak** («… #f=<id>.» eller «)» fra en melding) virker: `parseHash` tar bort tegn utenfor
  `[A-Za-z0-9_-]` på slutten.
- **Gamle autolagringer**: bare Forslag D selv (urørt) blir borte; en kopi med eget navn beholdes også urørt. En kopi fra
  de 11 minuttene nettsiden hadde seed-revisjon 2 (11. okt 20:58–21:09) sammenlignes med en frossen revisjon 2
  (`seed/frozen/forslagD.schema1.rev2.json`, ca. 4 kB gzip) og gir ikke «Forslag D (eget)». I lokal modus huskes det
  aktive forslaget fra første innlasting.
- **«+ Nytt forslag» er ikke et angresteg** (gjelder alle måter å lage forslag på mens synkroniseringen går, også
  «Åpne fil»): Angre rett etter slettet før forslaget for hele familien uten de to bekreftelsene. Sletting kan
  fortsatt angres.
- **Telefonens mini-linje vises bare med Velg** (`SelectionMiniBar.tsx`): med Nytt bygg, Vegg, Dør/vindu, Mål eller
  Møbler aktiv står den ikke over planen. Før: i førstegangsflyten slettet trykket som skulle sette vedskjulet, døra
  man nettopp hadde flyttet (og slettingen ble lagret for familien).
- **Endehåndtakene på dører og vinduer på telefon** er høyst 0,3 m (`editModel.ts openingEndHandleRadiusPx`, tegnet i
  sin egen radius, `PlanHandle.r` → `EditOverlay`) og vises ikke under ca. 33 px/m (Bredde i Egenskaper ved startzoom).
  Før: 1,2 m store sirkler ved startzoom fanget alle trykk innen ca. 2 m av en valgt dør, og en panorering ble en
  breddeendring.
- **Rotasjonshåndtaket dreier alltid** (`FurnitureLayer.tsx`): det står på en ledig side av møbelet (front, bak,
  venstre, høyre – den første som ikke berører et annet møbel eller en vegg; ellers over et teppe; på telefon ellers
  siden som vender opp på skjermen; ellers fronten), og et trykk på det dreier møbelet. En stol ved spisebordet får
  håndtaket på ryggen. Før: 32 av 46 klikk på håndtaket valgte noe annet. Ved integrasjonen: en side der stilken går
  gjennom en vegg, teller ikke som ledig (skjermbildet viste en kommode inntil veggen i Soverom (ny fløy) med
  håndtaket ute i Gang).
- **Biblioteket uten noe valgt** velger rommet midt i planen slik den var før arket åpnet (på PC: den synlige
  midten). Har rommet ingen ledig plass for møbelet, prøves de 6 nærmeste rommene før det får stå oppå noe; møbelet
  følger med forespørselen (`requestPlanCentre(doc, catalogId)`). Hintet i biblioteket begynner «Trykk på et rom
  først, eller ha rommet midt i planen.». Før: det første møbelet havnet på kjøkkenbenken uansett hvor man så.
- **«Dupliser» i et fullt rom** prøver naborommene (omriss innen 0,6 m, nærmest først) og nekter ellers med «Ingen
  ledig plass til en kopi.» (ingenting legges til, ikke noe angresteg). Før: kopien kunne havne i veggen.
- **«Ta tilbake» rører ikke en vegg brukeren selv har flyttet** (`editActions.ts carriedSideways`, `ghostStep`): en
  vegg i forlengelsen tas bare tilbake når den ble flyttet i samme angresteg som spøkelset (uten angrelogg etter en
  innlasting: bare når den er flyttet nøyaktig like mye). Før: w-vf-korr (og lw-hems2-s på hemsen) hoppet tilbake når
  w-103-korr ble tatt tilbake.
- **Nytt bygg over huset skyver ikke husets møbler** (`edit.ts pushFurnitureOut`): bare møbler uten rom og med midten
  utenfor alle bygg skyves, og ikke inn i en vegg eller et dørslag (inntil 2 m ut i 5 cm-steg). Før: badstuovnen
  havnet på terrassen.
- **Et bygg som flyttes, dreies eller dras over terrassemøbler, skyver dem ut** med den samme toasten («Utebord» er
  flyttet ut av «Vedskjul».; ved drag én gang, når draget slutter), så bygget aldri tar dem med seg eller sletter dem.
- **Et vedskjul satt med den åpne fronten mot et annet bygg dreies 180°** (bare ved plassering; samme fotavtrykk,
  pulttaket heller da mot fløya), og et bygg med dør får ikke døra mot et annet bygg. Et tak med et nytt bygg inntil
  enden får ikke advarselen «… møter ikke nabotaket …» (`roof.ts`: bygg fra Nytt bygg bærer ikke mønet videre;
  geometrien er uendret).
- **Et veggdrag som stopper, sier fra**: omrisset ved pekeren begrenses som selve flyttingen (`wallMoveFraction`), og
  hjelpelinja viser «Veggen kan ikke flyttes lenger hit – enden står fast» mens draget varer (`DragFeedback.hint` →
  `PlanFeedback.hint` → `onHint`). Ca. 0,12 ms mer per forhåndsbilde.
- **Romnavn etter «Ta tilbake» overlever en innlasting**: hver sammenslåing lagrer det borte rommet med ankrene til
  rommene i etasjen (`Variant.mergedRooms`, høyst 40; ingen ny skjemaversjon). Angre tar det bort igjen.
- **Integrasjonen**: tekstene ligger i `nb.ts` (`nb.editor.duplicateNoSpace`, `nb.editor.wallStuck`, `nb.library.intro`
  / `introTouch`; de midlertidige `duplicateStrings.ts`, `editFixStrings.ts` og `furnitureLibraryHint.ts` er borte);
  `EditOverlay` tegner håndtak i `PlanHandle.r`; biblioteket sender møbelet med i spørsmålet om planens midte (klikk-
  fangsten `libraryPickId` er borte); ordbrukstesten setter vedskjulet og dreier det to ganger for å få fronten mot
  fløya; den falske familieplassen i e2e sender skrivinger mellom faner (`storage`-hendelsen).
- **Tester**: `npm test` 1739 tester i 100 filer, alle grønne. `npm run typecheck`, `npm run lint`, `npm run build` og
  `npx tsc --noEmit -p e2e/tsconfig.json` er rene. `npm run e2e` 68 av 68 grønne i tre prosjekter, 7 hoppet over
  (de mot den ekte Firestore; med `E2E_FIRESTORE=1` 7 av 7 grønne):
  - nye på PC (`editing.spec.ts` (u)–(x)): w-vf-korr +0,3, w-103-korr −0,3 og «Ta tilbake» lar w-vf-korr stå; et
    vedskjul 0,2 m fra badstuveggen flytter ingen av husets møbler; et vedskjul dratt over utebordet skyver det ut med
    toasten, og når skjulet slettes, står bordet; lw-split dratt nordover på hemsen viser «Veggen kan ikke flyttes
    lenger hit …» i hjelpelinja og står;
  - nye for forslagene (`proposals.spec.ts`): Angre etter «+ Nytt forslag» sletter ikke; to faner på den falske
    familieplassen: B holder et drag mens A lagrer, B slipper → konflikt, «Lagre over» lagrer Bs utgave og A sin ligger
    under Tidligere versjoner (og kommer tilbake derfra); en gammel fane på den forrige plassen viser «Bytt tilbake /
    Bli her» og endrer ingenting;
  - nye på iPhone: hele førstegangsflyten ved startzoom fra førstegangskortet (`phone-editing.spec.ts`: «+ Nytt
    forslag», døra flyttet, vedskjul der døras Slett sto – ingen advarsel, døra står –, Soverom (ny fløy) zoomet inn og
    møblert fra biblioteket uten noe valgt, Dupliser fritt, Send, og lenken åpnet på en annen enhet har alt); med en dør
    valgt velger trykk ved siden av vinduet, veggen og rommet; en panorering 1,4 m fra døra panorerer; ved ca. 46 px/m
    er endehåndtakene tilbake (høyst 0,3 m); rotasjonshåndtaket på en spisestol (på ryggen) dreier stolen, ikke bordet;
    Kommode fra biblioteket i Soverom (ny fløy), fritt;
  - nye skjermbilder `phone-first-flow.png`; de andre er tatt på nytt (håndtaket på en ledig side, hintet i
    biblioteket).
- **Prøvd mot den ekte Firestore** (`E2E_FIRESTORE=1`, engangsfamilier `e2e-…`, slettet etterpå, 0 dokumenter igjen;
  `family-firestore.spec.ts` 5 av 5, `family-offline.spec.ts` og `phone-family-firestore.spec.ts` også grønne): den gamle fanen (fane 1 på R lastet på nytt etter at fane 2 gikk til F og hentet
  «Mammas idé»: ingen bytte, intet tilbud, familien ser begge forslagene); «Lagre over» innen 5 minutter: serveren har
  Bs utgave og As ligger som versjon («Test A») og vises i As Tidligere versjoner; en endring rett før
  `visibilitychange` → hidden sendes innen 0,7 s (før 1 s-forsinkelsen; uten lytteren 1,0 s) og er på serveren etter at
  konteksten er lukket.

### Ytelse (ærlig, 12. okt)

Ingen ny måling av dragene i denne runden; klemmen i forhåndsbildet koster ca. 0,12 ms per bilde. Gjennomgangen målte
produksjonsbygget med sanntidsinput (125 bevegelser med 16 ms mellomrom over 2 s, uten å vente på hvert bilde):

| Drag | Normal CPU | 4 × tregere CPU |
|---|---|---|
| PC, vegg / kant / enhet | omrisset i hvert bilde; etter pekeren median 0,11–0,12 m, maks 0,24–0,32 m; lengste stopp 100–150 ms; ca. 9 oppdateringer à 89–105 ms | 19–23 bilder på 2 s; stopp p90 450–500 ms, maks 517–783 ms; 6–7 oppdateringer à 435–513 ms (maks 790); etter pekeren median 0,12–0,13 m, p90 0,50–0,60 m, maks 0,62–0,65 m |
| iPhone 13, vegg / enhet | omrisset i hvert bilde, ca. 0,2 m etter, stopp maks 150 ms | stopp inntil 800 / 400 ms, etter pekeren maks 0,80 / 0,66 m |

Ærlig sagt: med 4 × tregere CPU kan det første bildet etter en oppdatering ligge 0,6–0,8 m etter fingeren, og skjermen
står stille 0,4–0,8 s mens oppdateringen går. Tallet 0,10 / 0,15 m i ×4-kolonnen fra fikserunde 2b gjaldt bare trinnvis
input der målingen ventet på hvert bilde. Den inkrementelle avledningen («Neste» 4) er fortsatt den egentlige rettingen.

### Avgjort i runde 2 (Robin kan endre)

- **«Dupliser» i et fullt rom** går til et naborom eller nektes («Ingen ledig plass til en kopi.»); det erstatter
  «kopien kan stå oppå andre møbler».
- **Rotasjonshåndtaket** står på en ledig side, og et trykk på det dreier alltid (det erstatter «trykket går til det
  som ligger under»).
- **Endehåndtak på dører og vinduer på telefon** er høyst 0,3 m og vises ikke under ca. 33 px/m (det erstatter
  «utenfor karmene ved startzoom»).
- **Mini-linja på telefon** vises bare med Velg.
- **Biblioteket uten noe valgt**: rommet i midten av planen før arket åpnet; uten plass der de 6 nærmeste rommene.
- **Et nytt bygg over huset** skyver bare terrassemøbler; husets møbler blir stående (blokkoverlapp-advarselen viser
  det). Skyvet hoppes ikke over når bygget overlapper huset – da ville terrassemøbler under det havne i byggets rom og
  bli med ved neste flytting.
- **Et vedskjul med fronten mot et annet bygg** dreies 180° ved plassering, ikke ved drag eller «Roter 90°».
- **«møter ikke nabotaket»** vises ikke når det som står inntil enden, er et bygg fra Nytt bygg.
- **Romnavn etter tilbaketaking** lagres i forslaget (`Variant.mergedRooms`) i stedet for å leses fra angreloggen
  (ingen ny skjemaversjon; feltet er valgfritt).
- **«+ Nytt forslag» er ikke et angresteg**; en sletting kan angres.
- **En lenke til en plass enheten har forlatt** spør («Bytt tilbake» / «Bli her») i stedet for å bytte.
- **Den frosne seed-revisjon 2** følger med appen (ca. 4 kB gzip) for autolagringer fra de 11 minuttene 11. okt.

### Kjente problemer (runde 2)

- Delte forslag: når en lagring som lå i kø uten nett, kommer fram etter en nyere, kan dokumentets `updatedAt` gå
  bakover (Firestore har ingen «behold den største» for tekst); bare «sist endret» påvirkes, innholdet og versjonene er
  riktige.
- Redigering (fra før runden, tall fra gjennomgangens sveip; ingen nye):
  - **Hender som drar en ende ut og inn igjen**: av 940 drag (0,3 / 0,5 m i fire retninger, PC og telefon) kommer 840
    tilbake (335f2f1: 570). De 100 er lw-106-top 40 («Trapperepos» mistes), dv-kjk-w 20 («Passasje» / «Vindfang»),
    w-vf-korr.b 12 («Korridor (øvre)»), lw-landing.a 12 og w-106-korr.a 8 (dreier hemsveggen lw-106-top til
    [3,1, 2,50]). Romnavn som mistes på veien ut, kommer bare tilbake med «Ta tilbake», ikke ved å dra tilbake for hånd.
  - **Vegger som snur retning**: w-104-diag når w-104-103 flyttes +1 (flytt og drag), w-105-diag også når w-105-106
    flyttes +1, w-peis-w blir en snudd stubb på 8 cm når w-korr-stue flyttes +1 (flytt), lw-landing snur når
    lw-106-top flyttes +1 (flytt). w-105-diag snur også når w-104-s flyttes −1 eller w-106-korr +1.
  - **Kant ut og inn igjen**: blk-bod/v-bod-ne +1 og tilbake (i hvilke steg som helst) gir 26 rom («Ved» slått sammen
    med «Bod (ny)»).
  - **Spøkelse over en levende vegg**: etter hovedhusets sørvegg −0,3 og glassets østvegg −0,5 ligger
    dv-leseskrok-spøkelset over 0,5 m av den levende veggen i part-main-old når hovedhusets spøkelse er tatt tilbake.
- Drag av vegger, kanter og bygg står stille 0,4–0,8 s per oppdatering med 4 × tregere CPU (se «Ytelse»).
- De andre punktene under «Kjente problemer (fikserunde 2b)» og «(fase 2b)» gjelder fortsatt.

## Fikserunde 2b (12. okt 2026)

Den tredje gjennomgangen (møbler, delte forslag og offline, redigeringen; PC og iPhone, også mot den ekte Firestore)
fant 9 store og 15 mindre feil. De er rettet i tre parallelle deler (møbler i planen, den delte lagringen,
redigeringskjernen) og satt sammen her. To av de mindre er bare delvis rettet (se «Kjente problemer»).

### Gjort

- **Rotasjonshåndtaket tar ikke lenger trykk som er ment for noe annet** (`FurnitureLayer.tsx`): det treffes bare på
  den tegnede sirkelen; på telefon er den høyst 0,3 m i radius og vises ikke før planen er zoomet inn til ca. 33 px/m
  (ved startzoom bruker man «Roter» i menyen ved møbelet). Et trykk på håndtaket der det står over et annet møbel (også
  et teppe), en dør eller et vindu, en vegg, et spøkelse, en stolpe, rekkverket eller et romnavn går til det som ligger
  der. Før: med senga valgt dreide et trykk på garderoben, lenestolen eller døra senga 90°. (Endret i runde 2:
  håndtaket står på en ledig side og dreier alltid.)
- **Knip med én finger på håndtaket zoomer** (`usePanZoom.ts` `holdPointer` / `passPointer`): planen ser fingeren på
  håndtaket, så to fingre er alltid en knipe, og håndtaket slipper trykket sitt (ingen dreiing). Før: senga ble dratt
  3,5 m ut på terrassen og planen zoomet ikke.
- **Møbelbiblioteket uten noe valgt** setter møbelet i et rom midt i den delen av planen som synes over arket (ellers
  rommet som ble brukt sist, så midt i huset). Før: hvert nytt møbel havnet lenger sør, under arket og ute på plenen.
  (Endret i runde 2: planen slik den var før arket åpnet, og naborom med plass.)
- **Spisebordene tegner ikke lenger stoler** i planen (stolene er egne møbler, som i 3D).
- **En stol skjøvet inn under et bord er ingen kollisjon** så lenge midten av stolen er høyst 0,25 m innenfor bordkanten
  og en del av setet stikker ut (stol og utestol under spisebord, utebord, salongbord og kjøkkenøy).
- **«Dupliser» / Ctrl+D** setter kopien på nærmeste ledige plass ved siden av: møbler mot en vegg langs veggen (neste
  ledige plass), frie møbler på et 5 cm-rutenett rundt originalen med samme dreining. I et fullt rom havner kopien et
  sted som bare er fritt for vegger (den kan stå oppå andre møbler); den faste forskyvningen på 0,3 m brukes bare når
  ingenting annet går (6 av seedens 57 møbler, i rom de ikke får plass i). Før: kopien sto i originalen eller i veggen.
  (Endret i runde 2: i et fullt rom et naborom, ellers «Ingen ledig plass til en kopi.».)
- **Et nytt bygg tar bare med seg sine egne møbler**: de som står i et av byggets rom. Settes et bygg over møbler på
  terrassen, skyves de ut på nærmeste side («Utebord» er flyttet ut av «Vedskjul».); flyttes eller slettes bygget,
  blir møblene stående. (Runde 2: også når bygget flyttes, dreies eller dras over dem; husets møbler skyves aldri.)
- **Drag av vegger, kanter og bygg viser omrisset ved pekeren i hvert skjermbilde**: planen tegner forhåndsbildets
  omriss (heltrukket) over omrisset der elementet sto (stiplet). Før ble omrisset ved pekeren kastet, så elementet
  flyttet seg bare når den tunge oppdateringen kom (hvert ca. 230 ms på PC). Se «Ytelse».
- **Dører og vinduer kommer tilbake** også når veggen settes tilbake i ujevne steg (−1, så +0,2 og +0,8); en
  veggende dratt tilbake for hånd lander på punktet i dag (spøkelsesendene er snappemål) og heles.
- **Ingen spøkelse over en levende vegg** mellom «Ta tilbake»-trinnene (hovedhusets sørvegg + glassets østvegg).
- **Vegger som flyttes, blir ikke skjeve**: en ende som ikke kan følge med, begrenser flyttingen (w-peis-n stopper på
  y 2,2, w-vf-kjk på x 9), en vegg i forlengelsen flyttes med (lw-106-top med w-106-korr), og «Ta tilbake» setter dem
  tilbake hele. lw-split kan ikke flyttes nordover lenger (før ble den skjev).
- **Telefon**: Nytt bygg når høyst max(0,25 m, 10 px) (ca. 0,87 m ved startzoom; et vedskjul trykket midt på terrassen
  blir stående der, før 2 m mot kanten); dører og vinduer har endehåndtak utenfor karmene ved startzoom, og bredden
  lagres i hele centimeter med den andre karmen fast.
- **Romnavn etter «Ta tilbake»**: rom som ble slått sammen av et tidligere «Ta tilbake», får flaten sin igjen når en
  senere tilbaketaking deler den (27 navngitte rom). Også det gamle tilfellet `w-bod-gavl` +1 gir seeden igjen.
- **Sletting uten nett skriver ikke over andres endringer**: slett, hent tilbake og «behold versjon» endrer bare
  feltene sine (aldri innholdet). Den som hadde en nyere utgave, får «… ble slettet av … på en enhet som ikke hadde sett
  de siste endringene dine …» med «Hent tilbake». Angre av en sletting henter tilbake; å skrive over et forslag i
  Papirkurven tar vare på det gamle som en tidligere versjon.
- **Statusen er ærlig etter en innlasting uten nett**: endringer som ligger i kø fra før, teller («Lagret her – sendes
  når du er på nett»), og «Lagre» venter på dem. Under en konflikt sier statusen «Ikke lagret – velg Hent endringene
  eller Lagre over», og nettleseren spør før siden lukkes (ikke på iPhone, som ikke har det). Ingenting lagres midt i
  et drag.
- **«Oppdater» i én fane** laster bare den fanen; de andre sier «Appen er oppdatert i en annen fane … [Last på nytt]».
- **Gamle autolagringer fra fase 1**: et vanlig besøk på den gamle nettsiden gir ikke noe forslag (sammenlignes med
  Forslag D slik fase 1 hadde den); en endret kopi blir «Forslag D (eget)» med en id som er unik for enheten, vises, og
  beholder sin egen «sist endret».
- **Familielenken**: en lenke som er kuttet av, starter aldri en ny plass (meldingen «Lenken til familiens plass er
  ikke hel …»; uten plass fra før lagres forslagene på enheten til hele lenken åpnes). Bytter enheten plass (også ved
  å lime inn en annen lenke i samme fane), huskes den gamle, og appen tilbyr «Hent forslagene fra den forrige plassen»
  for forslagene som ble laget på enheten der.
- **Ingen Google-skript på iPhone**: den anonyme innloggingen laster ikke lenger apis.google.com eller innloggingsvinduet.
- **Integrasjonen**: teksten «… er flyttet ut av …» ligger i `nb.editor` (den midlertidige `editFixStrings.ts` er
  borte); planen tegner det bevegelige omrisset heltrukket (`PlanFeedback.target`, `EditOverlay` `data-edit-moving`);
  tilbudet om å hente forslag sier «Hent forslaget …» / «Det legges til her …» når det er ett; et testtidsmål som
  feilet når maskinen var travel (`touchTaps` «furnished seed»), har fått 30 s og mistet en feilsøkingsutskrift.
- **Tester**: `npm test` 1684 tester i 97 filer, alle grønne. `npm run typecheck`, `npm run lint`, `npm run build` og
  `npx tsc --noEmit -p e2e/tsconfig.json` er rene. `npm run e2e` 56 av 56 grønne i tre prosjekter, 4 hoppet over (de
  mot den ekte Firestore):
  - nye på PC (`furniture.spec.ts` (E)–(H)): omrisset ved pekeren i hvert skjermbilde under et veggdrag, også når
    modellen ligger etter; Ctrl+D på lenestolen i Stue uten advarsel; hovedhusets sørvegg og glassets østvegg tatt
    tilbake ett spøkelse om gangen uten spøkelse over en levende vegg; en stol skjøvet inn under bordet;
  - nye på iPhone (`phone-furniture.spec.ts`): med senga valgt velger trykk på garderoben, døra og teppet dem og senga
    dreies aldri (også med håndtaket synlig); knip med én finger på håndtaket zoomer og flytter ingenting (begge
    rekkefølger), et trykk alene dreier; biblioteket → Slett → biblioteket tre ganger lander i et rom på skjermen; et
    vedskjul midt på terrassen blir innen 0,3 m; dørhåndtak ved startzoom og bredde i hele cm;
  - nye for forslagene (`proposals.spec.ts`, delt modus uten den ekte Firestore): en avkuttet `#f=`-lenke; bytte av
    plass i samme fane med tilbudet om å hente forslagene (en falsk Firestore i nettleseren);
  - ny for PWA (`offline.spec.ts`): to faner, «Oppdater» i den ene, den andre laster ikke på nytt av seg selv;
  - nye skjermbilder `plan-drag-preview.png`, `phone-rotate-handle.png`, `family-carry-over.png`; de andre er tatt på
    nytt (spisebordene uten stoler).
- **Prøvd mot den ekte Firestore** (`E2E_FIRESTORE=1`, engangsfamilier `e2e-…`, slettet etterpå over REST, 0 dokumenter
  igjen): A sletter uten nett mens B flytter badestampen → dokumentet beholder Bs innhold (bare `deletedAt`,
  `updatedAt` og `updatedBy` endres), B
  får meldingen og «Hent tilbake» henter Bs utgave på begge; produksjonsbygget: en endring uten nett og en innlasting
  uten nett viser endringen og «Lagret her – sendes når du er på nett» (også etter 3 s), tilbake på nett «Lagret for
  alle» og serveren har den; iPhone 13: innlogging og lagring kontakter bare `identitytoolkit` og `firestore`, ingen
  apis.google.com, `__/auth/iframe` eller getProjectConfig; den ekte fase 1-autolagringen gir ingen dokumenter, en
  endret gir «Forslag D (eget)» med id `forslag-d-eget-…` og sin egen «sist endret».

### Ytelse (målt 12. okt på denne maskinen)

Produksjonsbygget i hodeløs Chromium, 1400 × 900, «Mitt forslag», 30 musebevegelser med 16 ms mellomrom, tre kjøringer
(medianen). Lange oppgaver = oppdateringene av modellen (antall, median, maks). «Lengste stopp» = det lengste
mellomrommet mellom to skjermbilder under draget (hodeløs Chromium har selv opptil ca. 170 ms uten noe å gjøre).
«Etter pekeren» = hvor langt det tegnede omrisset ligger etter pekeren langs draget, i skjermbildene som ble tegnet.

| Drag | Normal CPU: lange oppgaver · lengste stopp · etter pekeren | 4 × tregere CPU: lange oppgaver · lengste stopp · etter pekeren |
|---|---|---|
| Vegg (`w-gang-n`) | 8 (78 ms, maks 132) · 133 ms · median 0,10 m, maks 0,15 m | 9 (362 ms, maks 670) · 550 ms · 0,10 / 0,15 m* |
| Kant (fløyas østkant) | 8 (83 ms, maks 96) · 167 ms · 0,10 / 0,15 m | 10 (406 ms, maks 440) · 450 ms · 0,10 / 0,15 m* |
| Enhet (Vedskjul, kroppen) | 7 (80 ms, maks 92) · 417 ms · 0,10 / 0,15 m | 9 (408 ms, maks 490) · 500 ms · 0,10 / 0,15 m* |

\* Rettet i runde 2: disse tallene gjelder bare trinnvis input der målingen ventet på hvert skjermbilde. Med
sanntidsinput kan det første bildet etter en oppdatering ligge 0,6–0,8 m etter, og skjermen står stille 0,4–0,8 s (se
«Ytelse» under runde 2).
| Dør (`door-mellom-vf`) | ingen · 300 ms | 6 (52 ms, maks 105) · 217 ms |
| Badestamp | ingen · 183 ms | 10 (70 ms, maks 89) · 150 ms |
| Møbel (senga) | ingen · 50 ms | 1 (55 ms) · 67 ms |

I Node (w-gang-n, enhetstesten): `previewDrag` 0,10 ms, et skjermbilde med bare forhåndsbildet 1,2 ms, `updateDrag`
49 ms og avledningen 48 ms, et skjermbilde med en oppdatering ca. 120 ms, en oppdatering omtrent hvert 98. ms; før
runden flyttet veggen seg ca. hvert 219. ms. Ærlig sagt: omrisset følger nå pekeren i hvert skjermbilde som blir
tegnet (høyst 0,15 m etter med normal CPU, rutenettet er 0,1 m; med 4 × tregere CPU se runde 2), men selve
oppdateringene er like tunge som før (70–90 ms på PC, 360–670 ms med 4 × tregere CPU), og mens en av dem
går, står skjermen stille. Det tallet i «Ytelse» under fase 2b som sa at forhåndsbildet ble tegnet hvert skjermbilde,
stemte ikke før denne runden. Neste skritt er fortsatt den inkrementelle avledningen («Neste» 4).

### Avgjort i fikserunde 2b (Robin kan endre)

- **Rotasjonshåndtaket på telefon** vises først fra ca. 33 px/m (høyst 0,3 m stort); ved startzoom dreier man med
  «Roter» i menyen ved møbelet.
- **Stoler under bord**: grensen er målt fra midten av stolen (høyst 0,25 m innenfor bordkanten), ikke fra setet; en
  stol skjøvet 0,375 m inn under kanten teller dermed ikke som kollisjon.
- ~~**«Dupliser» i et fullt rom** legger kopien et sted som er fritt for vegger, men kan stå oppå andre møbler (rødt
  med advarsel); den faste forskyvningen er siste utvei.~~ Erstattet i runde 2 (naborom, ellers nektet).
- **Et nytt bygg over møbler** skyver dem ut (med en toast) i stedet for å ta dem med; byggets egne møbler er de som
  står i rommene dets.
- **lw-split kan ikke flyttes nordover** (enden ved trappeåpningen står fast); før ble veggen skjev.
- ~~**Romnavn etter tilbaketaking** leses fra angreloggen (rommene som fantes ved siden av), ikke fra et nytt felt i
  dataene (ingen ny skjemaversjon).~~ Erstattet i runde 2: `Variant.mergedRooms` (fortsatt ingen ny skjemaversjon).
- **Den gamle autolagringens forslag** får id-en `forslag-d-eget-<hash>` (av autolagringens egen prosjekt-id og tider)
  i stedet for en tilfeldig id, så en ny import aldri lager en kopi til.
- **Forslag laget før 2b får ingen møbler** (de er kopier av Forslag D slik den var da); Forslag D og nye forslag er
  møblert. Et gammelt forslag kan møbleres fra biblioteket.

### Kjente problemer (fikserunde 2b)

- Redigering: ~~av 25 drag ut og inn igjen av veggender kommer 24 tilbake~~ (rettet i runde 2: av 940 kommer 840
  tilbake, se «Kjente problemer (runde 2)»); `w-vf-korr.b` −0,5 snapper først på hjørnet til `w-vf-kjk`, og draget
  tilbake tar naboen med. `w-105-diag` snur fortsatt retning når `w-104-s` flyttes −1 eller `w-106-korr` +1 (var der
  før runden).
- Delte forslag uten familie (`noFamily`, avkuttet lenke på en ny enhet): noen tekster (førstegangskortet, «Slett for
  alle») bruker ordlyden for den delte plassen.
- Ved startzoom på telefon ligger den 0,6 m dype garderoben i Soverom (ny fløy) inne i veggens trykkbånd: et trykk på
  den velger veggen (zoom inn for å velge garderoben). Et romnavn over et møbel vinner fortsatt på telefon.
- Drag av vegger, kanter og bygg står stille mens en oppdatering går (se «Ytelse»).

## Fase 2b – møbler, delte forslag, offline (integrert 12. okt 2026)

Fem parallelle deler (møbelkjernen, møbler i planen, møbler i 3D, delte forslag/offline, finpuss av redigeringen i
kjernen og i planen) er satt sammen her, og alle funnene fra den andre gjennomgangen av 2a er tatt (dra-ytelsen for
vegger, kanter og enheter fortsatt delvis, se «Ytelse»).

### Gjort

- **Møbler** (`src/furniture/catalog.ts`, `geometry/furnitureDerive.ts`, `state/editActions.ts`):
  - Katalogen har 50 møbler i 7 kategorier (Soverom, Stue, Kjøkken, Bad/WC, Badstue, Annet, Ute) med størrelser,
    strekkbare mål, farger, plassbehov, symbol og 3D-modell. Et ukjent møbel vises som en boks med advarselen.
  - Avledningen finner rommet og nivået under møbelet (en seng dratt fra Korridor (øvre) til Soverom 1 står på
    underetasjen), gulvhøyden (rom, terrasse eller terreng), plassbehov, kollisjoner (møbler, vegger, trapper, pipe,
    stolper, badestamp; en stol i en døråpning står ikke «i veggen») og dører som blokkeres. Hjørnesofaen kolliderer
    som en L, så salongbordet kan stå i hjørnet.
  - Advarslene sier hva og hvor: «Døra i veggen mellom Gang og Hovedbad blokkeres av «Toalett».», «Møbelet «Seng 150»
    står i trappa / i pipa / i en stolpe / i badestampen.», «Toalett trenger sluk …».
  - Handlinger: sette inn (størrelse fra katalogen, nivå fra gulvet), flytte (nivået følger gulvet, også under drag),
    rotere, duplisere (kopien blir valgt og står ved siden av, se fikserunde 2b), slette, endre størrelse (bakkanten blir stående), farge. Forslag D nekter
    alt. Møbler med ryggen mot en vegg som flyttes, følger veggen, og «Ta tilbake» setter dem nøyaktig tilbake.
  - **Seeden er møblert** (`SEED_REVISION` 6, `seed/furniture.ts`, 57 møbler `fu-<rom>-<n>`) etter den gamle modellens
    `buildD150()`, uten advarsler. Romskjema, arealer og farger for Forslag D er uendret.
- **Møbler i planen** (`plan2d/layers/FurnitureLayer.tsx`, `furnitureSymbols.ts`): hvert katalogmøbel har sitt eget
  symbol; det valgte får ramme, navn, plassbehov og et rotasjonshåndtak (trykk: 90°, dra: 15°-trinn, Alt: 1°; på
  telefon fra ca. 33 px/m, se fikserunde 2b); møbler
  i en vegg, oppå hverandre eller i et dørslag blir røde. «Plassbehov for møbler» under Vis viser plassbehovet for alle
  (huskes). Romnavn flytter seg bort fra møblene der de kan.
- **Møbelbiblioteket** (`ui/FurnitureLibrary.tsx`): søk (store/små bokstaver og æ/ø/å likegyldig, noen synonymer som
  «wc»), kategorier med antall (rommets kategori åpnes først), symbol, navn og mål. Trykk setter møbelet i det valgte
  rommet (eller i et rom midt i den synlige delen av planen) mot nærmeste ledige vegg, dusjer i et hjørne, bord og tepper mot midten; dra det inn i
  planen (planen viser hvor det havner, rødt hvis plassen er opptatt) eller 3D-visningen (på telefon: hold fingeren på
  det først). På telefon er biblioteket et ark som lukkes etter innsettingen.
- **Møbel i Egenskaper** (`ui/properties/FurnitureProps.tsx`): Navn, Rom, Størrelse, Bredde/Dybde (der møbelet kan
  strekkes, innenfor katalogens grenser), Farge, «Roter 90°», «Dupliser», «Slett».
- **Møbler i 3D** (`view3d/Furniture.tsx`, `furnitureBuilders.ts`): en egen modell for hvert av de 50 møblene i den
  gamle modellens farger og stil, i møbelets farge, rød ved kollisjon, kuttet i «Inne». Flytting og rotering gjenbruker
  geometrien; hele seeden bygges på ca. 4 ms. Et møbel sluppet i 3D havner på gulvet der strålen treffer.
- **Delte forslag** (`state/familyStore*.ts`, `ui/ProposalsMenu.tsx`, `StatusPill.tsx`, `ShareDialog.tsx`,
  `TrashPanel.tsx`, `RevisionsPanel.tsx`): forslagene ligger i familiens plass i Firestore (Firebase er satt opp, reglene
  er publisert og **uendret** i denne runden). Familielenken er `https://robinharald.github.io/hytte-planlegger/#f=<32
  tegn>`, og `#f=…&p=<forslag>` åpner ett forslag. Forslag-menyen (Forslag D først, så familiens forslag med «sist endret
  av …»), «+ Nytt forslag», Gi nytt navn, Slett med to bekreftelser og Papirkurv i 30 dager, Tidligere versjoner (inntil
  20, høyst én per 5 minutter), «Hva heter du?» én gang per enhet, konfliktvakten («Hent endringene» / «Lagre over»),
  Lagre som fil / Åpne fil / Eksporter JSON under Mer. Gamle `#d=`-lenker og den gamle autolagringen blir nye forslag.
- **Statusen**: «Lagret for alle» etter den anonyme innloggingen og første lagring; «Lagret her – sendes når du er på
  nett» uten nett (sendes av seg selv etterpå); «Kun på denne enheten (ingen delt plass satt opp)» uten
  Firebase-oppsett. Ny ved integrasjonen: får appen ikke lastet Firebase i det hele tatt (blokkert), lagres forslagene
  på enheten med «Kun på denne enheten (familiens plass kan ikke nås nå)», og når plassen kan nås (hvert 15. sekund og
  når enheten kommer på nett, eller ved neste oppstart) legges de inn i familiens plass. En endring som kommer fra en
  annen enhet viser ikke lenger «Lagrer …» et øyeblikk (og skrives ikke tilbake).
- **Prøvd mot den ekte Firestore** (to nettleserkontekster mot `npm run dev`, tre engangsfamilier `e2e-…`, alle
  dokumentene slettet etterpå, 0 igjen): statusen nådde «Lagret for alle» etter 1,6–4,2 s ved oppstart og 1,1–1,3 s
  etter «Nytt forslag»; forslaget fra A var i B med en gang B var koblet til; badestampen flyttet i B kom fram i A
  innen 2 ms etter at B hadde lagret («sist endret av Test B»); A uten nett: «Lagret her – sendes når du er på nett»,
  tilbake på nett «Lagret for alle» etter 0,25 s, og B fikk endringen.
- **Offline / PWA**: service worker (`./sw.js`, scope `./`) som mellomlagrer hele appen med fonter, ikoner og
  Firebase-delen; «Ny versjon av appen er klar. [Oppdater]» (lagrer først); PNG-ikoner (180, 192, 512, 512 maskable),
  manifest uten `start_url` (Hjem-skjerm-appen åpner adressen den ble lagt til fra, med familielenken); kortet «Legg
  planleggeren på Hjem-skjermen» på iPhone; `navigator.storage.persist()`.
- **Bygget for GitHub Pages**: relativ base `./`. Sjekket ved at pwa-testen nå serverer produksjonsbygget under
  `/hytte-planlegger/` (`vite preview --base`): alle skript, stiler og fonter lastes fra den stien, service workeren
  har scope `/hytte-planlegger/`, manifestets `scope` er `./`, og appen starter uten nett. Firebase er egne, lazy
  deler (`familyStore.firestore-*.js` og Firebase-SDK-ene).
- **Finpuss av redigeringen** (funnene fra den andre gjennomgangen):
  - Glassutbygget: «Ta tilbake» etter hovedhusets sørvegg +0,3 og glassets østvegg +0,5 gir seeden igjen, møblene
    også (før: et løst spøkelse inne i huset); to innoverflyttinger av glasset etterlater ingen spøkelser.
  - En kant av hytta i dag som flyttes innover, blir «Nytt» (før: «Hytta i dag»).
  - «Ta tilbake» etter et drag som snappet på et naboendepunkt drar ikke med seg urørte vegger.
  - Dører og vinduer kommer tilbake på plass også når veggen flyttes tilbake i flere steg, og på en nabovegg som ble
    dreid og satt tilbake.
  - En kopi fra revisjon 4 med glasset gjort større får «i dag»-delen fra spøkelseslinjene.
  - En fri enhet utenfor 10 cm-rutenettet dreies om sin egen midte og kommer tilbake etter +90/−90.
  - Telefon: et vedskjul satt ut 0,4 m fra fløya fester seg (plasseringen når hele fingerradiusen igjen), og ved drag
    når kontaktmål (fløyveggen, terrassekanten) minst så langt som dra-terskelen.
  - Telefon: et trykk på det valgte som flyttes mer enn 5 px er et drag (en Vedskjul flyttes 0,5 m ved startzoom; før
    trengtes 0,87 m).
  - Telefon: «Bod (ny)» velges med et trykk på navnet; dører har endehåndtak fra halv håndtaksdiameter.
  - Et klikk midt på `win-106-s` velger vinduet, neste klikk dørspøkelset under det.
  - Endepunkt-drag: hjelpelinjer kan ikke dra enden mer enn 0,25 m forbi fingeren, og linjer i andre etasjer teller
    ikke.
  - `w-103-korr` dratt rett sørover blir parallell (enden i hjørnet følger med).
  - Dra-sløyfa tegner et lett forhåndsbilde hvert skjermbilde og gjør den tunge oppdateringen bare hvert 2.–9. bilde
    (se «Ytelse»).
  - Løse vegger sier hvor de står («veggen nord i Stue», «på terrassen», «sør for «Bod-fløy»»), og like linjer slås
    sammen («3 vegger nord i Stue henger løs …»); merket i Advarsler teller alle.
  - Førstegangskortet sier riktig hvor det lagres (delt plass eller bare denne enheten) og nevner møbler.
- **Integrasjonen ellers**: alle tekster ligger i `nb.ts` (biblioteket, Møbel-redigereren, rotasjonshåndtaket, stedene
  for løse vegger, møbeladvarslene; de midlertidige `furnitureStrings.ts` og `warningStrings.ts` er borte);
  Møbler-hintet «Trykk på et møbel i listen for å sette det inn, eller dra det inn i planen.»; de gamle dialogene
  Send forslaget / Versjoner og plassholderne (`FurnitureEditor`, `FurnitureMeshes`, `buildFurnitureBox`) er fjernet;
  ordbrukstesten for engelske ord virker igjen (regex-en hadde tilbaketegn i stedet for `\b`).
- **Tester**: `npm test` 1613 tester i 93 filer, alle grønne (1245 før 2b). `npm run typecheck`, `npm run lint`,
  `npm run build` og `npx tsc --noEmit -p e2e/tsconfig.json` er rene. `npm run e2e` 43 av 43 grønne i tre prosjekter
  (`chromium`, `iphone`, `pwa`):
  - `furniture.spec.ts` (PC): toalett i Hovedbad fra biblioteket (plassbehovet vises), dratt inn i dørslaget →
    «… blokkeres av «Toalett»», rotert, duplisert, slettet; senga i Soverom (ny fløy) dratt fra veggen og tilbake →
    snapper mot veggen; sørvegg +0,3, glass +0,5 og «Ta tilbake» på alle spøkelser → seeden med møbler; et klikk midt
    på `win-106-s` velger det; 3D Inne ovenfra.
  - `phone-furniture.spec.ts` (iPhone): stol fra arket og dratt 1 m; Forslag-menyen: lage og gi nytt navn; vedskjul
    0,4 m fra fløya fester seg og flyttes 0,5 m ved startzoom; «Bod (ny)» på navnet.
  - `proposals.spec.ts` (PC): lage, laste på nytt, gi nytt navn, slette med to bekreftelser, Papirkurv og tilbake,
    status, Send forslaget, gammel `#d=`-lenke, gammel autolagring. `offline.spec.ts` (pwa): bygget under
    `/hytte-planlegger/`, ny innlasting uten nett.
  - Endret: trykk på rom i telefontesten treffer navnet eller gulvet ved siden av møblene (9 rom, minst 8, «Bod (ny)»
    alltid); romnavn med areal ≥ 10 (før ≥ 15); «Hent ny Forslag D» er fjernet (Forslag D er alltid den nyeste).
  - Nye skjermbilder: `plan-furnished.png`, `3d-inne-furnished.png`, `phone-library.png`, `proposals-menu.png`,
    `share-dialog.png`; de andre er tatt på nytt (møblert).

### Ytelse (målt 12. okt på denne maskinen)

Produksjonsbygget i Chromium, 1400 × 900, «Mitt forslag», 30 musebevegelser med 16 ms mellomrom. Skjermbildene går
jevnt mellom de lange oppgavene (median 16,7 ms); tabellen viser de lange oppgavene (antall, median, maks), det er
oppdateringene av modellen.

| Drag | Normal CPU | 4 × tregere CPU |
|---|---|---|
| Dør (`door-mellom-vf`) | ingen | 1 (71 ms) |
| Vegg (`w-gang-n`) | 9 (81 ms, maks 95) | 11 (338 ms, maks 369) |
| Kant (fløyas østkant) | 9 (71 ms, maks 79) | 10 (343 ms, maks 395) |
| Enhet (Vedskjul, kroppen) | 9 (71 ms, maks 81) | 10 (393 ms, maks 411) |
| Badestamp | ingen | 11 (68 ms, maks 76) |
| Møbel (senga) | ingen | 1 (62 ms) |

Før runden (andre gjennomgang): vegg og kant ga 27 lange oppgaver på 64–78 ms per 30 bevegelser (ca. 13–15 bilder i
sekundet); med 4 × tregere CPU 14 på ca. 290 ms. Planen oppdaterer modellen hvert 150. ms når oppdateringen tar 75 ms:
en tredjedel så mange stopp, men hver av dem er like lang. Forhåndsbildet skulle tegne omrisset ved pekeren hvert
skjermbilde, men omrisset ble kastet på veien (den tredje gjennomgangen); det er rettet i fikserunde 2b (målt der). Avledning i Node: møbeltrinnet alene 0,3 ms, en endring av bare møbler ca. 0,5 ms (grense 5).

### Avgjort i 2b (Robin kan endre)

- **Tepper velges på kanten**; midt på teppet velger man rommet under (ellers var Leseskrok og Soverom (ny fløy)
  nesten umulige å velge). Teppet tegnes under de andre møblene.
- **Romnavn og møbler**: med mus vinner møbelet under et romnavn (senga i Soverom (ny fløy) kan dras fra midten),
  på telefon vinner navnet (rom velges der på navnet). Et nytt trykk på det valgte møbelet gir rommet under, og et
  nytt trykk på det valgte rommet gir møbelet under.
- **Et romnavn som flytter seg bort fra møblene kan miste arealet** («Soverom (ny fløy)» alene); ved startzoom på PC
  viser 11 av 21 navn arealet (17 uten møbler). Romskjema og Egenskaper har alle arealene.
- **Dra-terskel på telefon for det valgte: 5 px** (planen sa 6; 0,5 m ved startzoom er 5,8 px). Et trykk på det valgte
  som glir mer enn 5 px, flytter det (Angre retter det).
- **Kopien fra «Dupliser» blir valgt.** Det valgte møbelet viser alltid plassbehovet sitt.
- **Firebase som ikke lastes** gir lokal lagring for økten og flytting inn i familiens plass senere (se «Gjort»).
- Seeden: sengehodene mot endeveggen; senga i Soverom 2 0,5 m sør (ut av slaget til `d-105`); Soverom 3 får en
  90 × 190-seng; servantene flyttet ut av dørslag; hylla i pantryet er 0,28 m dyp; hylla i Bod (ny) og benken i
  Mellombygg står ikke foran en dør; hjørnesofaens rygg på romdeleren y 2,2; den gamle peisen er en Vedovn i hytta i
  dag; vasketårn i Hovedbad, vaskemaskin i Teknisk.
- Forslag D lagres aldri i den delte plassen (alltid den som følger med appen); manifestet har ingen `start_url`.
- Røyktesten «Hent ny Forslag D» er tatt bort; erstatningen er i `proposals.spec.ts`.

### Neste

Se «Neste» øverst (fase 2b er pushet og publisert, og fase 3 er gjort).

### Kjente problemer (fase 2b)

- Møbler: ved konkave hjørner med åpne sammenføyninger stikker de avledede ytterveggene 0,16 m inn i rommet
  (pantryets sørvesthjørne), så et møbel der får kollisjon. Bjelker teller ikke, vinduer blokkeres aldri, og
  plassbehov gir ingen advarsel. Bokhylla i Leseskrok dekker vestvinduet (som i den gamle modellen).
- Møbler i 3D: dusjveggen har alltid glass foran og på +x-siden, hjørnesofaen har ingen speilvendt utgave, rød
  farge bare ved kollisjon (ikke når et møbel blokkerer en dør), og fargene blir litt lysere enn hex-verdien.
  Ingen forhåndsvisning når et møbel dras over 3D-visningen (slippet virker).
- Et romnavn som står over et lite møbel ved startzoom på telefon dekker det (et nytt trykk gir møbelet).
- Delte forslag: en utgave som ble skrevet over av en lagring uten nett, reddes bare hvis enheten har appen åpen når
  den sene lagringen kommer; en endring fra en annen enhet lukker en åpen Angre-toast; Papirkurven har ingen «Tøm nå»
  (den tømmer seg selv etter 30 dager); å åpne en lenke til en annen familie laster siden på nytt (den gamle huskes,
  og forslagene laget her tilbys i den nye); uten IndexedDB viser delt modus uten nett bare Forslag D;
  `controllerchange` alene (en fane som aldri så den ventende versjonen) er ikke enhetstestet; den ekte delte plassen
  er prøvd i Chromium på PC og med iPhone 13-emulering, ikke på en ekte iPhone. Konfliktvarselet før siden lukkes
  finnes ikke på iPhone (Safari har ikke `beforeunload`).
- Chrome på PC tilbyr kanskje ikke «Installer» (manifestet har ingen `start_url`); iPhone påvirkes ikke.
- Redigering: (rettet i fikserunde 2b: «Ta tilbake» etter `w-bod-gavl` +1 gir seedens 27 navn igjen.) En enhet utenfor
  rutenettet i begge retninger
  som dreies inn på rutenettet, kommer ikke helt tilbake (planen setter aldri ut en slik). En dør brukeren selv har
  flyttet ≤ 15 cm kan bli trukket tilbake når veggen dreies og settes tilbake.
- Dra-ytelse for vegger, kanter og enheter: se «Ytelse» i fikserunde 2b (70–90 ms per oppdatering på PC, 360–670 ms
  med 4 × tregere CPU; omrisset følger pekeren mellom oppdateringene).
- Playwright: Chromiums berøringsemulering mister av og til klikket fra et trykk rett etter en knipe-zoom og et drag;
  telefontesten trykker da en gang til (ikke sett på ekte telefoner).
- Det gamle tidsmålet for avledning (`derive.schema2.test.ts` «is fast») kan feile når hele testsettet kjører i
  parallell; det tar nå beste av 20 kjøringer.

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
  - Et glassutbygg som alt var gjort større før revisjon 5, beholder den økningen som «hytta i dag» bare til første
    endring (endret i 2b: da bygges «i dag»-delen fra spøkelseslinjene).
- **BYA i dag kan synke litt** når en gammel kant flyttes ut: kledningsstripa som havner inne i bygget, telles som ny
  (glassets østvegg +0,5: 102,18 → 101,905), som vedtatt for vestgavlen.
- **Treffbåndet ved berøring er minst 10 px, ikke 12.** Ved 11,6 px/m ligger hvert punkt i «Bod (ny)» innenfor 5,5 px
  av en vegglinje, så 12 px ville gitt bare 21 av 24 romnavn.
- **Snapping når ting flyttes** legger aldri til mer enn halve draget (`SNAP_ADD_FRACTION` 0,5). Skyggen fra Nytt bygg
  fester seg innen hele pekerradiusen, 12 / 24 px (endret i 2b; i runde 2 bare 0,25 m, og en Vedskjul 0,4 m fra fløya
  festet seg ikke på telefon).
- **En enhet som dreies inntil noe**, kan bli stående 5 cm utenfor 10 cm-rutenettet; frie enheter på rutenettet dreies
  på rutenettet, frie enheter utenfor det dreies om sin egen midte og beholder forskyvningen (2b).
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
- Dra-ytelse for vegger, blokk-kanter og satt ut enheter: hver oppdatering avleder hele byggetrinnet (ca. 40–48 ms i
  Node). Siden 2b tegnes et lett forhåndsbilde mellom oppdateringene (se «Ytelse» under fase 2b); et bilde der
  avstemmingen endrer rommene, avleder fortsatt to ganger. Neste steg: inkrementell vegg- og romavledning.
- BRA eks. kan stige litt når en gammel kant flyttes ut, fordi det høyere taket gir hemsen mer målbar høyde
  (nordkanten +1: 103,51 → 104,72).
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
   seed (revisjon 4 er skjema 2, revisjon 5 glassutbyggets «i dag»-del, revisjon 6 møblene i fase 2b).

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
