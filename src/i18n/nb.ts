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
  furniture: 'Møbelbiblioteket kommer i neste oppdatering.',
} as const;

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
    moreTitle: 'Lagre versjon, versjoner, eksport og import',
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
    created: (name: string) => `«${name}» er laget. Nå kan du endre det – og angre alt med Angre.`,
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
    titles: {
      labels: 'Vis romnavn med mål og areal i planen og i 3D',
      dims: 'Vis målkjeder langs ytterveggene i planen',
      grid: 'Vis rutenett med 1 m mellom linjene i planen',
      roofPlan: 'Vis takflatene over planen',
      new: 'Farg det som er nytt oransje i planen, og vis det som er fjernet med stiplede linjer',
      new3d: 'Farg det som er nytt oransje i 3D-modellen. Av: naturlige farger.',
      trees: 'Vis bjørketrærne på tomta i 3D',
      terrain: 'Vis terrenget rundt hytta i 3D',
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
      unit: 'Sett et nytt bygg på tomta eller terrassen: vedskjul, bod, badstue eller anneks',
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

  /** Furniture library slot (the catalogue arrives in phase 2b). */
  library: {
    heading: 'Møbler',
    close: 'Lukk',
    closeTitle: 'Lukk møbelbiblioteket og gå tilbake til Velg',
    placeholder:
      'Møbelbiblioteket kommer i neste oppdatering: senger, sofaer, bord, kjøkken og bad som du trykker på eller drar inn i planen.',
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
      width: 'Bredde',
      depth: 'Dybde',
      colour: 'Farge',
      colourDefault: 'Standard',
      colours: { white: 'Hvit', wood: 'Tre', grey: 'Grå', green: 'Grønn', black: 'Svart' } as Record<string, string>,
      rotate: 'Roter 90°',
      duplicate: 'Dupliser',
      delete: 'Slett',
      room: (name: string) => `Rom: ${name}`,
      noRoom: 'Rom: –',
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
      'Trykk på et rom, en vegg eller et møbel for å se målene. I ditt eget forslag drar du det valgte for å flytte det.',
      'Forslag D er det faste grunnlaget og kan ikke endres. «+ Nytt forslag» lager en kopi som du kan endre: flytt vegger, dører, vinduer og møbler – og angre alt med Angre.',
      'Alt lagres automatisk og deles med familien. Trykk «Send forslaget» for å sende lenken.',
    ],
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
    midsummer: '21. juni',
    today: 'I dag',
  },

  schedule: {
    heading: 'Romskjema',
    room: 'Rom',
    block: 'Bygningsdel',
    status: 'Status',
    statusTitle: 'Hytta i dag (i dag) eller nytt',
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
      areaExisting: 'Herav eksisterende',
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
      sill: 'Brystning',
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
      risers: 'Opptrinn',
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
      towards: (direction: string) => `mot ${direction}`,
      /** Compass points from north, clockwise (45° each). */
      directions: ['nord', 'nordøst', 'øst', 'sørøst', 'sør', 'sørvest', 'vest', 'nordvest'],
      and: 'og',
    },
    /** A 'generic' warning from a geometry fallback (derive.ts GEOMETRY_FALLBACK); the detail stays technical. */
    geometryFallback: (detail: string) =>
      `En del av geometrien er forenklet fordi en polygonberegning feilet. Sjekk hjørner og vegger som nesten ligger oppå hverandre (teknisk: ${detail}).`,
  },

  help: {
    heading: 'Slik bruker du den',
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
    opening: 'Åpning',
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
    existingBlockMove: 'Hytta i dag kan ikke flyttes som helhet – flytt veggene i stedet',
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
} as const;

/** Start of the message of a geometry-fallback 'generic' warning (geometry/derive.ts `GEOMETRY_FALLBACK` + ':'). */
const GEOMETRY_FALLBACK_PREFIX = 'geometry fallback:';

/**
 * Lookup used by `warningText` to turn ids into names. Return the id itself when unknown. 'furniture' gives the
 * item's catalogue name. Walls and openings are named by type and place (ui/warnings.ts, `nb.warnings.names`), never
 * by id: 'opening' = "vinduet i veggen mellom Gang og Bad", 'openingType' = "vinduet", 'openingPlace' = "i veggen
 * mellom Gang og Bad", 'wall' = "veggen mellom Gang og Bad" (all lower case; `warningText` capitalises).
 */
export type NameLookup = (
  kind: 'level' | 'room' | 'block' | 'opening' | 'openingType' | 'openingPlace' | 'wall' | 'furniture',
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
    case 'opening-on-removed-edge':
      return `${cap(names('opening', w.openingId))} sitter i en vegg som er fjernet.`;
    case 'door-blocked':
      return `${cap(names('opening', w.openingId))} blokkeres av ${names('wall', w.by)}.`;
    case 'wall-dangling':
      return `${cap(names('wall', w.wallId))} henger løs og danner ikke noe rom.`;
    case 'block-overlap':
      return `Bygningsdelene «${names('block', w.blockIds[0])}» og «${names('block', w.blockIds[1])}» overlapper.`;
    case 'block-self-intersecting':
      return `Bygningsdelen «${names('block', w.blockId)}» krysser seg selv – sjekk hjørnene.`;
    case 'parts-overlap':
      return `Delene i «${names('block', w.blockId)}» overlapper hverandre.`;
    case 'roof-no-meet':
      return `Taket på «${names('block', w.blockId)}» møter ikke nabotaket i ${w.end === 'start' ? 'den ene' : 'den andre'} enden.`;
    case 'area-limit':
      return `Arealet ${fmtArea(w.actual)} er over grensen på ${fmtArea(w.limit)}.`;
    case 'deck-steps-blocked':
      return 'En trapp fra terrassen står der det nå er et bygg. Flytt trappa langs terrassekanten eller slett den.';
    case 'furniture-overlap':
      return `Møblene «${names('furniture', w.furnitureIds[0])}» og «${names('furniture', w.furnitureIds[1])}» står oppå hverandre.`;
    case 'furniture-in-wall':
      return `Møbelet «${names('furniture', w.furnitureId)}» står inni en vegg.`;
    case 'furniture-outside':
      return `Møbelet «${names('furniture', w.furnitureId)}» står utenfor rommene og terrassen.`;
    case 'furniture-unknown':
      return `Møbeltypen «${w.catalogId}» finnes ikke i katalogen og vises som en boks.`;
    case 'furniture-needs-wet-room':
      return `«${names('furniture', w.furnitureId)}» trenger sluk og bør stå på bad, WC eller vaskerom.`;
    case 'generic':
      return w.message.startsWith(GEOMETRY_FALLBACK_PREFIX)
        ? nb.warnings.geometryFallback(w.message.slice(GEOMETRY_FALLBACK_PREFIX.length).trim())
        : w.message;
    default:
      return 'Ukjent advarsel.';
  }
}
