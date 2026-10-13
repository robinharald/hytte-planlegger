# Slik setter du opp familiens delte plass (Firebase) – ca. 5 minutter

Planleggeren lagrer alle forslag i en delt plass i skyen, slik at alle i familien ser de samme forslagene på PC, iPad og
telefon. Den delte plassen ligger i **Firebase** (Google). Gratisplanen holder i mange år for dette bruket, det trengs ikke
betalingskort, og det lagres ingen personopplysninger utover navnene dere selv skriver inn («Mamma», «Pappa»).

Robin må gjøre dette én gang med sin Google-konto. Alt annet gjør Claude.

1. Gå til https://console.firebase.google.com og logg inn med Google-kontoen din.
2. **Legg til prosjekt** → navn `hytte-planlegger` → skru gjerne av Google Analytics → **Opprett prosjekt**.
3. I menyen til venstre (under «Product categories»): **Databases & Storage → Firestore Database → Create database**.
   (I eldre utgaver av konsollen heter menyen «Build».)
   - Location: `europe-west3` (Frankfurt) eller `europe-north1` (Finland).
   - Velg **Start in production mode** → **Create**.
4. I menyen til venstre: **Security → Authentication → Get started → fanen Sign-in method → Anonymous → Enable → Save.**
   (Anonym innlogging gir hver enhet en usynlig id, så ingen trenger passord.)
5. Øverst til venstre: tannhjulet → **Project settings** → fanen **General** → rull ned til **Your apps** →
   klikk web-ikonet `</>` → kallenavn `hytteplanlegger` → **ikke** huk av for Hosting → **Register app**.
   Du får et utdrag som ser slik ut:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "hytte-planlegger-xxxx.firebaseapp.com",
     projectId: "hytte-planlegger-xxxx",
     storageBucket: "hytte-planlegger-xxxx.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abcdef"
   };
   ```

   Kopier hele utdraget og lim det inn i chatten til Claude (eller i fila `src/state/firebaseConfig.ts`). Disse verdiene er
   ment å være offentlige; sikkerheten ligger i reglene i neste punkt og i at lenken til familiens plass er umulig å gjette.
6. Reglene: **Databases & Storage → Firestore Database → fanen Rules** → erstatt innholdet med innholdet i fila `firestore.rules` i
   prosjektmappen (Claude lager den) → **Publish**.

Det var alt. Når konfigurasjonen er limt inn og nettsiden er publisert på nytt, viser statusen i appen «Lagret for alle»,
og lenken du sender familien inneholder id-en til deres delte plass (se «Familielenken» under).

## Familielenken

Første gang appen åpnes på en enhet uten lenke, lager den en ny, tilfeldig id for familiens plass (32 tegn) og
husker den. Adressefeltet viser den hele tiden. **Send familielenken til familien før de åpner nettsiden, og be dem
åpne nettsiden bare med den** (også første gang, og når de legger den på Hjem-skjermen): den som åpner den vanlige
adressen uten lenke, får sin egen, tomme plass.

- **Familielenke:** `https://robinharald.github.io/hytte-planlegger/#f=<familie-id>` – den du sender familien. Den som
  åpner den, kommer inn i den samme delte plassen og ser alle forslagene.
- **Lenke til ett forslag:** `…/#f=<familie-id>&p=<forslag-id>` – åpner familiens plass med det forslaget på skjermen.
  «Send forslaget» sender denne (via delingsarket på telefonen, ellers kopieres den), og viser begge lenkene.
- Id-en må være 24–64 tegn (bokstaver, tall, `-` og `_`), ellers slipper reglene ingen inn. Tegn som en melding eller
  en setning legger rett etter lenken (`.` `,` `)` og lignende), tas bort. Id-ene appen lager, er nøyaktig 32 tegn: en
  id på 33 tegn som slutter på `_` eller `-` (lenken kopiert med understreken eller bindestreken rundt den, f.eks.
  kursiv `_…_` i en chat), er den samme id-en uten det siste tegnet. En lenke der id-en ikke er
  hel (kuttet av i en melding), starter aldri en ny plass: appen sier fra («Lenken til familiens plass er ikke hel …»)
  og bruker plassen enheten hadde fra før. Har enheten ingen, lagres forslagene bare på enheten (statusen sier
  «Kun på denne enheten (familielenken er ikke hel)») til hele familielenken åpnes; da flyttes de inn i plassen.
- Åpner en enhet **uten** plass en lenke til en plass som er **tom** (ingen forslag), spør appen først: «Denne plassen
  er tom. Er lenken hel?». Plassen huskes ikke, og ingenting flyttes inn i den (den gamle autolagringen, forslag som lå
  på enheten), før du trykker **Begynn her** eller lager et forslag der. Så lenge sier statusen «Ikke startet – plassen
  i lenken er tom» (aldri «Lagret»), også om meldingen lukkes. Har plassen forslag, brukes den med en gang.
- Åpner en enhet som **har** en plass, en familielenke til en **annen** plass (en ny lenke, en gammel fane, et
  bokmerke, en fane Safari åpner igjen – ved oppstart eller limt inn i en åpen fane), bytter den aldri av seg selv.
  Appen blir i plassen den bruker nå og spør: «Denne lenken går til en annen delt plass. Plassen i lenken har 3 forslag
  (Pappa, Mamma); plassen du bruker nå har 1.» med **Bytt dit** og **Bli her**. Knappen som er uthevet, er plassen med
  forslag som er laget på andre enheter («Bytt dit» bare når plassen i lenken har slike og plassen du bruker nå ikke
  har det; ellers «Bli her»). Ingenting lagres eller tilbys før du har valgt. «Bli her» lar alt være og viser plassen du
  bruker nå i adressefeltet igjen; så lenge du ikke har svart, står lenken i adressefeltet, og spørsmålet kommer igjen
  hvis fanen lastes på nytt. Har plassen i lenken ingen forslag, står det «… har ingen forslag (er lenken hel?)».
- **Bytt dit** bytter plass (siden lastes på nytt). Den gamle id-en huskes på enheten (`hytte-planlegger:family.previous`),
  og når den nye plassen har svart, tilbyr appen «Hent forslagene fra den forrige plassen» («Hent forslaget …» når det er
  ett) for forslagene som ble laget **på denne enheten** i den gamle plassen før byttet (enheten husker hvilke,
  `hytte-planlegger:family.created`). Svarer du ja, legges de inn i den nye plassen, og i den gamle havner de i
  Papirkurven (30 dager). «Nei takk» lar dem ligge i den gamle plassen; den kan fortsatt åpnes med sin egen lenke
  (`…/#f=<gammel id>`). Forslag andre har laget i den gamle plassen, tilbys ikke, og heller ikke forslag som selv ble
  hentet inn fra en annen plass (`hytte-planlegger:family.carried-in`): de blir værende der de er. Har den gamle
  plassen forslag fra **andre** enheter (den var familiens plass), er ingen av knappene uthevet, og meldingen sier fra:
  «Den plassen har også forslag fra andre. Henter du det hit, ser ikke familien det der lenger.»
- En **lenke til ett forslag** i en annen plass (`#f=<annen id>&p=<forslag-id>`, det «Send forslaget» sender) bytter
  aldri plass av seg selv. Appen spør: «Denne lenken går til «Mammas idé» i en annen delt plass.», sier hva de to
  plassene har, og gir tre valg: **Hent «Mammas idé» som en kopi hit** (en kopi legges til i plassen du bruker nå og
  vises; den andre plassen røres ikke, og den samme lenken to ganger gir ikke to kopier), **Bytt dit** (som over; etter
  byttet vises «Mammas idé») og **Bli her**. «Bytt dit» er uthevet etter samme regel som over (plassen i lenken har
  forslag fra andre, plassen du bruker nå har ingen – en enhet som har havnet i en plass for seg selv, kommer slik inn i
  familiens plass); ellers er kopien uthevet. En kopi regnes som hentet inn så lenge den er urørt; endrer du den på
  denne enheten, regnes den som laget her og tilbys ved et senere «Bytt dit», så endringene ikke blir liggende igjen.
- En gammel lenke til ett forslag i plassen enheten byttet fra (`#f=<gammel id>&p=<forslag-id>`), der forslaget er
  hentet hit, åpner forslaget her uten å spørre («… fra lenken finnes alt i listen.»).
- **Andre faner som står åpne** på samme enhet: bytter én fane plass («Bytt dit», eller en ny enhet som får sin første
  plass), viser de andre fanene «Denne enheten har byttet delt plass i en annen fane.» med **Last på nytt**. De kan ikke
  endres lenger (verktøyene og «+ Nytt forslag» er borte, planen tar ikke imot endringer) og lagrer ingenting mer
  (statusen sier «Ikke lagret – last siden på nytt»). Det som var endret i fanen før byttet, lagres i plassen den
  viste. «Last på nytt» åpner plassen enheten bruker nå.
- **«Hva heter du?»** kommer aldri som en egen dialog mens noen endrer: er navnet ukjent, spør «+ Nytt forslag» om det
  i samme vindu som navnet på forslaget («Navn på forslaget» og «Hva heter du?»; navnet kan stå tomt). Lagres noe uten
  navn på en annen måte (f.eks. «Nytt forslag» i meldingen om at Forslag D er låst), kommer spørsmålet som en melding
  over planen med **Skriv navnet** og **Hopp over** når ingenting er endret på 3 sekunder. «Hopp over» spør aldri
  igjen; navnet kan endres under Mer → «Endre navnet ditt».
- Gamle lenker med `#d=` (en kopi av et forslag i selve lenken) virker fortsatt: forslaget legges til som et nytt
  forslag i familiens plass. Den samme lenken to ganger legger det ikke til to ganger.
- Forslag som lå lagret i nettleseren fra før (den gamle autolagringen), flyttes inn i familiens plass første gang,
  med sin egen «sist endret»-tid, og det som var på skjermen vises (også etter at appen er lastet på nytt). En urørt
  Forslag D (et vanlig besøk på den gamle nettsiden, også fra de 11 minuttene 11. oktober da nettsiden hadde
  revisjon 2 av Forslag D, og kopien «Hent ny Forslag D» la til) flyttes ikke; en endret Forslag D heter «Forslag D
  (eget)» og får en id som er unik for enheten. En kopi med eget navn («Mammas utkast») flyttes også når den er
  urørt; en urørt «Dupliser» fra fase 1 som fortsatt heter «Forslag D (kopi)», flyttes ikke.
- På iPhone: legg appen på Hjem-skjermen mens familielenken er åpen. En app på Hjem-skjermen har sin egen lagring og
  åpner adressen den ble lagt til fra (manifestet har med vilje ingen `start_url`), så den kommer rett inn i familiens
  forslag.

Forslag D ligger ikke i den delte plassen: det følger med appen, er låst og er alltid den nyeste utgaven.

## Hva statusen øverst betyr

| Status | Betyr |
|---|---|
| «Lagret for alle» | Familiens delte plass har bekreftet alle endringene fra denne enheten (også dem som lå i kø fra før appen ble lastet på nytt). Alle med familielenken ser dem. |
| «Lagrer …» | En endring er på vei: appen venter et øyeblikk etter siste endring (og til et drag er sluppet), eller plassen har ikke bekreftet den ennå. |
| «Lagret her – sendes når du er på nett» | Du er uten nett, og minst én endring ligger i kø på denne enheten (også etter at appen er lastet på nytt uten nett). Den sendes av seg selv når nettet er tilbake. |
| «Ikke lagret – velg Hent endringene eller Lagre over» | Forslaget ble endret (eller slettet) et annet sted mens du endret det her. Endringene dine i det forslaget lagres ikke før du velger i meldingen over planen. Lukker du appen før det, er de borte (på PC spør nettleseren først). |
| «Kobler til …» | Appen starter forbindelsen til den delte plassen. |
| «Ikke koblet til familiens plass – lagres her» | Forbindelsen feilet (f.eks. første oppstart uten nett, eller Anonymous er slått av). Appen prøver igjen. |
| «Ikke lagret – prøver igjen» | Den delte plassen avviste en lagring (f.eks. regler som ikke er publisert). Endringen er ikke borte; appen prøver igjen. |
| «Kun på denne enheten (familiens plass kan ikke nås nå)» | Firebase kunne ikke lastes i det hele tatt (f.eks. blokkert av nettleseren). Appen virker som vanlig og lagrer forslagene på denne enheten; den prøver igjen hvert 15. sekund og når enheten kommer på nett, og legger da forslagene herfra inn i familiens plass. |
| «Kun på denne enheten (familielenken er ikke hel)» | Enheten har ingen familieplass, og lenken den ble åpnet med var kuttet av. Forslagene lagres på enheten til hele familielenken åpnes; da flyttes de inn i plassen. |
| «Kun på denne enheten (ingen delt plass satt opp)» | Appen kjører uten Firebase-oppsett (`firebaseConfig` er `null`): forslagene lagres bare i denne nettleseren. |
| «Kunne ikke lagre på denne enheten (lite plass?)» | Nettleseren har ikke plass. Lagre forslaget som fil (Mer → Lagre som fil). |
| «Ikke lagret – last siden på nytt» | En annen fane på denne enheten har byttet til en annen delt plass. Denne fanen kan ikke endres og lagrer ingenting mer; trykk «Last på nytt» i meldingen. |
| «Ikke startet – plassen i lenken er tom» | Enheten har ingen plass ennå, og lenken går til en tom plass. Ingenting er lagret der; trykk «Begynn her» eller lag et forslag for å begynne. |

På smale skjermer viser statusen en kort tekst («Lagret», «Lagret her», «Kun her», «Ikke startet» …); hele teksten står i
verktøytipset.

Endrer to personer det samme forslaget samtidig, viser appen ««X» ble endret av Pappa for 2 min siden.» med to valg,
og ingen av dem kaster noe:

- **Hent endringene**: deres utgave vises og lagres; din utgave legges under **Mer → Tidligere versjoner** (hvis den
  er forskjellig). Var forslaget slettet, blir det liggende i Papirkurven, med din utgave under Tidligere versjoner.
- **Lagre over**: din utgave lagres for alle; deres utgave legges under Tidligere versjoner (alltid, også om det er
  mindre enn fem minutter siden forrige versjon). Var forslaget slettet, hentes det tilbake med din utgave.

Den som fikk sin utgave lagt bort med «Lagre over», får beskjed: ««X» ble lagret over av Pappa. Din utgave ligger
under Tidligere versjoner.» med **Vis** (hvis appen er åpen der når lagringen kommer, også om den er lastet på nytt i
mellomtiden). Under Tidligere versjoner er utgaven merket «lagt bort ved Lagre over», versjoner som ble lagret på
denne enheten er merket «din», og to versjoner fra samme minutt vises med sekunder.

Lagret noen uten nett over en nyere utgave, legger appen den overskrevne utgaven under Tidligere versjoner og sier
fra (på enheten som laget den, hvis appen er åpen der når den sene lagringen kommer – også om appen er lastet på nytt
i mellomtiden). Sletting og «Hent tilbake» endrer bare om forslaget ligger i Papirkurven, aldri innholdet: slettet
noen uten nett et forslag en annen har endret i mellomtiden, ligger den nyeste utgaven i Papirkurven, og den som
endret det, får beskjed med «Hent tilbake» (hvis appen er åpen der når slettingen kommer).

Endringer lagres et sekund etter siste endring, og med en gang når appen legges bort (en annen app, Hjem-skjermen,
låseknappen på iPhone, eller fanen lukkes). Å lage et forslag («+ Nytt forslag», «Kopier») eller å bytte til et annet
forslag tømmer angrelisten: «Angre» er grå til du har endret noe i forslaget du ser på, så den fjerner aldri det nye
forslaget for alle og hopper aldri tilbake til en endring i et annet forslag. Et forslag slettes bare fra menyen, med
to bekreftelser (og slettingen kan angres).

## Hva som lagres

Bare dette, under `families/<familie-id>/…` (passer med reglene i `firestore.rules`):

- `proposals/<forslag-id>` med feltene
  - `name`: forslagets navn;
  - `project`: selve forslaget som JSON-tekst (et prosjekt med bare dette forslaget). Det har også med **tomta**
    (`site`): hyttas posisjon (`originLatLon`, breddegrad og lengdegrad), tidssonen, nordretningen, gulv- og
    vannhøyden, trærne og grunnarbeidene – de samme opplysningene som ligger i selve appen alle kan laste ned;
  - `schemaVersion`: hvilken utgave av dataformatet forslaget er lagret i;
  - `createdAt` / `createdBy` og `updatedAt` / `updatedBy`: når det ble laget og sist endret, og navnet personen
    skrev inn («Mamma»). Kommer en lagring som lå i kø uten nett fram etter en nyere, kan «sist endret» vise det
    eldre tidspunktet (Firestore kan ikke «beholde det største» for tekst); innholdet og versjonene er riktige;
  - `deletedAt`: når det ble lagt i Papirkurven (ellers tomt);
  - `lineage`: tidspunktene (`updatedAt`) til utgavene denne bygger på – slik ser appen at en lagring eller sletting
    uten nett ble gjort fra en eldre utgave;
  - `lastRevisionAt` og `revisions`: når den nyeste tidligere versjonen ble tatt, og id-ene til de tidligere
    versjonene. `lastRevisionAt` kan gå bakover på samme måte som `updatedAt` (en sen lagring uten nett); da tas
    neste versjon bare litt før de fem minuttene;
  - `overwrote`: bare etter «Lagre over» – tidspunktet til utgaven som ble lagt bort (slik ser enheten som lagret
    den, at den skal få beskjed); neste vanlige lagring setter det til tomt.
- `proposals/<forslag-id>/revisions/<id>`: inntil 20 tidligere versjoner – én per fem minutter med vanlige endringer,
  og i tillegg alltid utgaven som ble lagt bort ved «Lagre over», «Hent endringene» eller en lagring uten nett over en
  nyere utgave. Hver har `name`, `project`, `schemaVersion`, `savedAt` og `savedBy` (og `reason: 'saveOver'` for
  utgaven «Lagre over» la bort). En lagring legger til sin egen og fjerner bare de eldste; ingen versjon blir liggende
  utenfor listen (også når lagringen ble gjort uten nett fra en eldre utgave). Lagrer to enheter samtidig, kan listen
  en kort stund ha litt mer enn 20, og en lagring uten nett over en nyere utgave kan gi to like kopier av den samme
  eldre utgaven.

Avløpsstammene fra «Avløp og sluk» er en del av forslaget (`project`). Arkitektens IFC-fil, PDF-ene og PNG-bildene
sendes aldri til Firestore: IFC-modellen blir i nettleseren på enheten som lastet den inn, og PDF / PNG lagres eller
deles bare der du velger.

Ellers bare tidspunkter og id-er (tilfeldige tegn). Ingen e-post, ingen enhetsnavn, ingen nettleserinfo og ingen
posisjon for den som bruker appen. Innloggingen er anonym og laster ingen Google-skript eller innloggingsvinduer (bare
Firebase sine adresser for innlogging og database: `identitytoolkit.googleapis.com` ved første innlogging,
`securetoken.googleapis.com` som fornyer innloggingen omtrent én gang i timen, og `firestore.googleapis.com`). Slettede forslag ligger i Papirkurven i 30 dager og slettes så
for godt (med sine tidligere versjoner) neste gang en enhet åpner appen.

## Tester og utvikling

Tester (Vitest og Playwright) bruker aldri den ekte delte plassen: under testkjøring og nettleserautomatisering kjører
appen i «Kun på denne enheten»-modus. For å prøve den delte plassen fra en automatisert nettleser kan
`localStorage['hytte-planlegger:family-mode'] = 'shared'` settes (eller `VITE_FAMILY_STORE=shared` ved bygging); bruk da
en egen familie-id som begynner med `e2e-` og slett den etterpå. Prøvene mot den ekte plassen ligger klare:
`E2E_FIRESTORE=1 npx playwright test e2e/family-firestore.spec.ts e2e/phone-family-firestore.spec.ts
e2e/family-offline.spec.ts` lager egne `e2e-`-familier og sletter dem etterpå (uten variabelen hoppes de over).

`npm run dev` i en vanlig nettleser bruker det samme Firebase-prosjektet som nettsiden, men `localhost` har sin egen
lagring i nettleseren: uten lenke lager den sin egen, nye familie-id. For å komme til familiens plass må du åpne
`http://localhost:5173/#f=<familie-id>` (familielenken med localhost foran). Vil du prøve noe uten å røre familiens
forslag: sett `localStorage['hytte-planlegger:family-mode'] = 'local'` i nettleserens konsoll (eller start med
`VITE_FAMILY_STORE=local npm run dev`), og fjern den igjen etterpå.

## Hva om vi ikke vil ha dette?

Da fungerer alt likevel, men bare på hver enkelt enhet: hver person har sine egne forslag i sin egen nettleser og må sende
lenker eller filer for å dele. Statusen viser da «Kun på denne enheten (ingen delt plass satt opp)». Sett `firebaseConfig` i
`src/state/firebaseConfig.ts` til `null` for å kjøre slik.

## Om GitHub-varselet «Secrets detected»

GitHub varsler om alle Google-nøkler det finner. Firebase sin web-nøkkel (`apiKey`) er ikke hemmelig: den ligger uansett i
nettsiden alle laster ned, og Google sier selv at den kan være offentlig. Sikkerheten ligger i Firestore-reglene og i den
umulige-å-gjette familie-id-en. Varselet kan lukkes som «false positive». Vil du stramme til likevel, kan nøkkelen begrenses
til nettsiden: Google Cloud Console → APIs & Services → Credentials → «Browser key (auto created by Firebase)» →
Application restrictions: HTTP referrers → legg til `robinharald.github.io/*` og `localhost`.
