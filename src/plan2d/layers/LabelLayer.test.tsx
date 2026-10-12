// @vitest-environment jsdom
/**
 * LabelHitLayer writes each label's hit rectangle in plan metres (`data-label-box`), which the plan reads when a tap
 * the DOM gives to a wall band lands on a room's name (editModel.ts `labelTap`, usePlanEditing.ts).
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DerivedRoom } from '../../model/derived';
import { parseLabelBox } from '../editModel';
import { LABEL_FONT } from '../labelLayout';
import { LabelHitLayer } from './LabelLayer';
import type { PlacedLabel } from './LabelLayer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const room = { id: 'room-bod-ny', levelId: 'main', room: { id: 'r', name: 'Bod (ny)' } } as unknown as DerivedRoom;

function placed(at: [number, number], w: number, h: number): PlacedLabel {
  return { room, at, label: { lines: ['Bod (ny)'], nameLines: 1, kind: 'name', font: LABEL_FONT, w, h, ys: [0] } } as PlacedLabel;
}

describe('LabelHitLayer: data-label-box', () => {
  it('is the label\'s w × h screen px around its plan point, in plan metres, with the room\'s selection', () => {
    act(() =>
      root.render(
        <svg>
          <LabelHitLayer labels={[placed([7, 10.625], 36.3, 11)]} scale={11.56} />
        </svg>,
      ),
    );
    const rect = container.querySelector('[data-room-label-hit="room-bod-ny"]')!;
    const box = parseLabelBox(rect.getAttribute('data-label-box'));
    expect(box).not.toBeNull();
    expect(box!.min[0]).toBeCloseTo(7 - 36.3 / 2 / 11.56, 3);
    expect(box!.max[0]).toBeCloseTo(7 + 36.3 / 2 / 11.56, 3);
    expect(box!.min[1]).toBeCloseTo(10.625 - 5.5 / 11.56, 3);
    expect(box!.max[1]).toBeCloseTo(10.625 + 5.5 / 11.56, 3);
    expect(rect.getAttribute('data-sel-kind')).toBe('room');
    expect(rect.getAttribute('data-sel-id')).toBe('room-bod-ny');
    expect(rect.getAttribute('data-sel-level')).toBe('main');
  });

  it('follows the zoom', () => {
    act(() =>
      root.render(
        <svg>
          <LabelHitLayer labels={[placed([2, 3], 40, 20)]} scale={40} />
        </svg>,
      ),
    );
    const box = parseLabelBox(container.querySelector('[data-label-box]')!.getAttribute('data-label-box'));
    expect(box).toEqual({ min: [1.5, 2.75], max: [2.5, 3.25] });
  });
});
