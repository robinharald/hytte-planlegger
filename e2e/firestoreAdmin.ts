/**
 * The real family space from the test runner (Node), for the opt-in Firestore specs (`E2E_FIRESTORE=1`,
 * e2e/*firestore*.spec.ts and e2e/family-offline.spec.ts): an anonymous sign-in over the REST API (like a new device),
 * reading a family's proposal documents, and deleting a throwaway `e2e-` family afterwards (proposals and their
 * revisions). The rules allow exactly this to any signed-in user for family ids of 24–64 characters
 * (firestore.rules); nothing else is touched. The Firebase config is the app's own (src/state/firebaseConfig.ts).
 */
import { randomBytes } from 'node:crypto';
import { firebaseConfig } from '../src/state/firebaseConfig';

/** The specs run only when asked to: they write to Robin's real Firebase project (and delete what they wrote). */
export const FIRESTORE_ENABLED = process.env.E2E_FIRESTORE === '1';
export const FIRESTORE_SKIP_REASON = 'needs the real Firestore: run with E2E_FIRESTORE=1';

if (FIRESTORE_ENABLED && !firebaseConfig) throw new Error('E2E_FIRESTORE=1 but src/state/firebaseConfig.ts is null');
const config = firebaseConfig ?? { apiKey: '', projectId: '' };
const DOCS = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents`;
/** In case the API key is restricted to the site and localhost (docs/firebase-oppsett.md). */
const REFERER = 'http://localhost:5173/';

/** A throwaway family id: `e2e-<tag>-<random>`, 32 characters or more. */
export function e2eFamilyId(tag: string): string {
  return `e2e-${tag}-${randomBytes(12).toString('base64url')}`.slice(0, 64);
}

let token: Promise<string> | null = null;

/** An anonymous sign-in of the test runner (one per run). */
function idToken(): Promise<string> {
  token ??= (async () => {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${config.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: REFERER },
      body: JSON.stringify({ returnSecureToken: true }),
    });
    if (!r.ok) throw new Error(`anonymous sign-in failed: ${r.status} ${await r.text()}`);
    return ((await r.json()) as { idToken: string }).idToken;
  })();
  return token;
}

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const t = await idToken();
  return fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}`, Referer: REFERER } });
}

type RestValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
  timestampValue?: string;
  arrayValue?: { values?: RestValue[] };
  mapValue?: { fields?: Record<string, RestValue> };
};

function plain(v: RestValue): unknown {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue?.values ?? []).map(plain);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue?.fields ?? {}).map(([k, x]) => [k, plain(x)]));
  return undefined;
}

export interface RestDoc {
  /** Full resource name (projects/…/documents/families/…). */
  name: string;
  id: string;
  data: Record<string, unknown>;
}

/** The documents of a collection (`families/<id>/proposals`, `…/revisions`). */
export async function listDocs(collectionPath: string): Promise<RestDoc[]> {
  const out: RestDoc[] = [];
  let pageToken = '';
  do {
    const r = await call(`${DOCS}/${collectionPath}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`);
    if (!r.ok) throw new Error(`list ${collectionPath}: ${r.status} ${await r.text()}`);
    const j = (await r.json()) as { documents?: { name: string; fields?: Record<string, RestValue> }[]; nextPageToken?: string };
    for (const d of j.documents ?? []) {
      out.push({ name: d.name, id: d.name.split('/').pop() ?? '', data: Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, plain(v)])) });
    }
    pageToken = j.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

/** The family's proposal documents (the Papirkurv's too). */
export function proposalDocs(familyId: string): Promise<RestDoc[]> {
  return listDocs(`families/${familyId}/proposals`);
}

/** The hot tub's centre in a proposal document's project (its only variant). */
export function tubOf(doc: RestDoc | undefined): [number, number] | null {
  if (!doc || typeof doc.data.project !== 'string') return null;
  const p = JSON.parse(doc.data.project) as { variants: { outdoor: { hotTubs: { centre: [number, number] }[] } }[] };
  return p.variants[0]?.outdoor.hotTubs[0]?.centre ?? null;
}

/** Delete a throwaway family (its proposals and their revisions); returns how many proposal documents are left (0). */
export async function purgeFamily(familyId: string): Promise<number> {
  if (!familyId.startsWith('e2e-')) throw new Error(`refusing to delete ${familyId}: not an e2e- family`);
  for (const p of await proposalDocs(familyId)) {
    for (const r of await listDocs(`families/${familyId}/proposals/${p.id}/revisions`)) {
      const d = await call(`https://firestore.googleapis.com/v1/${r.name}`, { method: 'DELETE' });
      if (!d.ok) throw new Error(`delete ${r.name}: ${d.status}`);
    }
    const d = await call(`https://firestore.googleapis.com/v1/${p.name}`, { method: 'DELETE' });
    if (!d.ok) throw new Error(`delete ${p.name}: ${d.status}`);
  }
  return (await proposalDocs(familyId)).length;
}
