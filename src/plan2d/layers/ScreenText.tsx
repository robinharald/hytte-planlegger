/**
 * Counter-flipped group for text inside the flipped plan root: children are laid out in screen pixels
 * (y down, constant size at any zoom) around the plan point (x, y). `rotate` is a screen rotation in degrees.
 */
import type { ReactNode } from 'react';

export function ScreenText({ x, y, scale, rotate, children, ...rest }: { x: number; y: number; scale: number; rotate?: number; children: ReactNode } & Record<`data-${string}`, string | undefined>) {
  const inv = 1 / scale;
  const t = `translate(${x} ${y}) scale(${inv} ${-inv})${rotate ? ` rotate(${rotate})` : ''}`;
  return (
    <g transform={t} pointerEvents="none" {...rest}>
      {children}
    </g>
  );
}
