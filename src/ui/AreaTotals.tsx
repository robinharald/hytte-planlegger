/**
 * Arealer panel and the always-visible headline strip. Numbers come straight from `DerivedVariant.areas`
 * (geometry/areas.ts); nothing is computed here except sums and the building-only split (areaFigures.ts).
 *
 * Panel: BYA with Bygninger (own eks./nytt split) and Terrasser over 0,5 m on separate lines, BRA per level
 * (measurable / gross), Aksemål and Rom (netto), each with an expandable "Slik måles det".
 * Headline: "BYA 235,5 m² · bygg 178,3 (eks. 102,2 · nytt 76,1) · terrasse 57,2 — BRA 170,1 m² (per level)",
 * with the abbreviations expanded in tooltips (<abbr title>).
 */
import type { ReactNode } from 'react';
import type { AreaSplit } from '../model/derived';
import { nb } from '../i18n/nb';
import { useDerived } from '../state/useDerived';
import { buildingSplit } from './areaFigures';
import type { BuildingSplit } from './areaFigures';
import { Panel } from './common';
import { formatM2, formatNumber } from './format';
import { shortLevelName, sortByLevelElevation } from './schedule';

const A = nb.areas;
const H = nb.headline;

function Explain(props: { text: string }) {
  return (
    <details className="explain">
      <summary>{A.howMeasured}</summary>
      <p>{props.text}</p>
    </details>
  );
}

function SplitLine({ split }: { split: AreaSplit }) {
  return (
    <div className="split-line num">
      <span>
        {A.existing} {formatM2(split.existing)}
      </span>
      <span className="new">
        {A.new} {formatM2(split.new)}
      </span>
    </div>
  );
}

/** "(eks. 102,2 · nytt 76,2)" */
function ShortSplit({ split }: { split: BuildingSplit }) {
  return (
    <>
      (<abbr title={H.existingFull}>{H.existingShort}</abbr> {formatNumber(split.existing)} ·{' '}
      <span className="new">
        {H.newShort} {formatNumber(split.new)}
      </span>
      )
    </>
  );
}

function Figure(props: { name: string; full: string; total: number; children?: ReactNode; explain: string }) {
  return (
    <section className="figure">
      <div className="figure-head">
        <span className="figure-name">
          {props.name}
          <small>{props.full}</small>
        </span>
        <span className="figure-total">{formatM2(props.total)}</span>
      </div>
      {props.children}
      <Explain text={props.explain} />
    </section>
  );
}

export function AreaTotals(props: { defaultOpen?: boolean }) {
  const { areas, levels, outdoor } = useDerived();
  const roomsTotal = areas.rooms.reduce((s, r) => s + r.area, 0);
  const roomsSplit: AreaSplit = {
    total: roomsTotal,
    existing: areas.rooms.reduce((s, r) => s + r.areaExisting, 0),
    new: areas.rooms.reduce((s, r) => s + r.areaNew, 0),
  };
  const perLevel = sortByLevelElevation(areas.bra.perLevel, levels);
  const buildings = buildingSplit(areas.bya, outdoor.decks);

  return (
    <Panel title={A.heading} defaultOpen={props.defaultOpen} testId="area-totals">
      <Figure name={A.bya} full={A.byaFull} total={areas.bya.total} explain={A.explain.bya}>
        <dl className="kv num">
          <div>
            <dt>{A.buildings}</dt>
            <dd>
              {formatM2(areas.bya.buildings)}
              {buildings && (
                <span className="muted">
                  {' '}
                  <ShortSplit split={buildings} />
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>{A.decks}</dt>
            <dd>{formatM2(areas.bya.decks)}</dd>
          </div>
        </dl>
      </Figure>

      <Figure name={A.bra} full={A.braFull} total={areas.bra.total} explain={A.explain.bra}>
        <SplitLine split={areas.bra} />
        {perLevel.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{A.perLevel}</th>
                <th scope="col" className="r">
                  {A.measurable}
                </th>
                <th scope="col" className="r">
                  {A.gross}
                </th>
              </tr>
            </thead>
            <tbody>
              {perLevel.map((l) => (
                <tr key={l.levelId}>
                  <td>{l.name}</td>
                  <td className="r">{formatM2(l.area)}</td>
                  <td className="r muted">{formatM2(l.gross)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Figure>

      <Figure name={A.axis} full={A.axisFull} total={areas.axis.total} explain={A.explain.axis}>
        <SplitLine split={areas.axis} />
      </Figure>

      <Figure name={A.rooms} full={A.roomsFull} total={roomsTotal} explain={A.explain.rooms}>
        <SplitLine split={roomsSplit} />
      </Figure>
    </Panel>
  );
}

/**
 * Headline numbers that stay visible on every layout: BYA total, buildings with their eks./nytt split and the
 * decks; BRA total and per level.
 */
export function Headline() {
  const { areas, levels, outdoor } = useDerived();
  const perLevel = sortByLevelElevation(areas.bra.perLevel, levels);
  const buildings = buildingSplit(areas.bya, outdoor.decks);
  return (
    <div className="headline" role="group" aria-label={H.label} data-testid="headline">
      <span className="hl-group">
        <b>
          <abbr title={H.byaFull}>{H.bya}</abbr>
        </b>
        {formatM2(areas.bya.total)}
        <span className="muted">
          {' · '}
          <span title={H.buildingsFull}>{H.buildings}</span> {formatNumber(areas.bya.buildings)}
          {buildings && (
            <>
              {' '}
              <ShortSplit split={buildings} />
            </>
          )}
          {areas.bya.decks > 0 && (
            <>
              {' · '}
              <span title={H.decksFull}>{H.decks}</span> {formatNumber(areas.bya.decks)}
            </>
          )}
        </span>
      </span>
      <span className="hl-sep" aria-hidden="true">
        —
      </span>
      <span className="hl-group">
        <b>
          <abbr title={H.braFull}>{H.bra}</abbr>
        </b>
        {formatM2(areas.bra.total)}
        {perLevel.length > 0 && (
          <span className="muted">
            {' '}
            ({perLevel.map((l) => `${shortLevelName(l.name)} ${formatM2(l.area)}`).join(' · ')})
          </span>
        )}
      </span>
    </div>
  );
}
