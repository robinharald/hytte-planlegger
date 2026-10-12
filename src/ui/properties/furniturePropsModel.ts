/** Pure helpers of the Møbel editor (FurnitureProps.tsx), kept out of the component file so fast refresh works. */
import type { FurnitureCatalogItem } from '../../furniture/catalog';
import { sizeTextCm } from '../furnitureLibraryModel';

/** Sizes within this (m) of a preset count as that preset. */
export const SAME_SIZE_M = 0.0005;

/** Label of a preset in the choice: its catalogue label, with the size in cm when the label has no number. */
export function presetLabel(p: { label: string; w: number; d: number }): string {
  return /\d/.test(p.label) ? p.label : `${p.label} (${sizeTextCm(p.w, p.d)})`;
}

/** The preset the stored size matches (the stored key first), or null (a stretched / custom size). */
export function matchingPreset(entry: FurnitureCatalogItem, size: { w: number; d: number }, key?: string): string | null {
  const same = (p: { w: number; d: number }) => Math.abs(p.w - size.w) <= SAME_SIZE_M && Math.abs(p.d - size.d) <= SAME_SIZE_M;
  const byKey = entry.sizes.find((p) => p.key === key);
  if (byKey && same(byKey)) return byKey.key;
  return entry.sizes.find(same)?.key ?? null;
}
