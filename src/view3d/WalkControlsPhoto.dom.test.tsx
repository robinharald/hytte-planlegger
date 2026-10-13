// @vitest-environment jsdom
/** The walk overlay's camera button (WalkControlsPhoto.tsx): saves the 3D view as a PNG, the walk goes on. */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { nb } from '../i18n/nb';
import { WalkPhotoButton } from './WalkControlsPhoto';
import { resetView3dLocal, startWalk, view3dLocal } from './walkState';

const savePng3d = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../export/pngExport', () => ({ savePng3d }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('WalkPhotoButton', () => {
  it('has a label and a tooltip, loads the PNG code when shown and saves on a tap without ending the walk', async () => {
    resetView3dLocal();
    startWalk();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<WalkPhotoButton />));
    const button = container.querySelector<HTMLButtonElement>('[data-testid="walk-photo"]')!;
    expect(button.getAttribute('aria-label')).toBe(nb.walk.photo);
    expect(button.title).toBe(nb.walk.photoTitle);
    // the PNG module arrives; a tap then calls it at once (the share sheet needs the tap)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    act(() => button.click());
    expect(savePng3d).toHaveBeenCalledTimes(1);
    expect(view3dLocal.getState().walk).not.toBeNull();
    await act(async () => root.unmount());
    container.remove();
    resetView3dLocal();
  });
});
