/**
 * The walk overlay's camera button (stacked under «Avslutt» in WalkOverlay.tsx): saves the 3D view as a PNG without
 * ending the walk, like the P key (WalkControls.tsx); both go through export/walkView.ts `saveWalkPhoto` to
 * pngExport.ts `savePng3d`, the menu's «Lagre 3D-bildet som PNG», whose caption then names the view «Gå rundt».
 * The button loads the PNG code when it appears, so a tap reaches `savePng3d` synchronously.
 */
import { useEffect } from 'react';
import type { CSSProperties, JSX } from 'react';
import { nb } from '../i18n/nb';
import { loadWalkPhoto, saveWalkPhoto } from '../export/walkView';

const STYLE: CSSProperties = {
  width: 44,
  height: 44,
  padding: 0,
  display: 'grid',
  placeItems: 'center',
  border: '1px solid rgba(29,36,30,.25)',
  borderRadius: 22,
  background: 'rgba(255,255,255,.9)',
  color: '#1d241e',
  cursor: 'pointer',
  boxShadow: '0 1px 3px rgba(0,0,0,.15)',
  touchAction: 'manipulation',
};

/** The camera button of the walk overlay (top right, under «Avslutt»; WalkOverlay places it). */
export function WalkPhotoButton(): JSX.Element {
  useEffect(() => {
    void loadWalkPhoto().catch(() => undefined);
  }, []);
  return (
    <button type="button" style={STYLE} title={nb.walk.photoTitle} aria-label={nb.walk.photo} data-testid="walk-photo" onClick={() => saveWalkPhoto()}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
        <circle cx="12" cy="13" r="3.5" />
      </svg>
    </button>
  );
}
