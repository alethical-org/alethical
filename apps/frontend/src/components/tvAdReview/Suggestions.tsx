import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
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
const MATCHES: Record<string, string> = {
  normalized_exact: 'Same name',
  exact_amount: 'Same amount',
  exact_date: 'Same date',
  within_stated_flight_dates: 'Date within the printed flight dates',
};
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

function Card({
  children,
  status,
  useLabel,
  dismissLabel,
  disabled,
  onUse,
  onDismiss,
}: {
  children: ReactNode;
  status?: string;
  useLabel: string;
  dismissLabel: string;
  disabled: boolean;
  onUse?: () => void;
  onDismiss: () => void;
}) {
  return (
    <View style={s.card}>
      <Text style={s.note}>Suggested · Not checked</Text>
      {children}
      {status ? <Text style={s.body}>{status}</Text> : null}
      <View style={s.row}>
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
      {shown.map((item) => (
        <View key={keyOf(item)}>{render(item)}</View>
      ))}
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
      intro="Machine-read values from the original. Using one copies it into the form below; check it against the prepared page before saving."
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
          status={
            item.already_checked
              ? 'Already checked on this copy'
              : !item.in_safe_text
                ? `This line is not in the safe text for page ${item.page}. Edit the quote to match the safe text before saving.`
                : item.field === 'organization_address'
                  ? 'Add the organization named in the address and its printed role before saving'
                  : undefined
          }
        >
          <Text style={s.label}>{sentence(factLabel(item.field))}</Text>
          <Text selectable style={s.body}>
            {item.value}
          </Text>
          <Text selectable style={s.note}>
            Page {item.page} · “{item.quote}”
          </Text>
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
      intro="Registered committees whose name has the same spelling as the printed advertiser or payer"
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
          status={
            item.already_connected
              ? 'Already connected to this copy'
              : !item.in_safe_text
                ? `This line is not in the safe text for page ${item.evidence.page}. Edit the quote to match the safe text before saving.`
                : undefined
          }
        >
          <Text style={s.label}>{item.name}</Text>
          <Text style={s.note}>
            Registration {item.registration_number}
            {item.office ? ` · ${item.office}` : ''}
            {item.district ? ` ${item.district}` : ''}
            {item.terminated ? ' · Registration ended' : ''}
          </Text>
          <Text selectable style={s.note}>
            Same spelling as the printed {factLabel(item.evidence.field)} on page{' '}
            {item.evidence.page} ({item.evidence.source === 'checked' ? 'Checked' : 'Machine-read'}
            ): “{item.evidence.quote}”
          </Text>
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
      render={(item) => (
        <Card
          disabled={shared.disabled}
          useLabel={`Use suggestion: expense row ${item.source_row_number}`}
          dismissLabel={`Dismiss suggestion: expense row ${item.source_row_number}`}
          onUse={item.already_connected || !item.evidence ? undefined : () => onUse(item)}
          onDismiss={() => shared.onDismiss(expenseKey(item))}
          status={
            item.already_connected
              ? 'Already connected to this copy'
              : item.existing_link_status === 'rejected'
                ? 'An earlier review rejected this match'
                : item.evidence && !item.in_safe_text
                  ? `This line is not in the safe text for page ${item.evidence.page}. Edit the quote to match the safe text before saving.`
                  : undefined
          }
        >
          <Text style={s.label}>
            {item.source_dataset === 'independent_expenditures'
              ? 'Independent expenditure'
              : 'Campaign expense'}{' '}
            · row {item.source_row_number}
          </Text>
          {item.fields.map((field) => (
            <Text key={field.label} selectable style={s.body}>
              {field.label}: {shown(field.label, field.value)}
            </Text>
          ))}
          {item.matches.map((match, index) => (
            <Text key={index} selectable style={s.note}>
              {MATCHES[match.match] ?? match.match}: printed {factLabel(match.fcc_field)} “
              {shown(match.fcc_field, match.fcc_value)}” on page {match.page}, reported “
              {shown(match.fcc_field, match.expense_value)}”
            </Text>
          ))}
        </Card>
      )}
    />
  );
}
