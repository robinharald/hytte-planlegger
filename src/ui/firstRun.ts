/**
 * Whether the first-run card is open (docs/phase2-plan.md §5): the first time the app is opened in this browser,
 * until "Skjønner" or until the user makes a proposal (then the card has done its job). Both remember it in
 * localStorage (`hytte-planlegger:first-run-seen`; without storage the card simply shows again next time). A tiny
 * store so the toasts can keep clear of the card while it is open.
 */
import { create } from 'zustand';
import { storage } from '../state/appStore';
import { readRaw, writeRaw } from '../state/persistence';

export const FIRST_RUN_KEY = 'hytte-planlegger:first-run-seen';

const firstRunStore = create<{ open: boolean }>()(() => ({ open: readRaw(storage, FIRST_RUN_KEY) === null }));

export function useFirstRunOpen(): boolean {
  return firstRunStore((s) => s.open);
}

/** Close the card for good ("Skjønner", or a proposal was made). */
export function dismissFirstRun(): void {
  if (!firstRunStore.getState().open) return;
  writeRaw(storage, FIRST_RUN_KEY, new Date().toISOString());
  firstRunStore.setState({ open: false });
}
