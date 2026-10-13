/**
 * Norwegian bokmål UI strings. Every user-visible string of the app shell lives here (architecture.md "UI").
 * Keys are grouped by panel. Parametrised strings are functions. Numbers are formatted by ui/format.ts
 * (comma decimals, "m²") before they reach these templates.
 * The renderers' own few strings live here too (`plan2d`, `view3d`); plan2d/strings.ts and view3d/strings.ts
 * re-export them under their old names.
 *
 * Phase 2a (docs/phase2-plan.md): a variant is called "Forslag" in the UI; element status words are "Hytta i dag" /
 * "Nytt" / "Fjernet" (never "rives"). New groups: `proposals`, `tools`, `hints`, `library`, `toasts`, `edit` (the
 * Egenskaper editors), `numberField`, `firstRun`, `miniBar`, `sheet`, `legend`.
 *
 * Wording rules (fix round after 2a): "Trykk" for every pointer (also with a mouse); one rotate verb, "Roter"; a text
 * that mentions undo says "Angre" on a touch screen and "Angre eller Ctrl+Z" with a keyboard (the `undo` argument,
 * ui/device.ts `undoHow`). A text needed in several places has ONE source: the constants below.
 */
import type { ModelWarning } from '../model/derived';
import type { ElementStatus, Id, OpeningType, RoomType, WallKind } from '../model/types';
import type { CameraPreset } from '../view3d/View3D';
import { formatBytes, formatM, formatNumber } from '../ui/format';

// ---------------------------------------------------------------------------
// Texts used in more than one place (one source each)
// ---------------------------------------------------------------------------

/** docs/phase2-plan.md §1 rule 1: every edit of the bundled Forslag D is refused with this text ("Nytt forslag" button). */
const LOCKED = 'Forslag D er grunnlaget og kan ikke endres. Lag et nytt forslag for å endre.';

/** §1 rule 2: element status words, also the legend of "Vis hva som er nytt" (never "rives"). */
const STATUS = { existing: 'Hytta i dag', new: 'Nytt', removed: 'Fjernet' } as const;

/** §3.2: hint line texts (the toolbar's default per tool and the plan's texts while a tool is in progress). */
const HINTS = {
  select: 'Trykk for å velge, dra det valgte for å flytte.',
  wall: 'Trykk der veggen skal begynne',
  wallEnd: 'Trykk der den skal slutte (Esc avbryter)',
  opening: 'Velg type, og trykk på en vegg',
  unit: 'Trykk der bygget skal stå – det fester seg til terrassekanten og veggene',
  measure: 'Trykk på to punkter',
  measureEnd: 'Trykk på det andre punktet (Esc avbryter)',
  furniture: 'Trykk på et møbel i listen for å sette det inn, eller dra det inn i planen.',
} as const;

/** §5: the status pill (and its explanation in docs/firebase-oppsett.md). */
const PILL = {
  local: 'Kun på denne enheten (ingen delt plass satt opp)',
  /** Shared mode, but the family's space could not be loaded: saved here, sent when it can be reached. */
  unreachable: 'Kun på denne enheten (familiens plass kan ikke nås nå)',
  synced: 'Lagret for alle',
  pending: 'Lagret her – sendes når du er på nett',
  saving: 'Lagrer …',
  connecting: 'Kobler til …',
  error: 'Ikke koblet til familiens plass – lagres her',
  failed: 'Ikke lagret – prøver igjen',
  localFailed: 'Kunne ikke lagre på denne enheten (lite plass?)',
  /** A conflict is open: the edits of that proposal wait for the user's choice. */
  conflict: 'Ikke lagret – velg Hent endringene eller Lagre over',
  /** Shared mode, but the `#f=` link was not whole and this device has no family yet: saved here until a whole link. */
  noFamily: 'Kun på denne enheten (familielenken er ikke hel)',
  /** Another tab on this device switched to another family space: this tab saves nothing until it is reloaded. */
  elsewhere: 'Ikke lagret – last siden på nytt',
  /** Shared mode: the start link's space is empty and not this device's yet («Begynn her» or a new proposal starts it). */
  notStarted: 'Ikke startet – plassen i lenken er tom',
  /** Shared mode, offline: the start link's space (not this device's yet) has never been fetched, so it is unknown. */
  waitingOffline: 'Uten nett – plassen i lenken er ikke hentet ennå',
} as const;

const MONTHS = ['jan.', 'feb.', 'mars', 'apr.', 'mai', 'juni', 'juli', 'aug.', 'sep.', 'okt.', 'nov.', 'des.'] as const;

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * "i dag 14.30", "i går 09.05", "3. okt. 14.30", "3. okt. 2025" (device time); with `seconds` "i dag 14.30.07" (and in
 * another year the time too), for two that share a minute.
 */
function when(iso: string, now: number = Date.now(), seconds = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = `${two(d.getHours())}.${two(d.getMinutes())}${seconds ? `.${two(d.getSeconds())}` : ''}`;
  const today = new Date(now);
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((dayStart(today) - dayStart(d)) / 86_400_000);
  if (days === 0) return `i dag ${time}`;
  if (days === 1) return `i går ${time}`;
  const date = `${d.getDate()}. ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === today.getFullYear() ? `${date} ${time}` : `${date} ${d.getFullYear()}${seconds ? ` ${time}` : ''}`;
}

/** "akkurat nå", "for 2 min siden", "for 3 timer siden", else `when`. */
function ago(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const min = Math.floor((now - t) / 60_000);
  if (min < 1) return 'akkurat nå';
  if (min < 60) return `for ${min} min siden`;
  const hours = Math.floor(min / 60);
  if (hours < 12) return `for ${hours} ${hours === 1 ? 'time' : 'timer'} siden`;
  return when(iso, now);
}

/** IFC nudge in metres with a sign: "+0,03", "−0,01", "0". */
const signedCm = (m: number) => (m > 0 ? `+${formatNumber(m, 2)}` : m < 0 ? `−${formatNumber(-m, 2)}` : '0');

/** The drainage helper: «ved x 18,6» for a wall along plan y, «ved y 4,2» along plan x, '' for a slanted wall. */
function wallAt(axis: 'x' | 'y' | null, value: number): string {
  return axis ? ` ved ${axis} ${formatM(value, false)}` : '';
}

/** The fixture's definite noun («toalettet»), else «møbelet» (`nb.plumbing.nouns`). */
export function plumbingNoun(catalogId: string): string {
  return nb.plumbing.nouns[catalogId] ?? nb.plumbing.nounOther;
}

/** §3.6: today's cabin cannot be deleted as a whole (the editor core's toast and the Bygningsdel editor). */
const EXISTING_BLOCK_DELETE = 'Hytta i dag kan ikke slettes som helhet – flytt eller fjern vegger i stedet.';

export const nb = {
  app: {
    title: 'Hytteplanlegger',
    place: 'Merkesvatnet',
    loading3d: 'Laster 3D …',
    loadingPlan: 'Laster plan …',
    readOnlyTag: 'Skrivebeskyttet',
  },

  topbar: {
    variant: 'Forslag',
    variantActions: 'Forslag',
    newProposal: '+ Nytt forslag',
    newProposalTitle: 'Lag et nytt forslag: en kopi av forslaget du ser på, som du kan endre',
    rename: 'Gi nytt navn',
    renameTitle: 'Gi forslaget du ser på et nytt navn',
    delete: 'Slett',
    deleteTitle: 'Slett forslaget du ser på (du blir spurt to ganger, og det kan angres)',
    lockedTag: 'Grunnlag',
    lockedTitle: LOCKED,
    undo: 'Angre',
    undoTitle: 'Angre (Ctrl+Z)',
    redo: 'Gjør om',
    redoTitle: 'Gjør om (Ctrl+Y)',
    saveVersion: 'Lagre versjon',
    saveVersionTitle: 'Ta et navngitt øyeblikksbilde av prosjektet som du kan hente fram igjen',
    versions: 'Versjoner',
    versionsTitle: 'Se, hent og slett lagrede versjoner',
    export: 'Eksporter',
    exportTitle: 'Last ned prosjektet som JSON-fil',
    import: 'Importer',
    importTitle: 'Åpne et prosjekt fra en JSON-fil',
    share: 'Send forslaget',
    shareTitle: 'Lag en lenke til forslaget som du kan sende til familien',
    help: 'Hjelp',
    helpTitle: 'Slik bruker du planleggeren: verktøy, bevegelser og hurtigtaster',
    more: 'Mer',
    moreTitle: 'Tidligere versjoner, Papirkurv, lagre og åpne fil',
    fileActions: 'Lagring og deling',
  },

  prompts: {
    newProposalName: 'Navn på det nye forslaget:',
    renameVariant: 'Nytt navn på forslaget:',
    renameRoom: 'Nytt navn på rommet:',
    versionName: 'Navn på versjonen:',
    deleteVariant: (name: string) => `Vil du slette forslaget «${name}»?`,
    /** `undo`: how to undo on this device (`undoTouch` / `undoKeyboard`, ui/device.ts `undoHow`). */
    deleteVariantSure: (name: string, undo: string) => `Er du sikker? «${name}» forsvinner fra listen. (Du kan angre med ${undo}.)`,
    deleteVersion: (name: string) => `Vil du slette versjonen «${name}»? Dette kan ikke angres.`,
    resetSeed: (undo: string) => `Vil du tilbakestille hele prosjektet til Forslag D? Alle forslag erstattes. Dette kan angres med ${undo}.`,
    restoreVersion: (name: string, undo: string) => `Vil du hente versjonen «${name}»? Dagens prosjekt erstattes (kan angres med ${undo}).`,
    importProject: (name: string, undo: string) => `Vil du åpne «${name}» fra fila? Dagens prosjekt erstattes (kan angres med ${undo}).`,
    /** How to undo, by touch (only the Angre button) and with a keyboard. */
    undoTouch: 'Angre',
    undoKeyboard: 'Angre eller Ctrl+Z',
    /** Asked before a wall with openings becomes an invisible room divider (its openings are deleted). */
    dividerOpenings: (n: number) =>
      n === 1
        ? 'Veggen har en dør eller et vindu som blir borte når den blir en usynlig romdeler. Vil du fortsette?'
        : `Veggen har ${n} dører og vinduer som blir borte når den blir en usynlig romdeler. Vil du fortsette?`,
  },

  /** Proposals ("Forslag" = a variant in the data) and the locked base proposal (docs/phase2-plan.md §1 rule 1). */
  proposals: {
    defaultName: 'Mitt forslag',
    numberedName: (n: number) => `Mitt forslag ${n}`,
    /** Every edit of the base proposal is refused with this text and a "Nytt forslag" button. */
    locked: LOCKED,
    lockedShort: 'Forslag D er grunnlaget og kan ikke endres.',
    newProposal: 'Nytt forslag',
    newProposalTitle: 'Lag en kopi som du kan endre, og gå over til den',
    /** After «+ Nytt forslag» / «Kopier»: the undo history starts empty in the new proposal (familyStore.sync.ts). */
    created: (name: string) => `«${name}» er laget. Nå kan du endre det, og Angre tar tilbake endringene du gjør i det.`,
  },

  headline: {
    label: 'Nøkkeltall',
    bya: 'BYA',
    byaFull: 'Bebygd areal',
    bra: 'BRA',
    braFull: 'Bruksareal',
    existingShort: 'i dag',
    existingFull: 'hytta i dag',
    newShort: 'nytt',
    buildings: 'bygg',
    buildingsFull: 'Bygningene, målt til utsiden av kledningen',
    decks: 'terrasse',
    decksFull: 'Terrasser mer enn 0,5 m over terrenget',
  },

  views: {
    heading: 'Visning',
    plan: 'Plan',
    threeD: '3D',
    split: 'Begge',
    planTitle: 'Bare plantegningen',
    threeDTitle: 'Bare 3D-modellen',
    splitTitle: 'Plan og 3D ved siden av hverandre',
    storey: 'Etasje',
    ground: 'Plan 1',
    groundTitle: 'Underetasjen og hovedplanet',
    loft: 'Hems',
    loftTitle: 'Hemsen over soverommene',
  },

  mode3d: {
    heading: '3D',
    ute: 'Ute',
    uteTitle: 'Hele hytta utenfra, med tak',
    inne: 'Inne',
    inneTitle: 'Taket tas av og veggene kuttes 1,3 m over gulvet, så du ser inn i rommene',
    inneHint: 'tak fjernet',
    presets: 'Vinkler',
    presetNames: {
      oversikt: 'Oversikt',
      terrassen: 'Fra terrassen',
      framsiden: 'Framsiden',
      baksiden: 'Baksiden',
      langsiden: 'Langsiden (mot vannet)',
      ovenfra: 'Ovenfra',
      'naert-tilbygget': 'Nært tilbygget',
      'inne-stua': 'Inne i stua',
    } satisfies Record<CameraPreset, string> as Record<string, string>,
    presetTitles: {
      oversikt: 'Hele hytta og tomta på skrå ovenfra',
      terrassen: 'Fra terrassen, mot den nye fløya og bod-fløya',
      framsiden: 'Den nye fløyas langside med den hvite glassdøra',
      baksiden: 'Baksiden, med bod-fløya',
      langsiden: 'Langsiden mot vannet: glassutbygget, stuedøra og gavlen på den nye fløya',
      ovenfra: 'Rett ovenfra, som et kart',
      'naert-tilbygget': 'Tilbygget på nært hold, ovenfra på skrå',
      'inne-stua': 'I øyehøyde inne i stua, langs stua og spiseplassen (best med Inne; veggene kuttes da 2,3 m over gulvet)',
    } satisfies Record<CameraPreset, string> as Record<string, string>,
  },

  toggles: {
    heading: 'Vis',
    labels: 'Navn på rom',
    dims: 'Målsetting',
    grid: 'Rutenett',
    roofPlan: 'Takplan',
    new: 'Vis hva som er nytt',
    /** The 3D view's own switch (off by default: natural colours). */
    new3d: 'Vis hva som er nytt i 3D',
    trees: 'Bjørketrær',
    terrain: 'Terreng',
    clearances: 'Plassbehov for møbler',
    titles: {
      labels: 'Vis romnavn med mål og areal i planen og i 3D',
      dims: 'Vis målkjeder langs ytterveggene i planen',
      grid: 'Vis rutenett med 1 m mellom linjene i planen',
      roofPlan: 'Vis takflatene over planen',
      new: 'Farg det som er nytt oransje i planen, og vis det som er fjernet med stiplede linjer',
      new3d: 'Farg det som er nytt oransje i 3D-modellen. Av: naturlige farger.',
      trees: 'Vis bjørketrærne på tomta i 3D',
      terrain: 'Vis terrenget rundt hytta i 3D',
      clearances: 'Vis skravert hvor mye plass møblene trenger foran og rundt seg (det valgte møbelet viser det alltid)',
    },
  },

  /** Toolbar (docs/phase2-plan.md §3.2). */
  tools: {
    label: 'Verktøy',
    names: {
      select: 'Velg',
      wall: 'Vegg',
      opening: 'Dør/vindu',
      unit: 'Nytt bygg',
      furniture: 'Møbler',
      measure: 'Mål',
    },
    titles: {
      select: 'Velg og flytt det som er tegnet (Esc)',
      wall: 'Tegn en ny vegg: trykk der den begynner og der den slutter',
      opening: 'Sett inn en dør, et vindu eller en åpning i en vegg',
      unit: 'Sett et nytt bygg på tomta eller terrassen: vedskjul, bod, badstue, anneks eller eget bygg',
      furniture: 'Sett inn møbler fra møbelbiblioteket',
      measure: 'Mål avstanden mellom to punkter',
    },
    lockedTitle: 'Forslag D kan ikke endres – lag et nytt forslag først',
    undo: 'Angre',
    undoTitle: 'Angre siste endring (Ctrl+Z)',
    redo: 'Gjør om',
    redoTitle: 'Gjør om det du angret (Ctrl+Y)',
    openingType: 'Type',
    unitTemplate: 'Bygg',
    rotateUnit: 'Roter',
    rotateUnitTitle: 'Roter bygget 90° før du setter det ut',
    /** Warning count badge (opens Advarsler). */
    warnings: (n: number) => (n === 1 ? '1 advarsel' : `${n} advarsler`),
    warningsTitle: 'Vis advarslene',
    /** Unit templates of "Nytt bygg" (ids as in Block.template). */
    units: {
      vedskjul: { name: 'Vedskjul', size: '2 × 1,5 m, åpen front' },
      bod: { name: 'Bod', size: '2 × 3 m' },
      badstue: { name: 'Badstue', size: '2,4 × 2,2 m' },
      anneks: { name: 'Anneks', size: '4 × 3 m' },
      eget: { name: 'Eget bygg', size: '3 × 3 m, flatt tak' },
    } as Record<string, { name: string; size: string }>,
  },

  /** Hint line under the toolbar (docs/phase2-plan.md §3.2). */
  hints: {
    label: 'Hjelpetekst',
    ...HINTS,
    /** Forslag D with Velg (also why a drag there only moves the view). */
    locked: 'Forslag D er det faste grunnlaget og kan ikke endres. «Nytt forslag» lager en kopi som du kan endre.',
  },

  /** The furniture library (ui/FurnitureLibrary.tsx; the Møbler column, the bottom sheet on phones). */
  library: {
    heading: 'Møbler',
    close: 'Lukk',
    closeTitle: 'Lukk møbelbiblioteket og gå tilbake til Velg',
    searchLabel: 'Søk i møblene',
    searchPlaceholder: 'Søk etter møbler',
    searchClear: 'Tøm søket',
    noMatch: (q: string) => `Ingen møbler passer «${q}».`,
    /** Under the search box: a tap places in the selected room, so the user can pick the room first. */
    intro: 'Trykk på et rom først, eller ha rommet midt i planen. Trykk så på et møbel for å sette det inn, eller dra det inn i planen.',
    introTouch:
      'Trykk på et rom først, eller ha rommet midt i planen. Trykk så på et møbel for å sette det inn, eller hold fingeren på det for å dra det inn i planen.',
    /** Category header: number of items. */
    count: (n: number) => (n === 1 ? '1 møbel' : `${n} møbler`),
    /** Item size in the list ("90 × 200 cm"). */
    size: (wCm: number, dCm: number) => `${wCm} × ${dCm} cm`,
    itemTitle: (name: string, size: string) => `${name}, ${size}. Trykk for å sette inn, eller dra inn i planen.`,
    /** Screen-reader status after a placement. */
    placedIn: (name: string, room: string) => `${name} er satt inn i ${room}.`,
    placed: (name: string) => `${name} er satt inn.`,
    /**
     * Toast after a library tap that landed in another room than the one picked (the selection) or, with nothing
     * picked, the room in the middle of the plan (ui/furniturePlacer.ts `placeFurniture`): «Kommode er satt inn i
     * «Gang».»; `room` null: a room without a name.
     */
    placedInToast: (item: string, room: string | null) =>
      room ? `${item} er satt inn i «${room}».` : `${item} er satt inn i et rom uten navn.`,
    /**
     * Toast after a library tap whose item had no free spot in the room in the middle of the plan nor in the rooms
     * nearest to it, and went to the closest room of the storey that has one (ui/furniturePlacer.ts
     * `freeRoomElsewhere`): «Ingen plass i rommene i nærheten: Seng 180 er satt inn i «Stue».»; `room` null: a room
     * without a name.
     */
    placedFarToast: (item: string, room: string | null) =>
      room ? `Ingen plass i rommene i nærheten: ${item} er satt inn i «${room}».` : `Ingen plass i rommene i nærheten: ${item} er satt inn i et rom uten navn.`,
  },

  toasts: {
    region: 'Meldinger',
    deleted: 'Slettet.',
    undo: 'Angre',
    close: 'Lukk meldingen',
    restored: 'Tatt tilbake.',
    pickCorner: 'Trykk først på hjørnet som skal bort i planen, og velg så «Fjern hjørne».',
    /** An edit made a new warning: the toast's text and its "Vis" button (opens Advarsler). */
    newWarning: (text: string) => `Ny advarsel: ${text}`,
    newWarnings: (n: number) => `${n} nye advarsler.`,
    show: 'Vis',
    showTitle: 'Vis advarslene',
  },

  /** NumberField (docs/phase2-plan.md §3.7 "Number fields"). */
  numberField: {
    decrease: (step: string) => `Mindre (−${step})`,
    increase: (step: string) => `Større (+${step})`,
    invalid: (min: string, max: string) => `Skriv et tall fra ${min} til ${max}, for eksempel 2,40.`,
  },

  /** Egenskaper editors (docs/phase2-plan.md §3.7). */
  edit: {
    more: 'Mer',
    clearTitle: 'Fjern markeringen (Esc)',
    lockedNotice: 'Forslag D er grunnlaget og kan ikke endres.',
    noneNotes: 'Merknader til forslaget',
    noneNotesPlaceholder: 'Hva er tanken med dette forslaget?',
    readOnlyNote: 'Endringer er slått av for en delt versjon.',
    room: {
      name: 'Navn',
      type: 'Romtype',
      width: 'Bredde ↔',
      depth: 'Dybde ↕',
      floor: 'Gulv',
      floorDefault: (material: string) => `Som romtypen (${material.toLowerCase()})`,
      floorTypeDefault: 'Som romtypen',
      note: 'Merknad',
      delete: 'Slett rom',
      deleteTitle: 'Fjern navnet og romtypen; flaten blir et rom uten navn',
      move: 'Flytt',
      left: 'venstre vegg',
      right: 'høyre vegg',
      lower: 'nedre vegg',
      upper: 'øvre vegg',
      blockOnly: 'Endres under bygningsdelen',
      selectBlock: 'Velg bygningsdelen',
      approx: 'Rommet er ikke rektangulært: målene er største bredde og dybde.',
      unnamed: 'Rom uten navn',
      unnamedText: 'Denne flaten har ikke fått navn ennå. Gi den et navn og en romtype:',
      nameIt: 'Gi navn',
      namePlaceholder: 'For eksempel Gang',
    },
    wall: {
      length: 'Lengde',
      thickness: 'Tykkelse',
      split: 'Del i to',
      splitTitle: 'Del veggen i to like lange deler',
      delete: 'Slett',
      height: 'Høyde',
      heightAuto: 'Automatisk',
      heightRoof: 'Til taket',
      heightFixed: 'Fast høyde',
      fixedHeight: 'Høyde over gulvet',
      divider: 'Usynlig romdeler',
      dividerTitle: 'Veggen blir en tynn strek som bare deler flaten i to rom (ingen vegg i 3D, ingen dører)',
      exteriorNote: 'Dra veggen i planen for å flytte den. Veggtykkelsen settes under bygningsdelen.',
      addOpening: 'Legg til dør/vindu',
      addOpeningTitle: 'Velg verktøyet Dør/vindu og trykk på veggen',
      openings: 'Dører og vinduer',
    },
    opening: {
      type: 'Type',
      width: 'Bredde',
      height: 'Høyde',
      sill: 'Høyde over gulv',
      corner: 'Avstand fra hjørne',
      cornerTitle: 'Fra innsiden av nærmeste tverrvegg til kanten av åpningen',
      flipHinge: 'Bytt hengselside',
      flipSide: 'Slå andre veien',
      delete: 'Slett',
      leaves: 'Antall fløyer',
      frame: 'Karmfarge',
      leaf: 'Dørblad',
      muntins: 'Sprosser',
      muntinsNone: 'Ingen',
      muntinsGrid: (cols: number, rows: number) => `${cols} × ${rows} ruter`,
      fullHeight: 'Går helt opp',
      host: 'Sitter i',
    },
    colours: {
      white: 'Hvit',
      green: 'Grønn',
      wood: 'Tre',
      black: 'Svart',
      glass: 'Glass',
    } as Record<string, string>,
    block: {
      name: 'Navn',
      width: 'Bredde ↔',
      depth: 'Dybde ↕',
      roofType: 'Taktype',
      pitch: 'Takvinkel',
      openFront: 'Åpen front',
      delete: 'Slett',
      duplicate: 'Dupliser',
      ridge: 'Mønehøyde',
      eave: 'Rafthøyde',
      overhang: 'Utstikk',
      wallThickness: 'Veggtykkelse',
      ceiling: 'Himlingshøyde',
      ceilingOn: 'Flatt himlingsnivå',
      roofMaterial: 'Taktekking',
      parts: 'Deler',
      partDims: (name: string, dims: string) => `${name}: ${dims}`,
      partLength: (name: string, length: string) => `${name}: lengde ${length}`,
      implicitPart: 'Ny del',
      heightsNote: 'Høydene er målt fra gulvet i bygningsdelen.',
      notRectangle: 'Bygningsdelen er ikke rektangulær: dra hjørnene i planen for å endre størrelsen.',
      existingNoDelete: EXISTING_BLOCK_DELETE,
      /** Template units ("Nytt bygg"): a quarter turn around the centre. */
      rotate: 'Roter 90°',
      rotateTitle: 'Roter bygget en kvart runde rundt midten',
      vertexNote: 'Dra hjørnet i planen for å flytte det.',
      edgeLength: 'Lengde',
      position: 'Plassering',
    },
    deck: {
      height: 'Høyde',
      heightTitle: 'Topp terrassebord, målt fra gulvet i hovedplanet',
      railing: 'Rekkverk',
      railingNone: 'Uten rekkverk',
      railingHeight: 'Rekkverkshøyde',
      edgeHint: 'Trykk på en kant av terrassen i planen for å slå rekkverket av eller på der.',
      addSteps: 'Legg til trapp',
      addStepsTitle: 'Sett en trapp midt på den lengste ledige kanten',
      removeCorner: 'Fjern hjørne',
      addCorner: 'Legg til hjørne',
      addCornerTitle: 'Sett inn et nytt hjørne midt på kanten, som du kan dra',
      area: 'Areal',
      edgeRailing: 'Rekkverk langs denne kanten',
      edges: 'Rekkverk per kant',
      edgeName: (i: number, length: string) => `Kant ${i} (${length})`,
      noFreeRun: 'Kanten står inntil et bygg og får ikke rekkverk.',
      noRailing: 'Terrassen har ikke rekkverk.',
      noFreeEdge: 'Ingen ledig kant å sette trappa på.',
    },
    steps: {
      width: 'Bredde',
      risers: 'Trinn',
      delete: 'Slett',
      blocked: 'Trappa står der det nå er et bygg. Flytt den langs kanten eller slett den.',
    },
    hotTub: {
      diameter: 'Diameter',
      delete: 'Slett',
    },
    tree: {
      height: 'Høyde',
      delete: 'Slett',
    },
    furniture: {
      name: 'Navn',
      size: 'Størrelse',
      sizeCustom: 'Egen størrelse',
      width: 'Bredde',
      depth: 'Dybde',
      colour: 'Farge',
      colourDefault: 'Standard',
      colours: { white: 'Hvit', wood: 'Tre', grey: 'Grå', green: 'Grønn', black: 'Svart' } as Record<string, string>,
      rotate: 'Roter 90°',
      rotateTitle: 'Roter møbelet 90° (R)',
      duplicate: 'Dupliser',
      duplicateTitle: 'Lag en kopi av møbelet ved siden av (Ctrl+D)',
      delete: 'Slett',
      deleteTitle: 'Slett møbelet (Delete)',
      room: (name: string) => `Rom: ${name}`,
      noRoom: 'Rom: –',
      unknown: 'Dette møbelet finnes ikke i møbellisten lenger. Det vises som en boks med målene sine.',
      /** Range note under a stretchable field ("0,30–6,00 m"). */
      range: (min: string, max: string) => `${min}–${max} m`,
    },
    ghost: {
      text: 'Dette er en del av hytta i dag som er fjernet eller flyttet i dette forslaget. Det vises stiplet.',
      restore: 'Ta tilbake',
      restoreTitle: 'Sett det tilbake slik det er i hytta i dag',
      kinds: { wall: 'Vegg', opening: 'Dør eller vindu', edge: 'Yttervegg' } as Record<string, string>,
    },
    structureNote: 'Bæring, pipe og trapper kan ikke endres her ennå.',
  },

  firstRun: {
    label: 'Kom i gang',
    heading: 'Slik kommer du i gang',
    /** docs/phase2-plan.md §5 first-run card. */
    items: [
      'Trykk på et rom, en vegg, en dør, et vindu eller et møbel for å se målene. I ditt eget forslag drar du det valgte for å flytte det.',
      'Forslag D er det faste grunnlaget og kan ikke endres. «+ Nytt forslag» lager en kopi som du kan endre: flytt vegger, dører, vinduer og møbler, sett ut nye bygg – og angre alt med Angre.',
    ],
    /** The third bullet, true for the running mode (familyStore: shared = Firestore, local = this device only). */
    saved: {
      shared:
        'Alt lagres automatisk i familiens delte plass, så alle med familielenken ser forslagene – uten nett lagres det her og sendes senere. Trykk «Send forslaget» for å sende lenken.',
      local: 'Alt lagres automatisk på denne enheten. Trykk «Send forslaget» for å dele en kopi av forslaget som lenke.',
    },
    ok: 'Skjønner',
  },

  /** Phone: floating bar above the selection (docs/phase2-plan.md §3.1). */
  miniBar: {
    label: 'Det valgte',
    properties: 'Egenskaper',
    rotate: 'Roter',
    delete: 'Slett',
  },

  /** Phone bottom sheets (Egenskaper, Møbler). */
  sheet: {
    close: 'Lukk',
    expand: 'Vis mer',
    collapse: 'Vis mindre',
  },

  sun: {
    heading: 'Sol og skygge',
    date: 'Dato',
    time: 'Klokkeslett',
    timeSlider: 'Tid på døgnet',
    altitude: 'Solhøyde',
    bearing: 'Retning',
    belowHorizon: 'Sola er under horisonten',
    timezoneNote: 'Lokal tid ved hytta',
    // ---- phase 3: day presets, the daylight band, «Skygger» (ui/Controls.tsx SunControls, view3d/sunPanel.ts) ----
    presets: 'Dager',
    midsummer: 'Midtsommer',
    midsummerTitle: '21. juni: midnattssol ved hytta',
    equinox: 'Jevndøgn',
    equinoxTitle: '20. mars: dag og natt omtrent like lange',
    midwinter: 'Midtvinter',
    midwinterTitle: '21. desember: mørketid, sola kommer ikke over horisonten',
    today: 'I dag',
    todayTitle: 'Dagens dato og klokkeslett ved hytta',
    sunrise: 'Soloppgang',
    sunset: 'Solnedgang',
    /** The chosen date has midnight sun / polar night at the cabin. */
    alwaysUp: 'Sola er oppe hele døgnet',
    alwaysDown: 'Sola er under horisonten',
    /** Accessible name of the daylight band under the time slider. */
    daylight: 'Når sola er oppe denne dagen',
    shadows: 'Skygger',
    shadowsTitle: 'Sola kaster skygger i 3D (slå av hvis 3D går tregt på telefonen)',
  },

  schedule: {
    heading: 'Romskjema',
    room: 'Rom',
    block: 'Bygningsdel',
    status: 'Status',
    statusTitle: '«i dag»: slik hytta er i dag. «nytt»: nytt i dette forslaget.',
    dims: 'Mål (m)',
    dimsTitle: 'Innvendige mål, bredde × dybde. «ca.» når rommet ikke er et rektangel.',
    area: 'Areal',
    areaTitle: 'Netto gulvflate (m²) mellom innsidene av veggene',
    unnamed: 'Uten navn',
    newTag: 'nytt',
    existingTag: 'i dag',
    split: (existing: string, added: string) => `i dag ${existing} · nytt ${added}`,
    empty: 'Ingen rom er funnet ennå.',
    sum: 'Sum',
    levelSum: 'Sum etasje',
    approxPrefix: 'ca.',
  },

  areas: {
    heading: 'Arealer',
    bya: 'BYA',
    byaFull: 'Bebygd areal',
    bra: 'BRA',
    braFull: 'Bruksareal',
    axis: 'Aksemål',
    axisFull: 'Grunnflate på akselinjene',
    rooms: 'Rom (netto)',
    roomsFull: 'Sum av rommene',
    total: 'Totalt',
    existing: STATUS.existing,
    new: STATUS.new,
    buildings: 'Bygninger',
    decks: 'Terrasser over 0,5 m',
    existingShort: 'i dag',
    newShort: 'nytt',
    gross: 'Brutto',
    measurable: 'Målbart',
    perLevel: 'Per etasje',
    howMeasured: 'Slik måles det',
    explain: {
      bya:
        'Bebygd areal etter NS 3940: flaten bygningene dekker på tomta, målt til utsiden av kledningen, pluss ' +
        'terrasser som ligger mer enn 0,5 m over terrenget. Der bygningsdeler overlapper telles flaten én gang. ' +
        'For bygningene fordeles eksisterende og nytt etter hvilken bygningsdel hvert punkt ligger i; terrassene ' +
        'vises for seg.',
      bra:
        'Bruksareal etter NS 3940: gulvflaten innenfor ytterveggene, med innerveggene medregnet. «Brutto» er hele ' +
        'flaten innenfor ytterveggene på etasjen. «Målbart» teller bare der det er minst 1,9 m fri høyde under taket, ' +
        'pluss en stripe på 0,6 m utenfor dette, og trappeåpninger trekkes fra. Hemsen teller bare med sin målbare del.',
      axis:
        'Grunnflate målt på akselinjene (utsiden av bindingsverket), slik skissen for Forslag D regner: ' +
        'ca. 170,2 m². Bare til sammenligning, ikke et standardisert mål.',
      rooms:
        'Netto gulvflate i hvert rom, målt mellom innsidene av veggene. Delt i eksisterende og nytt etter ' +
        'bygningsdel. Rom under skråtak (hemsen) telles her med hele gulvflaten, også der det er under 1,9 m under ' +
        'taket. I BRA teller bare delen med minst 1,9 m fri høyde, så summen av rommene kan bli større enn BRA ' +
        'selv om BRA også tar med innerveggene.',
    },
  },

  properties: {
    heading: 'Egenskaper',
    none: 'Ingenting er valgt. Trykk på et rom, en vegg, en dør eller et vindu i planen.',
    dangling: 'Det som var valgt finnes ikke lenger.',
    clear: 'Avmarker',
    rename: 'Gi nytt navn',
    renameTitle: 'Gi rommet et nytt navn',
    fields: {
      name: 'Navn',
      type: 'Type',
      kind: 'Veggtype',
      level: 'Etasje',
      block: 'Bygningsdel',
      dims: 'Innvendige mål',
      area: 'Areal',
      areaExisting: 'Herav hytta i dag',
      areaNew: 'Herav nytt',
      floor: 'Gulv',
      note: 'Merknad',
      status: 'Status',
      length: 'Lengde',
      thickness: 'Tykkelse',
      height: 'Høyde',
      baseZ: 'Underkant',
      topZ: 'Overkant',
      openings: 'Åpninger',
      width: 'Bredde',
      sill: 'Høyde over gulv',
      host: 'Sitter i',
      roof: 'Tak',
      pitch: 'Takvinkel',
      ridge: 'Møne (underside)',
      eave: 'Raft (underside)',
      footprint: 'Yttermål',
      deckTop: 'Topp terrassebord',
      style: 'Utførelse',
      posts: 'Stolper',
      steps: 'Trapper',
      diameter: 'Diameter',
      position: 'Plassering',
      catalog: 'Katalognøkkel',
      isNew: 'Ny',
      yes: 'Ja',
      no: 'Nei',
      edge: 'Kant',
      vertex: 'Hjørne',
      from: 'Fra',
      to: 'Til',
      risers: 'Trinn',
    },
    zNote: 'Høyder er målt fra gulvet i hovedplanet.',
    railingStyles: { glass: 'Glass', boards: 'Bord' } as Record<string, string>,
  },

  warnings: {
    heading: 'Advarsler',
    none: 'Ingen advarsler.',
    count: (n: number) => (n === 1 ? '1 advarsel' : `${n} advarsler`),
    showTitle: 'Vis i planen',
    deriveFailed: (detail: string) => `Modellen kunne ikke beregnes: ${detail}`,
    /**
     * How warnings name walls and openings (ui/warnings.ts): by type and place, never by id. "vinduet i veggen mellom
     * Gang og Soverom (ny fløy)", "døra i ytterveggen mot nord i Kjøkken".
     */
    names: {
      opening: {
        window: 'vinduet',
        door: 'døra',
        glassDoor: 'glassdøra',
        slidingDoor: 'skyvedøra',
        saunaDoor: 'badstudøra',
        opening: 'åpningen',
      } satisfies Record<OpeningType, string>,
      wall: 'veggen',
      exterior: 'ytterveggen',
      divider: 'romdeleren',
      /** A wall with no named room on either side or around it. */
      looseWall: 'en vegg',
      unknownOpening: 'en dør eller et vindu',
      between: (a: string, b: string) => `mellom ${a} og ${b}`,
      /** "i Kjøkken", "i veggen mellom …". */
      inRoom: (place: string) => `i ${place}`,
      /** A wall with no named room around it, inside a building part: "i «Ny tverrfløy»". */
      inBlock: (block: string) => `i «${block}»`,
      towards: (direction: string) => `mot ${direction}`,
      /** Compass points from north, clockwise (45° each). */
      directions: ['nord', 'nordøst', 'øst', 'sørøst', 'sør', 'sørvest', 'vest', 'nordvest'],
      and: 'og',
      /** A loose wall in one named room, by the part of the room it stands in: "nord i Stue"; null: "midt i Stue". */
      inRoomPart: (direction: string | null, room: string) => (direction ? `${direction} i ${room}` : `midt i ${room}`),
      /** A loose wall on the deck: "nord på terrassen"; null: "på terrassen". */
      onDeck: (direction: string | null) => (direction ? `${direction} på terrassen` : 'på terrassen'),
      /** A loose wall outside the buildings and the deck: "sør for «Bod-fløy»" (the nearest building part). */
      nearBlock: (direction: string, block: string) => `${direction} for «${block}»`,
      /** Plural of the wall nouns above (wall, exterior, divider), for merged loose-wall lines. */
      plural: { veggen: 'vegger', ytterveggen: 'yttervegger', romdeleren: 'romdelere' } as Record<string, string>,
      /** Several loose walls in one place: "3 vegger nord i Stue henger løs og danner ikke noe rom." */
      looseWalls: (n: number, nouns: string, place: string) => `${n} ${nouns} ${place} henger løs og danner ikke noe rom.`,
      /** After a merged loose-wall line whose noun has no plural: "(2 steder)". */
      repeated: (n: number) => `(${n} steder)`,
      /** What a furniture item stands in when it is not a wall ('furniture-in-wall'): "i trappa". */
      obstacles: { stair: 'i trappa', chimney: 'i pipa', post: 'i en stolpe', beam: 'i en bjelke', hotTub: 'i badestampen' } as Record<string, string>,
    },
    /** A 'generic' warning from a geometry fallback (derive.ts GEOMETRY_FALLBACK); the detail stays technical. */
    geometryFallback: (detail: string) =>
      `En del av geometrien er forenklet fordi en polygonberegning feilet. Sjekk hjørner og vegger som nesten ligger oppå hverandre (teknisk: ${detail}).`,
  },

  help: {
    heading: 'Slik bruker du planleggeren',
    close: 'Lukk',
    intro:
      'Planleggeren viser Forslag D for hytta ved Merkesvatnet som 2D-plan og 3D-modell. Alt lages fra én ' +
      'datamodell, så romstørrelser og arealer er alltid oppdatert.',
    items: [
      'Forslag D er grunnlaget og kan ikke endres. Trykk «+ Nytt forslag» for å lage din egen kopi – den kan du endre så mye du vil, også hytta slik den er i dag.',
      'Velg Plan, 3D eller Begge i Visning-panelet. I planen bytter du mellom Plan 1 og Hems.',
      'Trykk for å velge et rom, en vegg, en dør eller et vindu; målene vises under Egenskaper. Dra det du har valgt for å flytte det. Drar du et annet sted, flyttes planen. Rull eller knip for å zoome.',
      'Skriv mål rett inn i Egenskaper, for eksempel 2,40 (komma eller punktum). − og + endrer med 10 cm. Enter eller Tab lagrer, Esc angrer det du skrev.',
      'Det som er nytt, vises oransje i planen og det som er fjernet, stiplet, når «Vis hva som er nytt» er på. «Ta tilbake» setter en fjernet vegg, dør eller et vindu tilbake.',
      'I 3D har bryteren sin egen: «Vis hva som er nytt i 3D» under Vis. Den er av til å begynne med, så 3D-modellen har naturlige farger.',
      'Alt lagres automatisk i nettleseren. «Send forslaget» lager en lenke som inneholder hele forslaget. «Lagre versjon» tar et navngitt øyeblikksbilde.',
      'På telefonen: trykk for å velge, og bruk linjen over det valgte (Egenskaper · Roter · Slett). Egenskaper åpnes nederst på skjermen med de viktigste feltene; dra i håndtaket eller trykk «Vis mer» for resten.',
      'Advarsler: tallet i verktøylinjen viser hvor mange det er. Når en endring gir en ny advarsel, kommer den som en melding med «Vis».',
      'I 3D viser Ute hele hytta, mens Inne tar av taket og kutter veggene, så du ser inn i rommene. Dra for å snu, rull eller knip for å zoome. Sol og skygge følger valgt dato og klokkeslett ved hytta.',
      '«Gå rundt» (under kameravinklene, eller knappen oppe til høyre i 3D-bildet) lar deg gå gjennom rommene i øyehøyde. På PC: W A S D eller piltastene, se deg rundt med musa, Shift for å løpe, P lagrer bildet, Esc avslutter og lar kameraet stå der du sto. På telefonen: gå med spaken nede til venstre og dra i bildet for å se deg rundt; kameraknappen under «Avslutt» lagrer bildet.',
      'Sol og skygge: trykk Midtsommer, Jevndøgn, Midtvinter eller I dag, og dra i klokkeslettet. Den gule stripa viser når sola er oppe den dagen. Slå av «Skygger» hvis 3D går tregt på telefonen.',
      '«Eksporter» øverst: «Eksporter plan som PDF» lager tegninger i 1:50 eller 1:100 på A3 eller A4, med mål, romnavn, arealer, tittelfelt og romskjema – skriv ut i faktisk størrelse (100 %). «Lagre 3D-bildet som PNG» lagrer det du ser i 3D som et bilde.',
      '«Avløp og sluk» under Vis viser et forslag til avløpsstamme og hvor langt toaletter, dusjer, servanter og vaskemaskiner har til den. Står noe for langt unna, kommer det under Advarsler. Dra stammen langs veggene for å flytte den.',
      '«IFC-modell»: last inn arkitektens IFC-fil av hytta i dag, så ligger den blått over planen og halvgjennomsiktig i 3D. Fila blir bare på denne enheten.',
    ],
    tools: 'Verktøy',
    toolList: [
      { name: 'Velg', text: 'Trykk for å velge, dra det valgte for å flytte. Terrassen får hjørner du kan dra, og «+» midt på kantene.' },
      { name: 'Vegg', text: 'Trykk der veggen skal begynne og der den skal slutte. Verktøyet er på til du trykker Esc eller Velg.' },
      { name: 'Dør/vindu', text: 'Velg type, og trykk på en vegg.' },
      {
        name: 'Nytt bygg',
        text: 'Velg vedskjul, bod, badstue, anneks eller eget bygg, og trykk der det skal stå. Terrassen tilpasser seg. «Roter» snur bygget, også etter at det er satt ut.',
      },
      { name: 'Møbler', text: HINTS.furniture },
      { name: 'Mål', text: 'Trykk på to punkter for å se avstanden.' },
    ],
    shortcuts: 'Hurtigtaster',
    comingSoon: 'kommer',
    shortcutList: [
      { keys: 'Ctrl+Z / Ctrl+Y', text: 'Angre / gjør om', active: true },
      { keys: 'Esc', text: 'Avbryt verktøyet, eller fjern markeringen', active: true },
      { keys: 'Delete', text: 'Slett det som er valgt', active: true },
      { keys: 'Piltaster', text: 'Flytt det valgte 1 cm (med Shift 10 cm)', active: true },
      { keys: 'R', text: 'Roter det valgte møbelet eller nye bygget 90°, eller bygget du er i ferd med å sette ut', active: true },
      { keys: 'Ctrl+D', text: 'Dupliser møbel eller nytt bygg', active: true },
      { keys: 'Alt', text: 'Hold inne mens du drar: fest til 1 cm i stedet for 10 cm', active: true },
      { keys: 'W A S D', text: 'Gå i «Gå rundt» (også piltastene; Shift for å løpe, P lagrer bildet, Esc avslutter)', active: true },
    ],
  },

  banners: {
    readOnly: 'Du ser på en delt versjon.',
    readOnlyHintMerge: (variants: number) =>
      `Endringer er slått av. «Lag min egen kopi» legger ${variants === 1 ? 'det delte forslaget' : `de ${variants} delte forslagene`} ` +
      'til i ditt eget prosjekt, ved siden av forslagene du har fra før.',
    readOnlyHintNew: 'Endringer er slått av. «Lag min egen kopi» gjør den til ditt eget prosjekt, så du kan jobbe videre med den.',
    makeCopy: 'Lag min egen kopi',
    leaveShared: 'Tilbake til mitt prosjekt',
    showSeed: 'Vis Forslag D',
    seedUpdated: (rev: number) => `Forslag D er oppdatert (revisjon ${rev}).`,
    fetchSeed: 'Hent ny Forslag D',
    resetSeed: 'Tilbakestill til Forslag D',
    schemaTooNew: 'Det lagrede prosjektet kommer fra en nyere versjon av appen og kan ikke åpnes her.',
    reload: 'Last siden på nytt',
    otherTab: 'Prosjektet er endret i en annen fane. Endringene her lagres ikke før du har valgt.',
    loadOtherTab: 'Hent endringene',
    keepMine: 'Behold mine endringer',
    storageUnavailable: 'Lagring i nettleseren er ikke tilgjengelig. Endringer forsvinner når du lukker siden.',
    saveFailed: 'Endringene kunne ikke lagres i nettleseren (lite plass?). Eksporter prosjektet som JSON-fil for sikkerhets skyld.',
    linkInvalid: 'Lenken kunne ikke leses. Viser det lagrede prosjektet i stedet.',
    linkTooNew: 'Lenken kommer fra en nyere versjon av appen. Last siden på nytt og prøv igjen.',
    linkRebased:
      'Lenken ble laget med en eldre utgave av Forslag D. Endringene i lenken er lagt oppå den nyeste utgaven, så noe kan se annerledes ut.',
    autosaveInvalid: 'Det lagrede prosjektet kunne ikke leses. Viser Forslag D i stedet (en kopi av det gamle er tatt vare på).',
    importFailed: 'Fila kunne ikke leses som et prosjekt.',
    importTooNew: 'Fila kommer fra en nyere versjon av appen.',
    versionFailed: 'Versjonen kunne ikke hentes.',
    dismiss: 'Lukk',
  },

  share: {
    heading: 'Send forslaget',
    intro:
      'Lenken inneholder hele forslaget. Send den til familien: den som åpner den, ser en skrivebeskyttet versjon og kan lage sin egen kopi.',
    allVariants: 'Send alle forslagene',
    activeOnly: (name: string) => `Bare «${name}» sendes.`,
    allIncluded: (n: number) => `Alle ${n} forslagene sendes.`,
    link: 'Lenke',
    size: 'Lengde',
    copy: 'Kopier lenke',
    copied: 'Kopiert!',
    copyFailed: 'Kunne ikke kopiere automatisk. Merk lenken og kopier den selv.',
    tooBig: 'Lenken er lang (over 8 kB). Noen apper kutter lange lenker. Send heller forslaget som JSON-fil.',
    sendJson: 'Send som JSON-fil',
    close: 'Lukk',
    /** Name of a shared variant added to a project that already has a variant called `name`. */
    sharedName: (name: string, n: number) => (n === 1 ? `${name} (delt)` : `${name} (delt ${n})`),
  },

  versions: {
    heading: 'Versjoner',
    empty: 'Ingen lagrede versjoner for dette prosjektet.',
    save: 'Lagre versjon nå',
    saved: (name: string) => `Lagret «${name}».`,
    saveFailed: 'Versjonen kunne ikke lagres (lite plass i nettleseren). Slett noen gamle versjoner og prøv igjen.',
    restore: 'Hent',
    delete: 'Slett',
    savedAt: 'Lagret',
    size: 'Størrelse',
    totalSize: 'Plass brukt',
    otherProjects: 'Andre prosjekter',
    otherProjectsHint: 'Versjoner av prosjekter du har hatt tidligere i denne nettleseren.',
    limit: (n: number) => `Maks ${n} versjoner per prosjekt. De eldste fjernes først.`,
    close: 'Lukk',
    defaultName: (date: string) => `Versjon ${date}`,
    danger: 'Start på nytt',
    resetSeed: 'Tilbakestill til Forslag D',
  },

  seed: {
    variantName: (rev: number) => `Forslag D (revisjon ${rev})`,
  },

  /** Shared proposals, saving, offline (docs/phase2-plan.md §5): menu, status pill, dialogs, notices. */
  family: {
    when,
    ago,
    /** Who changed something when no name is known. */
    someone: 'noen',
    menu: 'Forslag',
    menuTitle: 'Bytt forslag, lag et nytt eller åpne Papirkurv',
    baseLine: 'Det faste grunnlaget – kan ikke endres',
    changedBy: (who: string, at: string) => `sist endret av ${who}, ${at}`,
    changed: (at: string) => `sist endret ${at}`,
    notSaved: 'ikke lagret ennå',
    newFromBase: '+ Nytt forslag (kopi av Forslag D)',
    copyActive: (name: string) => `Kopier «${name}»`,
    trashItem: (n: number) => (n > 0 ? `Papirkurv (${n})` : 'Papirkurv'),
    /** Name of a proposal from an old autosave whose name is the base's. */
    ownCopyName: (name: string, n: number) => (n === 1 ? `${name} (eget)` : `${name} (eget ${n})`),
    pill: PILL,
    /** The pill on narrow screens (the long text stays its accessible name and tooltip). */
    pillShort: {
      local: 'Kun her',
      unreachable: 'Kun her',
      synced: 'Lagret',
      pending: 'Lagret her',
      saving: 'Lagrer …',
      connecting: 'Kobler til …',
      error: 'Ikke koblet til',
      failed: 'Ikke lagret',
      localFailed: 'Ikke lagret',
      conflict: 'Ikke lagret',
      noFamily: 'Kun her',
      elsewhere: 'Ikke lagret',
      notStarted: 'Ikke startet',
      waitingOffline: 'Uten nett',
    } satisfies Record<keyof typeof PILL, string>,
    pillTitle: {
      local: 'Forslagene lagres automatisk i denne nettleseren. Trykk «Send forslaget» for å dele en kopi som lenke.',
      unreachable:
        'Familiens delte plass kan ikke nås nå. Det du gjør lagres på denne enheten og legges i familiens plass når den kan nås igjen.',
      synced: 'Alle endringer er lagret i familiens delte plass. Alle med familielenken ser dem.',
      pending: 'Du er uten nett. Endringene er lagret på denne enheten og sendes til familien når du er på nett igjen.',
      saving: 'Endringene lagres nå.',
      connecting: 'Kobler til familiens delte plass. Endringene lagres her så lenge.',
      error: 'Fikk ikke kontakt med familiens delte plass. Endringene lagres på denne enheten og sendes når det går.',
      failed: 'Den siste endringen ble ikke lagret. Appen prøver igjen av seg selv.',
      localFailed: 'Nettleseren har ikke plass til flere endringer. Lagre forslaget som fil (Mer → Lagre som fil).',
      conflict:
        'Forslaget ble endret et annet sted mens du endret det her. Endringene dine her lagres ikke før du velger «Hent endringene» eller «Lagre over».',
      noFamily:
        'Lenken til familiens plass var ikke hel, så appen vet ikke hvilken plass den skal bruke. Forslagene lagres på denne enheten til du åpner hele familielenken; da flyttes de inn i familiens plass.',
      elsewhere:
        'Denne enheten bruker en annen delt plass nå (den ble byttet i en annen fane). Denne fanen kan ikke endres og lagrer ingenting før du laster siden på nytt.',
      notStarted:
        'Plassen i lenken er tom, og denne enheten har ikke tatt den i bruk. Ingenting er lagret der ennå. Trykk «Begynn her» eller lag et forslag for å begynne.',
      waitingOffline:
        'Du er uten nett, og denne enheten har ikke hentet plassen i lenken før. Den hentes når du er på nett igjen; har den forslag, vises de da.',
    } satisfies Record<keyof typeof PILL, string>,
    conflict: (name: string, by: string, at: string) => `«${name}» ble endret av ${by} ${at}.`,
    conflictDeleted: (name: string, by: string, at: string) => `«${name}» ble slettet av ${by} ${at}.`,
    conflictHint: 'Endringene dine her er ikke lagret ennå.',
    /** What each conflict button keeps (nothing is thrown away). */
    conflictKeeps: '«Hent endringene» legger utgaven din under Tidligere versjoner. «Lagre over» legger den andre utgaven der.',
    conflictKeepsDeleted:
      '«Hent endringene» lar forslaget ligge i Papirkurv, med utgaven din under Tidligere versjoner. «Lagre over» henter det tilbake med utgaven din.',
    fetchChanges: 'Hent endringene',
    saveOver: 'Lagre over',
    overwritten: (name: string, by: string) =>
      `«${name}» ble endret av ${by} på en enhet uten nett mens du også endret det. Din utgave ligger under Tidligere versjoner.`,
    /** Another device chose «Lagre over» over a version saved here (kept under Tidligere versjoner). */
    overwrittenSavedOver: (name: string, by: string) => `«${name}» ble lagret over av ${by}. Din utgave ligger under Tidligere versjoner.`,
    overwrittenDeleted: (name: string, by: string) =>
      `«${name}» ble slettet av ${by} på en enhet som ikke hadde sett de siste endringene dine. Din utgave ligger i Papirkurv.`,
    showRevisions: 'Vis',
    dismiss: 'Lukk',
    tooNew: (n: number) =>
      n === 1
        ? 'Ett forslag er laget med en nyere versjon av appen og vises ikke her. Oppdater appen for å se det.'
        : `${n} forslag er laget med en nyere versjon av appen og vises ikke her. Oppdater appen for å se dem.`,
    familyUnavailable:
      'Lenken går til familiens delte plass, men den er ikke tilgjengelig her. Forslagene lagres bare på denne enheten.',
    /** A `#f=` link whose family id is not whole (cut off when it was copied or sent). */
    linkInvalid: (hasFamily: boolean) =>
      hasFamily
        ? 'Lenken til familiens plass er ikke hel (den kan ha blitt kuttet av). Du ser den plassen du brukte sist på denne enheten. Be om familielenken på nytt.'
        : 'Lenken til familiens plass er ikke hel (den kan ha blitt kuttet av). Forslagene lagres bare på denne enheten til du åpner hele familielenken. Be om lenken på nytt.',
    /** After a switch to another family space: proposals this device made in the one it used before. */
    carryOver: {
      text: (names: readonly string[]) =>
        names.length === 1
          ? `Du laget «${names[0]}» på denne enheten i plassen du byttet fra.`
          : `Du laget ${names.length} forslag på denne enheten i plassen du byttet fra: ${names.map((n) => `«${n}»`).join(', ')}.`,
      hint: (n: number) =>
        n === 1 ? 'Det legges til her, og i den forrige plassen havner det i Papirkurv.' : 'De legges til her, og i den forrige plassen havner de i Papirkurv.',
      /** The space left has proposals made on other devices (the family's): offered without a highlighted button. */
      othersThere: (n: number) =>
        n === 1
          ? 'Den plassen har også forslag fra andre. Henter du det hit, ser ikke familien det der lenger.'
          : 'Den plassen har også forslag fra andre. Henter du dem hit, ser ikke familien dem der lenger.',
      accept: (n: number) => (n === 1 ? 'Hent forslaget fra den forrige plassen' : 'Hent forslagene fra den forrige plassen'),
      decline: 'Nei takk',
      done: (n: number) => (n === 1 ? 'Forslaget er hentet fra den forrige plassen.' : `${n} forslag er hentet fra den forrige plassen.`),
      /**
       * Name of a proposal brought along when this space already has one with its name: the name of the device that
       * made it («Mammas idé (Pappa)»), else «(kopi)» — never «(delt)», which reads as the family's own.
       */
      copyName: (name: string, who: string | null, n: number) => {
        const tag = who ?? 'kopi';
        return n === 1 ? `${name} (${tag})` : `${name} (${tag} ${n})`;
      },
    },
    /**
     * A family link (a new one, an old tab, a bookmark) to another space than the one this device uses: no switch until
     * the user picks «Bytt dit»; a link to one proposal there offers a copy instead (never a switch).
     */
    otherFamily: {
      text: 'Denne lenken går til en annen delt plass.',
      /** What the two spaces hold: `names` are the people who made the proposals in the link's space. */
      counts: (n: number, names: readonly string[], m: number) => {
        const there =
          n === 0 ? 'Plassen i lenken har ingen forslag (er lenken hel?)' : `Plassen i lenken har ${n} forslag${names.length > 0 ? ` (${names.join(', ')})` : ''}`;
        return `${there}; plassen du bruker nå har ${m === 0 ? 'ingen' : m}.`;
      },
      hint: 'Du ser plassen du bruker nå.',
      switch: 'Bytt dit',
      stay: 'Bli her',
      proposalText: (name: string | null) =>
        name ? `Denne lenken går til «${name}» i en annen delt plass.` : 'Denne lenken går til et forslag i en annen delt plass.',
      proposalHint: 'Du kan hente det som en kopi hit (plassen du bruker nå, byttes ikke) eller bytte dit.',
      proposalMissing: 'Forslaget i lenken finnes ikke i den plassen.',
      copy: (name: string) => `Hent «${name}» som en kopi hit`,
      copied: (name: string) => `«${name}» er hentet som en kopi.`,
    },
    /** A link to a space with no proposals on a device without a family: nothing is stored until the user starts it. */
    emptyFamily: {
      text: 'Denne plassen er tom. Er lenken hel?',
      hint: 'Lenken går til en delt plass uten forslag. Har du fått den fra familien, kan den være kuttet av – be om den på nytt. Er det en ny plass, kan du begynne her.',
      start: 'Begynn her',
    },
    /** Another tab on this device switched to another family space. */
    elsewhere: {
      text: 'Denne enheten har byttet delt plass i en annen fane.',
      hint: 'Denne fanen kan ikke endres før den er lastet på nytt.',
      reload: 'Last på nytt',
    },
    linkImported: (name: string) => `«${name}» fra lenken er lagt til som et nytt forslag.`,
    linkKnown: (name: string) => `«${name}» fra lenken finnes alt i listen.`,
    fileImported: (n: number) => (n === 1 ? 'Forslaget fra fila er lagt til.' : `${n} forslag fra fila er lagt til.`),
    importConfirm: (name: string, n: number) =>
      n === 1 ? `Vil du legge til «${name}» fra fila som et nytt forslag?` : `Vil du legge til de ${n} forslagene fra fila som nye forslag?`,
    restoredFromTrash: (name: string) => `«${name}» er hentet tilbake.`,
    revisionRestored: (name: string) => `«${name}» er satt tilbake til den tidligere versjonen.`,
    name: {
      heading: 'Hva heter du?',
      intro: 'Navnet vises ved forslagene du endrer, for eksempel «sist endret av Mamma». Det lagres på denne enheten og i forslagene.',
      label: 'Navn',
      placeholder: 'For eksempel Mamma',
      save: 'Lagre',
      skip: 'Hopp over',
      /** The first save without a name: a banner once the plan has been left alone (never a dialog while editing). */
      bannerHint: 'Navnet vises ved forslagene du endrer, for eksempel «sist endret av Mamma».',
      bannerWrite: 'Skriv navnet',
      /** «+ Nytt forslag» while the name is unknown: one dialog asks for both. */
      newHeading: 'Nytt forslag',
      proposalLabel: 'Navn på forslaget',
      personLabel: 'Hva heter du?',
      personHint: 'Vises ved forslagene du endrer, for eksempel «sist endret av Mamma». Kan stå tomt.',
      create: 'Lag forslaget',
      cancel: 'Avbryt',
    },
    delete: {
      heading: 'Slett forslag',
      first: (name: string) => `Vil du slette «${name}»?`,
      sureShared: 'Er du sikker? Forslaget forsvinner for alle.',
      sureLocal: 'Er du sikker? Forslaget forsvinner fra listen.',
      trashNote: 'Det ligger i Papirkurv i 30 dager og kan hentes tilbake derfra.',
      cancel: 'Avbryt',
      next: 'Slett',
      confirmShared: 'Slett for alle',
      confirmLocal: 'Slett',
      done: (name: string) => `«${name}» er lagt i Papirkurv.`,
    },
    trash: {
      heading: 'Papirkurv',
      intro: 'Slettede forslag ligger her i 30 dager. Etter det forsvinner de for godt.',
      empty: 'Papirkurven er tom.',
      deleted: (at: string, by: string | null) => (by ? `Slettet ${at} av ${by}` : `Slettet ${at}`),
      daysLeft: (n: number) => (n <= 1 ? 'forsvinner i løpet av et døgn' : `forsvinner om ${n} dager`),
      restore: 'Hent tilbake',
      close: 'Lukk',
    },
    revisions: {
      heading: 'Tidligere versjoner',
      intro: (name: string) =>
        `Appen tar vare på inntil 20 tidligere versjoner av «${name}»: én for hvert femte minutt med endringer, og alltid den utgaven som ble lagt bort da to endret forslaget samtidig.`,
      base: 'Forslag D endres aldri, så det har ingen tidligere versjoner. Velg et av forslagene først.',
      empty: 'Ingen tidligere versjoner ennå. De kommer når forslaget blir endret.',
      loading: 'Henter versjonene …',
      failed: 'Versjonene kunne ikke hentes. Er du uten nett?',
      savedBy: (at: string, by: string | null) => (by ? `${at} · ${by}` : at),
      /** Tags of a revision: a version this device saved, and the version a «Lagre over» put aside. */
      tagOwn: 'din',
      tagSavedOver: 'lagt bort ved Lagre over',
      restore: 'Gjenopprett',
      confirm: (at: string) => `Vil du gjenopprette versjonen fra ${at}? Det du har nå, blir tatt vare på som en tidligere versjon.`,
      restoreFailed: 'Versjonen kunne ikke gjenopprettes.',
      legacyHeading: 'Versjoner lagret på denne enheten før',
      legacyHint: 'Versjoner du lagret selv før forslagene ble delt. «Legg til» gjør forslagene i dem til nye forslag.',
      legacyAdd: 'Legg til',
      close: 'Lukk',
    },
    share: {
      heading: 'Send forslaget',
      introShared: 'Alle som får familielenken, ser de samme forslagene og kan endre dem. Send den bare til familien.',
      proposalLink: (name: string) => `Lenke til «${name}»`,
      proposalNote: 'Åpner dette forslaget i familiens delte plass.',
      familyLink: 'Familielenke (alle forslagene)',
      familyNote: 'Den som åpner denne, kommer inn i familiens delte plass og ser alle forslagene.',
      familyId: 'Familiens plass',
      send: 'Send …',
      copy: 'Kopier',
      copied: 'Kopiert!',
      introLocal:
        'Det er ingen delt plass satt opp, så lenken inneholder en kopi av forslaget. Den som åpner den, får kopien som et nytt forslag.',
      localLink: 'Lenke med en kopi av forslaget',
      shareTitle: (name: string) => `Hytteplanlegger: ${name}`,
      shareText: 'Se forslaget i hytteplanleggeren:',
      copyFailed: 'Kunne ikke kopiere automatisk. Merk lenken og kopier den selv.',
    },
    more: {
      revisions: 'Tidligere versjoner',
      revisionsTitle: 'Se og gjenopprett tidligere versjoner av forslaget du ser på',
      trash: 'Papirkurv',
      trashTitle: 'Slettede forslag (i 30 dager)',
      saveFile: 'Lagre som fil',
      saveFileTitle: 'Last ned forslaget du ser på som fil',
      openFile: 'Åpne fil',
      openFileTitle: 'Legg til forslag fra en fil',
      exportJson: 'Eksporter JSON',
      exportJsonTitle: 'Last ned alle forslagene som én JSON-fil',
      changeName: 'Endre navnet ditt',
      changeNameTitle: 'Navnet som vises ved forslagene du endrer',
    },
    update: {
      ready: 'Ny versjon av appen er klar.',
      button: 'Oppdater',
      updatedElsewhere: 'Appen er oppdatert i en annen fane. Last siden på nytt for å bruke den nye versjonen.',
      reload: 'Last på nytt',
    },
    install: {
      heading: 'Legg planleggeren på Hjem-skjermen',
      ios: 'Trykk på Del-knappen i Safari og velg «Legg til på Hjem-skjerm». Da åpner den som en app og virker også uten nett.',
      iosShared: 'Gjør det mens familielenken er åpen, så kommer du rett inn i familiens forslag.',
      prompt: 'Installer planleggeren som en app på denne enheten. Da virker den også uten nett.',
      install: 'Installer',
      ok: 'Skjønner',
    },
  },

  /** docs/phase2-plan.md §1 rule 2: "Nytt" / "Hytta i dag" / "Fjernet" (never "rives"). */
  status: STATUS satisfies Record<ElementStatus, string>,

  /** Legend of "Vis hva som er nytt" (drawn by the plan). */
  legend: {
    heading: 'Forklaring',
    ...STATUS,
  },

  roomTypes: {
    stue: 'Stue',
    kjokken: 'Kjøkken',
    spiseplass: 'Spiseplass',
    soverom: 'Soverom',
    bad: 'Bad',
    wc: 'WC',
    badstue: 'Badstue',
    gang: 'Gang',
    vindfang: 'Vindfang',
    bod: 'Bod',
    teknisk: 'Teknisk rom',
    pantry: 'Pantry',
    hems: 'Hems',
    leseskrok: 'Leseskrok',
    apning: 'Åpning',
    annet: 'Annet',
  } satisfies Record<RoomType, string>,

  openingTypes: {
    window: 'Vindu',
    door: 'Dør',
    glassDoor: 'Glassdør',
    slidingDoor: 'Skyvedør',
    saunaDoor: 'Badstudør',
    opening: 'Åpning',
  } satisfies Record<OpeningType, string>,

  wallKinds: {
    interior: 'Innervegg',
    'exterior-old': 'Tidligere yttervegg',
    divider: 'Romdeler',
    exterior: 'Yttervegg',
  } satisfies Record<WallKind | 'exterior', string>,

  floorMaterials: {
    wood: 'Tregulv',
    tile: 'Fliser',
    sauna: 'Badstupanel',
    concrete: 'Betong',
    deck: 'Terrassebord',
  } as Record<string, string>,

  roofTypes: {
    gable: 'Saltak',
    mono: 'Pulttak',
    flat: 'Flatt tak',
  } as Record<string, string>,

  roofMaterials: {
    turf: 'Torv',
    metal: 'Metall',
    shingle: 'Shingel',
  } as Record<string, string>,

  selectionKinds: {
    wall: 'Vegg',
    blockEdge: 'Yttervegg',
    blockVertex: 'Hjørne',
    opening: 'Dør/vindu',
    room: 'Rom',
    block: 'Bygningsdel',
    deck: 'Terrasse',
    railing: 'Rekkverk',
    hotTub: 'Badestamp',
    structure: 'Konstruksjon',
    furniture: 'Møbel',
    tree: 'Tre',
    deckVertex: 'Terrassehjørne',
    deckEdge: 'Terrassekant',
    steps: 'Trapp',
    /** The kind tag of a removed piece of today's cabin (the header's status tag already says "Fjernet"). */
    ghost: 'Fra hytta i dag',
  } as Record<string, string>,

  structureKinds: {
    post: 'Stolpe',
    beam: 'Bjelke',
    chimney: 'Pipe',
    stair: 'Trapp',
  } as Record<string, string>,

  error: {
    heading: 'Noe gikk galt',
    body: 'Visningen kunne ikke tegnes. Du kan laste siden på nytt eller tilbakestille prosjektet til Forslag D.',
    paneBody: 'Denne visningen kunne ikke tegnes.',
    retry: 'Prøv igjen',
    reload: 'Last siden på nytt',
    reset: 'Tilbakestill til Forslag D',
    details: 'Tekniske detaljer',
  },

  a11y: {
    closeDialog: 'Lukk dialogen',
    planView: 'Plantegning',
    view3d: '3D-modell',
  },

  /** 2D plan renderer (re-exported as `planStrings` by plan2d/strings.ts). */
  plan2d: {
    /** Stair arrow label. */
    up: 'opp',
    /** North arrow letter. */
    north: 'N',
    /** Unit after the scale bar length. */
    metre: 'm',
    /** Label of a detected room face without a Room record. */
    unnamedRoom: 'Uten navn',
    /** Accessible name of the plan SVG. */
    planTitle: 'Plantegning',
    /**
     * The plan's editing side (plan2d/editStrings.ts hands these over with the same keys; it can become
     * `export const editStrings = nb.plan2d.edit;`).
     */
    edit: {
      /** Legend shown with "Vis hva som er nytt" (§3.4): the status words. */
      legendExisting: STATUS.existing,
      legendNew: STATUS.new,
      legendRemoved: STATUS.removed,
      /** Hint line texts the plan reports through `onHint` (§3.2): the same texts as `nb.hints`. */
      hintWallStart: HINTS.wall,
      hintWallEnd: HINTS.wallEnd,
      hintOpening: HINTS.opening,
      hintUnit: HINTS.unit,
      hintMeasure: HINTS.measure,
      hintMeasureEnd: HINTS.measureEnd,
      hintFurniture: HINTS.furniture,
      /** Tooltips of the drag handles. */
      handleVertex: 'Dra for å flytte hjørnet',
      handleEdge: 'Dra for å flytte kanten',
      handleInsert: 'Trykk eller dra for å legge til et hjørne',
      handleWallEnd: 'Dra for å flytte veggenden',
      handleOpeningEnd: 'Dra for å endre bredden',
      /** The selected furniture item's rotate handle. */
      rotateHandle: 'Roter: trykk for 90°, eller dra rundt',
    },
  },

  /**
   * The editor core's texts (state/editStrings.ts hands these over with the same keys; it can become
   * `export const EDIT_STRINGS = nb.editor;`).
   */
  editor: {
    /** §1.1: every edit of the bundled Forslag D is refused with this toast (button "Nytt forslag"). */
    locked: LOCKED,
    /** Toast after every delete (with [Angre]). */
    deleted: 'Slettet.',
    /**
     * §3.5: two rooms ended up in one face; «a» stays (its name is the one on the plan). The UI shows it in ONE toast
     * with the action's own text: "Slettet. «Soverom 1» og «Bad» er nå ett rom." (ui/Toasts.tsx).
     */
    merged: (a: string, b: string) => `«${a}» og «${b}» er nå ett rom.`,
    /** §3.6: deleteBlock of a block with existing area. */
    existingBlockDelete: EXISTING_BLOCK_DELETE,
    /** moveBlock of a block with existing area. */
    existingBlockMove: 'Hytta i dag kan ikke flyttes som helhet – flytt veggene i stedet.',
    /** §3.7: a room size field whose side has only block edges. */
    resizeBlockEdge: 'Endres under bygningsdelen',
    /** deleteDeckVertex on a deck with three corners. */
    deckMinVertices: 'Terrassen må ha minst tre hjørner.',
    /** deleteDeckVertex when the outline without the corner would cross itself. */
    deckVertexCrosses: 'Hjørnet kan ikke fjernes – terrassen ville krysse seg selv.',
    /** A drag or a nudge that would make a building, deck or wall too small or turn it inside out. */
    tooSmall: 'Så langt går det ikke – da blir det for lite.',
    /** duplicateBlock: name of the copy. */
    copyName: (name: string) => `${name} (kopi)`,
    /**
     * «Dupliser» / Ctrl+D (editActions `duplicateFurniture`): no free spot for a copy in the item's room nor in the
     * rooms next to it, so nothing is added.
     */
    duplicateNoSpace: 'Ingen ledig plass til en kopi.',
    /**
     * «Dupliser»: the original's room was full and the copy went to a room a door or opening of that room leads to;
     * null: a room without a name.
     */
    copyIn: (room: string | null) => (room ? `Kopien står i «${room}».` : 'Kopien står i et rom uten navn.'),
    /**
     * A unit from Nytt bygg would stand on another building: the placement, a move or turn of the unit, or an edge or
     * corner drag is refused or stops against that building's wall. The hint line as it is, with a full stop as a
     * toast.
     */
    unitOnBlock: 'Bygget kan ikke stå oppå et annet bygg',
    /**
     * A house edge or corner that cannot move outward because a unit from Nytt bygg stands against it (the move is
     * refused, nothing changes). No full stop: it is also the drag hint; the toast adds one.
     */
    unitInTheWay: (unit: string) => `«${unit}» står inntil veggen – flytt det først`,
    /**
     * «Ta tilbake» on a house edge refused because a unit from Nytt bygg is in the way: the unit against the edge that
     * cannot be pushed away, or one in the edge plan's way. No full stop: the toast adds one.
     */
    restoreUnitInTheWay: (unit: string) => `Ta tilbake går ikke: «${unit}» står i veien – flytt det først`,
    /** Bredde / Dybde made a unit's own openings narrower so they fit its walls (toast with [Angre]). */
    unitOpeningsNarrowed: (unit: string, count: number) =>
      count === 1 ? `Åpningen i «${unit}» er gjort smalere, så den får plass i veggen.` : `Åpningene i «${unit}» er gjort smalere, så de får plass i veggene.`,
    /** «Ta tilbake» gave merged-away rooms their own face back: "Rommet «WC» er tilbake." */
    roomsBack: (names: readonly string[]) => {
      const q = names.map((n) => `«${n}»`);
      if (q.length <= 1) return `Rommet ${q[0] ?? ''} er tilbake.`;
      return `Rommene ${q.slice(0, -1).join(', ')} og ${q[q.length - 1]} er tilbake.`;
    },
    /**
     * Drag hint (`DragFeedback.hint`) while a wall drag is cut short or refused because an end of the wall cannot
     * follow (its support runs out, e.g. lw-split north).
     */
    wallStuck: 'Veggen kan ikke flyttes lenger hit – enden står fast',
    /** A unit placed over furniture pushed it out of the unit: "«Utebord» er flyttet ut av «Vedskjul»." */
    furniturePushedOut: (unit: string, items: readonly string[]) => {
      const q = items.map((n) => `«${n}»`);
      const list = q.length <= 1 ? (q[0] ?? '') : `${q.slice(0, -1).join(', ')} og ${q[q.length - 1]}`;
      return `${list} er flyttet ut av «${unit}».`;
    },
    /**
     * "Nytt bygg" templates (model/unitTemplates.ts): the new block's name and its one room's name (project data
     * once placed). The toolbar's chooser shows `nb.tools.units`, which uses the same block names.
     */
    units: {
      vedskjul: { block: 'Vedskjul', room: 'Vedskjul' },
      bod: { block: 'Bod', room: 'Bod' },
      badstue: { block: 'Badstue', room: 'Badstue' },
      anneks: { block: 'Anneks', room: 'Anneks' },
      eget: { block: 'Eget bygg', room: 'Rom' },
    },
  },

  /** 3D renderer (re-exported as `STRINGS` by view3d/strings.ts). */
  view3d: {
    /** Root element label for assistive technology. */
    canvasLabel: '3D-modell av hytta',
    /** Hint in the lower left corner (old model). */
    hint: 'Dra for å snu · rull/knip for å zoome · trykk for å velge',
    /** Room without a name (should not normally be labelled). */
    unnamedRoom: 'Uten navn',
  },

  /** Phase 3: «Eksporter» – the plan as PDF and the 3D view as PNG (src/export, ui/ExportDialog.tsx). */
  export: {
    // ---- top bar menu «Eksporter» (ui/ExportMenu.tsx, next to «Mer») ---------------------------------------------
    menu: 'Eksporter',
    menuTitle: 'Lagre planen som PDF til utskrift, eller 3D-bildet som PNG',
    menuPdf: 'Eksporter plan som PDF …',
    menuPdfTitle: 'Lag en PDF av plantegningen i målestokk 1:50 eller 1:100, med romskjema – til utskrift eller til en håndverker',
    menuPng: 'Lagre 3D-bildet som PNG',
    menuPngTitle: 'Lagre det du ser i 3D-visningen som et bilde (PNG)',

    // ---- the PDF dialog -----------------------------------------------------------------------------------------
    heading: 'Eksporter plan som PDF',
    paper: 'Papir',
    paperA4Title: 'A4 (21 × 29,7 cm), vanlig skriverpapir',
    paperA3Title: 'A3 (29,7 × 42 cm), dobbelt så stort som A4',
    scale: 'Målestokk',
    scale50Title: '1:50 – 1 m blir 2 cm på papiret',
    scale100Title: '1:100 – 1 m blir 1 cm på papiret',
    storeys: 'Etasjer',
    bothStoreys: 'Begge',
    bothStoreysTitle: 'Plan 1 og Hems, hver på sine ark',
    include: 'Ta med',
    labels: 'Romnavn og arealer',
    dims: 'Målsetting',
    furniture: 'Møbler',
    colours: 'Farger',
    coloursNew: 'Vis hva som er nytt (farger)',
    coloursNewTitle: 'Nytt i oransje, det som fjernes stiplet, med forklaring – som i appen',
    coloursBw: 'Svart-hvitt',
    coloursBwTitle: 'Bare svart, hvitt og grått – best på en skriver uten farger',
    orientation: { landscape: 'liggende', portrait: 'stående' } as Record<'landscape' | 'portrait', string>,
    /** "Blir 3 sider: Plan 1 på 1 ark A3 liggende, Hems på 1 ark A3 liggende, romskjema til slutt." */
    summary: (pages: number, parts: string[]) => `Blir ${pages} ${pages === 1 ? 'side' : 'sider'}: ${[...parts, 'romskjema til slutt'].join(', ')}.`,
    summaryPart: (storey: string, sheets: number, paper: string, orientation: string) => `${storey} på ${sheets} ark ${paper} ${orientation}`,
    tiled: 'Planen er større enn arket i denne målestokken, så den deles på flere ark med 1 cm overlapp. Skriv ut i «faktisk størrelse» (100 %), ikke «tilpass til siden».',
    printTip: 'Skriv ut i «faktisk størrelse» (100 %), så stemmer målestokken.',
    make: 'Lag PDF',
    making: 'Lager PDF …',
    done: (file: string, pages: number) => `Laget «${file}» (${pages} ${pages === 1 ? 'side' : 'sider'}).`,
    share: 'Del …',
    shareTitle: 'Send PDF-en med telefonens delingsmeny (e-post, meldinger, Filer …)',
    download: 'Last ned',
    downloadTitle: 'Lagre PDF-en på denne enheten',
    failed: (message: string) => `Klarte ikke å lage PDF-en: ${message}`,
    /**
     * A lazy library (the PDF code, the IFC reader) has never been downloaded on this device and there is no network
     * (export/offline.ts `offlineFirstUse`; the PDF dialog and the IFC panel).
     */
    offlineFirstUse: 'Første gang trenger dette nett – koble til og prøv igjen; etterpå virker det uten nett.',

    // ---- title block --------------------------------------------------------------------------------------------
    tbProject: 'Prosjekt',
    tbProposal: 'Forslag',
    tbStorey: 'Etasje',
    tbScale: 'Målestokk',
    tbDate: 'Dato',
    tbSheet: 'Ark',
    tbSheetOf: (i: number, n: number) => `${i} av ${n}`,
    /** Position of a tile in a plan split over several sheets: "rad 1, kolonne 2". */
    tbTile: (row: number, col: number) => `rad ${row}, kolonne ${col}`,
    tbAreas: 'Arealer',
    /** "BYA 235,5 m²" and below it "bygg 178,3 · terrasse 57,2" */
    tbBya: (total: string) => `BYA ${total}`,
    tbByaDetail: (buildings: string, decks: string) => `bygg ${buildings} · terrasse ${decks}`,
    /** "BRA 170,1 m²" and below it "i dag 95,0 · nytt 75,1" */
    tbBra: (total: string) => `BRA ${total}`,
    tbBraDetail: (existing: string, added: string) => `i dag ${existing} · nytt ${added}`,
    tbMadeWith: 'Hytteplanlegger',
    tbBy: (name: string) => `sist endret av ${name}`,
    tbScheduleStorey: 'Romskjema',
    tbNoScale: '–',
    north: 'N',
    scaleBarUnit: 'm',
    legendExisting: 'Hytta i dag',
    legendNew: 'Nytt',
    legendRemoved: 'Fjernet',

    // ---- schedule page ------------------------------------------------------------------------------------------
    scheduleHeading: 'Romskjema og arealer',
    scheduleType: 'Type',
    schedulePart: 'Del',
    scheduleBoth: 'begge',
    scheduleVoidNote: '(åpning, telles ikke)',
    scheduleTotal: 'Sum alle rom (netto)',
    scheduleContinued: '(fortsatt)',
    totalsHeading: 'Arealer (NS 3940)',
    totalsBya: 'BYA – bebygd areal',
    totalsByaBuildings: 'bygninger',
    totalsByaDecks: 'terrasser over 0,5 m',
    totalsBra: 'BRA – bruksareal',
    totalsAxis: 'Aksemål (grunnflate på akselinjene)',
    totalsRooms: 'Rom (netto, sum av rommene)',
    totalsNote: 'Romarealene er netto gulvflate mellom innsidene av veggene. BYA er målt til utsiden av kledningen; BRA innenfor ytterveggene der fri høyde er minst 1,9 m. «i dag» = hytta slik den er nå, «nytt» = nytt i forslaget.',

    // ---- PNG ----------------------------------------------------------------------------------------------------
    /** Caption line 2: "3D · Ute · Oversikt · 13.10.2026" */
    pngView: (mode: string, preset: string) => `3D · ${mode} · ${preset}`,
    pngSaved: (file: string) => `Bildet er lagret som «${file}».`,
    pngNo3d: 'Fant ikke 3D-visningen. Åpne 3D eller Begge og prøv igjen.',
    pngOpening3d: 'Åpner 3D-visningen …',
    pngFailed: (message: string) => `Klarte ikke å lagre bildet: ${message}`,
  },

  /** Phase 3: «Gå rundt», the first-person walk in 3D (view3d/WalkControls.tsx, WalkOverlay.tsx, ui/Controls.tsx). */
  walk: {
    /** «Gå rundt» button on the 3D view and chip among the camera angles. */
    start: 'Gå rundt',
    startTitle: 'Gå rundt i øyehøyde (1,65 m over gulvet). PC: W A S D og musa, Shift for å løpe, P lagrer bildet, Esc avslutter. Telefon: spaken og dra i bildet.',
    exit: 'Avslutt',
    exitTitle: 'Avslutt Gå rundt (Esc)',
    /** Hint line while walking on a PC with the mouse locked to the view. */
    hintDesktop: 'Gå med W A S D, se deg rundt med musa, P lagrer bildet, Esc avslutter',
    /** …when the mouse is not locked (the browser refused, or after a click elsewhere). */
    hintDesktopUnlocked: 'Gå med W A S D, dra i bildet for å se deg rundt (trykk i bildet for å styre med musa), P lagrer bildet, Esc avslutter',
    /** …on a phone or tablet. */
    hintTouch: 'Gå med spaken, dra i bildet for å se deg rundt',
    joystick: 'Spak: dra for å gå',
    /** The camera button under «Avslutt» while walking (view3d/WalkControlsPhoto.tsx) and the P key. */
    photo: 'Lagre bildet',
    photoTitle: 'Lagre det du ser nå som PNG-bilde (P), uten å slutte å gå',
  },

  /** Phase 3: «Avløp og sluk», the drainage helper (geometry/plumbing.ts, plan2d/layers/PlumbingLayer.tsx, ui/PlumbingToggle.tsx). */
  plumbing: {
    toggle: 'Avløp og sluk',
    toggleTitle: 'Vis avløpsstammen, rørene fra toaletter, dusjer, servanter og vaskemaskiner og hvor langt de har til stammen',
    stack: 'Avløpsstamme',
    stackSuggested: 'Forslag til avløpsstamme. Dra den langs veggene for å flytte den.',
    stackStored: 'Avløpsstamme. Dra den langs veggene for å flytte den, trykk for å slette.',
    stackReadOnly: 'Avløpsstamme',
    deleteStack: 'Slett avløpsstammen',
    addStack: 'Legg til avløpsstamme',
    addStackTitle: 'Setter en ny avløpsstamme på veggen nærmest avløpene som står for langt unna (ellers ved de andre avløpene)',
    todayDrain: 'Bruker avløpet som er der i dag',
    suggestedNote: 'Stammen er et forslag. Dra den i planen for å flytte den.',
    storedNote: 'Trykk på en stamme i planen for å slette den.',
    none: 'Ingen toaletter, dusjer, servanter eller vaskemaskiner i forslaget.',
    /** Definite noun of each fixture that needs a drain («toalettet»), by catalogue id (`plumbingNoun`). */
    nouns: {
      toalett: 'toalettet',
      servant: 'servanten',
      'dusj-80': 'dusjen',
      'dusj-90': 'dusjen',
      'dusj-100': 'dusjen',
      badekar: 'badekaret',
      vaskemaskin: 'vaskemaskinen',
      vaskesoyle: 'vaskesøylen',
      sluk: 'sluket',
      varmtvannsbereder: 'varmtvannsberederen',
    } as Record<string, string>,
    /** A fixture without a noun above. */
    nounOther: 'møbelet',
    /** Distance label on a run in the plan: «0,4 m». */
    distance: (m: number): string => formatM(m),
    /** «WC og Hovedbad: toalettene står rygg mot rygg på veggen ved x 18,6 – det er fint.» */
    pair: (rooms: readonly string[], kind: 'back-to-back' | 'side-by-side', axis: 'x' | 'y' | null, value: number): string =>
      `${rooms.length ? `${joinAnd([...rooms])}: t` : 'T'}oalettene står ${kind === 'back-to-back' ? 'rygg mot rygg' : 'side om side'} på veggen${wallAt(axis, value)} – det er fint.`,
    /** «WC: toalettet står 0,4 m fra avløpsstammen – det er fint.» */
    near: (catalogId: string, room: string | undefined, m: number): string =>
      `${room ? `${room}: ${plumbingNoun(catalogId)}` : cap(plumbingNoun(catalogId))} står ${formatM(m)} fra avløpsstammen – det er fint.`,
    /** «Soverom 1: toalettet står 6,2 m fra avløpsstammen – det er for langt (høyst 1,0 m).» */
    far: (catalogId: string, room: string | undefined, m: number, limit: number): string =>
      `${room ? `${room}: ${plumbingNoun(catalogId)}` : cap(plumbingNoun(catalogId))} står ${formatM(m)} fra avløpsstammen – det er for langt (høyst ${formatM(limit)}).`,
    /** «Soverom 1: toalettet har ingen avløpsstamme i etasjen.» */
    noStack: (catalogId: string, room: string | undefined): string =>
      `${room ? `${room}: ${plumbingNoun(catalogId)}` : cap(plumbingNoun(catalogId))} har ingen avløpsstamme i etasjen.`,
    /** «De andre 4 avløpene står innen 3,0 m fra avløpsstammen – det er fint.» (`reach`: geometry/plumbing.ts FIXTURE_REACH_M) */
    othersNear: (n: number, reach: number): string =>
      n === 1
        ? `Det andre avløpet står innen ${formatM(reach)} fra avløpsstammen – det er fint.`
        : `De andre ${n} avløpene står innen ${formatM(reach)} fra avløpsstammen – det er fint.`,
    /** «Bad, Do og Teknisk / vask bruker avløpet som er der i dag.» */
    today: (rooms: readonly string[]): string => `${joinAnd([...rooms])} bruker avløpet som er der i dag.`,
    /** Advarsler ('drain-far'): «Toalettet i «Soverom 1» står 6,2 m fra avløpsstammen.» */
    drainFar: (catalogId: string, room: string | null | undefined, m: number): string =>
      `${cap(plumbingNoun(catalogId))}${room ? ` i «${room}»` : ''} står ${formatM(m)} fra avløpsstammen.`,
  },

  /** Phase 3: «IFC-modell», the architect's model of today's cabin as an overlay (src/ifc, ui/IfcPanel.tsx). */
  ifc: {
    heading: 'IFC-modell',
    intro:
      'Legg arkitektens modell av hytta i dag over planen og 3D-visningen, så du kan se at alt stemmer. Fila blir bare på denne enheten – den lastes ikke opp og deles ikke.',
    load: 'Last inn IFC-fil',
    loadTitle: 'Velg arkitektens IFC-fil (.ifc) fra denne enheten',
    replace: 'Bytt fil',
    replaceTitle: 'Velg en annen IFC-fil',
    remove: 'Fjern',
    removeTitle: 'Fjern IFC-modellen fra denne enheten',
    loading: 'Leser IFC-fila …',
    restoring: 'Henter IFC-modellen …',
    notIfc: 'Fila ser ikke ut som en IFC-fil (.ifc).',
    failed: 'IFC-fila kunne ikke leses.',
    empty: 'Fant ingen vegger, tak eller dekker i IFC-fila.',
    fileInfo: (name: string, bytes: number) => `${name} · ${formatBytes(bytes)}`,
    showPlan: 'Vis i planen',
    showPlanTitle: 'Blå omriss av IFC-modellens vegger, vinduer og dører over planen',
    show3d: 'Vis i 3D',
    show3dTitle: 'IFC-modellen halvgjennomsiktig i 3D',
    walls3d: 'Vegger, dører og vinduer',
    roof3d: 'Tak',
    slabs3d: 'Dekker',
    opacity: 'Synlighet',
    percent: (v: number) => `${Math.round(v * 100)} %`,
    nudge: 'Juster plassering',
    nudgeTitle: 'Flytt IFC-modellen 1 cm om gangen, høyst 10 cm hver vei',
    nudgeLeft: 'Flytt 1 cm til venstre',
    nudgeRight: 'Flytt 1 cm til høyre',
    nudgeUp: 'Flytt 1 cm opp i planen',
    nudgeDown: 'Flytt 1 cm ned i planen',
    nudgeOffset: (dx: number, dy: number) => `x ${signedCm(dx)} m · y ${signedCm(dy)} m`,
    nudgeReset: 'Nullstill',
    nudgeResetTitle: 'Tilbake til plasseringen fra kalibreringen',
  },
} as const;

/** Start of the message of a geometry-fallback 'generic' warning (geometry/derive.ts `GEOMETRY_FALLBACK` + ':'). */
const GEOMETRY_FALLBACK_PREFIX = 'geometry fallback:';

/**
 * Lookup used by `warningText` to turn ids into names. Return the id itself when unknown. 'furniture' gives the
 * item's catalogue name. Walls and openings are named by type and place (ui/warnings.ts, `nb.warnings.names`), never
 * by id: 'opening' = "vinduet i veggen mellom Gang og Bad", 'openingType' = "vinduet", 'openingPlace' = "i veggen
 * mellom Gang og Bad", 'wall' = "veggen mellom Gang og Bad" (all lower case; `warningText` capitalises).
 *
 * Place words for the rest ('' when unknown; `warningText` then falls back to a text without them):
 *  - 'openingCoveredBy' (opening id): the building part now standing where the opening's stretch of wall was;
 *  - 'roofEnd' (`${blockId}:start` or `${blockId}:end`): the compass direction of that end of the roof, "øst";
 *  - 'stepsTowards' (steps id): the direction the deck steps face, "sør";
 *  - 'stepsBlockedBy' (steps id): the building part in the steps' way;
 *  - 'obstacle' (id of what a furniture item stands in): "i trappa", "i pipa", "i en stolpe", "i badestampen"
 *    (structure and hot tubs; '' for a wall).
 * A 'door-blocked' warning's `by` is a wall or a furniture item: 'furniture' answers with the item's name for an item
 * and with the id itself for anything else.
 */
export type NameLookup = (
  kind:
    | 'level'
    | 'room'
    | 'block'
    | 'opening'
    | 'openingType'
    | 'openingPlace'
    | 'wall'
    | 'furniture'
    | 'openingCoveredBy'
    | 'roofEnd'
    | 'stepsTowards'
    | 'stepsBlockedBy'
    | 'obstacle',
  id: string,
) => string;

/** Metres with two decimals and a comma (heights in warnings). */
function metres2(v: number): string {
  return `${v.toFixed(2).replace('.', ',')} m`;
}

/** First letter upper case (a sentence that starts with an element's name). */
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "a", "a og b", "a, b og c". */
function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${nb.warnings.names.and} ${items[items.length - 1]}`;
}

/** A place word from the lookup, or '' when it does not know one (an unknown id comes back as itself). */
function placeWord(names: NameLookup, kind: Parameters<NameLookup>[0], id: string): string {
  const v = names(kind, id);
  return v && v !== id ? v : '';
}

/** Overlapping openings: "Døra og vinduet i veggen mellom …" when they share the wall, else each with its place. */
function overlapNames(ids: Id[], names: NameLookup): string {
  const places = ids.map((id) => names('openingPlace', id));
  if (places.length > 1 && places.every((p) => p === places[0])) return `${joinAnd(ids.map((id) => names('openingType', id)))} ${places[0]}`;
  return joinAnd(ids.map((id) => names('opening', id)));
}

/** Norwegian text for a model warning. `fmtArea` formats m² (ui/format.ts formatM2). */
export function warningText(w: ModelWarning, names: NameLookup, fmtArea: (m2: number) => string): string {
  switch (w.kind) {
    case 'room-unnamed':
      return `Rom uten navn på ${names('level', w.levelId)} (${fmtArea(w.area)}).`;
    case 'room-anchor-lost':
      return `Rommet «${names('room', w.roomId)}» er borte fra planen. Angre siste endring, eller gi rommet et nytt navn.`;
    case 'room-small':
      return `Rommet «${names('room', w.roomId)}» er bare ${fmtArea(w.area)} (minst ${fmtArea(w.min)}).`;
    case 'opening-outside-host':
      return `${cap(names('opening', w.openingId))} får ikke plass i veggen.`;
    case 'opening-overlap':
      return `${cap(overlapNames(w.openingIds, names))} overlapper hverandre.`;
    case 'opening-above-roof':
      return `${cap(names('opening', w.openingId))} stikker opp i taket (overkant ${metres2(w.headZ)}, tak ${metres2(w.roofZ)}).`;
    case 'opening-on-removed-edge': {
      const by = placeWord(names, 'openingCoveredBy', w.openingId);
      return by
        ? `${cap(names('opening', w.openingId))} sitter i en vegg som nå er dekket av «${by}».`
        : `${cap(names('opening', w.openingId))} sitter i en vegg som er fjernet.`;
    }
    case 'door-blocked': {
      const item = placeWord(names, 'furniture', w.by);
      return item ? `${cap(names('opening', w.openingId))} blokkeres av «${item}».` : `${cap(names('opening', w.openingId))} blokkeres av ${names('wall', w.by)}.`;
    }
    case 'wall-dangling':
      return `${cap(names('wall', w.wallId))} henger løs og danner ikke noe rom.`;
    case 'block-overlap':
      return `Bygningsdelene «${names('block', w.blockIds[0])}» og «${names('block', w.blockIds[1])}» overlapper.`;
    case 'block-self-intersecting':
      return `Bygningsdelen «${names('block', w.blockId)}» krysser seg selv – sjekk hjørnene.`;
    case 'parts-overlap':
      return `Delene i «${names('block', w.blockId)}» overlapper hverandre.`;
    case 'roof-no-meet': {
      const towards = placeWord(names, 'roofEnd', `${w.blockId}:${w.end}`);
      const end = towards ? `enden mot ${towards}` : `${w.end === 'start' ? 'den ene' : 'den andre'} enden`;
      return `Taket på «${names('block', w.blockId)}» møter ikke nabotaket i ${end}.`;
    }
    case 'area-limit':
      return `Arealet ${fmtArea(w.actual)} er over grensen på ${fmtArea(w.limit)}.`;
    case 'deck-steps-blocked': {
      const towards = placeWord(names, 'stepsTowards', w.stepsId);
      const by = placeWord(names, 'stepsBlockedBy', w.stepsId);
      const steps = towards ? `Trappa fra terrassen mot ${towards}` : 'En trapp fra terrassen';
      return `${steps} står der det nå er ${by ? `«${by}»` : 'et bygg'}. Flytt trappa langs terrassekanten eller slett den.`;
    }
    case 'furniture-overlap':
      return `Møblene «${names('furniture', w.furnitureIds[0])}» og «${names('furniture', w.furnitureIds[1])}» står oppå hverandre.`;
    case 'furniture-in-wall': {
      const inside = placeWord(names, 'obstacle', w.wallId);
      return `Møbelet «${names('furniture', w.furnitureId)}» står ${inside || 'inni en vegg'}.`;
    }
    case 'furniture-outside':
      return `Møbelet «${names('furniture', w.furnitureId)}» står utenfor rommene og terrassen.`;
    case 'furniture-unknown':
      return `Møbeltypen «${w.catalogId}» finnes ikke i katalogen og vises som en boks.`;
    case 'furniture-needs-wet-room':
      return `«${names('furniture', w.furnitureId)}» trenger sluk og bør stå på bad, WC eller vaskerom.`;
    case 'drain-far': {
      const room = w.roomId ? placeWord(names, 'room', w.roomId) : '';
      return nb.plumbing.drainFar(w.catalogId, room || null, w.distance);
    }
    case 'generic':
      return w.message.startsWith(GEOMETRY_FALLBACK_PREFIX)
        ? nb.warnings.geometryFallback(w.message.slice(GEOMETRY_FALLBACK_PREFIX.length).trim())
        : w.message;
    default:
      return 'Ukjent advarsel.';
  }
}
