/**
 * Selection model shared by the plan, the 3D view and the panels (architecture.md "Component contracts").
 * A selection only stores a kind and an id; `resolveSelection` looks the object up in the derived model and
 * returns null when it no longer exists (dangling after undo, variant switch, deletion).
 *
 * Phase 2 (docs/phase2-plan.md §3.6) adds:
 *  - 'deckVertex' (id = the DeckVertex id) and 'deckEdge' (id = the edge id = its start vertex id; the same string
 *    as the vertex, told apart by the kind);
 *  - 'steps' (id = the DeckSteps id, `DerivedSteps.id`);
 *  - 'ghost' (id = a ghost wall id or ghost opening id — status 'removed', e.g. `${id}/ghost` after a move or the
 *    element itself after a delete — or a `Variant.ghosts` id of a moved block edge); `restoreGhost(id)` takes it.
 *  - 'railing' resolves by the derived railing id `${deckId}/railing` (as in phase 1 after schema 2).
 * A ghost selection only resolves to a ghost (a wall / opening with `isGhost`), never to a live element.
 */
import type {
  DerivedBlock,
  DerivedDeck,
  DerivedFurniture,
  DerivedHotTub,
  DerivedOpening,
  DerivedRailing,
  DerivedRoom,
  DerivedSteps,
  DerivedStructure,
  DerivedVariant,
  DerivedWall,
} from '../model/derived';
import type { BlockVertex, Id, Tree, Vec2 } from '../model/types';

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
  | 'tree'
  | 'deckVertex'
  | 'deckEdge'
  | 'steps'
  | 'ghost';

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
  | { kind: 'tree'; tree: Tree; baseZ: number }
  | { kind: 'deckVertex'; deck: DerivedDeck; vertexId: Id; index: number; p: Vec2 }
  | { kind: 'deckEdge'; deck: DerivedDeck; edgeId: Id; index: number; a: Vec2; b: Vec2 }
  | { kind: 'steps'; steps: DerivedSteps; deck: DerivedDeck | null }
  | { kind: 'ghost'; ghost: GhostTarget };

/** What a ghost selection points at: a removed wall, a removed opening (with its host), or a moved block edge's old line. */
export type GhostTarget =
  | { type: 'wall'; id: Id; wall: DerivedWall }
  | { type: 'opening'; id: Id; opening: DerivedOpening; wall: DerivedWall }
  | { type: 'blockEdge'; id: Id; a: Vec2; b: Vec2 };

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

/** The deck owning a vertex / edge id (edge id = start vertex id) and its index in the outline. */
export function selectDeckVertex(derived: DerivedVariant, id: Id): { deck: DerivedDeck; index: number } | null {
  for (const deck of derived.outdoor.decks) {
    const index = deck.vertexIds.indexOf(id);
    if (index >= 0) return { deck, index };
  }
  return null;
}

/** A ghost (removed wall, removed opening or moved block edge) by id, or null. */
export function selectGhost(derived: DerivedVariant, id: Id): GhostTarget | null {
  const wall = derived.walls.find((w) => w.id === id && w.isGhost);
  if (wall) return { type: 'wall', id, wall };
  for (const w of derived.walls) {
    const opening = w.openings.find((o) => o.id === id && o.isGhost);
    if (opening) return { type: 'opening', id, opening, wall: w };
  }
  const edge = derived.ghosts.find((g) => g.id === id);
  if (edge) return { type: 'blockEdge', id, a: edge.a, b: edge.b };
  return null;
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
    case 'deckVertex': {
      const hit = selectDeckVertex(derived, sel.id);
      return hit ? { kind: 'deckVertex', deck: hit.deck, vertexId: sel.id, index: hit.index, p: hit.deck.polygon[hit.index] } : null;
    }
    case 'deckEdge': {
      const hit = selectDeckVertex(derived, sel.id);
      if (!hit) return null;
      const n = hit.deck.polygon.length;
      return { kind: 'deckEdge', deck: hit.deck, edgeId: sel.id, index: hit.index, a: hit.deck.polygon[hit.index], b: hit.deck.polygon[(hit.index + 1) % n] };
    }
    case 'steps': {
      const steps = derived.outdoor.steps.find((s) => s.id === sel.id);
      return steps ? { kind: 'steps', steps, deck: derived.outdoor.decks.find((d) => d.id === steps.deckId) ?? null } : null;
    }
    case 'ghost': {
      const ghost = selectGhost(derived, sel.id);
      return ghost ? { kind: 'ghost', ghost } : null;
    }
    default:
      return null;
  }
}
