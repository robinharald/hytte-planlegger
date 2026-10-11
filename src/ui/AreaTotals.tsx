/**
 * Arealer panel (BYA total / eksisterende / nytt with buildings + decks, BRA per level gross / measurable,
 * Aksemål, Rom netto), each with an expandable "Slik måles det", and the always-visible headline strip.
 * Numbers come straight from `DerivedVariant.areas` (geometry/areas.ts); nothing is computed here except sums.
 */
import type { ReactNode } from 'react';
import type { AreaSplit } from '../model/derived';
import { nb } from '../i18n/nb';
import { useDerived } from '../state/useDerived';
import { Panel } from './common';
import { formatM2 } from './format';
import { shortLevelName, sortByLevelElevation } from './schedule';

function Explain(props: { text: string }) {
  return (
    <details className="explain">
      <summary>{nb.areas.howMeasured}</summary>
      <p>{props.text}</p>
    </details>
  );
}

function SplitLine({ split }: { split: AreaSplit }) {
  return (
    <div className="split-line num">
      <span>
        {nb.areas.existing} {formatM2(split.existing)}
      </span>
      <span className="new">
        {nb.areas.new} {formatM2(split.new)}
      </span>
    </div>
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
  const { areas, levels } = useDerived();
  const roomsTotal = areas.rooms.reduce((s, r) => s + r.area, 0);
  const roomsSplit: AreaSplit = {
    total: roomsTotal,
    existing: areas.rooms.reduce((s, r) => s + r.areaExisting, 0),
    new: areas.rooms.reduce((s, r) => s + r.areaNew, 0),
  };
  const perLevel = sortByLevelElevation(areas.bra.perLevel, levels);

  return (
    <Panel title={nb.areas.heading} defaultOpen={props.defaultOpen} testId="area-totals">
      <Figure name={nb.areas.bya} full={nb.areas.byaFull} total={areas.bya.total} explain={nb.areas.explain.bya}>
        <SplitLine split={areas.bya} />
        <dl className="kv">
          <dt>{nb.areas.buildings}</dt>
          <dd>{formatM2(areas.bya.buildings)}</dd>
          <dt>{nb.areas.decks}</dt>
          <dd>{formatM2(areas.bya.decks)}</dd>
        </dl>
      </Figure>

      <Figure name={nb.areas.bra} full={nb.areas.braFull} total={areas.bra.total} explain={nb.areas.explain.bra}>
        <SplitLine split={areas.bra} />
        {perLevel.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{nb.areas.perLevel}</th>
                <th scope="col" className="r">
                  {nb.areas.measurable}
                </th>
                <th scope="col" className="r">
                  {nb.areas.gross}
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

      <Figure name={nb.areas.axis} full={nb.areas.axisFull} total={areas.axis.total} explain={nb.areas.explain.axis}>
        <SplitLine split={areas.axis} />
      </Figure>

      <Figure name={nb.areas.rooms} full={nb.areas.roomsFull} total={roomsTotal} explain={nb.areas.explain.rooms}>
        <SplitLine split={roomsSplit} />
      </Figure>
    </Panel>
  );
}

/** Headline numbers that stay visible on every layout: BYA total / eks. / nytt, BRA per level. */
export function Headline() {
  const { areas, levels } = useDerived();
  const perLevel = sortByLevelElevation(areas.bra.perLevel, levels);
  return (
    <div className="headline" role="group" aria-label={nb.headline.label} data-testid="headline">
      <span>
        <b>{nb.headline.bya}</b>
        {formatM2(areas.bya.total)}{' '}
        <span className="muted">
          ({nb.headline.existingShort} {formatM2(areas.bya.existing)} · <span className="new">{nb.headline.newShort} {formatM2(areas.bya.new)}</span>)
        </span>
      </span>
      <span>
        <b>{nb.headline.bra}</b>
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
