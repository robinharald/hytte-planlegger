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
og lenken du sender familien inneholder id-en til deres delte plass.

## Hva om vi ikke vil ha dette?

Da fungerer alt likevel, men bare på hver enkelt enhet: hver person har sine egne forslag i sin egen nettleser og må sende
lenker eller filer for å dele. Statusen viser da «Kun på denne enheten».

## Om GitHub-varselet «Secrets detected»

GitHub varsler om alle Google-nøkler det finner. Firebase sin web-nøkkel (`apiKey`) er ikke hemmelig: den ligger uansett i
nettsiden alle laster ned, og Google sier selv at den kan være offentlig. Sikkerheten ligger i Firestore-reglene og i den
umulige-å-gjette familie-id-en. Varselet kan lukkes som «false positive». Vil du stramme til likevel, kan nøkkelen begrenses
til nettsiden: Google Cloud Console → APIs & Services → Credentials → «Browser key (auto created by Firebase)» →
Application restrictions: HTTP referrers → legg til `robinharald.github.io/*` og `localhost`.
