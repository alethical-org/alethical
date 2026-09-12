import { CAMPAIGN_MONEY_COLORS as c } from '../../lib/campaignMoneyColors';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/types';

import {
  MONEY_DETAILS_SORTS,
  MONEY_DETAILS_TABS,
  sortMoneyGroups,
  tabDetails,
  type MoneyDetailsGroup,
  type MoneyDetailsSort,
  type MoneyDetailsTab,
} from '../../lib/campaignMoneyDetails';
import { committeeSlug } from '../../lib/committeeMoney';
import { formatDay, formatMoney, isAmountAboveZero } from '../../lib/legislatorCampaignMoney';
import { linkProps, routePath } from '../../navigation/links';
import { numericText, useDetailsStyles } from './detailsStyles';
import { moneyDetailsCopy as copy } from '../../lib/campaignMoneyDetailsCopy';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';

export function DonorPaymentList({
  groups,
  year,
  tab,
  onSelectTab,
  ready,
  failed,
  onRetry,
  selectedSort,
  onSelectSort,
}: {
  groups: MoneyDetailsGroup[];
  year: number;
  tab: MoneyDetailsTab;
  onSelectTab: (tab: MoneyDetailsTab) => void;
  ready: boolean;
  failed: boolean;
  onRetry: () => void;
  selectedSort?: MoneyDetailsSort;
  onSelectSort?: (sort: MoneyDetailsSort) => void;
}) {
  const s = useDetailsStyles();
  const [query, setQuery] = useState('');
  const { focused, focusProps } = useFieldFocus();
  const [localSort, setLocalSort] = useState<MoneyDetailsSort>('largest');
  const sort = selectedSort ?? localSort;
  const setSort = onSelectSort ?? setLocalSort;
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const panelId = React.useId();
  const tabButtons = useRef<(View | null)[]>([]);
  const tabs = MONEY_DETAILS_TABS.filter(
    (item) => item.id !== 'other' || groups.some((group) => group.tab === 'other'),
  );
  const keyboardTabIndex = Math.max(
    0,
    tabs.findIndex((item) => item.id === tab),
  );
  const tabKeys = {
    onKeyDown: (event: { key: string; preventDefault: () => void }) => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const currentIndex = keyboardTabIndex;
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      onSelectTab(tabs[next].id);
      (tabButtons.current[next] as unknown as { focus?: () => void } | null)?.focus?.();
    },
  };
  useEffect(() => {
    setQuery('');
    setShowAll(false);
    setOpen(new Set());
  }, [year, tab]);
  const data = tabDetails(groups, tab);
  const shown = sortMoneyGroups(data.groups, sort, query);
  const visible = showAll ? shown : shown.slice(0, 10);
  const current = MONEY_DETAILS_TABS.find((item) => item.id === tab)!;
  const isExpenditures = tab === 'expenditures';
  return (
    <View style={[s.section, s.rule]}>
      <View role="tablist" aria-label={copy.tabsLabel} style={s.horizontal} {...tabKeys}>
        {tabs.map((item, index) => (
          <Pressable
            key={item.id}
            ref={(node) => {
              tabButtons.current[index] = node;
            }}
            accessibilityRole="tab"
            aria-selected={tab === item.id}
            aria-controls={panelId}
            tabIndex={index === keyboardTabIndex ? 0 : -1}
            onPress={() => onSelectTab(item.id)}
            style={(state) => [
              s.control,
              tab === item.id && styles.active,
              Boolean('focused' in state && state.focused) && s.focus,
            ]}
          >
            <Text style={[s.controlText, ready && s.numeric]}>
              {item.label}
              {ready ? ` (${tabDetails(groups, item.id).nameCount})` : ''}
            </Text>
          </Pressable>
        ))}
      </View>
      <View nativeID={panelId} role="tabpanel" aria-label={current.label} style={s.section}>
        {!ready ? (
          <View style={s.section}>
            <Text accessibilityRole={failed ? 'alert' : undefined} style={s.body}>
              {failed ? copy.listFailed : copy.listLoading}
            </Text>
            {failed ? (
              <Pressable
                accessibilityRole="button"
                onPress={onRetry}
                style={(state) => [
                  s.control,
                  Boolean('focused' in state && state.focused) && s.focus,
                ]}
              >
                <Text style={s.controlText}>{copy.retry}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <>
            <View style={[s.horizontal, styles.toolbar]}>
              <TextInput
                value={query}
                onChangeText={(text) => {
                  setQuery(text);
                  setShowAll(false);
                }}
                {...focusProps}
                accessibilityLabel={copy.search}
                placeholder={copy.search}
                autoComplete="off"
                spellCheck={false}
                placeholderTextColor={c.muted}
                style={[
                  s.body,
                  styles.search,
                  fieldOutlineReset,
                  ...fieldFocusRing(focused),
                  focused && styles.searchFocused,
                ]}
              />
              <SortMenu key={`${year}-${tab}`} value={sort} onSelect={setSort} />
            </View>
            <View style={styles.counts}>
              <Text style={[s.small, s.numeric]}>
                {copy.counts(data.nameCount, data.paymentCount)}
              </Text>
              <Text style={[s.small, s.numeric]}>
                {copy.tabTotal(isExpenditures)}
                {formatMoney(data.amount) ?? copy.totalMissing}
                {isAmountAboveZero(data.inKindAmount)
                  ? copy.goodsShare(formatMoney(data.inKindAmount))
                  : ''}
              </Text>
            </View>
            {isExpenditures ? <Text style={s.small}>{copy.listedSpendingNote}</Text> : null}
            {visible.length ? (
              <View style={styles.rows}>
                {visible.map((group) => (
                  <PaymentGroup
                    key={group.key}
                    group={group}
                    year={year}
                    expanded={open.has(group.key)}
                    onToggle={() =>
                      setOpen((previous) => {
                        const next = new Set(previous);
                        if (next.has(group.key)) next.delete(group.key);
                        else next.add(group.key);
                        return next;
                      })
                    }
                  />
                ))}
              </View>
            ) : (
              <Text style={[s.body, !query && s.numeric]}>
                {query ? copy.noSearchMatch : copy.emptyTab(current.emptyWord, year)}
              </Text>
            )}
            {!showAll && shown.length > 10 ? (
              <Pressable
                accessibilityRole="button"
                style={(state) => [
                  s.control,
                  Boolean('focused' in state && state.focused) && s.focus,
                ]}
                onPress={() => setShowAll(true)}
              >
                <Text style={[s.controlText, s.numeric]}>
                  {copy.showRemaining(shown.length - 10, isExpenditures)}
                </Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

function PaymentGroup({
  group,
  year,
  expanded,
  onToggle,
}: {
  group: MoneyDetailsGroup;
  year: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const s = useDetailsStyles();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const slug = group.linkableRegistrationNumber
    ? committeeSlug(group.name, group.linkableRegistrationNumber)
    : null;
  const href = slug ? routePath.moneyCommittee(slug, { year: String(year) }) : null;
  const count = group.payments.length;
  return (
    <View style={styles.group}>
      <View style={styles.groupHead}>
        <View style={styles.identity}>
          {href && slug ? (
            <Text
              style={[s.name, s.link, styles.nameLink, numericText(group.name)]}
              {...linkProps(href, () =>
                navigation.navigate('CommitteeMoney', { slug, year: String(year) }),
              )}
            >
              {group.name}
            </Text>
          ) : (
            <Text style={[s.name, numericText(group.name)]}>{group.name}</Text>
          )}
          {group.employers.map((employer) => (
            <Text key={employer} style={[s.small, numericText(employer)]}>
              {employer}
            </Text>
          ))}
          {group.types.includes('Candidate Committee') ? (
            <Text style={s.small}>{copy.candidateCommittee}</Text>
          ) : null}
          {group.tab === 'other'
            ? group.types.filter(Boolean).map((kind) => (
                <Text key={kind} style={[s.small, numericText(kind)]}>
                  {kind}
                </Text>
              ))
            : null}
          <Text style={[s.small, s.numeric]}>{copy.payments(count)}</Text>
        </View>
        <Pressable
          onPress={onToggle}
          aria-expanded={expanded}
          accessibilityRole="button"
          accessibilityLabel={copy.expandPayments(expanded, count, group.name)}
          style={(state) => [
            styles.expand,
            Boolean('focused' in state && state.focused) && s.focus,
          ]}
        >
          <Text style={s.amount}>{formatMoney(group.amount) ?? copy.amountMissing}</Text>
          <Text aria-hidden style={[s.name, styles.chevron]}>
            {expanded ? '−' : '+'}
          </Text>
        </Pressable>
      </View>
      {expanded ? (
        <View>
          {group.payments.map((payment, index) => {
            const received = 'receivedOn' in payment;
            const date = received ? payment.receivedOn : payment.paidOn;
            return (
              <View key={index} style={styles.payment}>
                <View style={styles.identity}>
                  <Text style={[s.small, numericText(date)]}>
                    {formatDay(date) ?? copy.dateMissing}
                  </Text>
                  {!received ? (
                    <>
                      {[payment.vendorCity, payment.vendorState].filter(Boolean).length ? (
                        <Text
                          style={[
                            s.small,
                            numericText([payment.vendorCity, payment.vendorState].join(' ')),
                          ]}
                        >
                          {[payment.vendorCity, payment.vendorState].filter(Boolean).join(', ')}
                        </Text>
                      ) : null}
                      {payment.purpose ? (
                        <Text style={[s.small, numericText(payment.purpose)]}>
                          {payment.purpose}
                        </Text>
                      ) : null}
                      {payment.expenditureType ? (
                        <Text style={[s.small, numericText(payment.expenditureType)]}>
                          {payment.expenditureType}
                        </Text>
                      ) : null}
                    </>
                  ) : null}
                  {payment.inKind === 'Yes' ? (
                    <Text style={[s.small, s.lettered]}>{copy.inKindMarker}</Text>
                  ) : null}
                </View>
                <Text style={[s.small, s.numeric]}>
                  {formatMoney(payment.amount) ?? copy.amountMissing}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function SortMenu({
  value,
  onSelect,
}: {
  value: MoneyDetailsSort;
  onSelect: (value: MoneyDetailsSort) => void;
}) {
  const s = useDetailsStyles();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const button = useRef<View>(null);
  const options = useRef<(View | null)[]>([]);
  const focusButton = () => (button.current as unknown as { focus?: () => void } | null)?.focus?.();
  const close = () => {
    setOpen(false);
    focusButton();
  };
  useEffect(() => {
    if (open) (options.current[cursor] as unknown as { focus?: () => void } | null)?.focus?.();
  }, [open, cursor]);
  const label = MONEY_DETAILS_SORTS.find((item) => item.id === value)!.label;
  const keyEvents = {
    onKeyDown: (event: { key: string; preventDefault: () => void }) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setOpen(true);
        setCursor(
          (position) =>
            (position + (event.key === 'ArrowDown' ? 1 : -1) + MONEY_DETAILS_SORTS.length) %
            MONEY_DETAILS_SORTS.length,
        );
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        setCursor(event.key === 'Home' ? 0 : MONEY_DETAILS_SORTS.length - 1);
      }
      if (event.key === 'Tab') setOpen(false);
    },
  };
  return (
    <View style={[styles.sortWrap, open && styles.sortRaised]} {...keyEvents}>
      <Pressable
        ref={button}
        accessibilityRole="button"
        aria-haspopup="menu"
        aria-expanded={open}
        accessibilityLabel={copy.currentSort(label)}
        onPress={() => {
          setCursor(MONEY_DETAILS_SORTS.findIndex((item) => item.id === value));
          setOpen(!open);
        }}
        style={(state) => [s.control, Boolean('focused' in state && state.focused) && s.focus]}
      >
        <Text style={s.controlText}>{label}</Text>
      </Pressable>
      {open ? (
        <View role="menu" aria-label={copy.sort} style={styles.menu}>
          {MONEY_DETAILS_SORTS.map((item, index) => (
            <Pressable
              key={item.id}
              ref={(node) => {
                options.current[index] = node;
              }}
              role="menuitem"
              aria-label={copy.sortOption(item.label, item.id === value)}
              onPress={() => {
                onSelect(item.id);
                close();
              }}
              style={(state) => [
                s.control,
                styles.menuItem,
                Boolean('focused' in state && state.focused) && s.focus,
              ]}
            >
              <Text style={s.controlText}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  active: { borderColor: c.link, backgroundColor: c.tile },
  toolbar: { zIndex: 2, alignItems: 'stretch' },
  search: {
    flexGrow: 1,
    flexBasis: 220,
    minWidth: 0,
    minHeight: 46,
    padding: 12,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 10,
    backgroundColor: c.background,
  },
  searchFocused: {
    borderColor: c.fieldFocusBorder,
    borderBottomColor: c.fieldFocusBorder,
    boxShadow: `0 0 0 3px ${c.fieldFocusRing}`,
  },
  sortWrap: { minWidth: 170 },
  sortRaised: { zIndex: 3 },
  menu: {
    position: 'absolute',
    top: 50,
    right: 0,
    minWidth: 190,
    backgroundColor: c.background,
    padding: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    boxShadow: `0 8px 24px ${c.shadow}`,
  },
  menuItem: { borderWidth: 0 },
  counts: { gap: 8, backgroundColor: c.tile, padding: 16, borderRadius: 12 },
  rows: { gap: 10 },
  group: { borderWidth: 1, borderColor: c.border, borderRadius: 12, overflow: 'hidden' },
  groupHead: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  identity: { flex: 1, minWidth: 0, gap: 4 },
  nameLink: { minHeight: 44, paddingVertical: 10 },
  expand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 60,
    padding: 6,
    flexShrink: 1,
  },
  chevron: { width: 20, textAlign: 'center' },
  payment: {
    borderTopWidth: 1,
    borderTopColor: c.border,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
});
