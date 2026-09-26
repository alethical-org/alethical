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
    // Fictional figures: these tests must never publish an unreviewed poster claim.
    const chart: ChartInput = {
      kind: 'parts',
      total: quantity(250),
      parts: [{ ...quantity(75), label: 'Example recipients' }],
      remainderLabel: 'Other example recipients',
    };
    const result = calculateChart(chart);
    expect(result).toMatchObject({
      kind: 'parts',
      parts: [{ value: 75, percent: 30 }],
      remainder: { value: 175, percent: 70 },
    });
    expect(chartDescription(chart)).toContain('Other example recipients: 175 USD (70%)');
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

  it('uses exact decimal arithmetic for parts, remainders, and differences', () => {
    const parts: ChartInput = {
      kind: 'parts',
      total: quantity(0.6),
      parts: [
        { ...quantity(0.1), label: 'First' },
        { ...quantity(0.2), label: 'Second' },
      ],
      remainderLabel: 'Other',
    };
    expect(calculateChart(parts)).toMatchObject({ remainder: { value: 0.3, percent: 50 } });
    expect(chartDescription(parts)).toContain('Other: 0.3 USD (50%)');

    const comparison: ChartInput = {
      kind: 'comparison',
      baseline: quantity(0.1),
      compared: quantity(0.3),
      baselineLabel: 'Before',
      comparedLabel: 'After',
      showPercentChange: true,
    };
    expect(calculateChart(comparison)).toMatchObject({ difference: 0.2, percentChange: 200 });
    expect(chartDescription(comparison)).toContain('Difference: 0.2 USD (200%)');
    expect(
      calculateChart({ ...comparison, baseline: quantity(0.3), compared: quantity(0.1) }),
    ).toMatchObject({ difference: -0.2 });
  });

  it('rejects quantities whose precision or size would change the printed number', () => {
    const parts: ChartInput = {
      kind: 'parts',
      total: quantity(1),
      parts: [{ ...quantity(0.1), label: 'Named' }],
      remainderLabel: 'Other',
    };
    expect(() =>
      calculateChart({ ...parts, parts: [{ ...quantity(0.001), label: 'Named' }] }),
    ).toThrow('precision');
    expect(() =>
      calculateChart({
        ...parts,
        total: quantity(1, 'people'),
        parts: [{ ...quantity(0.12345, 'people'), label: 'Named' }],
      }),
    ).toThrow('precision');
    expect(() => calculateChart({ ...parts, total: quantity(100_000_000_000_000) })).toThrow(
      'safe range',
    );
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
      leftLabel: 'Gave to A',
      rightLabel: 'Gave to B',
      leftTotal: 100,
      rightTotal: 80,
      leftOnly: 60,
      rightOnly: 40,
      both: 40,
      union: 140,
    });
    expect(chartDescription(base)).toContain('Gave to A contains 100 organizations');
    expect(chartDescription(base)).toContain('Gave to B contains 80 organizations');
    expect(chartDescription(base)).toContain('Gave to B only: 40 organizations');
    expect(chartDescription(base)).toContain('both groups: 40 organizations');
    expect(chartDescription(base)).toContain('Diagram shows overlap, not relative group sizes.');
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
