/**
 * The plan of one storey as a static, printable SVG drawing at true scale (brief §6). It is the plan's own layers
 * (src/plan2d/layers) rendered with `renderToStaticMarkup`, so the PDF shows exactly the symbols of the app (wall
 * fills with the openings cut out, door swings, windows, stairs, furniture symbols, room labels laid out clear of each
 * other and of the furniture, dimension chains), then rewritten for svg2pdf (svgPrint.ts `printify`).
 *
 * Units: the drawing's own coordinates are plan-layer pixels (PRINT_PX_MM each on paper) with (0, 0) at the plan
 * rectangle's top-left corner (min x, max y); the plan root is `matrix(s 0 0 -s tx ty)` with s = pxPerMetre(scale)
 * (80 at 1:50, 40 at 1:100). Interaction-only layers (block / room / label hit areas, the selection) are left out;
 * the 1 m grid covers `gridRect` (the sheets' whole drawing area) and is cut to the drawing area by the sheet. Black and white: no floor tints, no "new" colours, greys only.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import type { Vec2 } from '../model/types';
import { DimensionLayer } from '../plan2d/layers/DimensionLayer';
import { FloorLayer } from '../plan2d/layers/FloorLayer';
import { FurnitureLayer } from '../plan2d/layers/FurnitureLayer';
import { furnitureLabelObstacles, layoutLabelsClearOfFurniture } from '../plan2d/layers/furnitureLayerModel';
import { GhostLayer } from '../plan2d/layers/GhostLayer';
import { GridLayer } from '../plan2d/layers/GridLayer';
import { LabelLayer } from '../plan2d/layers/LabelLayer';
import { OpeningLayer } from '../plan2d/layers/OpeningLayer';
import { OtherStoreyLayer } from '../plan2d/layers/OtherStoreyLayer';
import { OutdoorLayer } from '../plan2d/layers/OutdoorLayer';
import { RailingLayer } from '../plan2d/layers/RailingLayer';
import { StructureLayer } from '../plan2d/layers/StructureLayer';
import { WallLayer } from '../plan2d/layers/WallLayer';
import { labelFonts } from '../plan2d/labelLayout';
import type { PlanLayerData } from '../plan2d/storeyData';
import { FAINT_OPACITY } from '../plan2d/style';
import { labelDensity } from '../plan2d/svg';
import { rootTransform } from '../plan2d/viewport';
import type { View } from '../plan2d/viewport';
import { pxPerMetre } from './paper';
import type { PlanRect, PrintScale } from './paper';
import { printify } from './svgPrint';

export interface PlanDrawingOptions {
  scale: PrintScale;
  /** Where the 1 m grid goes (m; default the drawn rectangle): the whole grid of sheets, so it fills every sheet. */
  gridRect?: PlanRect;
  labels: boolean;
  dims: boolean;
  furniture: boolean;
  colour: boolean;
}

export interface PlanDrawing {
  /** The plan rectangle drawn (m). */
  rect: PlanRect;
  /** Plan-layer pixels per metre. */
  s: number;
  widthPx: number;
  heightPx: number;
  /** Printable SVG markup (the children of an <svg>), in the drawing's own pixels. */
  markup: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const NO_ITEMS: readonly string[] = [];

/** The view that puts the rectangle's top-left corner at (0, 0) at `s` px/m. */
export function drawingView(rect: PlanRect, s: number): View {
  return { s, tx: -s * rect.min[0], ty: s * rect.max[1] };
}

/** The element tree of the drawing (a plain function: rendered once, statically). */
function printPlanTree(data: PlanLayerData, rect: PlanRect, s: number, opts: PlanDrawingOptions) {
  const highlightNew = opts.colour;
  const g = opts.gridRect ?? rect;
  const grid = { min: [Math.floor(g.min[0]), Math.floor(g.min[1])] as Vec2, max: [Math.ceil(g.max[0]), Math.ceil(g.max[1])] as Vec2 };
  const furniture = opts.furniture ? data.furniture : [];
  const obstacles = highlightNew && data.ghostObstacles.length > 0 ? [...data.labelObstacles, ...data.ghostObstacles] : data.labelObstacles;
  const density = labelDensity(s);
  const labels = opts.labels && density !== 'none' ? layoutLabelsClearOfFurniture(data.rooms, density, s, labelFonts(s), obstacles, furnitureLabelObstacles(furniture)) : [];
  const faint = data.outdoorActive ? undefined : FAINT_OPACITY;
  return (
    <svg xmlns={SVG_NS}>
      <g data-plan-root="" transform={rootTransform(drawingView(rect, s))}>
        <GridLayer rect={grid} scale={s} />
        <g opacity={faint}>
          <OutdoorLayer decks={data.decks} hotTubs={data.hotTubs} trees={data.trees} selection={null} hatch selectable={false} />
        </g>
        {opts.colour && <FloorLayer floors={data.floors} highlightNew={highlightNew} />}
        <OtherStoreyLayer unions={data.otherUnions} />
        {furniture.length > 0 && <FurnitureLayer items={furniture} selection={null} scale={s} showClearances={false} colliding={NO_ITEMS} />}
        <WallLayer unions={data.unions} pieces={data.pieces} dividers={data.dividers} cuts={data.cuts} bounds={data.bounds} highlightNew={highlightNew} selection={null} />
        <GhostLayer ghosts={data.ghosts} highlightNew={highlightNew} />
        <OpeningLayer openings={data.openings} highlightNew={highlightNew} selection={null} />
        <StructureLayer elements={data.structure} selection={null} scale={s} stairModes={data.stairModes} />
        <g opacity={faint}>
          <RailingLayer railings={data.railings} steps={data.steps} selection={null} selectable={false} />
        </g>
        {labels.length > 0 && <LabelLayer labels={labels} scale={s} highlightNew={highlightNew} />}
        {opts.dims && <DimensionLayer dimensions={data.dimensions} scale={s} />}
      </g>
    </svg>
  );
}

/** Parses SVG markup into an element of a fresh XML document; throws on a parse error. */
export function parseSvg(markup: string): Element {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) throw new Error('SVG parse error');
  return root;
}

/** The storey's plan (`data`: plan2d/storeyData.ts `planLayerData`) in `rect` at 1:`opts.scale`, printable. */
export function planDrawing(data: PlanLayerData, rect: PlanRect, opts: PlanDrawingOptions): PlanDrawing {
  const s = pxPerMetre(opts.scale);
  const root = parseSvg(renderToStaticMarkup(printPlanTree(data, rect, s, opts)));
  printify(root, { greyscale: !opts.colour });
  const ser = new XMLSerializer();
  const markup = [...root.childNodes].map((n) => ser.serializeToString(n)).join('');
  return { rect, s, widthPx: (rect.max[0] - rect.min[0]) * s, heightPx: (rect.max[1] - rect.min[1]) * s, markup };
}
