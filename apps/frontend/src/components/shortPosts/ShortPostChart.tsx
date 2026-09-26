import { calculateChart } from '../../lib/shortPostCalculations';
import type {
  ShortPostChartDisplay,
  ShortPostEvidence,
  ShortPostGraphic,
  ShortPostHistory,
} from '../../lib/shortPosts';
import { isoDateLabel } from '../../lib/researchIndex';

type Props = {
  graphic: ShortPostGraphic;
  display: ShortPostChartDisplay;
  evidence: ShortPostEvidence;
  correction?: ShortPostHistory;
  /** Stable article identity keeps title IDs distinct across repeated chart kinds. */
  articleId: string;
};

const number = (value: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value);
const amount = (value: number, unit: string) => `${number(value)} ${unit}`;
const safeId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '-');

/** Quantities and text are both calculated from the reviewed ChartInput. */
export function ShortPostChart({ graphic, display, evidence, correction, articleId }: Props) {
  const result = calculateChart(graphic.input);
  const titleId = `short-chart-${safeId(articleId)}-${safeId(graphic.id)}`;
  const period =
    result.kind === 'parts'
      ? result.total.period
      : result.kind === 'comparison'
        ? result.baseline.period
        : result.period;
  const unit =
    result.kind === 'parts'
      ? result.total.unit
      : result.kind === 'comparison'
        ? result.baseline.unit
        : result.unit;
  const periodText = (period: { label: string; from: string; through: string }) =>
    `${period.label} (${period.from} through ${period.through})`;
  const differentPeriods =
    result.kind === 'comparison' &&
    (result.baseline.period.from !== result.compared.period.from ||
      result.baseline.period.through !== result.compared.period.through ||
      result.baseline.period.label !== result.compared.period.label);
  if (graphic.input.kind === 'overlap' && graphic.input.proportional)
    throw new Error('Overlap diagram requires nonproportional inputs');
  const asTable = display.treatment === 'table' && result.kind === 'parts';
  if (result.kind === 'parts' && result.parts.length !== 1 && !asTable) {
    throw new Error('Several parts need the table treatment so each value stays distinct');
  }
  if (result.kind === 'comparison' && (result.baseline.value < 0 || result.compared.value < 0)) {
    throw new Error('Comparison bars need nonnegative values and a shared zero');
  }

  return (
    <figure className="sp-chart" aria-labelledby={titleId}>
      <style>{chartCss}</style>
      <figcaption id={titleId} className="sp-chart-title">
        {display.title}
      </figcaption>
      <p className="sp-chart-measure">
        {result.kind !== 'comparison' && !asTable ? `${unit} · ` : null}
        {differentPeriods && result.kind === 'comparison'
          ? `${result.baselineLabel}: ${periodText(result.baseline.period)}; ${result.comparedLabel}: ${periodText(result.compared.period)}`
          : periodText(period)}
      </p>

      {result.kind === 'parts' && !asTable ? (
        <div className="sp-chart-plot">
          <div className="sp-chart-emphasis">
            <strong aria-hidden="true">{number(result.parts[0].percent)}%</strong>
            <span>
              <span aria-hidden="true">{amount(result.parts[0].value, unit)} of </span>
              <span aria-label={`Total: ${amount(result.total.value, unit)}`}>
                {amount(result.total.value, unit)}
              </span>
            </span>
          </div>
          <div className="sp-chart-stack" aria-hidden="true">
            {result.parts.map((part) => (
              <span
                key={part.label}
                className="sp-chart-stack-part"
                style={{ width: `${(part.value / result.total.value) * 100}%` }}
              />
            ))}
            <span
              className="sp-chart-stack-remainder"
              style={{ width: `${(result.remainder.value / result.total.value) * 100}%` }}
            />
          </div>
          <div className="sp-chart-legend">
            {[...result.parts, result.remainder].map((part, index) => (
              <div key={part.label} className="sp-chart-legend-row">
                <span
                  className={
                    index === result.parts.length ? 'sp-chart-key remainder' : 'sp-chart-key'
                  }
                />
                <span>{part.label}</span>
                <strong>
                  {number(part.value)} · {number(part.percent)}%
                </strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {result.kind === 'comparison' ? (
        <div className="sp-chart-plot sp-chart-comparison">
          {[
            { label: result.baselineLabel, value: result.baseline.value },
            { label: result.comparedLabel, value: result.compared.value },
          ].map(({ label, value }) => {
            const maximum = Math.max(0, result.baseline.value, result.compared.value);
            return (
              <div className="sp-chart-comparison-row" key={label}>
                <span>{label}</span>
                <span className="sp-chart-bar-field" aria-hidden="true">
                  {maximum > 0 ? (
                    <span
                      className="sp-chart-bar"
                      style={{ width: `${(value / maximum) * 100}%` }}
                    />
                  ) : null}
                </span>
                <strong>{amount(value, unit)}</strong>
              </div>
            );
          })}
        </div>
      ) : null}

      {result.kind === 'overlap' ? (
        <div className="sp-chart-overlap">
          <div className="sp-chart-circles" aria-hidden="true">
            <span className="sp-chart-circle left" />
            <span className="sp-chart-circle right" />
            <span className="sp-chart-circle-value left-only">{number(result.leftOnly)}</span>
            <span className="sp-chart-circle-value both">{number(result.both)}</span>
            <span className="sp-chart-circle-value right-only">{number(result.rightOnly)}</span>
          </div>
          <div className="sp-chart-overlap-legend">
            <div>
              <span>{result.leftLabel} only</span>
              <strong>{number(result.leftOnly)}</strong>
            </div>
            <div>
              <span>In both groups</span>
              <strong>{number(result.both)}</strong>
            </div>
            <div>
              <span>{result.rightLabel} only</span>
              <strong>{number(result.rightOnly)}</strong>
            </div>
            {result.neither !== undefined ? (
              <div>
                <span>In neither group</span>
                <strong>{number(result.neither)}</strong>
              </div>
            ) : null}
            <div>
              <span>Total in either group</span>
              <strong>{number(result.union)}</strong>
            </div>
            {result.universe !== undefined ? (
              <div>
                <span>Total, including neither group</span>
                <strong>{number(result.universe)}</strong>
              </div>
            ) : null}
            <p>
              {result.leftLabel} contains {number(result.leftTotal)}. {result.rightLabel} contains{' '}
              {number(result.rightTotal)}.
            </p>
          </div>
          <p className="sp-chart-overlap-warning">
            Diagram shows overlap, not relative group sizes
          </p>
        </div>
      ) : null}

      {asTable && result.kind === 'parts' ? (
        <div className="sp-chart-table-scroll">
          <table className="sp-chart-table">
            <thead>
              <tr>
                <th scope="col">Group</th>
                <th scope="col">{unit}</th>
                <th scope="col">Share</th>
              </tr>
            </thead>
            <tbody>
              {[...result.parts, result.remainder].map((part) => (
                <tr key={part.label}>
                  <th scope="row">{part.label}</th>
                  <td>{number(part.value)}</td>
                  <td>{number(part.percent)}%</td>
                </tr>
              ))}
              <tr className="sp-chart-table-total">
                <th scope="row">Total</th>
                <td>{number(result.total.value)}</td>
                <td>100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      {result.kind === 'comparison' && result.percentChange !== undefined ? (
        <p className="sp-chart-change">
          Change: {amount(result.difference, unit)} ({number(result.percentChange)}%)
        </p>
      ) : null}
      <div className={`sp-chart-foot${display.conclusion ? ' sp-chart-foot-conclusion' : ''}`}>
        <div className="sp-chart-foot-text">
          {display.conclusion ? (
            <p className="sp-chart-conclusion">
              <strong>Conclusion: {display.conclusion}</strong> {evidence.limitations}
            </p>
          ) : null}
          {display.sourcePlacement !== 'sources' && !evidence.url.startsWith('#') ? (
            <span>
              Source:{' '}
              <a href={evidence.url} target="_blank" rel="noopener noreferrer">
                {evidence.title}
              </a>
            </span>
          ) : null}
          {!display.conclusion ? <span>{evidence.limitations}</span> : null}
          {display.limitation !== evidence.limitations ? <span>{display.limitation}</span> : null}
          {correction ? (
            <a href={`#correction-${display.correctionHistoryIndex}`}>
              Corrected {isoDateLabel(correction.datedOn)}
            </a>
          ) : null}
        </div>
        {/* Approved twin-peak symbol, using the same vector as the website header. */}
        <svg
          width="31"
          height="30"
          viewBox="0 0 84 82"
          role="img"
          aria-label="Alethical"
          className="sp-chart-symbol"
        >
          <path d="M0 82 L38 0 L38 82 Z M84 82 L46 0 L46 82 Z" fill="#0f7a45" />
        </svg>
      </div>
    </figure>
  );
}

const chartCss = `
.sp-chart-foot.sp-chart-foot-conclusion{flex-direction:row;align-items:flex-start;justify-content:flex-start;gap:14px}.sp-chart-foot-conclusion .sp-chart-symbol{order:-1;margin-top:9px}.sp-chart-conclusion{margin:0;font-size:16px;line-height:1.5;font-weight:400;color:#11150f}.sp-chart-conclusion strong{font-weight:700}
.sp-chart{box-sizing:border-box;margin:30px 0;background:#fff;border:1px solid rgba(17,21,15,.12);border-radius:14px;padding:24px 26px 20px;font-family:'Libre Franklin',Helvetica,Arial,sans-serif;color:#11150f;min-width:0}
.sp-chart *{box-sizing:border-box}.sp-chart-title{font-size:19px;line-height:1.3;font-weight:800;letter-spacing:-.01em}.sp-chart-measure{margin:6px 0 0;font-size:15px;line-height:1.45;color:#4b524b}
.sp-chart-plot{margin-top:20px}.sp-chart-emphasis{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 12px;font-variant-numeric:tabular-nums}.sp-chart-emphasis strong{font-size:40px;line-height:1;letter-spacing:-.02em;white-space:nowrap}.sp-chart-emphasis span{font-size:16px;font-weight:600;color:#2c322c}
.sp-chart-stack{display:flex;height:34px;margin-top:14px;border:1px solid rgba(17,21,15,.16);border-radius:7px;overflow:hidden}.sp-chart-stack-part{display:block;background:#0f7a45}.sp-chart-stack-remainder{display:block;background:repeating-linear-gradient(135deg,#eef0ee 0 6px,#d9ddd9 6px 8px);border-left:2px solid #fff}
.sp-chart-legend{display:grid;gap:8px;margin-top:14px}.sp-chart-legend-row{display:grid;grid-template-columns:16px minmax(0,1fr) auto;align-items:center;gap:10px;font-size:15.5px;line-height:1.4}.sp-chart-legend-row strong,.sp-chart-overlap-legend strong{font-variant-numeric:tabular-nums;white-space:nowrap}.sp-chart-key{width:16px;height:16px;border-radius:4px;background:#0f7a45}.sp-chart-key.remainder{border:1px solid rgba(17,21,15,.2);background:repeating-linear-gradient(135deg,#eef0ee 0 4px,#c9cec9 4px 6px)}
.sp-chart-comparison{display:grid;grid-template-columns:minmax(180px,30%) minmax(0,1fr) max-content;gap:14px;align-items:center;overflow-x:auto}.sp-chart-comparison-row{display:contents;font-size:15.5px;font-weight:700}.sp-chart-comparison-row>span:first-child{line-height:1.35}.sp-chart-bar-field{display:block;min-width:0}.sp-chart-bar{display:block;height:28px;border-radius:0 6px 6px 0;background:#0f7a45}.sp-chart-comparison-row>strong{font-size:17px;font-variant-numeric:tabular-nums;white-space:nowrap}
.sp-chart-overlap{margin-top:20px;display:grid;grid-template-columns:320px minmax(0,1fr);gap:14px 28px;align-items:center}.sp-chart-circles{position:relative;width:320px;height:200px}.sp-chart-circle{position:absolute;top:0;width:200px;height:200px;border-radius:50%}.sp-chart-circle.left{left:0;border:2px solid #0f7a45;background:rgba(46,212,126,.10)}.sp-chart-circle.right{left:120px;border:2px dashed #11150f;background:rgba(17,21,15,.04)}.sp-chart-circle-value{position:absolute;top:50%;transform:translate(-50%,-50%);font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}.sp-chart-circle-value.left-only{left:60px}.sp-chart-circle-value.both{left:160px}.sp-chart-circle-value.right-only{left:260px}.sp-chart-overlap-legend>div{display:flex;justify-content:space-between;gap:12px;min-height:36px;align-items:center;border-top:1px solid rgba(17,21,15,.08);font-size:15.5px}.sp-chart-overlap-legend p{font-size:15px;line-height:1.5;color:#4b524b}.sp-chart-overlap-warning{grid-column:1/-1;margin:0;font-size:15px;line-height:1.5;font-weight:600;color:#2c322c}
.sp-chart-table-scroll{overflow-x:auto;margin-top:18px}.sp-chart-table{width:100%;border-collapse:collapse;font-size:16px;line-height:1.4;font-variant-numeric:tabular-nums}.sp-chart-table th{text-align:left}.sp-chart-table td,.sp-chart-table th:not(:first-child){text-align:right;white-space:nowrap}.sp-chart-table th,.sp-chart-table td{padding:11px 12px;border-bottom:1px solid rgba(17,21,15,.08)}.sp-chart-table th:first-child{padding-left:0}.sp-chart-table th:last-child,.sp-chart-table td:last-child{padding-right:0}.sp-chart-table thead th{font-size:14px;color:#4f5651;border-bottom:1px solid rgba(17,21,15,.2)}.sp-chart-table-total th,.sp-chart-table-total td{font-weight:800;border-bottom:0}
.sp-chart-symbol{flex:none}.sp-chart-change{margin:18px 0 0;font-size:16px;line-height:1.55;color:#1a201d;font-variant-numeric:tabular-nums}.sp-chart-foot{display:flex;justify-content:space-between;align-items:center;gap:14px 24px;margin-top:18px;padding-top:14px;border-top:1px solid rgba(17,21,15,.1)}.sp-chart-foot-text{display:flex;flex-direction:column;gap:6px;min-width:0;font-size:14.5px;line-height:1.5;color:#2c322c}.sp-chart-foot a{color:#0f7a45;font-weight:600;overflow-wrap:anywhere}.sp-chart-foot a:hover{color:#11832b;text-decoration:underline}.sp-chart-foot a:focus-visible{outline:2px solid #7c5cff;outline-offset:2px;border-radius:2px}
@media(max-width:767px){.sp-chart{padding:18px 18px 16px}.sp-chart-title{font-size:18px}.sp-chart-emphasis strong{font-size:34px}.sp-chart-comparison{grid-template-columns:minmax(0,1fr) max-content;gap:6px 10px}.sp-chart-comparison-row>span:first-child{grid-column:1/-1}.sp-chart-overlap{grid-template-columns:minmax(0,1fr);justify-items:center}.sp-chart-circles{width:280px;max-width:100%;height:auto;aspect-ratio:280/170}.sp-chart-circle{width:60.714286%;height:auto;aspect-ratio:1}.sp-chart-circle.right{left:39.285714%}.sp-chart-circle-value.left-only{left:19.642857%}.sp-chart-circle-value.both{left:50%}.sp-chart-circle-value.right-only{left:80.357143%}.sp-chart-overlap-legend{width:100%}.sp-chart-foot{flex-direction:column;align-items:flex-start}}
`;
