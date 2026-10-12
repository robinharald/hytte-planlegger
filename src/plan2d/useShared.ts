/**
 * `useShared(next)`: `next` with every part that is deep-equal to the value this hook returned last replaced by that
 * previous instance (stable.ts `shareEqual`), so memoised children see unchanged props when a new derived model
 * changes only a little (a drag frame). Kept in state and adjusted during render (React's pattern for a value derived
 * from the previous render), so nothing reads a ref while rendering; the component re-runs once, its children do not.
 */
import { useState } from 'react';
import { shareEqual } from './stable';

export function useShared<T>(next: T): T {
  const [state, setState] = useState(() => ({ source: next, value: next }));
  if (Object.is(state.source, next)) return state.value;
  const value = shareEqual(state.value, next);
  setState({ source: next, value });
  return value;
}
