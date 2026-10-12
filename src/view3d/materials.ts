/**
 * Materials of the 3D view, ported from the old three.js model (forrige-modell-v16.html): the same canvas
 * textures (boardTex, turfTex, grassTex, deckTex, floorTex, tileTex, logTex, drawn in the same order from the
 * same seeded random sequence), the same Lambert palette, the "new" highlight (emissive 0xb4560f at 0.5).
 *
 * Colour handling: the old model ran three r128 without colour management, so its hex colours were used as
 * LINEAR values (they render lighter than the hex) while its textures were decoded as sRGB. `legacyColour`
 * reproduces that, so the palette looks like the old model under today's colour-managed renderer. Light
 * intensities get the matching ×π (see SunLight.tsx).
 *
 * Everything is created lazily on first use (canvas textures need `document`) and cached for the lifetime of
 * the page; materials and textures are shared by all meshes and never disposed.
 *
 * UVs are in metres (geometryBuilders.ts), so each texture's `repeat` is 1 / its tile size in metres.
 */
import {
  CanvasTexture,
  Color,
  DoubleSide,
  LinearSRGBColorSpace,
  LineBasicMaterial,
  MeshBasicMaterial,
  MeshLambertMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import type { Material } from 'three';
import type { FloorMaterial } from '../model/types';

export type FrameColour = 'white' | 'green' | 'wood' | 'black';
export type LeafColour = 'white' | 'green' | 'wood';

/** Old-model hex colours (sRGB hex, used as linear values — see the header). */
export const PALETTE = {
  background: 0xc5ced8,
  trim: 0x6f8170,
  plinth: 0x9a9c96,
  roofSimple: 0x2c2f2e,
  shingle: 0x3b3936,
  deckSide: 0x35261e,
  rail: 0x3a2a21,
  white: 0xf2f2ee,
  glass: 0x27313a,
  green: 0x3f4f40,
  pine: 0xdcc9a2,
  cut: 0x6b5440,
  pane: 0x9cc3dd,
  tub: 0x5a3c27,
  wood: 0x8a6744,
  black: 0x1e1f20,
  water: 0x5c7684,
  lake: 0x8193a0,
  sauna: 0xd9b98a,
  concrete: 0x9a9c96,
  chimney: 0x2d2c2a,
  chimneyCap: 0x8d9094,
  trunk: 0xe6e2da,
  branch: 0x4a3f3f,
  newEmissive: 0xb4560f,
  selection: 0x2f7de1,
} as const;

/** Tile sizes in metres (u, v) of the canvas textures, from the old model's repeat values. */
export const TEXTURE_TILE = {
  board: [0.6, 2],
  turf: [2.5, 2.5],
  grass: [5.5, 5.5],
  deck: [1.2, 1.2],
  floor: [1.6, 1.6],
  tile: [0.6, 0.6],
  logs: [1.5, 1.5],
} as const;

export function legacyColour(hex: number): Color {
  return new Color().setHex(hex, LinearSRGBColorSpace);
}

// ---------------------------------------------------------------------------
// Canvas textures (verbatim drawing code of the old model)
// ---------------------------------------------------------------------------

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

interface Textures {
  board: CanvasTexture;
  turf: CanvasTexture;
  grass: CanvasTexture;
  deck: CanvasTexture;
  floor: CanvasTexture;
  tile: CanvasTexture;
  logs: CanvasTexture;
}

function rnd(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function canvasTex(w: number, h: number, draw: Draw, tile: readonly [number, number]): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g, w, h);
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.repeat.set(1 / tile[0], 1 / tile[1]);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function createTextures(): Textures {
  const R = rnd(7);
  const board = canvasTex(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#2e211b';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 4; i++) {
        const x = (i * w) / 4;
        g.fillStyle = ['#33251e', '#2b1f19', '#31231c', '#2d201a'][i];
        g.fillRect(x + 3, 0, w / 4 - 3, h);
        g.fillStyle = 'rgba(0,0,0,.55)';
        g.fillRect(x, 0, 3, h);
      }
      for (let k = 0; k < 500; k++) {
        g.fillStyle = `rgba(255,255,255,${R() * 0.03})`;
        g.fillRect(R() * w, R() * h, 1, 6 + R() * 20);
      }
    },
    TEXTURE_TILE.board,
  );
  const turf = canvasTex(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#5f6d34';
      g.fillRect(0, 0, w, h);
      const cols = ['#6f7d3a', '#56632d', '#7b6a3a', '#8a7444', '#4c5a2a', '#7e8a45', '#94704a'];
      for (let k = 0; k < 2600; k++) {
        g.fillStyle = cols[(R() * cols.length) | 0];
        const s = 1 + R() * 4;
        g.fillRect(R() * w, R() * h, s, s);
      }
    },
    TEXTURE_TILE.turf,
  );
  const grass = canvasTex(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#6b7440';
      g.fillRect(0, 0, w, h);
      const cols = ['#77803f', '#5f6838', '#828a4a', '#6a6b3a', '#8c8550', '#596334'];
      for (let k = 0; k < 3500; k++) {
        g.fillStyle = cols[(R() * cols.length) | 0];
        g.fillRect(R() * w, R() * h, 1 + R() * 3, 1 + R() * 3);
      }
    },
    TEXTURE_TILE.grass,
  );
  const deck = canvasTex(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#3a2a21';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#3e2d23' : '#36271f';
        g.fillRect(0, (i * h) / 8 + 2, w, h / 8 - 2);
        g.fillStyle = 'rgba(0,0,0,.5)';
        g.fillRect(0, (i * h) / 8, w, 2);
      }
    },
    TEXTURE_TILE.deck,
  );
  const floor = canvasTex(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#c9a776';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 8; i++) {
        g.fillStyle = ['#c7a473', '#cfae7f', '#c09c6a', '#d2b386'][i % 4];
        g.fillRect(0, (i * h) / 8 + 1, w, h / 8 - 1);
        g.fillStyle = 'rgba(90,60,30,.35)';
        g.fillRect(0, (i * h) / 8, w, 1);
        const x = (i * 97) % w;
        g.fillRect(x, (i * h) / 8, 1, h / 8);
      }
    },
    TEXTURE_TILE.floor,
  );
  const tile = canvasTex(
    128,
    128,
    (g, w, h) => {
      g.fillStyle = '#9ea3a3';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#8a8f90';
      for (let i = 0; i <= 4; i++) {
        g.fillRect((i * w) / 4 - 1, 0, 2, h);
        g.fillRect(0, (i * h) / 4 - 1, w, 2);
      }
    },
    TEXTURE_TILE.tile,
  );
  const logs = canvasTex(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#4a3424';
      g.fillRect(0, 0, w, h);
      for (let y = 10; y < h; y += 22) {
        for (let x = ((y / 22) % 2) * 11; x < w; x += 22) {
          g.beginPath();
          g.arc(x + R() * 3, y + R() * 3, 9 + R() * 2, 0, 7);
          g.fillStyle = ['#c99a63', '#b8854f', '#d4a873'][(R() * 3) | 0];
          g.fill();
          g.strokeStyle = '#7a5434';
          g.lineWidth = 1.5;
          g.stroke();
        }
      }
    },
    TEXTURE_TILE.logs,
  );
  return { board, turf, grass, deck, floor, tile, logs };
}

// ---------------------------------------------------------------------------
// Material sets
// ---------------------------------------------------------------------------

/** Opaque building materials; one set per highlight state (existing/plain vs. "new" with emissive). */
export interface MaterialSet {
  /** Exterior cladding (dark vertical boards). */
  board: MeshLambertMaterial;
  /** Interior lining. */
  pine: MeshLambertMaterial;
  /** Cut cap on walls in the interior mode. */
  cut: MeshLambertMaterial;
  turf: MeshLambertMaterial;
  metalRoof: MeshLambertMaterial;
  shingleRoof: MeshLambertMaterial;
  /** Roof soffit / underside. */
  roofUnder: MeshLambertMaterial;
  trim: MeshLambertMaterial;
  plinth: MeshLambertMaterial;
  deck: MeshLambertMaterial;
  deckSide: MeshLambertMaterial;
  rail: MeshLambertMaterial;
  frame: Record<FrameColour, MeshLambertMaterial>;
  leaf: Record<LeafColour, MeshLambertMaterial>;
  floor: Record<FloorMaterial, MeshLambertMaterial>;
  /** Posts, beams, stair treads. */
  wood: MeshLambertMaterial;
  chimney: MeshLambertMaterial;
  chimneyCap: MeshLambertMaterial;
  tub: MeshLambertMaterial;
  logs: MeshLambertMaterial;
}

export interface Materials {
  plain: MaterialSet;
  /** Same materials with the orange emissive tint for elements that are new. */
  highlight: MaterialSet;
  glassExterior: MeshLambertMaterial;
  glassInterior: MeshLambertMaterial;
  railGlass: MeshLambertMaterial;
  lake: MeshLambertMaterial;
  tubWater: MeshLambertMaterial;
  /** Fine terrain grid. */
  grass: MeshLambertMaterial;
  /** Coarse terrain grid: pushed back in depth so the fine grid wins where they overlap. */
  grassFar: MeshLambertMaterial;
  trunk: MeshLambertMaterial;
  branch: MeshLambertMaterial;
  /** Overlay drawn on top of the selected element. */
  selection: MeshBasicMaterial;
  /** Outline of the selected element's crease edges, drawn through everything (no depth test). */
  selectionLine: LineBasicMaterial;
}

function lambert(hex: number, extra: Partial<Pick<MeshLambertMaterial, 'side' | 'transparent' | 'opacity' | 'depthWrite'>> = {}): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ color: legacyColour(hex) });
  Object.assign(m, extra);
  return m;
}

function textured(map: CanvasTexture): MeshLambertMaterial {
  return new MeshLambertMaterial({ map });
}

function createPlainSet(t: Textures): MaterialSet {
  return {
    board: textured(t.board),
    pine: lambert(PALETTE.pine),
    cut: lambert(PALETTE.cut),
    turf: textured(t.turf),
    metalRoof: lambert(PALETTE.roofSimple),
    shingleRoof: lambert(PALETTE.shingle),
    roofUnder: lambert(PALETTE.rail),
    trim: lambert(PALETTE.trim),
    plinth: lambert(PALETTE.plinth),
    deck: textured(t.deck),
    deckSide: lambert(PALETTE.deckSide),
    rail: lambert(PALETTE.rail),
    frame: {
      white: lambert(PALETTE.white),
      green: lambert(PALETTE.green),
      wood: lambert(PALETTE.wood),
      black: lambert(PALETTE.black),
    },
    leaf: {
      white: lambert(PALETTE.white),
      green: lambert(PALETTE.green),
      wood: lambert(PALETTE.wood),
    },
    floor: {
      wood: textured(t.floor),
      tile: textured(t.tile),
      sauna: lambert(PALETTE.sauna),
      concrete: lambert(PALETTE.concrete),
      deck: textured(t.deck),
    },
    wood: lambert(PALETTE.wood),
    chimney: lambert(PALETTE.chimney),
    chimneyCap: lambert(PALETTE.chimneyCap),
    tub: lambert(PALETTE.tub, { side: DoubleSide }),
    logs: textured(t.logs),
  };
}

/** Deep-clones a set, giving every material the old model's "new" emissive tint. */
function highlighted(set: MaterialSet): MaterialSet {
  const tint = (m: MeshLambertMaterial): MeshLambertMaterial => {
    const c = m.clone();
    c.emissive = legacyColour(PALETTE.newEmissive);
    c.emissiveIntensity = 0.5;
    return c;
  };
  const mapRecord = <K extends string>(r: Record<K, MeshLambertMaterial>): Record<K, MeshLambertMaterial> =>
    Object.fromEntries(Object.entries(r).map(([k, m]) => [k, tint(m as MeshLambertMaterial)])) as Record<K, MeshLambertMaterial>;
  return {
    board: tint(set.board),
    pine: tint(set.pine),
    cut: tint(set.cut),
    turf: tint(set.turf),
    metalRoof: tint(set.metalRoof),
    shingleRoof: tint(set.shingleRoof),
    roofUnder: tint(set.roofUnder),
    trim: tint(set.trim),
    plinth: tint(set.plinth),
    deck: tint(set.deck),
    deckSide: tint(set.deckSide),
    rail: tint(set.rail),
    frame: mapRecord(set.frame),
    leaf: mapRecord(set.leaf),
    floor: mapRecord(set.floor),
    wood: tint(set.wood),
    chimney: tint(set.chimney),
    chimneyCap: tint(set.chimneyCap),
    tub: tint(set.tub),
    logs: tint(set.logs),
  };
}

function createMaterials(): Materials {
  const t = createTextures();
  const plain = createPlainSet(t);
  const glass = (hex: number, opacity: number) => lambert(hex, { side: DoubleSide, transparent: true, opacity, depthWrite: false });
  const grassFar = textured(t.grass);
  grassFar.polygonOffset = true;
  grassFar.polygonOffsetFactor = 2;
  grassFar.polygonOffsetUnits = 4;
  const lake = lambert(PALETTE.lake);
  lake.polygonOffset = true;
  lake.polygonOffsetFactor = -1;
  lake.polygonOffsetUnits = -2;
  const selection = new MeshBasicMaterial({ color: PALETTE.selection, transparent: true, opacity: 0.35, depthWrite: false });
  selection.polygonOffset = true;
  selection.polygonOffsetFactor = -1;
  selection.polygonOffsetUnits = -4;
  const selectionLine = new LineBasicMaterial({ color: PALETTE.selection, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
  return {
    plain,
    highlight: highlighted(plain),
    glassExterior: glass(PALETTE.glass, 0.35),
    glassInterior: glass(PALETTE.pane, 0.45),
    railGlass: glass(PALETTE.pane, 0.45),
    lake,
    tubWater: lambert(PALETTE.water),
    grass: textured(t.grass),
    grassFar,
    trunk: lambert(PALETTE.trunk),
    branch: lambert(PALETTE.branch),
    selection,
    selectionLine,
  };
}

let cache: Materials | null = null;

/** The shared materials (created on first call; browser only). */
export function getMaterials(): Materials {
  if (!cache) cache = createMaterials();
  return cache;
}

/** Material set for an element: the highlight set for new elements while "Marker det som er nytt" is on. */
export function materialSet(m: Materials, isNew: boolean, highlightNew: boolean): MaterialSet {
  return isNew && highlightNew ? m.highlight : m.plain;
}

/** Roof surface material by roof material type. */
export function roofSurface(set: MaterialSet, material: 'turf' | 'metal' | 'shingle'): Material {
  return material === 'metal' ? set.metalRoof : material === 'shingle' ? set.shingleRoof : set.turf;
}
