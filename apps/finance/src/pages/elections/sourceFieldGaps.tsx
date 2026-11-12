import { fieldGapLabel, type SourceFieldGap } from './externalData';

/** A missing source value is never a numeric zero. Use the existing metric rows
 * and source controls, keeping literal source evidence in the evidence panel. */
export function SourceFieldGaps({
  gaps,
  enabled = true,
  onSource,
}: {
  gaps: SourceFieldGap[] | undefined;
  enabled?: boolean;
  onSource: (gapIndex: number, sourceIndex: number) => void;
}) {
  return gaps?.map((gap, index) => (
    <div key={`${gap.measure}:${index}`}>
      <dt>{gap.label}</dt>
      <dd>
        {fieldGapLabel(gap.state)}
        {gap.sources.map((_, sourceIndex) => (
          <button
            key={sourceIndex}
            className="ec-link ec-filing-period"
            disabled={!enabled}
            onClick={() => onSource(index, sourceIndex)}
          >
            View source<span className="ec-sr-only"> for {gap.label}</span>
          </button>
        ))}
      </dd>
    </div>
  ));
}
