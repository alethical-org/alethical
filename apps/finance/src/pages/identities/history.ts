import type { Confirmation, Identity, PrintedKind, SplitPart } from './types';
import {
  coveredDates,
  coveredRows,
  day,
  named,
  period,
  plural,
  refOf,
  sourceOf,
  sumCounts,
} from './words';

export interface HistoryRow {
  key: string;
  at: string;
  date: string;
  text: string;
  evidence: string[];
}

/** Where a confirmation's evidence was found: the source the reviewer named, else the
 * saved file and row the server holds. */
export function confirmationSource(confirmation: Confirmation): string {
  return confirmation.source || sourceOf(confirmation);
}

export function confirmationNote(confirmation: Confirmation): string {
  return confirmation.basis ?? '';
}

function countable(part: SplitPart): boolean {
  return typeof part.confirmed_records === 'number' && Number.isFinite(part.confirmed_records);
}

function confirmationsOf(identity: Identity, kind: PrintedKind, name: string) {
  return (identity.confirmations ?? []).filter(
    (confirmation) => confirmation.record_kind === kind && confirmation.record_key === name,
  );
}

function evidenceLines(note: unknown, source: unknown): string[] {
  return [
    typeof note === 'string' && note && `Evidence: ${note}`,
    typeof source === 'string' && source && `Source: ${source}`,
  ].filter(Boolean) as string[];
}

/**
 * The history of 1 printed name, newest first, from the identities that hold or held
 * its records: each confirmation (or the creation it came with), each withdrawal with
 * its reason and the earlier confirmations' evidence, each merge into those identities
 * and each 2-part split that made them. Identities are named with their reference,
 * never their id. Who made a change is never served or shown.
 */
export function historyRows(
  identities: ReadonlyMap<string, Identity>,
  kind: PrintedKind,
  name: string,
  total: number,
): HistoryRow[] {
  const rows: HistoryRow[] = [];
  const seen = new Set<string>();
  const withdrawals = new Map<
    string,
    { at: string; identity: Identity; reason: string; source: string | null; items: Confirmation[] }
  >();
  for (const identity of identities.values()) {
    if (identity.status === 'merged') continue;
    const history = identity.history ?? [];
    const createdWith =
      history[0]?.action === 'created' && !history[0].detail?.split_from
        ? history.find((event) => event.action === 'confirmed')?.detail?.confirmation_id
        : null;
    for (const confirmation of confirmationsOf(identity, kind, name)) {
      if (seen.has(confirmation.id)) continue;
      seen.add(confirmation.id);
      const holder = identities.get(confirmation.identity_id) ?? identity;
      const k = coveredRows(confirmation);
      // Every event stays; a count resting on a file that is not held is dropped, never
      // printed as 0 (settled wording row 27).
      const counted = k === null ? '' : ` for ${k} of ${total} records`;
      const scope = `${counted}, ${period(coveredDates(confirmation))}`;
      if (!confirmation.replaces && confirmation.checked_at) {
        rows.push({
          key: `confirm|${confirmation.id}`,
          at: confirmation.checked_at,
          date: day(confirmation.checked_at) ?? '',
          text:
            createdWith === confirmation.id && holder.id === identity.id
              ? `Created ${named(holder)} and confirmed this name as it${scope}`
              : `Confirmed as ${named(holder)}${scope}`,
          evidence: [
            `Evidence: ${confirmationNote(confirmation)}`,
            `Source: ${confirmationSource(confirmation)}`,
          ],
        });
      }
      if (
        confirmation.status === 'withdrawn' &&
        !confirmation.replaced_by &&
        confirmation.withdrawn_at
      ) {
        const group = `${holder.id}|${confirmation.withdrawal_reason ?? ''}|${confirmation.withdrawal_source ?? ''}|${day(confirmation.withdrawn_at)}`;
        const entry = withdrawals.get(group) ?? {
          at: confirmation.withdrawn_at,
          identity: holder,
          reason: confirmation.withdrawal_reason ?? '',
          source: confirmation.withdrawal_source ?? null,
          items: [],
        };
        entry.items.push(confirmation);
        withdrawals.set(group, entry);
      }
    }
    for (const event of history) {
      const detail = event.detail ?? {};
      const references = event.references ?? {};
      if (
        event.action === 'merged' &&
        detail.into === identity.id &&
        typeof detail.from === 'string'
      ) {
        const from = detail.from;
        const fromName = identities.get(from)?.name ?? null;
        const fromLabel = { name: fromName ?? references[from] ?? '', reference: references[from] };
        if (!fromLabel.name) continue;
        const moved = sumCounts(
          (identity.confirmations ?? [])
            .filter((c) => c.identity_id === from && c.status === 'confirmed')
            .map((c) => (c.records ? coveredRows(c) : 1)),
        );
        const movedText =
          moved === null
            ? `confirmed records moved to ${refOf(identity)}`
            : `${plural(moved, 'confirmed record', 'confirmed records')} moved`;
        rows.push({
          key: `merge|${from}|${identity.id}`,
          at: event.at ?? '',
          date: day(event.at) ?? '',
          text: `${fromName ? named(fromLabel) : fromLabel.name} merged into ${named(identity)}; ${movedText} with their own evidence and dates; ${refOf(fromLabel)} now opens ${refOf(identity)}`,
          evidence: evidenceLines(detail.reason, detail.source),
        });
      }
      if (event.action === 'created' && typeof detail.split_from === 'string') {
        const old = identities.get(detail.split_from);
        const split = old?.history?.find((item) => item.action === 'split');
        const parts = old?.split_into ?? [];
        if (!old || !split || parts.length !== 2 || seen.has(`split|${old.id}`)) continue;
        seen.add(`split|${old.id}`);
        // The split's own order: the part that kept the records first, the new one second.
        const [stay, moved] = parts;
        // A count is printed only as served. A part whose file is not held, or that was
        // later merged or split, has none: it is named by its reference alone and never
        // reads as 0 (settled wording row 28).
        const movedText = countable(moved)
          ? `${plural(moved.confirmed_records as number, 'record', 'records')} moved to ${named(moved)}`
          : `records moved to ${refOf(moved)}`;
        const stayText = countable(stay)
          ? `${plural(stay.confirmed_records as number, 'record', 'records')} ${stay.confirmed_records === 1 ? 'stays' : 'stay'} with ${named(stay)}`
          : `records stay with ${refOf(stay)}`;
        rows.push({
          key: `split|${old.id}`,
          at: split.at ?? '',
          date: day(split.at) ?? '',
          text: `Split: ${movedText}; ${stayText}; ${refOf(old)} now opens a choice of both`,
          evidence: evidenceLines(split.detail?.reason, split.detail?.source),
        });
      }
    }
  }
  for (const [group, entry] of withdrawals) {
    const k = sumCounts(entry.items.map(coveredRows));
    rows.push({
      key: `withdraw|${group}`,
      at: entry.at,
      date: day(entry.at) ?? '',
      text: `Confirmation as ${named(entry.identity)} withdrawn${k === null ? '' : ` for ${plural(k, 'record', 'records')}`}: ${entry.reason}`,
      evidence: [
        ...evidenceLines(entry.reason, entry.source),
        ...entry.items.map(
          (c) =>
            `Earlier confirmation${c.checked_at ? `, checked on ${day(c.checked_at)}` : ''}: ${confirmationNote(c)} · ${confirmationSource(c)}`,
        ),
      ],
    });
  }
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
