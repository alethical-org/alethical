import { formatMoney } from "../../ui/money";

/** Display only: retained source values and downloads keep their exact decimals. */
export function moneyLabel(value: string | null | undefined): string {
  if (value == null || !/^-?\d+(\.\d+)?$/.test(value)) return "Unavailable";
  return formatMoney(value) ?? "Unavailable";
}
export function reportedMoneyLabel(
  value: string | null | undefined,
  currency?: string | null,
): string {
  if (currency === "USD") return moneyLabel(value);
  if (value == null || !/^-?\d+(\.\d+)?$/.test(value)) return "Unavailable";
  const whole = BigInt(value.replace("-", "").split(".")[0]);
  return `${value.startsWith("-") ? "−" : ""}${whole.toLocaleString("en-US")} ${currency || "currency unavailable"}`;
}

export function dateLabel(value: string | null | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return "Unavailable";
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(date)
    : "Unavailable";
}

export const count = (value: number | null | undefined) =>
  value == null ? "Unavailable" : value.toLocaleString("en-US");
export const pageNumber = (value: string) =>
  /^\d+$/.test(value) ? Math.max(1, Math.min(1_000_000, Number(value))) : 1;
export const periodLabel = (
  start: string | null | undefined,
  end: string | null | undefined,
) => {
  if (!start || !end) return "Dates unavailable";
  const first = dateLabel(start);
  const last = dateLabel(end);
  return `${start.slice(0, 4) === end.slice(0, 4) ? first.replace(/, \d{4}$/, "") : first} to ${last}`;
};

/** Contiguous physical lines are ranges; separate source lines remain separate. */
export function lineLabel(values: number[]): string {
  const lines = [...new Set(values)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i];
    let last = first;
    while (lines[i + 1] === last + 1) last = lines[++i];
    ranges.push(first === last ? String(first) : `${first}–${last}`);
  }
  return `${lines.length === 1 ? "Line" : "Lines"} ${ranges.join(", ")}`;
}
