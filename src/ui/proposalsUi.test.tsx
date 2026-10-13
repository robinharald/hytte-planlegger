// @vitest-environment jsdom
/**
 * The family UI of phase 2b (local mode, the app singleton): status pill, proposals menu, the two-step delete, Mer →
 * Papirkurv / Tidligere versjoner, conflict and other banners, "Hva heter du?", Send forslaget (local and shared),
 * the update toast (with the Vitest stand-in for the PWA register module), the home-screen card and the first-run
 * card's mode-specific text.
 */
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDerived } from './testDerived';

vi.mock('../geometry/derive', () => ({ deriveVariant: () => makeDerived() }));

const { appStore, familyUiStore, startPersistence, flushProposals } = await import('../state/appStore');
const { TopBar } = await import('./TopBar');
const { ProposalsMenu } = await import('./ProposalsMenu');
const { StatusPill, FamilyBanners, NameDialog } = await import('./StatusPill');
const { ShareDialog } = await import('./ShareDialog');
const { TrashPanel } = await import('./TrashPanel');
const { daysLeft, installCardKind, isIos, menuOrder, metaLine, pillState } = await import('./familyUi');
const { RevisionsPanel } = await import('./RevisionsPanel');
const { UpdateToast } = await import('./UpdateToast');
const { FirstRunCard } = await import('./FirstRunCard');
const stub = await import('./UpdateToast.stub');
const { nb } = await import('../i18n/nb');
const { SEED_VARIANT_ID } = await import('../model/seed/forslagD');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const start = appStore.getState().project;

function render(node: ReactNode) {
  act(() => root.render(node));
}
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: Element | null) => {
  if (!el) throw new Error('element not found');
  act(() => (el as HTMLElement).click());
};
const texts = (sel: string) => [...document.querySelectorAll(sel)].map((e) => e.textContent?.trim());

beforeEach(() => {
  localStorage.clear();
  appStore.getState().replaceProject(start, { readOnly: false, source: 'local' });
  appStore.setState({ toasts: [] });
  familyUiStore.setState({ askName: false, notices: [], conflicts: [], overwritten: [], tooNew: [], trash: [], meta: {}, failed: false, saving: false });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

// First: making a proposal closes the first-run card for good (firstRun.ts).
describe('first-run card', () => {
  it('the first-run card says what is true here: saved on this device (local mode)', () => {
    render(<FirstRunCard />);
    const text = byTestId('first-run')?.textContent ?? '';
    expect(text).toContain('Alt lagres automatisk på denne enheten. Trykk «Send forslaget» for å dele');
    expect(text).not.toContain('familiens delte plass');
    expect(nb.firstRun.saved.shared.startsWith('Alt lagres automatisk i familiens delte plass')).toBe(true);
  });
});

describe('status pill', () => {
  it('texts per state (§5)', () => {
    const base = { mode: 'shared' as const, phase: 'ready' as const, saving: false, pending: 0, online: true, failed: false };
    expect(pillState({ ...base, mode: 'local' })).toBe('local');
    expect(pillState({ ...base, mode: 'local', failed: true })).toBe('localFailed');
    expect(pillState(base)).toBe('synced');
    expect(pillState({ ...base, saving: true })).toBe('saving');
    expect(pillState({ ...base, pending: 2 })).toBe('saving');
    expect(pillState({ ...base, pending: 2, online: false })).toBe('pending');
    expect(pillState({ ...base, online: false })).toBe('synced');
    expect(pillState({ ...base, phase: 'connecting' })).toBe('connecting');
    expect(pillState({ ...base, phase: 'error' })).toBe('error');
    expect(pillState({ ...base, failed: true })).toBe('failed');
    expect(nb.family.pill.synced).toBe('Lagret for alle');
    expect(nb.family.pill.pending).toBe('Lagret her – sendes når du er på nett');
    expect(nb.family.pill.local).toBe('Kun på denne enheten (ingen delt plass satt opp)');
  });

  it('renders the local text as its accessible name, a short one for narrow screens, and an explanation', () => {
    render(<StatusPill />);
    const pill = byTestId('status-pill');
    expect(pill?.getAttribute('data-state')).toBe('local');
    expect(pill?.getAttribute('aria-label')).toBe(nb.family.pill.local);
    expect(pill?.querySelector('.pill-short')?.textContent).toBe('Kun her');
    expect(pill?.getAttribute('title')).toContain('Send forslaget');
    act(() => familyUiStore.setState({ mode: 'shared', phase: 'ready', pending: 1, online: false }));
    expect(byTestId('status-pill')?.getAttribute('aria-label')).toBe('Lagret her – sendes når du er på nett');
    act(() => familyUiStore.setState({ mode: 'local', pending: 0, online: true }));
  });
});

describe('proposals menu', () => {
  it('Forslag D first with "Grunnlag", then the proposals by creation, with "sist endret av …"; choosing shows one', () => {
    const now = Date.parse('2026-10-12T15:00:00');
    const later = appStore.getState().duplicateVariant(SEED_VARIANT_ID, 'B senere') ?? '';
    const earlier = appStore.getState().duplicateVariant(SEED_VARIANT_ID, 'A tidligere') ?? '';
    const at = new Date(now - 30 * 60_000).toISOString();
    const meta = {
      [later]: { id: later, name: 'B senere', createdAt: '2026-10-12T10:00:00.000Z', createdBy: 'Robin', updatedAt: at, updatedBy: 'Mamma', deletedAt: null, lineage: [] },
      [earlier]: { id: earlier, name: 'A tidligere', createdAt: '2026-10-11T10:00:00.000Z', createdBy: null, updatedAt: at, updatedBy: null, deletedAt: null, lineage: [] },
    };
    const ordered = menuOrder(appStore.getState().project.variants, meta).map((v) => v.name);
    expect(ordered).toEqual(['Forslag D', 'A tidligere', 'B senere']);
    const variant = appStore.getState().project.variants.find((v) => v.id === later);
    if (!variant) throw new Error('missing');
    expect(metaLine(variant, meta[later], now)).toMatch(/^sist endret av Mamma, i dag \d\d\.\d\d$/);
    expect(metaLine(variant, { ...meta[later], updatedBy: null }, now)).toMatch(/^sist endret i dag/);
    expect(metaLine(variant, undefined, now)).toBe('ikke lagret ennå');
    expect(metaLine(appStore.getState().project.variants[0], undefined, now)).toBe(nb.family.baseLine);

    act(() => familyUiStore.setState({ meta }));
    const onOpenTrash = vi.fn();
    render(<ProposalsMenu onOpenTrash={onOpenTrash} />);
    expect(byTestId('proposals-menu')?.textContent).toContain('A tidligere');
    click(byTestId('proposals-menu'));
    expect(texts('.proposal-item .proposal-name')).toEqual(['Forslag DGrunnlag', 'A tidligere', 'B senere']);
    expect(byTestId(`proposal-item-${later}`)?.textContent).toContain('sist endret av Mamma');
    expect(byTestId(`proposal-item-${earlier}`)?.getAttribute('aria-checked')).toBe('true');
    click(byTestId(`proposal-item-${SEED_VARIANT_ID}`));
    expect(appStore.getState().project.activeVariantId).toBe(SEED_VARIANT_ID);
    expect(byTestId('proposals-list')).toBeNull();
    click(byTestId('proposals-menu'));
    click(byTestId('menu-trash'));
    expect(onOpenTrash).toHaveBeenCalled();
  });

  it('"+ Nytt forslag" copies Forslag D (after the name), also from another proposal; Esc closes the list', () => {
    const other = appStore.getState().duplicateVariant(SEED_VARIANT_ID, 'Annet') ?? '';
    appStore.getState().updateVariant(other, (v) => {
      v.notes = 'endret';
    });
    vi.spyOn(window, 'prompt').mockReturnValue('Fra grunnlaget');
    render(<ProposalsMenu onOpenTrash={() => {}} />);
    click(byTestId('proposals-menu'));
    expect(byTestId('menu-copy-proposal')?.textContent).toBe('Kopier «Annet»');
    click(byTestId('menu-new-proposal'));
    const p = appStore.getState().project;
    const made = p.variants.find((v) => v.id === p.activeVariantId);
    expect(made).toMatchObject({ name: 'Fra grunnlaget', basedOnId: SEED_VARIANT_ID });
    expect(made?.notes).toBeUndefined();
    click(byTestId('proposals-menu'));
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(byTestId('proposals-list')).toBeNull();
  });
});

describe('top bar', () => {
  it('Slett asks twice; Avbryt at either step keeps it; the end puts it in the Papirkurv with an Angre toast', () => {
    const id = appStore.getState().duplicateVariant(SEED_VARIANT_ID, 'Mitt forslag') ?? '';
    render(<TopBar onOpen={() => {}} />);
    click(byTestId('delete-proposal'));
    expect(byTestId('delete-step-1')?.textContent).toBe('Vil du slette «Mitt forslag»?');
    click([...document.querySelectorAll('[data-testid="delete-dialog"] button')].find((b) => b.textContent === 'Avbryt') ?? null);
    expect(byTestId('delete-dialog')).toBeNull();
    click(byTestId('delete-proposal'));
    click(byTestId('delete-next'));
    expect(byTestId('delete-step-2')?.textContent).toContain('Er du sikker? Forslaget forsvinner fra listen.');
    expect(byTestId('delete-confirm')?.textContent).toBe('Slett');
    click([...document.querySelectorAll('[data-testid="delete-dialog"] button')].find((b) => b.textContent === 'Avbryt') ?? null);
    expect(appStore.getState().project.variants.some((v) => v.id === id)).toBe(true);
    click(byTestId('delete-proposal'));
    click(byTestId('delete-next'));
    click(byTestId('delete-confirm'));
    expect(appStore.getState().project.variants.some((v) => v.id === id)).toBe(false);
    expect(appStore.getState().toasts.at(-1)).toMatchObject({ text: '«Mitt forslag» er lagt i Papirkurv.', undo: true });
    expect(nb.family.delete.sureShared).toBe('Er du sikker? Forslaget forsvinner for alle.');
    expect(nb.family.delete.confirmShared).toBe('Slett for alle');
  });

  it('Mer: Tidligere versjoner, Papirkurv, Lagre som fil, Åpne fil, Eksporter JSON; each with a tooltip', () => {
    render(<TopBar onOpen={() => {}} />);
    expect(texts('[data-testid="more-menu"] .menu-item')).toEqual(['Tidligere versjoner', 'Papirkurv', 'Lagre som fil', 'Åpne fil', 'Eksporter JSON']);
    for (const el of document.querySelectorAll('[data-testid="more-menu"] .menu-item')) expect(el.getAttribute('title')).toBeTruthy();
    (byTestId('more-menu') as HTMLDetailsElement).open = true;
    click(byTestId('more-revisions'));
    expect(byTestId('revisions-panel')?.textContent).toContain('Forslag D endres aldri');
    click([...document.querySelectorAll('[data-testid="revisions-panel"] button')].find((b) => b.textContent === 'Lukk') ?? null);
    click(byTestId('more-trash'));
    expect(byTestId('trash-panel')?.textContent).toContain('Papirkurven er tom.');
    // Read-only: no Papirkurv / Tidligere versjoner / Åpne fil.
    act(() => appStore.getState().setUi({ readOnly: true }));
    expect(texts('[data-testid="more-menu"] .menu-item')).toEqual(['Lagre som fil', 'Eksporter JSON']);
    act(() => appStore.getState().setUi({ readOnly: false }));
  });

  it('"Send forslaget" opens the dialog; the name prompt shows while asked', async () => {
    render(<TopBar onOpen={() => {}} />);
    click(byTestId('open-share'));
    // A lazy chunk (TopBar.tsx): it shows once loaded.
    await vi.waitFor(
      async () => {
        await act(async () => {});
        expect(byTestId('share-dialog')).not.toBeNull();
      },
      { timeout: 10_000 },
    );
    act(() => familyUiStore.setState({ askName: true }));
    expect(byTestId('name-dialog')).toBeNull(); // not over another dialog
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(byTestId('name-dialog')).not.toBeNull();
  });
});

describe('banners and the name prompt', () => {
  it('conflict: "«X» ble endret av Pappa for 2 min siden." with Hent endringene / Lagre over; deleted variant text', () => {
    const at = new Date(Date.now() - 2 * 60_000 - 5000).toISOString();
    act(() =>
      familyUiStore.setState({
        conflicts: [
          { id: 'p1', name: 'Mitt forslag', kind: 'changed', by: 'Pappa', at },
          { id: 'p2', name: 'Annet', kind: 'deleted', by: null, at },
        ],
      }),
    );
    render(<FamilyBanners />);
    const banners = document.querySelectorAll('[data-testid="conflict-banner"]');
    expect(banners[0].textContent).toContain('«Mitt forslag» ble endret av Pappa for 2 min siden.');
    expect(banners[0].textContent).toContain('Hent endringene');
    expect(banners[0].textContent).toContain('Lagre over');
    expect(banners[1].textContent).toContain('«Annet» ble slettet av noen for 2 min siden.');
  });

  it('overwritten, too new and no shared space; dismissable', () => {
    const onShow = vi.fn();
    act(() =>
      familyUiStore.setState({
        overwritten: [{ id: 'p1', name: 'Mitt forslag', by: 'Pappa', at: new Date().toISOString() }],
        tooNew: [{ id: 'x', name: 'Ny', createdAt: '', createdBy: null, updatedAt: '', updatedBy: null, deletedAt: null, lineage: [] }],
        notices: ['family-unavailable'],
      }),
    );
    render(<FamilyBanners onShowRevisions={onShow} />);
    expect(byTestId('overwritten-banner')?.textContent).toContain('Din utgave ligger under Tidligere versjoner.');
    click([...(byTestId('overwritten-banner')?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Vis') ?? null);
    expect(onShow).toHaveBeenCalled();
    expect(byTestId('too-new-banner')?.textContent).toContain('Ett forslag er laget med en nyere versjon av appen');
    click(byTestId('family-unavailable')?.querySelector('button') ?? null);
    expect(familyUiStore.getState().notices).toEqual([]);
  });

  it('"Hva heter du?": Lagre stores the name; Hopp over stores "" (never asked again)', () => {
    act(() => familyUiStore.setState({ askName: true }));
    render(<NameDialog />);
    const input = byTestId('name-input') as HTMLInputElement;
    expect((byTestId('name-save') as HTMLButtonElement).disabled).toBe(true);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'Mamma');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(byTestId('name-save'));
    expect(localStorage.getItem('hytte-planlegger:my-name')).toBe('Mamma');
    expect(familyUiStore.getState().askName).toBe(false);
    render(<NameDialog />);
    click([...document.querySelectorAll('[data-testid="name-dialog"] button')].find((b) => b.textContent === 'Hopp over') ?? null);
    expect(localStorage.getItem('hytte-planlegger:my-name')).toBe('');
  });
});

describe('dialogs', () => {
  it('Papirkurv lists who deleted what and when, and how long it stays', () => {
    const now = Date.now();
    expect(daysLeft(new Date(now).toISOString(), now)).toBe(30);
    expect(daysLeft(new Date(now - 29.5 * 86_400_000).toISOString(), now)).toBe(1);
    expect(daysLeft(new Date(now - 31 * 86_400_000).toISOString(), now)).toBe(0);
    act(() =>
      familyUiStore.setState({
        trash: [{ id: 'p9', name: 'Gammelt', createdAt: '', createdBy: null, updatedAt: new Date(now).toISOString(), updatedBy: 'Pappa', deletedAt: new Date(now).toISOString(), lineage: [] }],
      }),
    );
    render(<TrashPanel onClose={() => {}} />);
    expect(byTestId('trash-item-p9')?.textContent).toMatch(/Gammelt.*Slettet i dag \d\d\.\d\d av Pappa · forsvinner om 30 dager/);
    expect(byTestId('trash-restore-p9')?.textContent).toBe('Hent tilbake');
  });

  it('Tidligere versjoner of a new proposal: none yet', async () => {
    appStore.getState().duplicateVariant(SEED_VARIANT_ID, 'Mitt forslag');
    render(<RevisionsPanel onClose={() => {}} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(byTestId('revisions-panel')?.textContent).toContain('Ingen tidligere versjoner ennå');
  });

  it('Send forslaget, local: a #d= copy; "Send …" uses the share sheet when there is one, else copies', async () => {
    const share = vi.fn(async () => {});
    Object.assign(navigator, { share });
    render(<ShareDialog onClose={() => {}} />);
    const link = (byTestId('share-local-link') as HTMLTextAreaElement).value;
    expect(link).toContain('#d=');
    await act(async () => {
      byTestId('share-send')?.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: link }));
    Object.assign(navigator, { share: undefined });
  });

  it('Send forslaget, shared: the proposal link and the family link, both labelled, and the family id', () => {
    const links = { family: 'https://x.test/hytte/#f=e2e-abcdefghijklmnopqrstuvwxyz', proposal: 'https://x.test/hytte/#f=e2e-abcdefghijklmnopqrstuvwxyz&p=p1' };
    render(<ShareDialog onClose={() => {}} links={links} />);
    expect((byTestId('share-proposal-link') as HTMLInputElement).value).toBe(links.proposal);
    expect((byTestId('share-family-link') as HTMLInputElement).value).toBe(links.family);
    const text = byTestId('share-dialog')?.textContent ?? '';
    expect(text).toContain('Lenke til «Forslag D»');
    expect(text).toContain('Familielenke (alle forslagene)');
    expect(text).toContain('Send den bare til familien');
  });
});

describe('app update toast', () => {
  it('"Ny versjon av appen er klar. [Oppdater]": saves first, then activates the new version', async () => {
    const stop = startPersistence();
    stub.setStubNeedRefresh(true);
    try {
      render(<UpdateToast />);
      expect(byTestId('update-toast')?.textContent).toContain('Ny versjon av appen er klar.');
      const before = stub.stubCalls.update;
      appStore.getState().duplicateVariant(SEED_VARIANT_ID, 'Ulagret');
      await act(async () => {
        byTestId('update-now')?.click();
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(stub.stubCalls.update).toBe(before + 1);
      await flushProposals();
      expect(localStorage.getItem('hytte-planlegger:proposals') ?? '').toContain('Ulagret');
    } finally {
      stub.setStubNeedRefresh(false);
      stop();
    }
  });

  it('nothing shows without a waiting version', () => {
    render(<UpdateToast />);
    expect(byTestId('update-toast')).toBeNull();
  });
});

describe('home-screen card', () => {
  it('iPhone in Safari: instructions; installable browsers: the button; never when installed or dismissed', () => {
    const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5, standalone: false };
    expect(isIos(iphone)).toBe(true);
    expect(isIos({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(installCardKind(iphone, false, false)).toBe('ios');
    expect(installCardKind({ ...iphone, standalone: true }, false, false)).toBeNull();
    expect(installCardKind(iphone, false, true)).toBeNull();
    const pc = { userAgent: 'Mozilla/5.0 (Windows NT 10.0)', platform: 'Win32', maxTouchPoints: 0, standalone: false };
    expect(installCardKind(pc, false, false)).toBeNull();
    expect(installCardKind(pc, true, false)).toBe('prompt');
  });

});
