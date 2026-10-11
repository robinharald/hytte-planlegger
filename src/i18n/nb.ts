/**
 * Norwegian bokmål UI strings. Every user-visible string of the app shell lives here (architecture.md "UI").
 * Keys are grouped by panel. Parametrised strings are functions. Numbers are formatted by ui/format.ts
 * (comma decimals, "m²") before they reach these templates.
 * The renderers' own few strings live here too (`plan2d`, `view3d`); plan2d/strings.ts and view3d/strings.ts
 * re-export them under their old names.
 */
import type { ModelWarning } from '../model/derived';
import type { ElementStatus, OpeningType, RoomType, WallKind } from '../model/types';
import type { CameraPreset } from '../view3d/View3D';

export const nb = {
  app: {
    title: 'Hytteplanlegger',
    place: 'Merkesvatnet',
    loading3d: 'Laster 3D …',
    loadingPlan: 'Laster plan …',
    readOnlyTag: 'Skrivebeskyttet',
  },

  topbar: {
    variant: 'Variant',
    variantActions: 'Varianthandlinger',
    duplicate: 'Dupliser',
    duplicateTitle: 'Lag en kopi av varianten du ser på',
    rename: 'Gi nytt navn',
    renameTitle: 'Gi varianten du ser på et nytt navn',
    delete: 'Slett',
    deleteTitle: 'Slett varianten du ser på (kan angres)',
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
    share: 'Del lenke',
    shareTitle: 'Lag en lenke som inneholder designet, til å sende til andre',
    help: 'Hjelp',
    helpTitle: 'Slik bruker du planleggeren, og hurtigtaster',
    more: 'Mer',
    moreTitle: 'Lagre versjon, versjoner, eksport og import',
    fileActions: 'Lagring og deling',
  },

  prompts: {
    duplicateName: 'Navn på den nye varianten:',
    renameVariant: 'Nytt navn på varianten:',
    renameRoom: 'Nytt navn på rommet:',
    versionName: 'Navn på versjonen:',
    deleteVariant: (name: string) => `Vil du slette varianten «${name}»? Dette kan angres med Ctrl+Z.`,
    deleteVersion: (name: string) => `Vil du slette versjonen «${name}»? Dette kan ikke angres.`,
    resetSeed: 'Vil du tilbakestille hele prosjektet til Forslag D? Alle varianter erstattes. Dette kan angres med Ctrl+Z.',
    restoreVersion: (name: string) => `Vil du hente versjonen «${name}»? Dagens prosjekt erstattes (kan angres med Ctrl+Z).`,
    importProject: (name: string) => `Vil du åpne «${name}» fra fila? Dagens prosjekt erstattes (kan angres med Ctrl+Z).`,
  },

  headline: {
    label: 'Nøkkeltall',
    bya: 'BYA',
    byaFull: 'Bebygd areal',
    bra: 'BRA',
    braFull: 'Bruksareal',
    existingShort: 'eks.',
    existingFull: 'eksisterende',
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
    inneTitle: 'Taket tas av og veggene kuttes i snitthøyden, så du ser inn i rommene',
    inneHint: 'tak fjernet',
    cutHeight: 'Snitthøyde',
    cutHeightHint: 'over gulvet',
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
      'inne-stua': 'I øyehøyde inne i stua, langs stua og spiseplassen (best med Inne; snitthøyden settes til minst 2,30 m)',
    } satisfies Record<CameraPreset, string> as Record<string, string>,
  },

  toggles: {
    heading: 'Vis',
    labels: 'Navn på rom',
    dims: 'Målsetting',
    grid: 'Rutenett',
    roofPlan: 'Takplan',
    new: 'Marker det som er nytt',
    trees: 'Bjørketrær',
    terrain: 'Terreng',
    titles: {
      labels: 'Vis romnavn med mål og areal i planen og i 3D',
      dims: 'Vis målkjeder langs ytterveggene i planen',
      grid: 'Vis rutenett med 1 m mellom linjene i planen',
      roofPlan: 'Vis takflatene over planen',
      new: 'Farg det som er nytt (tilbygg og nye vegger) oransje',
      trees: 'Vis bjørketrærne på tomta i 3D',
      terrain: 'Vis terrenget rundt hytta i 3D',
    },
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
    statusTitle: 'Eksisterende (eks.) eller nytt',
    dims: 'Mål (m)',
    dimsTitle: 'Innvendige mål, bredde × dybde. «ca.» når rommet ikke er et rektangel.',
    area: 'Areal',
    areaTitle: 'Netto gulvflate (m²) mellom innsidene av veggene',
    unnamed: 'Uten navn',
    newTag: 'nytt',
    existingTag: 'eks.',
    split: (existing: string, added: string) => `eks. ${existing} · nytt ${added}`,
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
    existing: 'Eksisterende',
    new: 'Nytt',
    buildings: 'Bygninger',
    decks: 'Terrasser over 0,5 m',
    existingShort: 'eks.',
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
    none: 'Ingenting er valgt. Klikk på et rom i planen eller i romskjemaet.',
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
      'Velg Plan, 3D eller Begge i Visning-panelet. I planen bytter du mellom Plan 1 og Hems.',
      'I 3D viser Ute hele hytta, mens Inne tar av taket og kutter veggene i valgt snitthøyde. Dra for å snu, rull eller knip for å zoome.',
      'Klikk på et rom i planen eller i romskjemaet for å se mål og areal under Egenskaper.',
      'Dupliser Forslag D før du endrer noe, så kan du sammenligne variantene etterpå.',
      'Alt lagres automatisk i nettleseren. «Lagre versjon» tar et navngitt øyeblikksbilde, «Del lenke» lager en lenke som inneholder hele designet.',
      'Sol og skygge følger valgt dato og klokkeslett ved hytta. Om sommeren er sola oppe hele døgnet.',
    ],
    shortcuts: 'Hurtigtaster',
    comingSoon: 'kommer',
    shortcutList: [
      { keys: 'Ctrl+Z / Ctrl+Y', text: 'Angre / gjør om', active: true },
      { keys: 'Esc', text: 'Fjern markering', active: true },
      { keys: 'Delete', text: 'Slett det som er valgt', active: false },
      { keys: 'R', text: 'Roter møbel', active: false },
      { keys: 'Ctrl+D', text: 'Dupliser det som er valgt', active: false },
    ],
  },

  banners: {
    readOnly: 'Du ser på en delt versjon.',
    readOnlyHintMerge: (variants: number) =>
      `Endringer er slått av. «Lag min egen kopi» legger ${variants === 1 ? 'den delte varianten' : `de ${variants} delte variantene`} ` +
      'til i ditt eget prosjekt, ved siden av variantene du har fra før.',
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
    heading: 'Del lenke',
    intro: 'Lenken inneholder hele designet. Den som åpner den ser en skrivebeskyttet versjon og kan lage sin egen kopi.',
    allVariants: 'Del alle varianter',
    activeOnly: (name: string) => `Bare «${name}» deles.`,
    allIncluded: (n: number) => `Alle ${n} variantene deles.`,
    link: 'Lenke',
    size: 'Lengde',
    copy: 'Kopier lenke',
    copied: 'Kopiert!',
    copyFailed: 'Kunne ikke kopiere automatisk. Merk lenken og kopier den selv.',
    tooBig: 'Lenken er lang (over 8 kB). Noen apper kutter lange lenker. Send heller designet som JSON-fil.',
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

  status: {
    existing: 'Eksisterende',
    new: 'Nytt',
    removed: 'Rives',
  } satisfies Record<ElementStatus, string>,

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
  },

  /** 3D renderer (re-exported as `STRINGS` by view3d/strings.ts). */
  view3d: {
    /** Root element label for assistive technology. */
    canvasLabel: '3D-modell av hytta',
    /** Hint in the lower left corner (old model). */
    hint: 'Dra for å snu · rull/knip for å zoome',
    /** Room without a name (should not normally be labelled). */
    unnamedRoom: 'Uten navn',
  },
} as const;

/** Start of the message of a geometry-fallback 'generic' warning (geometry/derive.ts `GEOMETRY_FALLBACK` + ':'). */
const GEOMETRY_FALLBACK_PREFIX = 'geometry fallback:';

/** Lookup used by `warningText` to turn ids into names. Return the id itself when unknown. */
export type NameLookup = (kind: 'level' | 'room' | 'block' | 'opening' | 'wall', id: string) => string;

/** Metres with two decimals and a comma (heights in warnings). */
function metres2(v: number): string {
  return `${v.toFixed(2).replace('.', ',')} m`;
}

/** Norwegian text for a model warning. `fmtArea` formats m² (ui/format.ts formatM2). */
export function warningText(w: ModelWarning, names: NameLookup, fmtArea: (m2: number) => string): string {
  switch (w.kind) {
    case 'room-unnamed':
      return `Rom uten navn på ${names('level', w.levelId)} (${fmtArea(w.area)}).`;
    case 'room-anchor-lost':
      return `Rommet «${names('room', w.roomId)}» finner ikke igjen flaten sin. Flytt ankeret inn i rommet.`;
    case 'room-small':
      return `Rommet «${names('room', w.roomId)}» er bare ${fmtArea(w.area)} (minst ${fmtArea(w.min)}).`;
    case 'opening-outside-host':
      return `Åpningen «${names('opening', w.openingId)}» får ikke plass i veggen sin.`;
    case 'opening-overlap':
      return `Åpninger overlapper: ${w.openingIds.map((id) => names('opening', id)).join(', ')}.`;
    case 'opening-above-roof':
      return `Åpningen «${names('opening', w.openingId)}» stikker opp i taket (overkant ${metres2(w.headZ)}, tak ${metres2(w.roofZ)}).`;
    case 'opening-on-removed-edge':
      return `Åpningen «${names('opening', w.openingId)}» sitter i en vegg som er fjernet.`;
    case 'door-blocked':
      return `Døra «${names('opening', w.openingId)}» blokkeres av «${names('wall', w.by)}».`;
    case 'wall-dangling':
      return `Veggen «${names('wall', w.wallId)}» henger løs og danner ikke noe rom.`;
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
    case 'generic':
      return w.message.startsWith(GEOMETRY_FALLBACK_PREFIX)
        ? nb.warnings.geometryFallback(w.message.slice(GEOMETRY_FALLBACK_PREFIX.length).trim())
        : w.message;
    default:
      return 'Ukjent advarsel.';
  }
}
