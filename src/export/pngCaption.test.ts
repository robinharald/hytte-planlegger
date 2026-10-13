/** The PNG caption names the walk: «Gå rundt» while walking and while the camera stays where a walk ended (Esc). */
import { afterEach, describe, expect, it } from 'vitest';
import { appStore } from '../state/appStore';
import { resetView3dLocal, startWalk } from '../view3d/walkState';
import { captionTexts } from './pngExport';
import { setWalkViewKept } from './walkView';

const date = new Date(2026, 9, 13, 12);

afterEach(() => {
  resetView3dLocal();
  setWalkViewKept(false);
});

describe('PNG caption', () => {
  it('names the camera angle when not walking', () => {
    expect(captionTexts(appStore.getState(), date).sub).toBe('3D · Ute · Oversikt · 13.10.2026');
  });

  it('says «Gå rundt» while walking (every storey whole: Ute), also with Inne chosen', () => {
    startWalk();
    expect(captionTexts(appStore.getState(), date).sub).toBe('3D · Ute · Gå rundt · 13.10.2026');
    const inne = { ...appStore.getState(), ui: { ...appStore.getState().ui, mode3d: 'inne' as const } };
    expect(captionTexts(inne, date).sub).toBe('3D · Ute · Gå rundt · 13.10.2026');
  });

  it('says «Gå rundt» while the camera stays where a walk ended with Esc', () => {
    setWalkViewKept(true);
    expect(captionTexts(appStore.getState(), date).sub).toBe('3D · Ute · Gå rundt · 13.10.2026');
  });
});
