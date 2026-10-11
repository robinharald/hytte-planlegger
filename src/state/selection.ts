/**
 * Selection model shared by the plan, the 3D view and the panels (architecture.md "Component contracts").
 * A selection only stores a kind and an id; `resolveSelection` looks the object up in the derived model and
 * returns null when it no longer exists (dangling after undo, variant switch, deletion).
 */
import type {
  DerivedBlock,
  DerivedDeck,
  DerivedFurniture,
  DerivedHotTub,
  DerivedOpening,
  DerivedRailing,
  DerivedRoom,
  DerivedStructure,
  DerivedVariant,
  DerivedWall,
} from '../model/derived';
import type { BlockVertex, Id, Tree } from '../model/types';

export type SelectionKind =
  | 'wall'
  | 'blockEdge'
  | 'blockVertex'
  | 'opening'
  | 'room'
  | 'block'
  | 'deck'
  | 'railing'
  | 'hotTub'
  | 'structure'
  | 'furniture'
  | 'tree';

export type Selection = { kind: SelectionKind; id: Id; levelId?: Id };

export type ResolvedSelection =
  | { kind: 'room'; room: DerivedRoom }
  | { kind: 'wall'; wall: DerivedWall }
  | { kind: 'opening'; opening: DerivedOpening; wall: DerivedWall }
  | { kind: 'block'; block: DerivedBlock }
  | { kind: 'blockEdge'; block: DerivedBlock; edge: DerivedBlock['edges'][number] }
  | { kind: 'blockVertex'; block: DerivedBlock; vertex: BlockVertex }
  | { kind: 'deck'; deck: DerivedDeck }
  | { kind: 'railing'; railing: DerivedRailing }
  | { kind: 'hotTub'; hotTub: DerivedHotTub }
  | { kind: 'structure'; structure: DerivedStructure }
  | { kind: 'furniture'; furniture: DerivedFurniture }
  | { kind: 'tree'; tree: Tree; baseZ: number };

export function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.id === b.id && (a.levelId ?? null) === (b.levelId ?? null);
}

/** Room by id; `levelId` disambiguates faces with the same id on different levels when given. */
export function selectRoom(derived: DerivedVariant, id: Id, levelId?: Id): DerivedRoom | null {
  const byLevel = levelId ? derived.rooms.find((r) => r.id === id && r.levelId === levelId) : undefined;
  return byLevel ?? derived.rooms.find((r) => r.id === id) ?? null;
}

export function selectWall(derived: DerivedVariant, id: Id): DerivedWall | null {
  return derived.walls.find((w) => w.id === id) ?? null;
}

export function selectOpening(derived: DerivedVariant, id: Id): { opening: DerivedOpening; wall: DerivedWall } | null {
  for (const wall of derived.walls) {
    const opening = wall.openings.find((o) => o.id === id);
    if (opening) return { opening, wall };
  }
  return null;
}

export function selectBlock(derived: DerivedVariant, id: Id): DerivedBlock | null {
  return derived.blocks.find((b) => b.block.id === id) ?? null;
}

/** Resolve a selection against the derived model. Returns null for a dangling selection. */
export function resolveSelection(derived: DerivedVariant, sel: Selection | null): ResolvedSelection | null {
  if (!sel) return null;
  switch (sel.kind) {
    case 'room': {
      const room = selectRoom(derived, sel.id, sel.levelId);
      return room ? { kind: 'room', room } : null;
    }
    case 'wall': {
      const wall = selectWall(derived, sel.id);
      return wall ? { kind: 'wall', wall } : null;
    }
    case 'opening': {
      const hit = selectOpening(derived, sel.id);
      return hit ? { kind: 'opening', ...hit } : null;
    }
    case 'block': {
      const block = selectBlock(derived, sel.id);
      return block ? { kind: 'block', block } : null;
    }
    case 'blockEdge': {
      for (const block of derived.blocks) {
        const edge = block.edges.find((e) => e.edgeId === sel.id);
        if (edge) return { kind: 'blockEdge', block, edge };
      }
      return null;
    }
    case 'blockVertex': {
      for (const block of derived.blocks) {
        const vertex = block.block.polygon.find((v) => v.id === sel.id);
        if (vertex) return { kind: 'blockVertex', block, vertex };
      }
      return null;
    }
    case 'deck': {
      const deck = derived.outdoor.decks.find((d) => d.id === sel.id);
      return deck ? { kind: 'deck', deck } : null;
    }
    case 'railing': {
      const railing = derived.outdoor.railings.find((r) => r.id === sel.id);
      return railing ? { kind: 'railing', railing } : null;
    }
    case 'hotTub': {
      const hotTub = derived.outdoor.hotTubs.find((h) => h.id === sel.id);
      return hotTub ? { kind: 'hotTub', hotTub } : null;
    }
    case 'structure': {
      const structure = derived.structure.find((s) => s.id === sel.id);
      return structure ? { kind: 'structure', structure } : null;
    }
    case 'furniture': {
      const furniture = derived.furniture.find((f) => f.id === sel.id);
      return furniture ? { kind: 'furniture', furniture } : null;
    }
    case 'tree': {
      const hit = derived.site.trees.find((t) => t.tree.id === sel.id);
      return hit ? { kind: 'tree', tree: hit.tree, baseZ: hit.baseZ } : null;
    }
    default:
      return null;
  }
}
