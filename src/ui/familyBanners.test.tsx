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
  familyUiStore.setState({
    askName: false,
    notices: [],
    conflicts: [],
    overwritten: [],
    tooNew: [],
    carryOver: null,
    otherFamily: null,
    emptyFamily: false,
    elsewhere: false,
    failed: false,
    saving: false,
  });
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
  const other = 'e2e-old-family-abcdefghijklmn';
  const info = { count: 3, names: ['Pappa', 'Mamma'], others: true, hereCount: 1, hereOthers: false, proposalName: null };

  it('a link to another space: says what each holds; the space with proposals made by others is highlighted', () => {
    familyUiStore.setState({ otherFamily: { id: other, proposal: null, info: null } });
    render(<FamilyBanners />);
    const banner = () => byTestId('other-family-banner');
    expect(banner()?.textContent).toContain('Denne lenken går til en annen delt plass.');
    expect(banner()?.dataset.primary).toBe('stay');
    expect(byTestId('other-family-switch')?.textContent).toBe('Bytt dit');
    expect(byTestId('other-family-stay')?.textContent).toBe('Bli her');
    // The link's space answered: proposals made by others there, only this device's own here → «Bytt dit».
    act(() => familyUiStore.setState({ otherFamily: { id: other, proposal: null, info } }));
    expect(banner()?.textContent).toContain('Plassen i lenken har 3 forslag (Pappa, Mamma); plassen du bruker nå har 1.');
    expect(banner()?.dataset.primary).toBe('switch');
    expect(byTestId('other-family-switch')?.className).toContain('btn-primary');
    // Proposals by others here as well (or none there): «Bli her».
    act(() => familyUiStore.setState({ otherFamily: { id: other, proposal: null, info: { ...info, hereOthers: true } } }));
    expect(banner()?.dataset.primary).toBe('stay');
    act(() => familyUiStore.setState({ otherFamily: { id: other, proposal: null, info: { ...info, count: 0, names: [], others: false, hereCount: 0 } } }));
    expect(banner()?.textContent).toContain('Plassen i lenken har ingen forslag (er lenken hel?); plassen du bruker nå har ingen.');
    expect(banner()?.dataset.primary).toBe('stay');
    expect(byTestId('other-family-stay')?.className).toContain('btn-primary');
    act(() => byTestId('other-family-stay')?.click());
    expect(familyUiStore.getState().otherFamily).toBeNull();
    expect(banner()).toBeNull();
  });

  it('a link to one proposal in another space: a copy is offered, never a switch', () => {
    familyUiStore.setState({ otherFamily: { id: other, proposal: 'p-x', info: { ...info, proposalName: 'Mammas idé' } } });
    render(<FamilyBanners />);
    expect(byTestId('other-family-banner')?.textContent).toContain('Denne lenken går til «Mammas idé» i en annen delt plass.');
    expect(byTestId('other-family-copy')?.textContent).toBe('Hent «Mammas idé» som en kopi hit');
    expect(byTestId('other-family-switch')).toBeNull();
    // Not there: only «Bli her».
    act(() => familyUiStore.setState({ otherFamily: { id: other, proposal: 'p-x', info } }));
    expect(byTestId('other-family-banner')?.textContent).toContain('Forslaget i lenken finnes ikke i den plassen.');
    expect(byTestId('other-family-copy')).toBeNull();
  });

  it('an empty space on a device without a family: asked; another tab switched: reload; «Lagre over» by another device', () => {
    familyUiStore.setState({ emptyFamily: true });
    render(<FamilyBanners />);
    expect(byTestId('empty-family-banner')?.textContent).toContain('Denne plassen er tom. Er lenken hel?');
    expect(byTestId('empty-family-start')?.textContent).toBe('Begynn her');
    act(() => familyUiStore.setState({ emptyFamily: false, elsewhere: true }));
    expect(byTestId('family-elsewhere-banner')?.textContent).toContain('Denne enheten har byttet delt plass i en annen fane.');
    expect(byTestId('family-elsewhere-reload')?.textContent).toBe('Last på nytt');
    expect(pillState({ mode: 'shared', phase: 'ready', saving: false, pending: 0, online: true, failed: false, elsewhere: true })).toBe('elsewhere');
    act(() =>
      familyUiStore.setState({ elsewhere: false, overwritten: [{ id: 'p-1', name: 'Felles', by: 'Test B', at: new Date().toISOString(), kind: 'savedOver' }] }),
    );
    expect(byTestId('overwritten-banner')?.textContent).toContain('«Felles» ble lagret over av Test B. Din utgave ligger under Tidligere versjoner.');
    expect(byTestId('overwritten-banner')?.dataset.kind).toBe('savedOver');
  });

  it('Tidligere versjoner: seconds when two share a minute; tagged «din» and «lagt bort ved Lagre over»', async () => {
    const { revisionLabels } = await import('./familyUi');
    const at = (h: number, m: number, sec: number) => new Date(2026, 9, 12, h, m, sec).toISOString();
    const now = new Date(2026, 9, 12, 23, 0, 0).getTime();
    const base = { proposalId: 'p-1', name: 'Felles', savedBy: 'Test A' };
    const labels = revisionLabels(
      [
        { ...base, id: 'r3', savedAt: at(22, 50, 41), reason: 'saveOver', own: true },
        { ...base, id: 'r2', savedAt: at(22, 50, 7), own: true },
        { ...base, id: 'r1', savedAt: at(21, 10, 0), savedBy: null },
      ],
      now,
    );
    expect(labels).toEqual(['i dag 22.50.41 · Test A · din · lagt bort ved Lagre over', 'i dag 22.50.07 · Test A · din', 'i dag 21.10']);
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
