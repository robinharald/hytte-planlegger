/**
 * Room labels: name, `b × d m` and `m²` (comma decimals via ui/format.ts). Density by the current px/m (svg.ts
 * `labelDensity`): ≥ 20 full label, 8–20 name only (small font below 12), < 8 none. Rooms of type 'apning' get
 * the name only. Faces without a Room record show "Uten navn" (italic, muted) with dims and area.
 * Labels are fitted to their rooms and to each other (labelLayout.ts `layoutRoomLabels`, run once per frame by
 * PlanView and passed to both layers here: the actual text rectangle must lie inside the room, clear of stairs,
 * chimney, posts and — with "Vis hva som er nytt" — the ghosts; the anchor moves off the label point when needed;
 * details are compacted to "name / m²", then dropped, then the name is wrapped, else no label until the user zooms
 * in), so labels never cross a wall or overlap each other.
 * Text is laid out in screen pixels through ScreenText, so it stays the same size at any zoom.
 *
 * Two layers (fix round 2 after phase 2a):
 *  - `LabelHitLayer`: each drawn label's text box is a hit area of its room (`data-room-label-hit`, selection
 *    { kind: 'room', id, levelId }). PlanView draws it BELOW the walls, openings and ghosts: a tap on a room's name
 *    selects the room (phones, zoomed out, where most of a small room is wall band), but within a wall's, door's or
 *    ghost's hit band (editModel.ts `hitBandPx`) that element wins, so walls and ghosts stay selectable next to a
 *    label.
 *  - `LabelLayer`: the text itself, on top of everything, taking no pointer events.
 *
 * Each hit rectangle also carries its box in plan metres (`data-label-box`, "x0 y0 x1 y1", editModel.ts
 * `formatLabelBox`), so a tap that the DOM gives to a wall, door or ghost band can still go to the room whose name was
 * tapped (editModel.ts `labelTap`, usePlanEditing.ts): the label beats the band except within LABEL_TAP_CORE_PX of the
 * element's line. That keeps the names of narrow rooms tappable at the phone's starting zoom («Bod (ny)»).
 */
import { memo } from 'react';
import type { DerivedRoom } from '../../model/derived';
import { formatLabelBox } from '../editModel';
import type { PlacedRoomLabel } from '../labelLayout';
import { selAttrs } from '../selection';
import { COLORS, PAPER } from '../style';
import { ScreenText } from './ScreenText';

export type PlacedLabel = PlacedRoomLabel<DerivedRoom>;

export interface LabelLayerProps {
  /** The fitted labels (labelLayout.ts `layoutRoomLabels` for the storey's rooms at `scale`). */
  labels: readonly PlacedLabel[];
  scale: number;
  highlightNew: boolean;
}

const labelKey = (r: DerivedRoom) => `${r.levelId}/${r.id}`;

/** The label's hit rectangle in plan metres (`data-label-box`): `label.w` × `label.h` screen px centred on `at`. */
function labelBoxOf({ label, at }: Pick<PlacedLabel, 'label' | 'at'>, scale: number): string {
  const hw = label.w / 2 / scale;
  const hh = label.h / 2 / scale;
  return formatLabelBox([at[0] - hw, at[1] - hh], [at[0] + hw, at[1] + hh]);
}

/** One label's hit area (memoised per label: PlanView keeps unchanged labels' identities between frames). */
const LabelHit = memo(function LabelHit({ placed, scale }: { placed: PlacedLabel; scale: number }) {
  const { room: r, label, at } = placed;
  return (
    <ScreenText x={at[0]} y={at[1]} scale={scale}>
      <rect
        x={-label.w / 2}
        y={-label.h / 2}
        width={label.w}
        height={label.h}
        fill="none"
        pointerEvents="fill"
        data-room-label-hit={r.id}
        data-label-box={labelBoxOf(placed, scale)}
        {...selAttrs('room', r.id, r.levelId)}
      />
    </ScreenText>
  );
});

/** Invisible hit areas of the drawn labels (see the header). */
export const LabelHitLayer = memo(function LabelHitLayer({ labels, scale }: { labels: readonly PlacedLabel[]; scale: number }) {
  return (
    <g data-layer="label-hits" pointerEvents="none">
      {labels.map((l) => (
        <LabelHit key={labelKey(l.room)} placed={l} scale={scale} />
      ))}
    </g>
  );
});

/** One label's text (memoised per label). */
const LabelText = memo(function LabelText({ placed: { room: r, label, at }, scale, highlightNew }: { placed: PlacedLabel; scale: number; highlightNew: boolean }) {
  const { lines, nameLines, font, ys } = label;
  const unnamed = !r.room;
  const nameColour = unnamed ? COLORS.labelMuted : r.isNew && highlightNew ? COLORS.labelNew : COLORS.labelName;
  return (
    <ScreenText x={at[0]} y={at[1]} scale={scale} data-room-label={r.id} data-label-kind={label.kind}>
      {lines.map((text, i) => {
        const isName = i < nameLines;
        return (
          <text
            key={i}
            x={0}
            y={ys[i]}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={isName ? font.name : font.detail}
            fontWeight={isName ? 600 : 400}
            fontStyle={unnamed && isName ? 'italic' : undefined}
            fill={isName ? nameColour : COLORS.labelMuted}
            stroke={PAPER}
            strokeWidth={3}
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            {text}
          </text>
        );
      })}
    </ScreenText>
  );
});

/** The label text, on top of the plan (no pointer events). */
export const LabelLayer = memo(function LabelLayer({ labels, scale, highlightNew }: LabelLayerProps) {
  return (
    <g data-layer="labels" pointerEvents="none">
      {labels.map((l) => (
        <LabelText key={labelKey(l.room)} placed={l} scale={scale} highlightNew={highlightNew} />
      ))}
    </g>
  );
});
