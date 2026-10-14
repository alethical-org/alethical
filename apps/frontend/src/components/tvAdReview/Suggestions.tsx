import { Fragment, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme as t } from '../../theme/tokens';
import { ReviewAction, reviewStyles as s } from './ReviewControls';
import {
  factLabel,
  type ReviewSuggestions,
  type SuggestedCommittee,
  type SuggestedExpense,
  type SuggestedFact,
} from './types';

/** Private reviewer aids. Using one only fills the form; every check stays the reviewer's. */
export type SuggestionState = {
  copyId: string;
  data?: ReviewSuggestions;
  busy: boolean;
  error: boolean;
};

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const money = (value: string) => {
  const amount = Number(value);
  return /^-?\d+(?:\.\d+)?$/.test(value) && Number.isFinite(amount)
    ? amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    : value;
};
const day = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match
    ? new Date(Date.UTC(+match[1], +match[2] - 1, +match[3])).toLocaleDateString('en-US', {
        timeZone: 'UTC',
        dateStyle: 'medium',
      })
    : value;
};
/** Display only; the stored and matched values stay exactly as returned. */
const shown = (field: string, value: string) =>
  /amount$/i.test(field) ? money(value) : /date$/i.test(field) ? day(value) : value;
const list = (items: number[]) =>
  items.length < 2
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
/** Machine reading repeats a value on each page; the card names the other pages once. */
const alsoOn = (pages: number[] | undefined, page: number) => {
  const others = (pages ?? []).filter((item) => item !== page);
  return others.length
    ? `Also printed on ${others.length === 1 ? 'page' : 'pages'} ${list(others)}`
    : null;
};
const MATCHES: Record<string, string> = {
  normalized_exact: 'Same name',
  exact_amount: 'Same amount',
  exact_date: 'Same date',
  within_stated_flight_dates: 'Date within the printed flight dates',
};
const identical = (match: SuggestedExpense['matches'][number]) =>
  match.match === 'exact_amount'
    ? Number(match.fcc_value) === Number(match.expense_value)
    : match.match !== 'within_stated_flight_dates' && match.fcc_value === match.expense_value;
/** Identical values print once, in the grid; only a difference in form prints both. */
function matchLines(matches: SuggestedExpense['matches']) {
  const pages = new Map<number, string[]>();
  const lines: string[] = [];
  for (const match of matches) {
    if (identical(match)) {
      const fields = pages.get(match.page) ?? [];
      if (!fields.includes(factLabel(match.fcc_field))) fields.push(factLabel(match.fcc_field));
      pages.set(match.page, fields);
    } else {
      lines.push(
        `${MATCHES[match.match] ?? match.match}: printed ${factLabel(match.fcc_field)} “${shown(
          match.fcc_field,
          match.fcc_value,
        )}” on page ${match.page}, reported ${shown(
          match.fcc_field === 'flight_dates' ? 'date' : match.fcc_field,
          match.expense_value,
        )}`,
      );
    }
  }
  return [
    ...[...pages].map(([page, fields]) => `Matches page ${page}: ${fields.join(', ')}`),
    ...lines,
  ];
}
const EXPENSE_REASONS: Record<string, string> = {
  extraction_not_found: 'No machine reading is saved for this file, so no expense is suggested',
  need_page_grounded_name_and_amount_or_date:
    'Machine reading found no printed name with an amount or date to compare',
  published_finance_release_unavailable: 'Campaign-money records are unavailable right now',
  no_supported_pairing_in_bounded_current_release_search:
    'No reported expense has the same name and the same amount or date',
};

export const factKey = (item: SuggestedFact) =>
  `fact:${item.field}:${item.value}:${item.page}:${item.quote}`;
export const committeeKey = (item: SuggestedCommittee) =>
  `committee:${item.registration_number}:${item.evidence.field}:${item.evidence.page}:${item.evidence.quote}`;
export const expenseKey = (item: SuggestedExpense) => `expense:${item.target_id}`;

const c = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(17,21,15,0.32)',
    borderRadius: 12,
    backgroundColor: '#ffffff',
    paddingVertical: 16,
    paddingHorizontal: 17,
  },
  status: {
    fontFamily: t.typography.ui,
    fontSize: 14.5,
    lineHeight: 21,
    fontWeight: '600',
    color: '#7a5a12',
  },
  kind: {
    fontFamily: t.typography.ui,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: '#4f5651',
  },
  value: {
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
    color: '#11150f',
    fontVariant: ['tabular-nums'],
  },
  line: {
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 21,
    color: '#4f5651',
    fontVariant: ['tabular-nums'],
  },
  warn: {
    fontFamily: t.typography.ui,
    fontSize: 14.5,
    lineHeight: 21,
    fontWeight: '600',
    color: '#7a5a12',
  },
  info: {
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 21,
    color: '#4f5651',
  },
  match: {
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 21,
    color: '#2c322c',
    fontVariant: ['tabular-nums'],
  },
});
const wrap = { overflowWrap: 'anywhere' } as object;
type Notice = { text: string; tone: 'warn' | 'info' };
const missingLine = (page: number): Notice => ({
  text: `This quote is not in the safe text for page ${page}. Edit it to match before saving.`,
  tone: 'warn',
});

function Card({
  children,
  notice,
  useLabel,
  dismissLabel,
  disabled,
  onUse,
  onDismiss,
}: {
  children: ReactNode;
  notice?: Notice;
  useLabel: string;
  dismissLabel: string;
  disabled: boolean;
  onUse?: () => void;
  onDismiss: () => void;
}) {
  return (
    <View style={c.card}>
      <Text style={c.status}>Not checked</Text>
      <View style={{ marginTop: 8 }}>{children}</View>
      {notice ? (
        <Text style={[notice.tone === 'warn' ? c.warn : c.info, { marginTop: 8 }]}>
          {notice.text}
        </Text>
      ) : null}
      <View style={[s.row, { marginTop: 14 }]}>
        {onUse ? (
          <ReviewAction
            label="Use suggestion"
            accessibilityLabel={useLabel}
            disabled={disabled}
            onPress={onUse}
          />
        ) : null}
        <ReviewAction
          label="Dismiss"
          accessibilityLabel={dismissLabel}
          disabled={disabled}
          onPress={onDismiss}
        />
      </View>
    </View>
  );
}

function Group<T>({
  title,
  intro,
  state,
  items,
  keyOf,
  dismissed,
  onRestore,
  empty,
  disabled,
  onRetry,
  render,
}: {
  title: string;
  intro: string;
  state: SuggestionState | null;
  items: T[];
  keyOf(item: T): string;
  dismissed: Set<string>;
  onRestore(keys: string[]): void;
  empty: string;
  disabled: boolean;
  onRetry(): void;
  render(item: T): ReactNode;
}) {
  const hidden = items.filter((item) => dismissed.has(keyOf(item)));
  const shown = items.filter((item) => !dismissed.has(keyOf(item)));
  return (
    <View style={s.stack}>
      <View style={{ gap: 6 }}>
        <Text accessibilityRole="header" aria-level={3} style={s.label}>
          {title}
        </Text>
        <Text style={s.note}>{intro}</Text>
        <View accessibilityLiveRegion="polite">
          <Text style={s.note}>
            {state?.busy
              ? state.data
                ? 'Updating suggestions; the earlier list remains below'
                : 'Loading suggestions…'
              : state?.error
                ? state.data
                  ? 'We couldn’t update the suggestions. The earlier list remains below.'
                  : 'We couldn’t load suggestions. You can still type each value.'
                : state?.data && !items.length
                  ? empty
                  : ''}
          </Text>
        </View>
      </View>
      {state?.error ? <ReviewAction label="Retry suggestions" onPress={onRetry} /> : null}
      {shown.length ? (
        <View style={{ gap: 12 }}>
          {shown.map((item) => (
            <View key={keyOf(item)}>{render(item)}</View>
          ))}
        </View>
      ) : null}
      {hidden.length ? (
        <ReviewAction
          label={`Show ${hidden.length} dismissed ${hidden.length === 1 ? 'suggestion' : 'suggestions'}`}
          disabled={disabled}
          onPress={() => onRestore(hidden.map(keyOf))}
        />
      ) : null}
    </View>
  );
}

type Shared = {
  state: SuggestionState | null;
  dismissed: Set<string>;
  disabled: boolean;
  onDismiss(key: string): void;
  onRestore(keys: string[]): void;
  onRetry(): void;
};

export function FactSuggestions({
  onUse,
  ...shared
}: Shared & { onUse(item: SuggestedFact): void }) {
  return (
    <Group
      {...shared}
      title="Suggested facts"
      intro="Machine-read from the original. Use suggestion copies a value into the form below."
      items={shared.state?.data?.facts ?? []}
      keyOf={factKey}
      empty="Machine reading found no facts on this file"
      render={(item) => (
        <Card
          disabled={shared.disabled}
          useLabel={`Use suggestion: ${factLabel(item.field)} ${item.value}`}
          dismissLabel={`Dismiss suggestion: ${factLabel(item.field)} ${item.value}`}
          onUse={item.already_checked ? undefined : () => onUse(item)}
          onDismiss={() => shared.onDismiss(factKey(item))}
          notice={
            item.already_checked
              ? { text: 'Already checked on this copy', tone: 'info' }
              : !item.in_safe_text
                ? missingLine(item.page)
                : item.field === 'organization_address'
                  ? {
                      text: 'Add the organization named in the address and its printed role before saving',
                      tone: 'info',
                    }
                  : undefined
          }
        >
          <Text style={c.kind}>{sentence(factLabel(item.field))}</Text>
          <Text selectable style={[c.value, wrap, { marginTop: 2 }]}>
            {item.value}
          </Text>
          <Text selectable style={[c.line, wrap, { marginTop: 6 }]}>
            Page {item.page} · “{item.quote}”
          </Text>
          {alsoOn(item.pages, item.page) ? (
            <Text style={[c.line, { marginTop: 2 }]}>{alsoOn(item.pages, item.page)}</Text>
          ) : null}
        </Card>
      )}
    />
  );
}

export function CommitteeSuggestions({
  onUse,
  ...shared
}: Shared & { onUse(item: SuggestedCommittee): void }) {
  return (
    <Group
      {...shared}
      title="Possible committees"
      intro="Registered committees with the same spelling as the printed advertiser or payer"
      items={shared.state?.data?.committees ?? []}
      keyOf={committeeKey}
      empty="No registered committee has the same spelling as the printed advertiser or payer"
      render={(item) => (
        <Card
          disabled={shared.disabled}
          useLabel={`Use suggestion: committee ${item.name}`}
          dismissLabel={`Dismiss suggestion: committee ${item.name}`}
          onUse={item.already_connected ? undefined : () => onUse(item)}
          onDismiss={() => shared.onDismiss(committeeKey(item))}
          notice={
            item.already_connected
              ? { text: 'Already connected to this copy', tone: 'info' }
              : !item.in_safe_text
                ? missingLine(item.evidence.page)
                : undefined
          }
        >
          <Text selectable style={[c.value, wrap]}>
            {item.name}
          </Text>
          <Text style={[c.line, { marginTop: 2 }]}>
            Registration {item.registration_number}
            {item.office ? ` · ${item.office}` : ''}
            {item.district ? ` ${item.district}` : ''}
            {item.terminated ? ' · Registration ended' : ''}
          </Text>
          <Text selectable style={[c.line, wrap, { marginTop: 6 }]}>
            Page {item.evidence.page} · printed {factLabel(item.evidence.field)}
            {item.evidence.source === 'checked' ? ' · Checked' : ''} · “{item.evidence.quote}”
          </Text>
          {alsoOn(item.pages, item.evidence.page) ? (
            <Text style={[c.line, { marginTop: 2 }]}>{alsoOn(item.pages, item.evidence.page)}</Text>
          ) : null}
        </Card>
      )}
    />
  );
}

export function ExpenseSuggestions({
  onUse,
  ...shared
}: Shared & { onUse(item: SuggestedExpense): void }) {
  const result = shared.state?.data?.expenses;
  return (
    <Group
      {...shared}
      title="Possible reported expenses"
      intro="Reported campaign expenses with the same printed name and the same amount or date. A match adds no expense and is not proof of payment."
      items={result?.suggestions ?? []}
      keyOf={expenseKey}
      empty={
        (result && EXPENSE_REASONS[result.reason]) ??
        'No reported expense is suggested for this file'
      }
      render={(item) => {
        const paidTo = item.fields.find((field) => field.label === 'Paid to')?.value;
        const amount = item.fields.find((field) => field.label === 'Amount')?.value;
        const name = `${paidTo ? `paid to ${paidTo}` : `row ${item.source_row_number}`}${
          amount ? `, ${shown('Amount', amount)}` : ''
        }`;
        return (
          <Card
            disabled={shared.disabled}
            useLabel={`Use suggestion: expense ${name}`}
            dismissLabel={`Dismiss suggestion: expense ${name}`}
            onUse={item.already_connected || !item.evidence ? undefined : () => onUse(item)}
            onDismiss={() => shared.onDismiss(expenseKey(item))}
            notice={
              item.already_connected
                ? { text: 'Already connected to this copy', tone: 'info' }
                : item.existing_link_status === 'rejected'
                  ? { text: 'An earlier review rejected this match', tone: 'warn' }
                  : item.evidence && !item.in_safe_text
                    ? missingLine(item.evidence.page)
                    : undefined
            }
          >
            <Text style={c.kind}>
              {item.source_dataset === 'independent_expenditures'
                ? 'Independent expenditure'
                : 'Campaign expense'}
            </Text>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'max-content minmax(0, 1fr)',
                gap: '4px 16px',
                marginTop: 6,
              }}
            >
              {item.fields.map((field) => (
                <Fragment key={field.label}>
                  <Text style={c.kind}>{field.label}</Text>
                  <Text selectable style={[c.match, wrap, { color: '#11150f', fontSize: 15.5 }]}>
                    {shown(field.label, field.value)}
                  </Text>
                </Fragment>
              ))}
            </div>
            {matchLines(item.matches).map((line) => (
              <Text key={line} selectable style={[c.match, wrap, { marginTop: 10 }]}>
                {line}
              </Text>
            ))}
          </Card>
        );
      }}
    />
  );
}
