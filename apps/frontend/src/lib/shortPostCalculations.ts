/** Pure calculations for Short post prose and quantitative graphics. */

export interface ReportingPeriod {
  from: string;
  through: string;
  label: string;
}

export interface Quantity {
  value: number;
  unit: string;
  period: ReportingPeriod;
}

export interface Part extends Quantity {
  label: string;
}

export type ChartInput =
  | {
      kind: 'parts';
      total: Quantity;
      parts: readonly Part[];
      remainderLabel: string;
      decimalPlaces?: number;
    }
  | {
      kind: 'comparison';
      baseline: Quantity;
      compared: Quantity;
      baselineLabel: string;
      comparedLabel: string;
      /** A percentage comparison needs a positive baseline. */
      showPercentChange: boolean;
      decimalPlaces?: number;
    }
  | {
      kind: 'overlap';
      left: Quantity;
      right: Quantity;
      both: Quantity;
      leftLabel: string;
      rightLabel: string;
      /** Required before an area or share can imply a complete universe. */
      universe?: Quantity;
      proportional: boolean;
    };

export type ChartResult =
  | {
      kind: 'parts';
      total: Quantity;
      parts: readonly { label: string; value: number; percent: number }[];
      remainder: { label: string; value: number; percent: number };
    }
  | {
      kind: 'comparison';
      baseline: Quantity;
      compared: Quantity;
      baselineLabel: string;
      comparedLabel: string;
      difference: number;
      percentChange?: number;
    }
  | {
      kind: 'overlap';
      unit: string;
      period: ReportingPeriod;
      leftLabel: string;
      rightLabel: string;
      leftTotal: number;
      rightTotal: number;
      leftOnly: number;
      rightOnly: number;
      both: number;
      neither?: number;
      union: number;
      universe?: number;
      proportional: boolean;
    };

export function isISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validQuantity(quantity: Quantity, name: string): void {
  if (!Number.isFinite(quantity.value)) throw new Error(`${name} needs a finite value`);
  if (!quantity.unit.trim()) throw new Error(`${name} needs a unit`);
  const { from, through, label } = quantity.period;
  if (!isISODate(from) || !isISODate(through)) {
    throw new Error(`${name} needs a complete reporting period`);
  }
  if (from > through || !label.trim()) throw new Error(`${name} needs a valid reporting period`);
}

function sameUnitAndPeriod(left: Quantity, right: Quantity): void {
  if (left.unit !== right.unit) throw new Error('quantities use different units');
  if (
    left.period.from !== right.period.from ||
    left.period.through !== right.period.through ||
    left.period.label !== right.period.label
  ) {
    throw new Error('quantities cover different reporting periods');
  }
}

function round(value: number, places: number): number {
  if (!Number.isInteger(places) || places < 0 || places > 4) {
    throw new Error('decimal places must be between 0 and 4');
  }
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

/** This one result supplies the body figures and the eventual chart geometry. */
export function calculateChart(input: ChartInput): ChartResult {
  if (input.kind === 'parts') {
    validQuantity(input.total, 'total');
    if (input.total.value <= 0) throw new Error('percentage needs an explicit positive total');
    if (!input.parts.length) throw new Error('parts need at least 1 category');
    if (!input.remainderLabel.trim()) throw new Error('remainder needs an explanation');
    let used = 0;
    const labels = new Set<string>();
    const parts = input.parts.map((part) => {
      validQuantity(part, part.label || 'part');
      sameUnitAndPeriod(input.total, part);
      if (!part.label.trim() || labels.has(part.label))
        throw new Error('parts need distinct labels');
      if (part.value < 0) throw new Error('parts cannot be negative');
      labels.add(part.label);
      used += part.value;
      return {
        label: part.label,
        value: part.value,
        percent: round((part.value / input.total.value) * 100, input.decimalPlaces ?? 1),
      };
    });
    if (labels.has(input.remainderLabel)) throw new Error('remainder label repeats a part');
    if (used > input.total.value + 1e-8) throw new Error('parts exceed their total');
    const remainderValue = Math.max(0, input.total.value - used);
    return {
      kind: 'parts',
      total: input.total,
      parts,
      remainder: {
        label: input.remainderLabel,
        value: remainderValue,
        percent: round((remainderValue / input.total.value) * 100, input.decimalPlaces ?? 1),
      },
    };
  }

  if (input.kind === 'comparison') {
    validQuantity(input.baseline, 'baseline');
    validQuantity(input.compared, 'compared value');
    if (input.baseline.unit !== input.compared.unit) {
      throw new Error('comparison uses different units');
    }
    if (!input.baselineLabel.trim() || !input.comparedLabel.trim()) {
      throw new Error('comparison needs both labels');
    }
    if (input.showPercentChange && (input.baseline.value <= 0 || input.compared.value < 0)) {
      throw new Error('percentage comparison needs nonnegative values and a positive baseline');
    }
    const difference = input.compared.value - input.baseline.value;
    return {
      kind: 'comparison',
      baseline: input.baseline,
      compared: input.compared,
      baselineLabel: input.baselineLabel,
      comparedLabel: input.comparedLabel,
      difference,
      ...(input.showPercentChange
        ? {
            percentChange: round(
              (difference / input.baseline.value) * 100,
              input.decimalPlaces ?? 1,
            ),
          }
        : {}),
    };
  }

  validQuantity(input.left, 'left set');
  validQuantity(input.right, 'right set');
  validQuantity(input.both, 'overlap');
  sameUnitAndPeriod(input.left, input.right);
  sameUnitAndPeriod(input.left, input.both);
  if (!input.leftLabel.trim() || !input.rightLabel.trim()) {
    throw new Error('overlap needs both set labels');
  }
  if (
    [input.left.value, input.right.value, input.both.value].some(
      (value) => !Number.isInteger(value) || value < 0,
    )
  ) {
    throw new Error('overlap needs nonnegative whole counts');
  }
  if (input.both.value > Math.min(input.left.value, input.right.value)) {
    throw new Error('overlap exceeds one of its sets');
  }
  const union = input.left.value + input.right.value - input.both.value;
  if (input.proportional && !input.universe) {
    throw new Error('proportional overlap needs an explicit universe');
  }
  if (input.universe) {
    validQuantity(input.universe, 'universe');
    sameUnitAndPeriod(input.left, input.universe);
    if (!Number.isInteger(input.universe.value) || input.universe.value < union) {
      throw new Error('universe is smaller than the union');
    }
  }
  return {
    kind: 'overlap',
    unit: input.left.unit,
    period: input.left.period,
    leftLabel: input.leftLabel,
    rightLabel: input.rightLabel,
    leftTotal: input.left.value,
    rightTotal: input.right.value,
    leftOnly: input.left.value - input.both.value,
    rightOnly: input.right.value - input.both.value,
    both: input.both.value,
    union,
    ...(input.universe
      ? { universe: input.universe.value, neither: input.universe.value - union }
      : {}),
    proportional: input.proportional,
  };
}

/** The accessible description is computed from the same result as the graphic and body numbers. */
export function chartDescription(input: ChartInput): string {
  const result = calculateChart(input);
  if (result.kind === 'parts') {
    const { unit, period } = result.total;
    const entries = [...result.parts, result.remainder];
    return `${result.total.value} ${unit}, ${period.label} (${period.from} through ${period.through}). ${entries
      .map((entry) => `${entry.label}: ${entry.value} ${unit} (${entry.percent}%)`)
      .join('; ')}.`;
  }
  if (result.kind === 'comparison') {
    return `${result.baselineLabel}: ${result.baseline.value} ${result.baseline.unit}, ${result.baseline.period.label} (${result.baseline.period.from} through ${result.baseline.period.through}). ${result.comparedLabel}: ${result.compared.value} ${result.compared.unit}, ${result.compared.period.label} (${result.compared.period.from} through ${result.compared.period.through}). Difference: ${result.difference} ${result.baseline.unit}${result.percentChange === undefined ? '' : ` (${result.percentChange}%)`}.`;
  }
  const { unit, period } = result;
  return `Overlap in ${period.label} (${period.from} through ${period.through}): ${result.leftLabel} contains ${result.leftTotal} ${unit}; ${result.rightLabel} contains ${result.rightTotal} ${unit}; ${result.leftLabel} only: ${result.leftOnly} ${unit}; ${result.rightLabel} only: ${result.rightOnly} ${unit}; both groups: ${result.both} ${unit}; union: ${result.union} ${unit}${result.neither === undefined ? '' : `; neither group: ${result.neither} ${unit} of ${result.universe} ${unit} in the stated universe`}.${result.proportional ? '' : ' Diagram shows overlap, not relative group sizes.'}`;
}
