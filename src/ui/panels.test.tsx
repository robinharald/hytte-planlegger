// @vitest-environment jsdom
/**
 * Render tests for the shell panels against the app store singleton (bootstrapped from the seed) with
 * `deriveVariant` mocked to the hand-made fixture, so they do not depend on the geometry pipeline.
 * (App/Stage are not rendered here: they lazy-load view3d/View3D.)
 */
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDerived } from './testDerived';

vi.mock('../geometry/derive', () => ({ deriveVariant: () => makeDerived() }));

const { appStore, makeMyOwnCopy, noticeStore } = await import('../state/appStore');
const { Controls } = await import('./Controls');
const { SidePanels } = await import('./SidePanels');
const { Headline } = await import('./AreaTotals');
const { Banners } = await import('./Banners');
const { TopBar } = await import('./TopBar');
const { useKeyboardShortcuts, useTestHook } = await import('./hooks');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const initialProject = appStore.getState().project;

function render(node: ReactNode) {
  act(() => root.render(node));
}

const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: Element | null) => {
  if (!el) throw new Error('element not found');
  act(() => (el as HTMLElement).click());
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  appStore.getState().replaceProject(initialProject, { readOnly: false, source: 'local', activeView: 'split', mode3d: 'ute', selection: null });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Controls', () => {
  it('has the view tabs and switches views', () => {
    render(<Controls isPhone={false} />);
    for (const id of ['view-tab-plan', 'view-tab-3d', 'view-tab-split', 'plan-storey-ground', 'plan-storey-loft', 'mode-ute', 'mode-inne']) {
      expect(byTestId(id), id).not.toBeNull();
    }
    click(byTestId('view-tab-3d'));
    expect(appStore.getState().ui.activeView).toBe('3d');
    expect(byTestId('view-tab-3d')?.getAttribute('aria-pressed')).toBe('true');
    expect(byTestId('plan-storey-ground')).toBeNull();
    click(byTestId('view-tab-plan'));
    expect(byTestId('mode-ute')).toBeNull();
  });

  it('has a button per camera preset and the cut height in interior mode', () => {
    render(<Controls isPhone={false} />);
    for (const p of ['oversikt', 'terrassen', 'framsiden', 'baksiden', 'langsiden', 'ovenfra', 'naert-tilbygget', 'inne-stua']) {
      expect(byTestId(`preset-${p}`), p).not.toBeNull();
    }
    click(byTestId('preset-ovenfra'));
    expect(appStore.getState().ui.preset).toBe('ovenfra');
    expect(byTestId('cut-height')).toBeNull();
    click(byTestId('mode-inne'));
    expect(appStore.getState().ui.mode3d).toBe('inne');
    const slider = byTestId('cut-height') as HTMLInputElement;
    expect(slider.min).toBe('1.2');
    expect(slider.max).toBe('2.6');
    act(() => appStore.getState().setUi({ cutHeight: 1.3 }));
    click(byTestId('preset-inne-stua'));
    expect(appStore.getState().ui).toMatchObject({ preset: 'inne-stua', cutHeight: 2.3 });
  });

  it('storey tabs set plan storey and active storey; toggles flip ui flags', () => {
    render(<Controls isPhone={false} />);
    click(byTestId('plan-storey-loft'));
    expect(appStore.getState().ui.planStorey).toBe('loft');
    expect(appStore.getState().ui.activeStoreyId).toBe('loft');
    const before = appStore.getState().ui.highlightNew;
    click(byTestId('toggle-new'));
    expect(appStore.getState().ui.highlightNew).toBe(!before);
    const labels = appStore.getState().ui.showLabels;
    click(byTestId('toggle-labels'));
    expect(appStore.getState().ui.showLabels).toBe(!labels);
  });
});

describe('side panels', () => {
  it('room schedule lists rooms; a click selects and shows the properties', () => {
    render(<SidePanels isPhone={false} />);
    const schedule = byTestId('room-schedule');
    expect(schedule?.textContent).toContain('Hovedbad');
    expect(schedule?.textContent).toContain('Underetasje');
    const row = [...container.querySelectorAll('tr.row')].find((tr) => tr.textContent?.includes('Hems 1'));
    click(row ?? null);
    expect(appStore.getState().ui.selection).toEqual({ kind: 'room', id: 'hems-1', levelId: 'loft' });
    expect(appStore.getState().ui.planStorey).toBe('loft');
    expect(row?.getAttribute('aria-selected')).toBe('true');
    const titles = [...container.querySelectorAll('.panel strong')].map((el) => el.textContent);
    expect(titles).toContain('Hems 1');
  });

  it('area totals show BYA, BRA per level and the explanations', () => {
    render(<SidePanels isPhone={false} />);
    const areas = byTestId('area-totals');
    expect(areas?.textContent).toContain('BYA');
    expect(areas?.textContent).toContain('170,2 m²');
    expect(areas?.textContent).toContain('Underetasje (soverom)');
    expect(areas?.querySelectorAll('details.explain')).toHaveLength(4);
  });

  it('warnings are listed in Norwegian and can select their target', () => {
    render(<SidePanels isPhone={false} />);
    expect(container.textContent).toContain('3 advarsler');
    const btn = [...container.querySelectorAll('.warnings button')].find((b) => b.textContent?.startsWith('Rom uten navn'));
    click(btn ?? null);
    expect(appStore.getState().ui.selection).toEqual({ kind: 'room', id: 'face-abc', levelId: 'main' });
  });
});

describe('headline, top bar, banners', () => {
  it('headline shows BYA and BRA per level', () => {
    render(<Headline />);
    const text = byTestId('headline')?.textContent ?? '';
    expect(text).toContain('BYA170,2 m²');
    expect(text).toContain('Underetasje 32,0 m²');
  });

  it('top bar hides edit actions while read-only but keeps the variant selector', () => {
    render(<TopBar onOpen={() => {}} />);
    expect(container.textContent).toContain('Dupliser');
    act(() => appStore.getState().setUi({ readOnly: true, source: 'link' }));
    expect(container.textContent).not.toContain('Dupliser');
    expect(container.textContent).not.toContain('Lagre versjon');
    expect(byTestId('variant-select')).not.toBeNull();
  });

  it('shared link banner offers "Lag min egen kopi"', () => {
    render(<Banners />);
    expect(byTestId('banner-shared')).toBeNull();
    act(() => appStore.getState().replaceProject({ ...initialProject, id: 'shared-id' }, { readOnly: true, source: 'link' }));
    expect(byTestId('banner-shared')?.textContent).toContain('Du ser på en delt versjon');
    click(byTestId('make-copy'));
    const { project, ui } = appStore.getState();
    expect(ui.readOnly).toBe(false);
    expect(project.id).not.toBe('shared-id');
    expect(project.basedOnProjectId).toBe('shared-id');
    expect(byTestId('banner-shared')).toBeNull();
    expect(typeof makeMyOwnCopy).toBe('function');
    expect(noticeStore.getState().notices).not.toContain('schema-too-new');
  });
});

describe('keyboard and test hook', () => {
  function Hooks(props: { ready: boolean }) {
    useKeyboardShortcuts();
    useTestHook(props.ready);
    return null;
  }

  it('Esc clears the selection, Ctrl+Z / Ctrl+Y undo and redo', () => {
    render(<Hooks ready={false} />);
    act(() => appStore.getState().select({ kind: 'room', id: 'x' }));
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(appStore.getState().ui.selection).toBeNull();

    const variant = appStore.getState().project.variants[0];
    const room = variant.rooms[0];
    act(() => appStore.getState().renameRoom(room.id, 'Omdøpt'));
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })));
    expect(appStore.getState().project.variants[0].rooms[0].name).toBe(room.name);
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true })));
    expect(appStore.getState().project.variants[0].rooms[0].name).toBe('Omdøpt');
  });

  it('window.__hytte follows ready, project and derived', () => {
    render(<Hooks ready={false} />);
    expect(window.__hytte?.ready).toBe(false);
    expect(window.__hytte?.project).toBe(appStore.getState().project);
    expect(window.__hytte?.derived.rooms.length).toBe(6);
    render(<Hooks ready />);
    expect(window.__hytte?.ready).toBe(true);
  });
});

describe('review fixes', () => {
  const texts = (sel: string) => [...container.querySelectorAll(sel)].map((el) => el.textContent?.trim() ?? '');

  it('Romskjema: Rom · Bygningsdel · Status · Mål · Areal, no level column, both shares of a mixed room', () => {
    render(<SidePanels isPhone={false} />);
    const schedule = byTestId('room-schedule');
    expect(texts('[data-testid="room-schedule"] thead th')).toEqual(['Rom', 'Bygningsdel', 'Status', 'Mål (m)', 'Areal']);
    expect(schedule?.querySelector('table')?.classList.contains('schedule')).toBe(true);
    const gang = [...(schedule?.querySelectorAll('tr.row') ?? [])].find((tr) => tr.textContent?.includes('Gang nedre'));
    const cells = [...(gang?.querySelectorAll('td') ?? [])].map((td) => td.textContent ?? '');
    expect(cells[1]).toBe('Hytta');
    expect(cells[2]).toBe('eks.nytt');
    expect(cells[3]).toBe('2,0 × 2,5');
    expect(cells[4]).toBe('5,0 m²3,0 + 2,0');
    expect(texts('[data-testid="room-schedule"] tr.subtotal td')).toContain('Sum etasje');
  });

  it('Egenskaper sits above Arealer and is revealed when a schedule row is chosen', () => {
    const scrolled = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrolled;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    try {
      render(<SidePanels isPhone />);
      const titles = [...container.querySelectorAll('details.panel > summary .panel-title')].map((el) => el.firstChild?.textContent);
      expect(titles).toEqual(['Romskjema', 'Egenskaper', 'Arealer', 'Advarsler']);
      const props = byTestId('properties') as HTMLDetailsElement;
      act(() => {
        props.open = false;
      });
      const row = [...container.querySelectorAll('tr.row')].find((tr) => tr.textContent?.includes('Stue'));
      click(row ?? null);
      expect(props.open).toBe(true);
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect(scrolled.mock.instances[0]).toBe(props);
    } finally {
      Element.prototype.scrollIntoView = original;
      vi.unstubAllGlobals();
    }
  });

  it('headline: BYA with buildings split and the deck, BRA per level, abbreviations explained', () => {
    render(<Headline />);
    const headline = byTestId('headline');
    const text = headline?.textContent ?? '';
    expect(text).toContain('BYA170,2 m² · bygg 160,2 (eks. 120,1 · nytt 40,1) · terrasse 10,0');
    expect(text).toContain('BRA140,0 m² (Underetasje 32,0 m² · Hovedplan 100,0 m² · Hems 8,0 m²)');
    const titles = [...(headline?.querySelectorAll('abbr') ?? [])].map((a) => a.getAttribute('title'));
    expect(titles).toEqual(expect.arrayContaining(['Bebygd areal', 'Bruksareal', 'eksisterende']));
  });

  it('Arealer: buildings with their own split, decks separately, rooms explanation mentions the loft', () => {
    render(<SidePanels isPhone={false} />);
    const areas = byTestId('area-totals');
    expect(areas?.textContent).toContain('Bygninger160,2 m² (eks. 120,1 · nytt 40,1)');
    expect(areas?.textContent).toContain('Terrasser over 0,5 m10,0 m²');
    expect(areas?.textContent).toContain('1,9 m');
    expect(areas?.textContent).not.toContain('Nytt 50,1');
  });

  it('shared banner: merge text and "Tilbake til mitt prosjekt" with an own project, else "Vis Forslag D"', () => {
    render(<Banners />);
    act(() => {
      noticeStore.setState({ sharedHasOwn: true });
      appStore.getState().replaceProject({ ...initialProject, id: 'shared-id' }, { readOnly: true, source: 'link' });
    });
    expect(byTestId('banner-shared')?.textContent).toContain('legger den delte varianten til i ditt eget prosjekt');
    expect(byTestId('leave-shared')?.textContent).toBe('Tilbake til mitt prosjekt');
    act(() => noticeStore.setState({ sharedHasOwn: false }));
    expect(byTestId('banner-shared')?.textContent).toContain('gjør den til ditt eget prosjekt');
    expect(byTestId('leave-shared')?.textContent).toBe('Vis Forslag D');
  });

  it('other-tab banner offers "Hent endringene" and "Behold mine endringer"', () => {
    render(<Banners />);
    act(() => noticeStore.setState({ notices: ['other-tab'] }));
    expect(container.textContent).toContain('Hent endringene');
    const keep = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Behold mine endringer');
    click(keep ?? null);
    expect(noticeStore.getState().notices).not.toContain('other-tab');
  });

  it('top bar: tooltips, subtitle without a repeated place name', () => {
    render(<TopBar onOpen={() => {}} />);
    const button = (label: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
    for (const label of ['Lagre versjon', 'Versjoner', 'Eksporter', 'Importer', 'Dupliser', 'Gi nytt navn', 'Del lenke', 'Hjelp']) {
      expect(button(label)?.getAttribute('title'), label).toBeTruthy();
    }
    expect(container.querySelector('.brand p')?.textContent).toBe(initialProject.name);
  });

  it('top bar below 600 px: "Mer" menu with the file actions, Del lenke and Hjelp stay', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes('max-width'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      const onOpen = vi.fn();
      render(<TopBar onOpen={onOpen} />);
      const menu = byTestId('more-menu') as HTMLDetailsElement;
      expect(menu).not.toBeNull();
      expect(texts('[data-testid="more-menu"] .menu-item')).toEqual(['Lagre versjon', 'Versjoner', 'Eksporter', 'Importer']);
      expect(texts('.file-actions > .btn')).toEqual([]);
      expect(byTestId('open-share')?.textContent).toBe('Del lenke');
      expect(byTestId('open-help')?.getAttribute('title')).toBeTruthy();
      act(() => {
        menu.open = true;
      });
      const versions = [...container.querySelectorAll('.menu-item')].find((b) => b.textContent === 'Versjoner');
      click(versions ?? null);
      expect(onOpen).toHaveBeenCalledWith('versions');
      expect(menu.open).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });

  it('controls: Langsiden preset, tooltips everywhere, a chosen view is remembered', () => {
    render(<Controls isPhone={false} />);
    expect(byTestId('preset-langsiden')?.textContent).toBe('Langsiden (mot vannet)');
    for (const el of container.querySelectorAll('.presets button, .seg button')) expect(el.getAttribute('title'), el.textContent ?? '').toBeTruthy();
    for (const el of container.querySelectorAll('.toggles label')) expect(el.getAttribute('title'), el.textContent ?? '').toBeTruthy();
    act(() => appStore.getState().setUi({ activeViewChosen: false }));
    click(byTestId('view-tab-plan'));
    expect(appStore.getState().ui).toMatchObject({ activeView: 'plan', activeViewChosen: true });
  });
});
