#!/usr/bin/env node
/**
 * freeze-seed-schema1.mjs — writes src/model/seed/frozen/forslagD.schema1.json: the bundled Forslag D project as
 * it was at schema version 1 / SEED_REVISION 3 (the last phase-1 seed), so share links made by phase 1 (deltas
 * against that seed) can still be decoded after the seed moved to schema 2 (docs/phase2-plan.md §2).
 *
 * One-off: it loads src/model/seed/forslagD.ts through Vite's SSR loader and REFUSES to write unless the seed is
 * still at schema 1 / revision 3, so it can never overwrite the frozen file with a newer seed. The committed JSON
 * is the source of truth from now on; do not edit it by hand.
 *
 * Run from the repository root: `node scripts/freeze-seed-schema1.mjs`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = resolve(ROOT, 'src/model/seed/frozen/forslagD.schema1.json');

/** Pretty JSON with arrays of plain numbers (points, sizes) kept on one line. */
function format(value) {
  return JSON.stringify(value, null, 2).replace(/\[\s+(-?[\d.eE+-]+(?:,\s+-?[\d.eE+-]+)*)\s+\]/g, (_, body) => `[${body.split(/,\s+/).join(', ')}]`);
}

const server = await createServer({ root: ROOT, configFile: false, logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' });
try {
  const seed = await server.ssrLoadModule('/src/model/seed/forslagD.ts');
  const project = seed.createForslagD();
  if (project.schemaVersion !== 1 || seed.SEED_REVISION !== 3) {
    throw new Error(`refusing to freeze: the seed is at schema ${project.schemaVersion}, revision ${seed.SEED_REVISION} (expected 1 / 3)`);
  }
  const text = format(project);
  if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(project)) throw new Error('formatting changed the content');
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, `${text}\n`);
  console.log(`wrote ${OUT_FILE}`);
} finally {
  await server.close();
}
