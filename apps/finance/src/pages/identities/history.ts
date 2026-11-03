import type { Confirmation, Identity, PrintedKind } from './types';
import { coveredDates, coveredRows, day, period, plural, sourceOf, splitBasis } from './words';

export interface HistoryRow {
  key: string;
  at: string;
  date: string;
  text: string;
  evidence: string[];
}

/** Where a confirmation's evidence came from: the source the reviewer named, else the
 * saved file and row the server holds. */
export function confirmationSource(confirmation: Confirmation): string {
  return splitBasis(confirmation.basis).src ?? sourceOf(confirmation);
}

export function confirmationNote(confirmation: Confirmation): string {
  return splitBasis(confirmation.basis).note;
}

function confirmationsOf(identity: Identity, kind: PrintedKind, name: string) {
  return (identity.confirmations ?? []).filter(
    (confirmation) => confirmation.record_kind === kind && confirmation.record_key === name,
  );
}

function reasonLines(reason: unknown): string[] {
  const { note, src } = splitBasis(typeof reason === 'string' ? reason : '');
  return [note && `Evidence: ${note}`, src && `Source: ${src}`].filter(Boolean) as string[];
}

/**
 * The history of 1 printed name, newest first, from the identities that hold or held
 * its records: each confirmation (or the creation it came with), each withdrawal with
 * its reason and the earlier confirmations' evidence, each merge into those identities
 * and each 2-part split that made them. Who made a change is never served or shown.
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
    { at: string; identity: Identity; reason: string; items: Confirmation[] }
  >();
  const nameOf = (id: string) => identities.get(id)?.name ?? null;
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
      const scope = `for ${k} of ${total} records, ${period(coveredDates(confirmation))}`;
      const evidence = [
        `Evidence: ${confirmationNote(confirmation)}`,
        `Source: ${confirmationSource(confirmation)}`,
      ];
      if (!confirmation.replaces && confirmation.checked_at) {
        rows.push({
          key: `confirm|${confirmation.id}`,
          at: confirmation.checked_at,
          date: day(confirmation.checked_at) ?? '',
          text:
            createdWith === confirmation.id && holder.id === identity.id
              ? `Created ${holder.name} (${holder.id}) and confirmed this name as it ${scope}`
              : `Confirmed as ${holder.name} (${holder.id}) ${scope}`,
          evidence,
        });
      }
      if (
        confirmation.status === 'withdrawn' &&
        !confirmation.replaced_by &&
        confirmation.withdrawn_at
      ) {
        const group = `${holder.id}|${confirmation.withdrawal_reason ?? ''}|${day(confirmation.withdrawn_at)}`;
        const entry = withdrawals.get(group) ?? {
          at: confirmation.withdrawn_at,
          identity: holder,
          reason: confirmation.withdrawal_reason ?? '',
          items: [],
        };
        entry.items.push(confirmation);
        withdrawals.set(group, entry);
      }
    }
    for (const event of history) {
      const detail = event.detail ?? {};
      if (
        event.action === 'merged' &&
        detail.into === identity.id &&
        typeof detail.from === 'string'
      ) {
        const from = detail.from;
        const moved = (identity.confirmations ?? [])
          .filter((c) => c.identity_id === from && c.status === 'confirmed')
          .reduce((sum, c) => sum + (c.records ? coveredRows(c) : 1), 0);
        rows.push({
          key: `merge|${from}|${identity.id}`,
          at: event.at ?? '',
          date: day(event.at) ?? '',
          text: `${nameOf(from) ?? from} (${from}) merged into ${identity.name} (${identity.id}); ${plural(moved, 'confirmed record', 'confirmed records')} moved with their own evidence and dates; ${from} now opens ${identity.id}`,
          evidence: reasonLines(detail.reason),
        });
      }
      if (event.action === 'created' && typeof detail.split_from === 'string') {
        const old = identities.get(detail.split_from);
        const split = old?.history?.find((item) => item.action === 'split');
        const parts = (split?.detail?.parts ?? []) as Array<{
          id: string;
          confirmations: Array<{ to: string }>;
        }>;
        if (!old || !split || parts.length !== 2 || seen.has(`split|${old.id}`)) continue;
        seen.add(`split|${old.id}`);
        const rowsOf = (part: { id: string; confirmations: Array<{ to: string }> }) => {
          const holder = identities.get(part.id);
          return part.confirmations.reduce((sum, item) => {
            const found = holder?.confirmations?.find((c) => c.id === item.to);
            return sum + (found ? (found.records ? coveredRows(found) : 1) : 0);
          }, 0);
        };
        const [stay, moved] = parts;
        rows.push({
          key: `split|${old.id}`,
          at: split.at ?? '',
          date: day(split.at) ?? '',
          text: `Split: ${plural(rowsOf(moved), 'record', 'records')} moved to ${nameOf(moved.id) ?? moved.id} (${moved.id}); ${plural(rowsOf(stay), 'record', 'records')} stay with ${nameOf(stay.id) ?? stay.id} (${stay.id}); ${old.id} now opens a choice of both`,
          evidence: reasonLines(split.detail?.reason),
        });
      }
    }
  }
  for (const [group, entry] of withdrawals) {
    const k = entry.items.reduce((sum, c) => sum + coveredRows(c), 0);
    rows.push({
      key: `withdraw|${group}`,
      at: entry.at,
      date: day(entry.at) ?? '',
      text: `Confirmation as ${entry.identity.name} (${entry.identity.id}) withdrawn for ${plural(k, 'record', 'records')}: ${entry.reason}`,
      evidence: [
        `Evidence: ${entry.reason}`,
        ...entry.items.map(
          (c) =>
            `Earlier confirmation${c.checked_at ? `, checked on ${day(c.checked_at)}` : ''}: ${confirmationNote(c)} · ${confirmationSource(c)}`,
        ),
      ],
    });
  }
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
