// @vitest-environment jsdom
/**
 * Fix round after 2b, the family UI (local mode, the app singleton): the status pill while a conflict is open, the
 * notice for a version deleted by a device that had not seen it ([Hent tilbake]), the banner for a family link that is
 * not whole, and the offer to bring along this device's proposals from the previous family space. Fourth fix round:
 * «Bytt dit» on a proposal link, the offer without a highlighted button when the space left is the family's, the
 * neutral pill of a space not started, and «Hva heter du?» as a banner.
 */
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDerived } from './testDerived';

vi.mock('../geometry/derive', () => ({ deriveVariant: () => makeDerived() }));

const { appStore, familyUiStore } = await import('../state/appStore');
const { StatusPill, FamilyBanners, NameDialog } = await import('./StatusPill');
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
    nameForProposal: null,
    nameBanner: false,
    unconfirmed: false,
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
    familyUiStore.setState({ carryOver: { from: 'e2e-old-family-abcdefghijklmn', names: ['Mammas idé', 'Hytte 2'], othersThere: false } });
    render(<FamilyBanners />);
    expect(byTestId('carry-over-banner')?.textContent).toContain(
      'Du laget 2 forslag på denne enheten i plassen du byttet fra: «Mammas idé», «Hytte 2».',
    );
    expect(byTestId('carry-over-accept')?.textContent).toBe('Hent forslagene fra den forrige plassen');
    expect(byTestId('carry-over-accept')?.className).toContain('btn-primary');
    expect(byTestId('carry-over-banner')?.textContent).not.toContain('forslag fra andre');
    act(() => byTestId('carry-over-decline')?.click());
    expect(familyUiStore.getState().carryOver).toBeNull();
    expect(byTestId('carry-over-banner')).toBeNull();
  });

  it('one proposal to bring along: singular wording', () => {
    familyUiStore.setState({ carryOver: { from: 'e2e-old-family-abcdefghijklmn', names: ['Mammas idé'], othersThere: false } });
    render(<FamilyBanners />);
    expect(byTestId('carry-over-banner')?.textContent).toContain('Du laget «Mammas idé» på denne enheten i plassen du byttet fra.');
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

  it('a link to one proposal in another space: a copy and «Bytt dit», highlighted like the space banner', () => {
    familyUiStore.setState({ otherFamily: { id: other, proposal: 'p-x', info: { ...info, proposalName: 'Mammas idé' } } });
    render(<FamilyBanners />);
    const banner = () => byTestId('other-family-banner');
    expect(banner()?.textContent).toContain('Denne lenken går til «Mammas idé» i en annen delt plass.');
    expect(banner()?.textContent).toContain('Plassen i lenken har 3 forslag (Pappa, Mamma); plassen du bruker nå har 1.');
    expect(banner()?.textContent).toContain('Du kan hente det som en kopi hit (plassen du bruker nå, byttes ikke) eller bytte dit.');
    expect(byTestId('other-family-copy')?.textContent).toBe('Hent «Mammas idé» som en kopi hit');
    // Proposals by others there, none here (a device stuck in a space of its own): «Bytt dit» is highlighted.
    expect(banner()?.dataset.primary).toBe('switch');
    expect(byTestId('other-family-switch')?.textContent).toBe('Bytt dit');
    expect(byTestId('other-family-switch')?.className).toContain('btn-primary');
    expect(byTestId('other-family-copy')?.className).not.toContain('btn-primary');
    // Proposals by others here too: the copy is highlighted, «Bytt dit» stays available.
    act(() => familyUiStore.setState({ otherFamily: { id: other, proposal: 'p-x', info: { ...info, hereOthers: true, proposalName: 'Mammas idé' } } }));
    expect(banner()?.dataset.primary).toBe('copy');
    expect(byTestId('other-family-copy')?.className).toContain('btn-primary');
    expect(byTestId('other-family-switch')?.className).not.toContain('btn-primary');
    // Not there: no copy; «Bli her» highlighted unless the space there is the family's.
    act(() => familyUiStore.setState({ otherFamily: { id: other, proposal: 'p-x', info: { ...info, hereOthers: true } } }));
    expect(banner()?.textContent).toContain('Forslaget i lenken finnes ikke i den plassen.');
    expect(byTestId('other-family-copy')).toBeNull();
    expect(banner()?.dataset.primary).toBe('stay');
    expect(byTestId('other-family-stay')?.className).toContain('btn-primary');
  });

  it('the offer after «Bytt dit» away from the family’s space: no highlighted button, and it says the family loses them', () => {
    familyUiStore.setState({ carryOver: { from: 'e2e-old-family-abcdefghijklmn', names: ['Pappas plan'], othersThere: true } });
    render(<FamilyBanners />);
    const text = byTestId('carry-over-banner')?.textContent ?? '';
    expect(text).toContain('Det legges til her, og i den forrige plassen havner det i Papirkurv.');
    expect(text).toContain('Den plassen har også forslag fra andre. Henter du det hit, ser ikke familien det der lenger.');
    expect(byTestId('carry-over-banner')?.dataset.othersThere).toBe('true');
    expect(byTestId('carry-over-accept')?.className).not.toContain('btn-primary');
    expect(byTestId('carry-over-decline')?.className).not.toContain('btn-primary');
  });

  it('the pill of a link’s space that is not started is neutral, never «Lagret»', () => {
    const base = { mode: 'shared' as const, phase: 'ready' as const, saving: false, pending: 0, online: true, failed: false };
    expect(pillState({ ...base, unconfirmed: true })).toBe('notStarted');
    expect(pillState({ ...base, phase: 'connecting', unconfirmed: true })).toBe('connecting');
    expect(pillState({ ...base, unconfirmed: false })).toBe('synced');
    act(() => familyUiStore.setState({ ...base, unconfirmed: true }));
    render(<StatusPill />);
    expect(byTestId('status-pill')?.dataset.state).toBe('notStarted');
    expect(byTestId('status-pill')?.getAttribute('aria-label')).toBe('Ikke startet – plassen i lenken er tom');
    expect(byTestId('status-pill')?.textContent).toContain('Ikke startet');
    act(() => familyUiStore.setState({ mode: 'local', phase: 'ready' }));
  });

  it('«Hva heter du?» after the first save without a name: a banner; «Skriv navnet» opens the prompt, «Hopp over» declines', () => {
    familyUiStore.setState({ nameBanner: true });
    render(<FamilyBanners />);
    expect(byTestId('name-banner')?.textContent).toContain('Hva heter du?');
    expect(byTestId('name-banner')?.textContent).toContain('Navnet vises ved forslagene du endrer');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    act(() => byTestId('name-banner-write')?.click());
    expect(familyUiStore.getState()).toMatchObject({ askName: true, nameBanner: false });
    expect(byTestId('name-banner')).toBeNull();
    act(() => familyUiStore.setState({ askName: false, nameBanner: true }));
    act(() => byTestId('name-banner-skip')?.click());
    expect(localStorage.getItem('hytte-planlegger:my-name')).toBe('');
    expect(familyUiStore.getState().nameBanner).toBe(false);
    // Read-only (a link view, a tab stopped by another tab): no banner.
    act(() => {
      familyUiStore.setState({ nameBanner: true });
      appStore.getState().setUi({ readOnly: true });
    });
    expect(byTestId('name-banner')).toBeNull();
    act(() => appStore.getState().setUi({ readOnly: false }));
  });

  it('«+ Nytt forslag» while the name is unknown: one dialog asks for both; «Lag forslaget» makes it with the name', () => {
    familyUiStore.setState({ askName: true, nameForProposal: { from: null } });
    render(<NameDialog />);
    expect(byTestId('new-proposal-dialog')?.textContent).toContain('Nytt forslag');
    const proposal = byTestId('new-proposal-name') as HTMLInputElement;
    const person = byTestId('new-proposal-person') as HTMLInputElement;
    expect(proposal.value).toBe('Mitt forslag');
    expect(document.activeElement).toBe(proposal);
    const type = (input: HTMLInputElement, value: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    type(proposal, 'Hyttedrøm');
    type(person, 'Mamma');
    act(() => byTestId('new-proposal-create')?.click());
    expect(localStorage.getItem('hytte-planlegger:my-name')).toBe('Mamma');
    expect(familyUiStore.getState()).toMatchObject({ askName: false, nameForProposal: null });
    const active = appStore.getState().project.variants.find((v) => v.id === appStore.getState().project.activeVariantId);
    expect(active?.name).toBe('Hyttedrøm');
    expect(byTestId('new-proposal-dialog')).toBeNull();
  });

  it('promptNewProposal: the browser prompt when the name is known or not needed, else the two-field prompt', async () => {
    // Fresh modules: the singleton above keeps the names given in the other tests in memory.
    vi.resetModules();
    const app = await import('../state/appStore');
    const { promptNewProposal } = await import('./Dialogs');
    const pill = await import('./StatusPill');
    const { SEED_VARIANT_ID } = await import('../model/seed/forslagD');
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('Fra prompten');
    const activeName = () => app.appStore.getState().project.variants.find((v) => v.id === app.appStore.getState().project.activeVariantId)?.name;
    // Local mode: no name is needed.
    promptNewProposal();
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(activeName()).toBe('Fra prompten');
    // The shared space, no name yet: one dialog for both (the copy of Forslag D is made from there).
    act(() => app.familyUiStore.setState({ mode: 'shared' }));
    promptNewProposal(SEED_VARIANT_ID);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(app.familyUiStore.getState()).toMatchObject({ askName: true, nameForProposal: { from: SEED_VARIANT_ID } });
    render(<pill.NameDialog />);
    expect(byTestId('new-proposal-dialog')).not.toBeNull();
    // «Avbryt» makes nothing.
    const count = app.appStore.getState().project.variants.length;
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="new-proposal-dialog"] button')].find((b) => b.textContent === 'Avbryt')?.click());
    expect(app.familyUiStore.getState()).toMatchObject({ askName: false, nameForProposal: null });
    expect(app.appStore.getState().project.variants.length).toBe(count);
    // With a name: the browser prompt, as before.
    localStorage.setItem('hytte-planlegger:my-name', 'Mamma');
    promptNewProposal();
    expect(prompt).toHaveBeenCalledTimes(2);
    prompt.mockRestore();
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
