// @vitest-environment jsdom
/**
 * Fix round after 2b, the family UI (local mode, the app singleton): the status pill while a conflict is open, the
 * notice for a version deleted by a device that had not seen it ([Hent tilbake]), the banner for a family link that is
 * not whole, and the offer to bring along this device's proposals from the previous family space.
 */
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDerived } from './testDerived';

vi.mock('../geometry/derive', () => ({ deriveVariant: () => makeDerived() }));

const { appStore, familyUiStore } = await import('../state/appStore');
const { StatusPill, FamilyBanners } = await import('./StatusPill');
const { pillState } = await import('./familyUi');
const { nb } = await import('../i18n/nb');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const start = appStore.getState().project;
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
function render(node: ReactNode) {
  act(() => root.render(node));
}

beforeEach(() => {
  localStorage.clear();
  appStore.getState().replaceProject(start, { readOnly: false, source: 'local' });
  familyUiStore.setState({ askName: false, notices: [], conflicts: [], overwritten: [], tooNew: [], carryOver: null, leftFamily: null, failed: false, saving: false });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const conflict = { id: 'p-1', name: 'Mitt forslag', kind: 'changed' as const, by: 'Pappa', at: new Date().toISOString() };

describe('status pill during a conflict', () => {
  it('says the edits are not saved until the user chooses, before any other state', () => {
    const base = { mode: 'shared' as const, phase: 'ready' as const, saving: false, pending: 0, online: true, failed: false };
    expect(pillState({ ...base, conflicts: [conflict] })).toBe('conflict');
    expect(pillState({ ...base, conflicts: [conflict], pending: 2, online: false })).toBe('conflict');
    expect(pillState({ ...base, mode: 'local', conflicts: [conflict] })).toBe('conflict');
    expect(pillState({ ...base, conflicts: [] })).toBe('synced');
    expect(nb.family.pill.conflict).toBe('Ikke lagret – velg Hent endringene eller Lagre over');
  });

  it('the pill shows it while a conflict is open', () => {
    render(<StatusPill />);
    expect(byTestId('status-pill')?.dataset.state).toBe('local');
    act(() => familyUiStore.setState({ conflicts: [conflict] }));
    expect(byTestId('status-pill')?.dataset.state).toBe('conflict');
    expect(byTestId('status-pill')?.getAttribute('aria-label')).toBe(nb.family.pill.conflict);
  });
});

describe('banners', () => {
  it('a version deleted by a device that had not seen it: says so and offers Hent tilbake', () => {
    familyUiStore.setState({ overwritten: [{ id: 'p-1', name: 'Mitt forslag', by: 'Mamma', at: new Date().toISOString(), kind: 'deleted' }] });
    render(<FamilyBanners />);
    expect(byTestId('overwritten-banner')?.textContent).toContain(
      '«Mitt forslag» ble slettet av Mamma på en enhet som ikke hadde sett de siste endringene dine. Din utgave ligger i Papirkurv.',
    );
    expect(byTestId('overwritten-restore')?.textContent).toBe(nb.family.trash.restore);
  });

  it('a family link that is not whole', () => {
    familyUiStore.setState({ notices: ['family-link-invalid'] });
    render(<FamilyBanners />);
    // Local mode in tests: no family on this device.
    expect(byTestId('family-link-invalid')?.textContent).toContain(nb.family.linkInvalid(false));
  });

  it('after a family switch: the offer to bring along the proposals made on this device; «Nei takk» closes it', () => {
    familyUiStore.setState({ carryOver: { from: 'e2e-old-family-abcdefghijklmn', names: ['Mammas idé', 'Hytte 2'] } });
    render(<FamilyBanners />);
    expect(byTestId('carry-over-banner')?.textContent).toContain(
      'Du laget 2 forslag i en annen delt plass på denne enheten før du åpnet denne familielenken: «Mammas idé», «Hytte 2».',
    );
    expect(byTestId('carry-over-accept')?.textContent).toBe('Hent forslagene fra den forrige plassen');
    act(() => byTestId('carry-over-decline')?.click());
    expect(familyUiStore.getState().carryOver).toBeNull();
    expect(byTestId('carry-over-banner')).toBeNull();
  });

  it('one proposal to bring along: singular wording', () => {
    familyUiStore.setState({ carryOver: { from: 'e2e-old-family-abcdefghijklmn', names: ['Mammas idé'] } });
    render(<FamilyBanners />);
    expect(byTestId('carry-over-banner')?.textContent).toContain('Du laget «Mammas idé» i en annen delt plass');
    expect(byTestId('carry-over-banner')?.textContent).toContain('Det legges til her, og i den forrige plassen havner det i Papirkurv.');
    expect(byTestId('carry-over-accept')?.textContent).toBe('Hent forslaget fra den forrige plassen');
    act(() => byTestId('carry-over-decline')?.click());
  });
});

describe('final fix round banners', () => {
  it('a link to a space this device left: «Bytt tilbake» / «Bli her»; «Bli her» closes it', () => {
    familyUiStore.setState({ leftFamily: 'e2e-old-family-abcdefghijklmn' });
    render(<FamilyBanners />);
    expect(byTestId('left-family-banner')?.textContent).toContain('Denne lenken går til en plass du har byttet bort fra.');
    expect(byTestId('left-family-back')?.textContent).toBe('Bytt tilbake');
    expect(byTestId('left-family-stay')?.textContent).toBe('Bli her');
    act(() => byTestId('left-family-stay')?.click());
    expect(familyUiStore.getState().leftFamily).toBeNull();
    expect(byTestId('left-family-banner')).toBeNull();
  });

  it('the conflict banner says which version goes under Tidligere versjoner', () => {
    familyUiStore.setState({ conflicts: [conflict] });
    render(<FamilyBanners />);
    const text = byTestId('conflict-banner')?.textContent ?? '';
    expect(text).toContain('«Hent endringene» legger utgaven din under Tidligere versjoner.');
    expect(text).toContain('«Lagre over» legger den andre utgaven der.');
    act(() => familyUiStore.setState({ conflicts: [{ ...conflict, kind: 'deleted' }] }));
    expect(byTestId('conflict-banner')?.textContent).toContain('«Lagre over» henter det tilbake med utgaven din.');
  });
});
