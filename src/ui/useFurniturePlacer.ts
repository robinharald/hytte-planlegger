/**
 * `useFurniturePlacer()`: furniturePlacer.ts `placeFurniture` bound to the app — the active proposal's derived model,
 * the plan's storey and the selection from the app store, the editor core's `addFurniture`, and the shown plan's
 * centre and zoom (plan2d/furnitureDrop.ts `requestPlanCentre`), and the app's toast (where an item landed when it is
 * not the room that was picked or in the middle).
 *
 * The library calls it for a tap; the plan's and the 3D view's `onDropFurniture` should call it for drops:
 * `place(catalogId, { kind: 'drop', at })` (the 3D view adding `levelId: hit.levelId`).
 */
import { useCallback } from 'react';
import { requestPlanCentre } from '../plan2d/furnitureDrop';
import { appStore } from '../state/appStore';
import { useEditActions } from '../state/editActions';
import { deriveForState } from '../state/useDerived';
import { usesTouch } from './device';
import { dropReach, placeFurniture } from './furniturePlacer';
import type { PlaceHow, Placed, PlacerEnv } from './furniturePlacer';

/** The app's env: the active proposal's derived model, the plan's storey and selection, the bound edit actions. */
function appEnv(addFurniture: PlacerEnv['addFurniture']): PlacerEnv {
  const s = appStore.getState();
  return {
    derived: deriveForState(s),
    storeyId: s.ui.planStorey,
    selection: s.ui.selection,
    addFurniture,
    select: (sel) => appStore.getState().select(sel),
    // A tap that lands in another room than the picked / middle one says where (last fix round).
    toast: (text) => void appStore.getState().showToast({ text }),
    planCentre: (catalogId) => {
      const c = requestPlanCentre(document, catalogId);
      return c?.centre ? { centre: c.centre, storeyId: c.storeyId } : null;
    },
  };
}

/** `place(catalogId, how)` bound to the app (a stable function). */
export function useFurniturePlacer(): (catalogId: string, how: PlaceHow) => Placed | null {
  const actions = useEditActions();
  return useCallback(
    (catalogId: string, how: PlaceHow) => {
      const env = appEnv((id, p, opts) => actions.addFurniture(id, p, opts));
      const withReach: PlaceHow = how.kind === 'drop' && how.reach === undefined ? { ...how, reach: dropReach(requestPlanCentre()?.scale, usesTouch()) } : how;
      return placeFurniture(env, catalogId, withReach);
    },
    [actions],
  );
}
