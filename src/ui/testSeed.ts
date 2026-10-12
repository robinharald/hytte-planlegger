/**
 * The real Forslag D seed through the real derive pipeline, for UI tests that need true geometry (room size targets,
 * "Avstand fra hjørne", the Egenskaper editors). Not used by the app.
 */
import { deriveVariant } from '../geometry/derive';
import type { DerivedVariant } from '../model/derived';
import { createForslagD } from '../model/seed/forslagD';
import type { Project, Variant } from '../model/types';
import { terrainFor } from '../state/useDerived';

export interface SeedFixture {
  project: Project;
  /** The bundled (locked) base proposal. */
  locked: Variant;
  /** An unlocked copy (what "Nytt forslag" gives). */
  variant: Variant;
  derived: DerivedVariant;
  derivedLocked: DerivedVariant;
  /** Derive another variant on the same site. */
  derive: (v: Variant) => DerivedVariant;
}

let cache: SeedFixture | null = null;

export function seedFixture(): SeedFixture {
  if (cache) return cache;
  const project = createForslagD('2026-10-12T08:00:00.000Z');
  const locked = project.variants[0];
  const variant: Variant = { ...structuredClone(locked), id: 'mitt-forslag', name: 'Mitt forslag' };
  delete variant.locked;
  const derive = (v: Variant) => deriveVariant(v, project.site, terrainFor(project.site));
  cache = { project, locked, variant, derived: derive(variant), derivedLocked: derive(locked), derive };
  return cache;
}
