// @vitest-environment jsdom
/**
 * Fix round after 2a (UX findings on the phone and the 3D colours), against the app store singleton with the real
 * Forslag D and the real derive pipeline; PlanView and View3D are replaced by stubs that record their props:
 *  - all six tools fit a 390 px phone row (the layout does not depend on sideways scrolling);
 *  - the mini-bar's placement: above the selection, flipped below when there is no room, never over the toolbar;
 *    "Roter 90°" for a placed "Nytt bygg" unit;
 *  - the Egenskaper sheet opens low with the basic fields; the part of the plan it covers reaches the plan as
 *    `viewportInsets` (kept current while the page scrolls); opening it scrolls the plan up under the toolbar;
 *  - the 3D view's own "Vis hva som er nytt i 3D" (off by default) while the plan keeps "Vis hva som er nytt" on.
 */
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// theme.css as text (Vitest does not load CSS, not even with ?raw): through Node's fs, without Node's types in the app config.
type NodeFs = { readFileSync(path: string, encoding: 'utf8'): string };
const nodeProcess = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: 'node:fs'): NodeFs } }).process;
const themeCss = nodeProcess.getBuiltinModule('node:fs').readFileSync(`${nodeProcess.cwd()}/src/ui/theme.css`, 'utf8');

const planProps: { current: Record<string, unknown> | null } = { current: null };
const view3dProps: { current: Record<string, unknown> | null } = { current: null };

vi.mock('../plan2d/PlanView', () => ({
  PlanView: (props: Record<string, unknown>) => {
    planProps.current = props;
    return <div data-testid="plan-stub" />;
  },
}));
vi.mock('../view3d/View3D', () => ({
  View3D: (props: Record<string, unknown>) => {
    view3dProps.current = props;
    return <div data-testid="view-3d-stub" />;
  },
}));

const { appStore } = await import('../state/appStore');
const { DEFAULT_UI } = await import('../state/store');
const { PREFS_VERSION, pickUiPrefs, sanitizeUiPrefs } = await import('../state/persistence');
const { nb } = await import('../i18n/nb');
const { Toolbar } = await import('./Toolbar');
const { HintLine } = await import('./HintLine');
const { Stage } = await import('./Stage');
const { Controls } = await import('./Controls');
const { PropertiesSheet } = await import('./PropertiesPanel');
const { SelectionMiniBar } = await import('./SelectionMiniBar');
const { placeMiniBar } = await import('./miniBarPlacement');
const { EditActionsProvider, NOOP_EDIT_ACTIONS, TOOL_KINDS, createNewProposal } = await import('./editorBridge');
const { overlayStore, setPropertiesSheet, setSelectionAnchor } = await import('./overlay');
const { PHONE_QUERY } = await import('./hooks');
type UiEditActions = import('./editorBridge').UiEditActions;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialProject = appStore.getState().project;
let container: HTMLDivElement;
let root: Root;
const originalMatchMedia = window.matchMedia;

const render = (node: ReactNode) => act(() => root.render(node));
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: Element | null) => {
  if (!el) throw new Error('element not found');
  act(() => (el as HTMLElement).click());
};

function phone(on: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: on && query === PHONE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

beforeEach(() => {
  appStore.getState().replaceProject(initialProject, { readOnly: false, source: 'local', activeView: 'plan', selection: null, tool: 'select' });
  appStore.setState({ toasts: [] });
  setPropertiesSheet(false);
  setSelectionAnchor(null);
  planProps.current = null;
  view3dProps.current = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

/** The declarations of `selector` inside the phone media blocks of theme.css. */
function phoneRule(selector: string): string {
  const out: string[] = [];
  const media = /@media \(max-width: 799px\) \{/g;
  let m: RegExpExecArray | null;
  while ((m = media.exec(themeCss))) {
    // The media block: up to its matching closing brace.
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < themeCss.length && depth > 0; i++) {
      if (themeCss[i] === '{') depth++;
      else if (themeCss[i] === '}') depth--;
    }
    const block = themeCss.slice(start, i - 1);
    const rule = new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`);
    const r = rule.exec(block);
    if (r) out.push(r[2]);
  }
  return out.join('\n');
}

describe('phone toolbar', () => {
  it('all six tools fit a 390 px row: six equal grid columns, icon above a wrapping label, no sideways scroll', () => {
    expect(TOOL_KINDS).toHaveLength(6);
    const row = phoneRule('.toolbar-tools');
    expect(row).toMatch(/display: grid;/);
    expect(row).toMatch(/grid-template-columns: repeat\(6, minmax\(0, 1fr\)\);/);
    expect(row).toMatch(/overflow: visible;/);
    const tool = phoneRule('.toolbar-tools .tool');
    expect(tool).toMatch(/flex-direction: column;/);
    expect(tool).toMatch(/min-width: 0;/);
    expect(tool).toMatch(/white-space: normal;/);
    // 390 px − 2 × 8 px page gutter − 2 × 5 px toolbar padding and border − 6 px gap − Angre / Gjør om (2 × 36 + 2 +
    // 7 px) = 277 px for six columns: 46 px each, wider than the widest label line ("Møbler", "vindu").
    expect((390 - 16 - 10 - 6 - (2 * 36 + 2 + 7)) / 6).toBeGreaterThan(44);

    act(() => void createNewProposal());
    render(<Toolbar />);
    const tools = [...document.querySelectorAll('.toolbar-tools > .tool')];
    expect(tools.map((t) => t.getAttribute('data-tool'))).toEqual([...TOOL_KINDS]);
    // "Dør/vindu" may break after the slash.
    expect(byTestId('tool-opening')?.querySelector('wbr')).not.toBeNull();
    expect(byTestId('tool-opening')?.textContent).toBe('Dør/vindu');
  });
});

describe('mini-bar placement', () => {
  const viewport = { width: 390, height: 664 };
  const bar = { width: 260, height: 50 };
  const at = (top: number, bottom: number, x = 200) => ({ x, y: top, rect: { left: x - 20, top, width: 40, height: bottom - top } });

  it('sits 12 px above the selection, centred on it', () => {
    expect(placeMiniBar({ anchor: at(400, 420), bar, viewport, chromeBottom: 120 })).toEqual({ left: 200, top: 338, below: false });
  });

  it('flips below the selection when there is no room above (it would cover the toolbar and hint line)', () => {
    // Selection just under the hint line (bottom 120): above would need top 98.
    expect(placeMiniBar({ anchor: at(160, 180), bar, viewport, chromeBottom: 120 })).toEqual({ left: 200, top: 192, below: true });
  });

  it('never covers the toolbar, even for a tall selection with no room either side', () => {
    const p = placeMiniBar({ anchor: at(130, 640), bar, viewport, chromeBottom: 120 });
    expect(p.top).toBeGreaterThanOrEqual(128);
    // An open sheet is a floor too.
    const q = placeMiniBar({ anchor: at(300, 330), bar, viewport, chromeBottom: 0, floor: 360 });
    expect(q.top + bar.height).toBeLessThanOrEqual(360);
  });

  it('stays 8 px inside the screen sideways', () => {
    expect(placeMiniBar({ anchor: at(400, 420, 10), bar, viewport, chromeBottom: 0 }).left).toBe(138);
    expect(placeMiniBar({ anchor: at(400, 420, 385), bar, viewport, chromeBottom: 0 }).left).toBe(390 - 138);
  });

  it('a placed "Nytt bygg" unit gets "Roter 90°", which turns it with rotateBlock', () => {
    act(() => void createNewProposal());
    act(() =>
      appStore.getState().updateActiveVariant((v) => {
        const wing = v.blocks.find((b) => b.id === 'blk-wing');
        if (wing) wing.template = 'vedskjul';
      }),
    );
    const actions = { ...NOOP_EDIT_ACTIONS, rotateBlock: vi.fn() } as UiEditActions & { rotateBlock: ReturnType<typeof vi.fn> };
    render(
      <EditActionsProvider actions={actions}>
        <SelectionMiniBar />
      </EditActionsProvider>,
    );
    act(() => setSelectionAnchor({ x: 200, y: 300 }));
    act(() => appStore.getState().select({ kind: 'block', id: 'blk-wing' }));
    expect(byTestId('mini-rotate')?.textContent).toBe(nb.edit.block.rotate);
    click(byTestId('mini-rotate'));
    expect(actions.rotateBlock).toHaveBeenCalledWith('blk-wing', 90);

    // Today's cabin (no template) cannot be turned.
    act(() => appStore.getState().select({ kind: 'block', id: 'blk-main' }));
    expect(byTestId('mini-rotate')).toBeNull();
  });
});

describe('the Egenskaper sheet on a phone', () => {
  it('opens low with the basic fields, scrolls the plan under the toolbar, and gives the plan its insets', () => {
    phone(true);
    // jsdom's viewport is 768 px high. The page is scrolled so the toolbar is at the top and the plan right under it.
    const rects: Record<string, Partial<DOMRect>> = {
      'toolbar-wrap': { top: 0, bottom: 56, height: 56 },
      'hint-line': { top: 62, bottom: 84, height: 22 },
      'pane-plan': { top: 90, bottom: 600, height: 510 },
      sheet: { top: 502, bottom: 768, height: 266 },
    };
    const keyOf = (el: Element) =>
      el.classList.contains('toolbar-wrap')
        ? 'toolbar-wrap'
        : el.classList.contains('pane-plan')
          ? 'pane-plan'
          : el.classList.contains('sheet')
            ? 'sheet'
            : el.getAttribute('data-testid') === 'hint-line'
              ? 'hint-line'
              : '';
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return { x: 0, y: 0, left: 0, right: 390, top: 0, bottom: 0, width: 390, height: 0, toJSON: () => ({}), ...rects[keyOf(this)] } as DOMRect;
    });
    const scrolled: Element[] = [];
    const scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true });

    act(() => void createNewProposal());
    render(
      <>
        <Toolbar />
        <HintLine />
        <Stage onReady3d={() => {}} />
        <PropertiesSheet />
      </>,
    );
    // No sheet: nothing covers the plan, it never pans by itself.
    expect(planProps.current?.viewportInsets).toBeUndefined();

    act(() => appStore.getState().select({ kind: 'wall', id: 'w-gang-n' }));
    act(() => setPropertiesSheet(true));
    const sheet = byTestId('properties-sheet');
    expect(sheet?.getAttribute('data-stop')).toBe('basic');
    expect(scrolled.some((el) => el.classList.contains('toolbar-wrap'))).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
    // The sheet (top 502) covers the plan's box (90 … 600) from 502 down: 98 px at its bottom.
    expect(planProps.current?.viewportInsets).toEqual({ top: 0, right: 0, bottom: 98, left: 0 });

    // The page scrolls 110 px further: the plan's top 20 px are above the screen, its bottom clears the sheet.
    rects['toolbar-wrap'] = { top: -110, bottom: -54, height: 56 };
    rects['hint-line'] = { top: -48, bottom: -26, height: 22 };
    rects['pane-plan'] = { top: -20, bottom: 490, height: 510 };
    act(() => void window.dispatchEvent(new Event('scroll')));
    expect(planProps.current?.viewportInsets).toEqual({ top: 20, right: 0, bottom: 0, left: 0 });

    // The basic stop hides "Mer" (CSS); "Vis mer" opens it fully.
    expect(themeCss).toMatch(/\.sheet\[data-stop='basic'\] \.sheet-body details\.more/);
    click(byTestId('sheet-stop'));
    expect(byTestId('properties-sheet')?.getAttribute('data-stop')).toBe('full');
    expect(byTestId('sheet-stop')?.textContent).toBe(nb.sheet.collapse);

    // Closing the sheet gives the plan its box back.
    act(() => setPropertiesSheet(false));
    expect(overlayStore.getState().sheets).toEqual({});
    expect(planProps.current?.viewportInsets).toBeUndefined();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('a desktop plan gets no insets', () => {
    phone(false);
    render(<Stage onReady3d={() => {}} />);
    expect(planProps.current).not.toBeNull();
    expect(planProps.current?.viewportInsets).toBeUndefined();
  });
});

describe('3D colours', () => {
  it('3D starts in natural colours with its own switch; the plan keeps "Vis hva som er nytt" on', async () => {
    expect(DEFAULT_UI.highlightNew).toBe(true);
    expect(DEFAULT_UI.highlightNew3d).toBe(false);
    act(() => appStore.getState().setUi({ activeView: 'split' }));
    await act(async () => {
      root.render(
        <>
          <Controls isPhone={false} />
          <Stage onReady3d={() => {}} />
        </>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(planProps.current?.highlightNew).toBe(true);
    expect(view3dProps.current?.highlightNew).toBe(false);

    const toggle3d = byTestId('toggle-new-3d') as HTMLInputElement;
    expect(toggle3d.closest('label')?.textContent).toContain(nb.toggles.new3d);
    expect(toggle3d.checked).toBe(false);
    click(toggle3d);
    expect(appStore.getState().ui).toMatchObject({ highlightNew: true, highlightNew3d: true });
    expect(view3dProps.current?.highlightNew).toBe(true);
    expect(planProps.current?.highlightNew).toBe(true);

    // 3D only: the plan's switch is not offered there.
    act(() => appStore.getState().setUi({ activeView: '3d' }));
    expect(byTestId('toggle-new')).toBeNull();
    expect(byTestId('toggle-new-3d')).not.toBeNull();
    act(() => appStore.getState().setUi({ activeView: 'plan' }));
    expect(byTestId('toggle-new')).not.toBeNull();
    expect(byTestId('toggle-new-3d')).toBeNull();
  });

  it('the switch is remembered (prefs version 4); older prefs leave 3D in natural colours', () => {
    expect(PREFS_VERSION).toBe(4);
    const prefs = pickUiPrefs({ ...DEFAULT_UI, highlightNew3d: true });
    expect(prefs).toMatchObject({ v: 4, highlightNew: true, highlightNew3d: true });
    expect(sanitizeUiPrefs(prefs)).toMatchObject({ highlightNew: true, highlightNew3d: true });
    expect(sanitizeUiPrefs({ v: 3, highlightNew: false })).toEqual({ highlightNew: false });
    expect(nb.help.items.some((t) => t.includes(nb.toggles.new3d))).toBe(true);
  });
});
