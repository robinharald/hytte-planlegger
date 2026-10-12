// @vitest-environment jsdom
/**
 * EditOverlay draws a handle at its own radius when it has one (`PlanHandle.r`: the touch end handles of openings,
 * capped at 0,3 m in plan metres, editModel.ts `openingEndHandleRadiusPx`), else at the pointer's handle radius.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_FEEDBACK } from '../editFeedback';
import { HANDLE_RADIUS_COARSE_PX, pointerSizes } from '../editModel';
import type { PlanHandle } from '../editModel';
import type { EditOverlayState } from '../usePlanEditing';
import { EditOverlay } from './EditOverlay';

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

const STATE: EditOverlayState = { tool: 'select', dragging: false, feedback: EMPTY_FEEDBACK, hover: null, wallStart: null, measure: null, openingHover: null, unitGhost: null, dropPreview: null };

const handle = (key: string, r?: number): PlanHandle => ({ key, p: [1, 1], shape: 'end', drag: null, tap: null, active: false, title: key, ...(r === undefined ? {} : { r }) });

describe('EditOverlay handles', () => {
  it('a handle with its own radius is drawn at it; the others at the pointer radius', () => {
    act(() =>
      root.render(
        <svg>
          <EditOverlay view={{ s: 40, tx: 0, ty: 400 }} handles={[handle('oe:start', 12), handle('we:a')]} sizes={pointerSizes(true)} state={STATE} dimensions={[]} highlights={[]} />
        </svg>,
      ),
    );
    const r = (key: string) => Number(container.querySelector(`[data-handle="${key}"] circle`)!.getAttribute('r'));
    expect(r('oe:start')).toBe(12);
    expect(r('we:a')).toBe(HANDLE_RADIUS_COARSE_PX);
  });
});
