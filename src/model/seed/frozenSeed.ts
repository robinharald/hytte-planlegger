/**
 * The phase-1 Forslag D (schema 1, SEED_REVISION 3), frozen as JSON in frozen/forslagD.schema1.json by
 * scripts/freeze-seed-schema1.mjs before the seed moved to schema 2. Share links made by phase 1 are deltas against
 * exactly this document, so `decodeDeltaPayload` (state/persistence.ts) rebuilds them on it and then migrates the
 * result (docs/phase2-plan.md §2). Never edit the JSON.
 *
 * The documents returned here are raw schema-1 JSON (not `Project` / `Variant`): run them through `migrateProject`.
 * Every call returns a fresh deep copy with the given timestamps.
 */
import frozen from './frozen/forslagD.schema1.json';

type Doc = Record<string, unknown>;

const FROZEN = frozen as unknown as Doc;

/** Schema version of the frozen document (1). */
export const FROZEN_SCHEMA_VERSION: number = FROZEN.schemaVersion as number;
/** Seed revision of the frozen document (3). */
export const FROZEN_SEED_REVISION: number = FROZEN.seedRevision as number;

/** The frozen schema-1 project (raw JSON), timestamps set to `now`. */
export function frozenSchema1Project(now?: string): Doc {
  const doc = structuredClone(FROZEN);
  if (now !== undefined) {
    doc.createdAt = now;
    doc.updatedAt = now;
    doc.variants = (doc.variants as Doc[]).map((v) => ({ ...v, createdAt: now }));
  }
  return doc;
}

/** The frozen schema-1 Forslag D variant (raw JSON), `createdAt` set to `now`. */
export function frozenSchema1Variant(now?: string): Doc {
  return (frozenSchema1Project(now).variants as Doc[])[0];
}
