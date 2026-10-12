/**
 * Renders a furniture symbol (furnitureSymbols.ts) in its local frame (metres; the caller places and turns it). Used
 * by the plan's FurnitureLayer (inside the flipped plan root) and by the furniture library's small icons
 * (`FurnitureIcon`: its own little <svg>, front at the bottom like in the plan at rotation 0). Strokes are screen
 * pixels (non-scaling), so a symbol reads the same at every zoom.
 */
import { memo } from 'react';
import type { Vec2 } from '../../model/types';
import { NSS, PAPER } from '../style';
import { FURNITURE_GLASS, FURNITURE_INK, FURNITURE_SOFT, bodyFill } from './furnitureLayerModel';
import { primsBounds, symbolOverflow, symbolPrims } from './furnitureSymbols';
import type { SymbolPrim, SymbolStyle } from './furnitureSymbols';

interface Paint {
  fill: string;
  fillOpacity?: number;
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  strokeOpacity?: number;
}

function paintOf(s: SymbolStyle, ink: string, body: string): Paint {
  switch (s) {
    case 'outline':
      return { fill: body, stroke: ink, strokeWidth: 1.1 };
    case 'paper':
      return { fill: body, stroke: ink, strokeWidth: 1 };
    case 'soft':
      return { fill: FURNITURE_SOFT, stroke: ink, strokeWidth: 0.7 };
    case 'line':
      return { fill: 'none', stroke: ink, strokeWidth: 0.9 };
    case 'thin':
      return { fill: 'none', stroke: ink, strokeWidth: 0.6, strokeOpacity: 0.85 };
    case 'dashed':
      return { fill: 'none', stroke: ink, strokeWidth: 0.7, strokeDasharray: '3 2' };
    case 'glass':
      return { fill: 'none', stroke: FURNITURE_GLASS, strokeWidth: 1 };
  }
}

const n4 = (v: number) => Math.round(v * 1e4) / 1e4;

function pathOf(pts: Vec2[], closed: boolean): string {
  if (pts.length < 2) return '';
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${n4(p[0])} ${n4(p[1])}`).join('') + (closed ? 'Z' : '');
}

function Prim({ p, ink, body }: { p: SymbolPrim; ink: string; body: string }) {
  const paint = paintOf(p.s, ink, body);
  const common = { ...paint, ...NSS, 'data-sym': p.s };
  switch (p.k) {
    case 'rect':
      return <rect x={n4(p.x)} y={n4(p.y)} width={n4(p.w)} height={n4(p.h)} rx={p.r ? n4(p.r) : undefined} {...common} />;
    case 'circle':
      return <circle cx={n4(p.cx)} cy={n4(p.cy)} r={n4(p.r)} {...common} />;
    case 'ellipse':
      return <ellipse cx={n4(p.cx)} cy={n4(p.cy)} rx={n4(p.rx)} ry={n4(p.ry)} {...common} />;
    case 'line':
      return <line x1={n4(p.a[0])} y1={n4(p.a[1])} x2={n4(p.b[0])} y2={n4(p.b[1])} {...common} fill={undefined} strokeLinecap="round" />;
    case 'poly':
      return <path d={pathOf(p.pts, p.closed)} {...common} fill={p.closed ? paint.fill : 'none'} strokeLinejoin="round" />;
  }
}

export interface FurnitureSymbolProps {
  catalogId: string;
  w: number;
  d: number;
  /** Line colour (default FURNITURE_INK). */
  ink?: string;
  /** Body fill (default paper, or the item colour's fill). */
  colour?: string;
}

/** The symbol's elements in the local frame (no transform). */
export const FurnitureSymbol = memo(function FurnitureSymbol({ catalogId, w, d, ink, colour }: FurnitureSymbolProps) {
  const prims = symbolPrims(catalogId, w, d);
  const body = bodyFill(colour, PAPER);
  const stroke = ink ?? FURNITURE_INK;
  return (
    <g data-symbol={catalogId}>
      {prims.map((p, i) => (
        <Prim key={i} p={p} ink={stroke} body={body} />
      ))}
    </g>
  );
});

/**
 * A small icon of the symbol for the library (`size` px square), the front at the bottom. The symbol keeps its
 * proportions; a long item (a 4 m counter) is drawn thin.
 */
export function FurnitureIcon(props: { catalogId: string; w: number; d: number; size?: number; title?: string }) {
  const { catalogId, w, d } = props;
  const px = props.size ?? 40;
  const prims = symbolPrims(catalogId, w, d);
  const b = primsBounds(prims) ?? { min: [-w / 2, -d / 2] as Vec2, max: [w / 2, d / 2] as Vec2 };
  const over = symbolOverflow(catalogId, w, d);
  const x0 = Math.min(b.min[0], -w / 2 - over);
  const x1 = Math.max(b.max[0], w / 2 + over);
  const y0 = Math.min(b.min[1], -d / 2 - over);
  const y1 = Math.max(b.max[1], d / 2 + over);
  const span = Math.max(x1 - x0, y1 - y0, 0.05);
  const pad = span * 0.06;
  const side = span + 2 * pad;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  // viewBox in the flipped frame (y up): the front (−y) ends up at the bottom.
  return (
    <svg className="furniture-icon" width={px} height={px} viewBox={`${n4(cx - side / 2)} ${n4(-cy - side / 2)} ${n4(side)} ${n4(side)}`} aria-hidden={props.title ? undefined : true} role={props.title ? 'img' : undefined} data-icon={catalogId}>
      {props.title && <title>{props.title}</title>}
      <g transform="scale(1 -1)">
        <FurnitureSymbol catalogId={catalogId} w={w} d={d} />
      </g>
    </svg>
  );
}
