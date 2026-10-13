/**
 * DOM controls of the walk mode over the 3D canvas (View3D): «Gå rundt» (top right) when not walking; while walking
 * «Avslutt» in the same place and, on touch screens, the joystick in the lower left corner (drag the knob: up =
 * forward; walk.ts `joystickVector`, written to walkState `walkInput`); under «Avslutt» the camera button that saves
 * the view as a PNG and walks on (WalkControlsPhoto.tsx, like the P key). Inline styles like the rest of View3D's
 * overlay; 44 px touch targets.
 */
import { useRef, useState } from 'react';
import { nb } from '../i18n/nb';
import type { CSSProperties, JSX, PointerEvent as ReactPointerEvent } from 'react';
import { joystickKnob, joystickVector } from './walk';
import { WalkPhotoButton } from './WalkControlsPhoto';
import { setJoystick, startWalk, stopWalk } from './walkState';

/** Joystick base radius (px). */
export const JOYSTICK_RADIUS = 56;
const KNOB = 52;

const BUTTON_STYLE: CSSProperties = {
  position: 'absolute',
  top: 10,
  right: 10,
  zIndex: 60,
  minHeight: 36,
  minWidth: 44,
  padding: '6px 12px',
  border: '1px solid rgba(29,36,30,.25)',
  borderRadius: 18,
  background: 'rgba(255,255,255,.9)',
  color: '#1d241e',
  font: '500 14px/1.2 Barlow, system-ui, sans-serif',
  cursor: 'pointer',
  boxShadow: '0 1px 3px rgba(0,0,0,.15)',
  touchAction: 'manipulation',
};

const { position: _position, top: _top, right: _right, zIndex: _zIndex, ...BUTTON_LOOK } = BUTTON_STYLE;
/** «Avslutt» (placed by WALK_BUTTONS_STYLE). */
const EXIT_STYLE: CSSProperties = { ...BUTTON_LOOK, background: '#4f6b55', color: '#fff', border: '1px solid #4f6b55', minHeight: 44, padding: '8px 16px' };

/** «Avslutt» with the camera button under it, top right: stacked, so the camera never overlaps a taller «Avslutt». */
const WALK_BUTTONS_STYLE: CSSProperties = {
  position: 'absolute',
  top: 10,
  right: 10,
  zIndex: 60,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 8,
};

const BASE_STYLE: CSSProperties = {
  position: 'absolute',
  left: 16,
  bottom: 44,
  width: JOYSTICK_RADIUS * 2,
  height: JOYSTICK_RADIUS * 2,
  boxSizing: 'border-box',
  borderRadius: '50%',
  background: 'rgba(255,255,255,.28)',
  border: '2px solid rgba(255,255,255,.75)',
  boxShadow: '0 1px 4px rgba(0,0,0,.25)',
  zIndex: 60,
  touchAction: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
};

export function WalkOverlay(props: { walking: boolean; coarse: boolean }): JSX.Element {
  if (!props.walking) {
    return (
      <button type="button" style={BUTTON_STYLE} title={nb.walk.startTitle} data-testid="walk-start-3d" onClick={() => startWalk()}>
        {nb.walk.start}
      </button>
    );
  }
  return (
    <>
      <div style={WALK_BUTTONS_STYLE}>
        <button type="button" style={EXIT_STYLE} title={nb.walk.exitTitle} data-testid="walk-exit" onClick={() => stopWalk()}>
          {nb.walk.exit}
        </button>
        <WalkPhotoButton />
      </div>
      {props.coarse && <Joystick />}
    </>
  );
}

function Joystick(): JSX.Element {
  const base = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);
  const [knob, setKnob] = useState<[number, number]>([0, 0]);

  const update = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = base.current?.getBoundingClientRect();
    if (!r) return;
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const v = joystickVector(dx, dy, JOYSTICK_RADIUS);
    setKnob(joystickKnob(dx, dy, JOYSTICK_RADIUS));
    setJoystick(v.strafe, v.forward);
  };
  const release = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (active.current !== e.pointerId) return;
    active.current = null;
    setKnob([0, 0]);
    setJoystick(0, 0);
  };
  return (
    <div
      ref={base}
      style={BASE_STYLE}
      role="application"
      aria-label={nb.walk.joystick}
      data-testid="walk-joystick"
      onPointerDown={(e) => {
        if (active.current !== null) return;
        active.current = e.pointerId;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // no capture (old browsers): moves outside the base are lost
        }
        e.preventDefault();
        update(e);
      }}
      onPointerMove={(e) => {
        if (active.current === e.pointerId) update(e);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <div
        style={{
          position: 'absolute',
          // inside the 2 px border (border-box): the centre is JOYSTICK_RADIUS − 2 from the padding edge
          left: JOYSTICK_RADIUS - 2 - KNOB / 2 + knob[0],
          top: JOYSTICK_RADIUS - 2 - KNOB / 2 + knob[1],
          width: KNOB,
          height: KNOB,
          borderRadius: '50%',
          background: 'rgba(255,255,255,.92)',
          boxShadow: '0 1px 4px rgba(0,0,0,.3)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
