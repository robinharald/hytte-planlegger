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
husker den. Adressefeltet viser den hele tiden:

- **Familielenke:** `https://robinharald.github.io/hytte-planlegger/#f=<familie-id>` – den du sender familien. Den som
  åpner den, kommer inn i den samme delte plassen og ser alle forslagene.
- **Lenke til ett forslag:** `…/#f=<familie-id>&p=<forslag-id>` – åpner familiens plass med det forslaget på skjermen.
  «Send forslaget» sender denne (via delingsarket på telefonen, ellers kopieres den), og viser begge lenkene.
- Id-en må være 24–64 tegn (bokstaver, tall, `-` og `_`), ellers slipper reglene ingen inn.
- Åpner en enhet en familielenke til en annen plass enn den den hadde, bytter den til den nye (den gamle id-en huskes
  på enheten under `hytte-planlegger:family.previous`, så ingenting er borte).
- Gamle lenker med `#d=` (en kopi av et forslag i selve lenken) virker fortsatt: forslaget legges til som et nytt
  forslag i familiens plass. Den samme lenken to ganger legger det ikke til to ganger.
- Forslag som lå lagret i nettleseren fra før (den gamle autolagringen), flyttes inn i familiens plass første gang.
- På iPhone: legg appen på Hjem-skjermen mens familielenken er åpen. En app på Hjem-skjermen har sin egen lagring og
  åpner adressen den ble lagt til fra (manifestet har med vilje ingen `start_url`), så den kommer rett inn i familiens
  forslag.

Forslag D ligger ikke i den delte plassen: det følger med appen, er låst og er alltid den nyeste utgaven.

## Hva statusen øverst betyr

| Status | Betyr |
|---|---|
| «Lagret for alle» | Alt er lagret i familiens delte plass. Alle med familielenken ser det. |
| «Lagrer …» | Endringen er på vei (appen venter et øyeblikk etter siste endring, så lagres den). |
| «Lagret her – sendes når du er på nett» | Du er uten nett. Endringene ligger trygt på denne enheten og sendes av seg selv når nettet er tilbake. |
| «Kobler til …» | Appen starter forbindelsen til den delte plassen. |
| «Ikke koblet til familiens plass – lagres her» | Forbindelsen feilet (f.eks. første oppstart uten nett, eller Anonymous er slått av). Appen prøver igjen. |
| «Ikke lagret – prøver igjen» | Den delte plassen avviste en lagring (f.eks. regler som ikke er publisert). Endringen er ikke borte; appen prøver igjen. |
| «Kun på denne enheten (familiens plass kan ikke nås nå)» | Firebase kunne ikke lastes i det hele tatt (f.eks. blokkert av nettleseren). Appen virker som vanlig og lagrer forslagene på denne enheten; den prøver igjen hvert 15. sekund og når enheten kommer på nett, og legger da forslagene herfra inn i familiens plass. |
| «Kun på denne enheten (ingen delt plass satt opp)» | Appen kjører uten Firebase-oppsett (`firebaseConfig` er `null`): forslagene lagres bare i denne nettleseren. |
| «Kunne ikke lagre på denne enheten (lite plass?)» | Nettleseren har ikke plass. Lagre forslaget som fil (Mer → Lagre som fil). |

På smale skjermer viser statusen en kort tekst («Lagret», «Lagret her», «Kun her» …); hele teksten står i verktøytipset.

Endrer to personer det samme forslaget samtidig, viser appen ««X» ble endret av Pappa for 2 min siden.» med «Hent
endringene» (ta deres utgave) og «Lagre over» (behold din). Lagret noen uten nett over en nyere utgave, legger appen
den overskrevne utgaven under **Mer → Tidligere versjoner** og sier fra.

## Hva som lagres

Bare dette, under `families/<familie-id>/…` (passer med reglene i `firestore.rules`):

- `proposals/<forslag-id>`: navnet, selve forslaget (som JSON-tekst), navnet den som laget og sist endret skrev inn
  («Mamma»), tidspunktene, og om det ligger i Papirkurven (`deletedAt`).
- `proposals/<forslag-id>/revisions/<id>`: inntil 20 tidligere versjoner (høyst én per fem minutter med endringer).

Ingen e-post, ingen enhetsnavn, ingen nettleserinfo, ingen posisjon. Slettede forslag ligger i Papirkurven i 30 dager
og slettes så for godt (med sine tidligere versjoner) neste gang en enhet åpner appen.

## Tester og utvikling

Tester (Vitest og Playwright) bruker aldri den ekte delte plassen: under testkjøring og nettleserautomatisering kjører
appen i «Kun på denne enheten»-modus. For å prøve den delte plassen fra en automatisert nettleser kan
`localStorage['hytte-planlegger:family-mode'] = 'shared'` settes (eller `VITE_FAMILY_STORE=shared` ved bygging); bruk da
en egen familie-id som begynner med `e2e-` og slett den etterpå.

`npm run dev` i en vanlig nettleser bruker den samme delte plassen som nettsiden (samme konfigurasjon). Vil du prøve
noe uten å røre familiens forslag: sett `localStorage['hytte-planlegger:family-mode'] = 'local'` i nettleserens konsoll
(eller start med `VITE_FAMILY_STORE=local npm run dev`), og fjern den igjen etterpå.

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
