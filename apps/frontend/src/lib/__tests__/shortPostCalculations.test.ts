import { describe, expect, it } from 'vitest';
import {
  calculateChart,
  chartDescription,
  type ChartInput,
  type Quantity,
} from '../shortPostCalculations';

const period = { from: '2025-01-01', through: '2025-12-31', label: '2025 filings' };
const quantity = (value: number, unit = 'USD'): Quantity => ({ value, unit, period });

describe('Short post chart calculations', () => {
  it('uses an explicit denominator, rounds once, and names the unassigned remainder', () => {
    const chart: ChartInput = {
      kind: 'parts',
      total: quantity(7_686_858),
      parts: [{ ...quantity(3_040_579), label: '4 caucus committees' }],
      remainderLabel: 'Other recipients in the stated coverage',
    };
    const result = calculateChart(chart);
    expect(result).toMatchObject({
      kind: 'parts',
      parts: [{ value: 3_040_579, percent: 39.6 }],
      remainder: { value: 4_646_279, percent: 60.4 },
    });
    expect(chartDescription(chart)).toContain(
      'Other recipients in the stated coverage: 4646279 USD (60.4%)',
    );
  });

  it('rejects missing values, missing periods, incompatible units, and impossible parts', () => {
    const base: ChartInput = {
      kind: 'parts',
      total: quantity(100),
      parts: [{ ...quantity(60), label: 'Named' }],
      remainderLabel: 'Other',
    };
    expect(() => calculateChart({ ...base, total: quantity(Number.NaN) })).toThrow('finite');
    expect(() => calculateChart({ ...base, total: quantity(0) })).toThrow('positive total');
    expect(() =>
      calculateChart({ ...base, parts: [{ ...quantity(60, 'people'), label: 'Named' }] }),
    ).toThrow('units');
    expect(() =>
      calculateChart({ ...base, parts: [{ ...quantity(101), label: 'Named' }] }),
    ).toThrow('exceed');
    expect(() => calculateChart({ ...base, parts: [{ ...quantity(-1), label: 'Named' }] })).toThrow(
      'negative',
    );
    expect(() =>
      calculateChart({ ...base, total: { ...quantity(100), period: { ...period, through: '' } } }),
    ).toThrow('period');
    expect(() =>
      calculateChart({
        ...base,
        total: { ...quantity(100), period: { ...period, through: '2025-02-30' } },
      }),
    ).toThrow('period');
    expect(() => calculateChart({ ...base, remainderLabel: '' })).toThrow('remainder');
  });

  it('keeps each comparison period and permits corrected negative differences without false percentages', () => {
    const baseline = quantity(100);
    const compared = {
      ...quantity(90),
      period: { from: '2026-01-01', through: '2026-08-31', label: '2026 to August' },
    };
    expect(
      calculateChart({
        kind: 'comparison',
        baseline,
        compared,
        baselineLabel: '2025',
        comparedLabel: '2026',
        showPercentChange: true,
      }),
    ).toMatchObject({
      difference: -10,
      percentChange: -10,
      baseline: { period },
      compared: { period: compared.period },
    });
    expect(
      calculateChart({
        kind: 'comparison',
        baseline: quantity(-5),
        compared: quantity(4),
        baselineLabel: 'old net',
        comparedLabel: 'corrected net',
        showPercentChange: false,
      }),
    ).toMatchObject({ difference: 9 });
    expect(() =>
      calculateChart({
        kind: 'comparison',
        baseline: quantity(-5),
        compared: quantity(4),
        baselineLabel: 'old net',
        comparedLabel: 'corrected net',
        showPercentChange: true,
      }),
    ).toThrow('positive baseline');
  });

  it('keeps overlap counts coherent and refuses proportional area without a universe', () => {
    const base: ChartInput = {
      kind: 'overlap',
      left: quantity(100, 'organizations'),
      right: quantity(80, 'organizations'),
      both: quantity(40, 'organizations'),
      leftLabel: 'Gave to A',
      rightLabel: 'Gave to B',
      proportional: false,
    };
    expect(calculateChart(base)).toMatchObject({
      leftOnly: 60,
      rightOnly: 40,
      both: 40,
      union: 140,
    });
    expect(() => calculateChart({ ...base, proportional: true })).toThrow('universe');
    expect(() => calculateChart({ ...base, both: quantity(90, 'organizations') })).toThrow(
      'exceeds',
    );
    expect(() => calculateChart({ ...base, universe: quantity(139, 'organizations') })).toThrow(
      'smaller',
    );
    expect(
      calculateChart({ ...base, proportional: true, universe: quantity(200, 'organizations') }),
    ).toMatchObject({ neither: 60, universe: 200 });
  });
});
