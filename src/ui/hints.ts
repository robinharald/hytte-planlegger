/** Default hint line texts per tool (docs/phase2-plan.md §3.2). Pure. */
import { nb } from '../i18n/nb';
import type { ToolKind } from './editorBridge';

export function hintFor(tool: ToolKind): string {
  switch (tool) {
    case 'wall':
      return nb.hints.wall;
    case 'opening':
      return nb.hints.opening;
    case 'unit':
      return nb.hints.unit;
    case 'furniture':
      return nb.hints.furniture;
    case 'measure':
      return nb.hints.measure;
    default:
      return nb.hints.select;
  }
}
