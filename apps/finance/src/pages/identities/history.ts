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
    const history = identity.history ?? [];
    for (const confirmation of confirmationsOf(identity, kind, name)) {
      if (seen.has(confirmation.id)) continue;
      seen.add(confirmation.id);
      const holder = identities.get(confirmation.identity_id) ?? identity;
      const holderHistory = holder.history ?? [];
      const createdWith =
        holderHistory[0]?.action === 'created' && !holderHistory[0].detail?.split_from
          ? holderHistory.find((event) => event.action === 'confirmed')?.detail?.confirmation_id
          : null;
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
            createdWith === confirmation.id
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
        const fromIdentity = identities.get(from);
        const fromName = fromIdentity?.name ?? null;
        const fromLabel = {
          name: fromName ?? references[from] ?? '',
          reference: fromIdentity?.reference ?? references[from],
        };
        if (!fromLabel.name) continue;
        // Events do not save historical source-row counts. Today's confirmations
        // cannot establish how many records moved when this merge happened.
        const movedText = `confirmed records moved to ${refOf(identity)}`;
        rows.push({
          key: `merge|${from}|${identity.id}`,
          at: event.at ?? '',
          date: day(event.at) ?? '',
          text: `${fromName ? named(fromLabel) : fromLabel.name} merged into ${named(identity)}; ${movedText} with their own evidence and dates; ${refOf(fromLabel)} now opens ${refOf(identity)}`,
          evidence: evidenceLines(detail.reason, detail.source),
        });
      }
      if (event.action === 'created' && typeof detail.split_from === 'string') {
        // The identity it was split from is read with this one; when that read fails the
        // page says so with Try again (reads.ts), so the row is never silently lost.
        const old = identities.get(detail.split_from);
        const split = old?.history?.find((item) => item.action === 'split');
        if (!old || !split || seen.has(`split|${old.id}`)) continue;
        // Every part the split made, in the split's own order (the part that kept the
        // records first). A part the server no longer serves in split_into is named by
        // the split event's own references.
        const served = new Map((old.split_into ?? []).map((part) => [part.id, part]));
        const into = Array.isArray(split.detail?.into)
          ? (split.detail.into as unknown[]).filter((id): id is string => typeof id === 'string')
          : [...served.keys()];
        const references = split.references ?? {};
        const parts: SplitPart[] = into.map(
          (id) =>
            served.get(id) ?? {
              id,
              reference: references[id] ?? null,
              kind: old.kind,
              name: references[id] ?? '',
            },
        );
        if (parts.length < 2) continue;
        seen.add(`split|${old.id}`);
        const [stay, ...moved] = parts;
        // Current part counts change after later source updates and confirmations;
        // the split event does not save the counts at the time of the split.
        const movedText = (part: SplitPart) => `records moved to ${refOf(part)}`;
        const stayText = `records stay with ${refOf(stay)}`;
        // "a choice of both" is drawn for 2 parts; more parts read "a choice of all {n}".
        const choice = parts.length === 2 ? 'both' : `all ${parts.length}`;
        rows.push({
          key: `split|${old.id}`,
          at: split.at ?? '',
          date: day(split.at) ?? '',
          text: `Split: ${moved.map(movedText).join('; ')}; ${stayText}; ${refOf(old)} now opens a choice of ${choice}`,
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
