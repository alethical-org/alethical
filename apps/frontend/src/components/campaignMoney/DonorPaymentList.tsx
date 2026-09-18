import { CAMPAIGN_MONEY_COLORS as c } from '../../lib/campaignMoneyColors';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useResponsive } from '../../hooks/useResponsive';
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
import { committeeSlug } from '../../lib/committeeMoneyShared';
import { formatDay, formatMoney, isAmountAboveZero } from '../../lib/legislatorCampaignMoney';
import { linkProps, routePath } from '../../navigation/links';
import { numericText, useDetailsStyles } from './detailsStyles';
import { moneyDetailsCopy as copy } from '../../lib/campaignMoneyDetailsCopy';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';
import { contentTabUnderline } from '../../theme/contentTabs';
import { LobbyingDonationContext } from '../lobbying/LobbyingDonationContext';

function wash(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16},${(value >> 8) & 255},${value & 255},0.12)`;
}

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
  const { isMobile } = useResponsive();
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
      const nextButton = tabButtons.current[next] as unknown as HTMLElement | null;
      nextButton?.focus?.({ preventScroll: true });
      nextButton?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
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
  const summaryColor = isExpenditures ? c.secondary : c[tab];
  if (ready && groups.length === 0) {
    return <Text style={s.body}>{copy.emptyLists}</Text>;
  }
  return (
    <View style={[s.section, styles.section]}>
      <View role="tablist" aria-label={copy.tabsLabel} style={styles.tabsScroll} {...tabKeys}>
        <View style={[styles.tabs, isMobile && styles.tabsMobile]}>
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
                styles.tab,
                Boolean('focused' in state && state.focused) && s.namesFocus,
                tab === item.id && styles.activeTab,
              ]}
            >
              {(state) => (
                <Text
                  style={[
                    s.controlText,
                    styles.tabLabel,
                    tab !== item.id &&
                      !(state as { hovered?: boolean }).hovered &&
                      styles.inactiveTab,
                  ]}
                >
                  {item.label}
                  {ready ? (
                    <Text
                      style={styles.tabCount}
                    >{` ${tabDetails(groups, item.id).nameCount}`}</Text>
                  ) : null}
                </Text>
              )}
            </Pressable>
          ))}
        </View>
      </View>
      <View nativeID={panelId} role="tabpanel" aria-label={current.label} style={styles.panel}>
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
                  Boolean('focused' in state && state.focused) && s.namesFocus,
                ]}
              >
                <Text style={s.controlText}>{copy.retry}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <>
            {data.paymentCount > 0 ? (
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
                <View
                  testID="payment-list-summary"
                  style={[styles.summary, { backgroundColor: wash(summaryColor) }]}
                >
                  <Text style={[s.body, styles.countText]}>
                    {copy.counts(data.nameCount, data.paymentCount)}
                  </Text>
                  <View style={styles.totalBlock}>
                    <View style={styles.totalRow}>
                      <Text style={styles.totalLabel}>{copy.tabTotal(isExpenditures)}</Text>
                      <Text testID="payment-list-total" style={[s.body, styles.totalAmount]}>
                        {formatMoney(data.amount) ?? copy.totalMissing}
                      </Text>
                    </View>
                    {isAmountAboveZero(data.inKindAmount) ? (
                      <Text style={[s.small, styles.goodsShare]}>
                        {copy.goodsShare(formatMoney(data.inKindAmount))}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </>
            ) : null}
            {isExpenditures && data.paymentCount > 0 ? (
              <Text style={[s.small, styles.listedSpendingNote]}>{copy.listedSpendingNote}</Text>
            ) : null}
            {visible.length ? (
              <View style={styles.list}>
                {visible.map((group, index) => (
                  <PaymentGroup
                    key={group.key}
                    group={group}
                    first={index === 0}
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
              <Text style={[s.body, styles.emptyList]}>
                {query ? copy.noSearchMatch : copy.emptyTab(current.emptyWord, year)}
              </Text>
            )}
            {!showAll && shown.length > 10 ? (
              <Pressable
                accessibilityRole="button"
                style={(state) => [
                  s.control,
                  styles.showMore,
                  Boolean('hovered' in state && state.hovered) && styles.showMoreHover,
                  Boolean('focused' in state && state.focused) && s.namesFocus,
                ]}
                onPress={() => setShowAll(true)}
              >
                <Text style={[s.controlText, styles.showMoreText]}>
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
  first,
  year,
  expanded,
  onToggle,
}: {
  group: MoneyDetailsGroup;
  first: boolean;
  year: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const s = useDetailsStyles();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { isMobile } = useResponsive();
  const slug =
    group.tab !== 'lobbyists' && group.linkableRegistrationNumber
      ? committeeSlug(group.name, group.linkableRegistrationNumber)
      : null;
  const href = slug ? routePath.moneyCommittee(slug, { year: String(year) }) : null;
  const count = group.payments.length;
  const [hovered, setHovered] = useState(false);
  const details = [
    ...group.employers,
    ...(group.types.includes('Candidate Committee') ? [copy.candidateCommittee] : []),
    ...(group.tab === 'other' ? group.types.filter(Boolean) : []),
    copy.payments(count),
  ].join(' · ');
  return (
    <View style={!first && styles.group}>
      <View
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        style={[styles.groupHead, hovered && styles.groupHovered]}
      >
        <View style={styles.identity}>
          {href && slug ? (
            <Text
              style={[s.name, s.link, numericText(group.name), styles.name, styles.nameLink]}
              {...linkProps(href, () =>
                navigation.navigate('CommitteeMoney', { slug, year: String(year) }),
              )}
            >
              {group.name}
            </Text>
          ) : (
            <Text style={[s.name, numericText(group.name), styles.name]}>{group.name}</Text>
          )}
          <Text style={[s.small, styles.rowDetails]}>{details}</Text>
        </View>
        <Text style={[s.amount, styles.groupAmount]}>
          {formatMoney(group.amount) ?? copy.amountMissing}
        </Text>
        <Pressable
          onPress={onToggle}
          aria-expanded={expanded}
          accessibilityRole="button"
          accessibilityLabel={copy.expandPayments(expanded, count, group.name)}
          style={(state) => [
            styles.expand,
            Boolean('focused' in state && state.focused) && s.namesFocus,
          ]}
        >
          <View style={[styles.chevron, expanded && styles.chevronOpen]}>
            <Chevron size={18} />
          </View>
        </Pressable>
      </View>
      {expanded ? (
        <View style={styles.payments}>
          <LobbyingDonationContext group={group} year={year} />
          {group.payments.map((payment, index) => {
            const received = 'receivedOn' in payment;
            const date = received ? payment.receivedOn : payment.paidOn;
            const hasDetails =
              payment.inKind === 'Yes' ||
              (!received &&
                (payment.vendorCity ||
                  payment.vendorState ||
                  payment.purpose ||
                  payment.expenditureType));
            return (
              <View key={index} style={[styles.payment, isMobile && styles.paymentMobile]}>
                <Text style={[s.small, styles.paymentDate]}>
                  {formatDay(date) ?? copy.dateMissing}
                </Text>
                {hasDetails ? (
                  <View style={[styles.paymentDetails, isMobile && styles.paymentDetailsMobile]}>
                    {!received ? (
                      <>
                        {[payment.vendorCity, payment.vendorState].filter(Boolean).length ? (
                          <Text
                            style={[
                              s.small,
                              numericText([payment.vendorCity, payment.vendorState].join(' ')),
                              styles.paymentText,
                            ]}
                          >
                            {[payment.vendorCity, payment.vendorState].filter(Boolean).join(', ')}
                          </Text>
                        ) : null}
                        {payment.purpose ? (
                          <Text style={[s.small, numericText(payment.purpose), styles.paymentText]}>
                            {payment.purpose}
                          </Text>
                        ) : null}
                        {payment.expenditureType ? (
                          <Text
                            style={[
                              s.small,
                              numericText(payment.expenditureType),
                              styles.paymentText,
                            ]}
                          >
                            {payment.expenditureType}
                          </Text>
                        ) : null}
                      </>
                    ) : null}
                    {payment.inKind === 'Yes' ? (
                      <Text style={[s.small, s.lettered]}>{copy.inKindMarker}</Text>
                    ) : null}
                  </View>
                ) : null}
                <Text
                  style={[s.small, styles.paymentAmount, isMobile && styles.paymentAmountMobile]}
                >
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
        style={(state) => [
          styles.sortButton,
          Boolean('hovered' in state && state.hovered) && styles.sortHovered,
          Boolean('focused' in state && state.focused) && s.namesFocus,
        ]}
      >
        <Text style={[s.controlText, styles.sortLabel]}>{label}</Text>
        <Chevron size={16} />
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
                styles.menuItem,
                Boolean('hovered' in state && state.hovered) && styles.menuItemHovered,
                Boolean('focused' in state && state.focused) && s.namesFocus,
              ]}
            >
              <Text style={[s.controlText, styles.menuLabel]}>{item.label}</Text>
              {item.id === value ? (
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden>
                  <Path
                    d="m5 12 4 4L19 6"
                    stroke={c.link}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Chevron({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path
        d="m6 9 6 6 6-6"
        stroke={c.secondary}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  // The containing section supplies the other 18px of the 30px gap.
  section: { paddingTop: 12 },
  tabsScroll: {
    flexWrap: 'nowrap',
    margin: -4,
    padding: 4,
    ...({ overflowX: 'auto', scrollbarWidth: 'none' } as object),
  },
  tabs: {
    minWidth: '100%',
    ...({ width: 'max-content' } as object),
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 26,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.1)',
  },
  tabsMobile: { gap: 20 },
  tab: {
    minHeight: 44,
    flexShrink: 0,
    justifyContent: 'center',
    paddingHorizontal: 2,
    paddingTop: 0,
    paddingBottom: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    ...contentTabUnderline.base,
    marginBottom: -1,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    ...({ outlineStyle: 'none' } as object),
  },
  activeTab: { ...contentTabUnderline.selected },
  tabLabel: { fontSize: 17, fontWeight: '700', ...({ whiteSpace: 'nowrap' } as object) },
  tabCount: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  inactiveTab: { color: c.muted },
  panel: { gap: 14, minWidth: 0 },
  toolbar: { zIndex: 2, alignItems: 'stretch', justifyContent: 'flex-end' },
  search: {
    flexGrow: 1,
    flexBasis: 220,
    minWidth: 0,
    height: 46,
    paddingHorizontal: 12,
    paddingVertical: 0,
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
  sortWrap: { alignSelf: 'flex-start' },
  sortButton: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 16,
    paddingRight: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.18)',
    backgroundColor: c.background,
    ...({ outlineStyle: 'none' } as object),
  },
  sortLabel: { fontSize: 17, fontWeight: '700' },
  sortHovered: { borderColor: 'rgba(17,21,15,0.36)' },
  sortRaised: { zIndex: 3 },
  menu: {
    position: 'absolute',
    top: '100%',
    marginTop: 6,
    right: 0,
    minWidth: 220,
    backgroundColor: c.background,
    padding: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.12)',
    boxShadow: '0 12px 32px rgba(17,21,15,0.12)',
  },
  menuItem: {
    minHeight: 44,
    borderRadius: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    ...({ outlineStyle: 'none' } as object),
  },
  menuItemHovered: { backgroundColor: '#f3f5f4' },
  menuLabel: { fontSize: 17, fontWeight: '600' },
  summary: {
    marginTop: 2,
    marginHorizontal: -12,
    paddingTop: 11,
    paddingBottom: 12,
    paddingLeft: 14,
    paddingRight: 70,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    rowGap: 6,
    columnGap: 20,
  },
  countText: { color: c.text, fontWeight: '800', fontVariant: ['tabular-nums'] },
  totalBlock: { marginLeft: 'auto', minWidth: 0, maxWidth: '100%' },
  totalRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    rowGap: 4,
    columnGap: 12,
  },
  totalLabel: { minWidth: 0, flexShrink: 1, fontSize: 15, color: c.secondary, fontWeight: '400' },
  totalAmount: {
    minWidth: 0,
    marginLeft: 'auto',
    color: c.text,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  goodsShare: { color: c.secondary, textAlign: 'right' },
  listedSpendingNote: { marginTop: 0 },
  list: {
    marginTop: -2,
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,21,15,0.08)',
  },
  emptyList: { marginTop: -2 },
  group: { borderTopWidth: 1, borderTopColor: 'rgba(17,21,15,0.08)' },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    paddingVertical: 12,
    paddingHorizontal: 2,
    gap: 12,
  },
  groupHovered: { backgroundColor: '#fafbfa' },
  identity: { flex: 1, minWidth: 0, gap: 4 },
  name: { fontSize: 17, fontWeight: '700' },
  nameLink: { ...({ textUnderlineOffset: '2px' } as object) },
  rowDetails: {
    fontSize: 15,
    lineHeight: 22.5,
    fontWeight: '400',
    color: c.muted,
    fontVariant: ['tabular-nums'],
  },
  groupAmount: { fontSize: 17, fontWeight: '700' },
  expand: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    ...({ outlineStyle: 'none' } as object),
  },
  chevron: { ...({ transition: 'transform .15s' } as object) },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  payments: { marginLeft: 18, paddingBottom: 10 },
  payment: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,21,15,0.12)',
    borderStyle: 'dashed',
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  paymentMobile: { flexWrap: 'wrap', rowGap: 6 },
  paymentDate: {
    width: 104,
    flexShrink: 0,
    fontSize: 15,
    fontWeight: '800',
    color: c.text,
    fontVariant: ['tabular-nums'],
  },
  paymentDetails: { flex: 1, minWidth: 0, gap: 4 },
  paymentDetailsMobile: { flexBasis: '100%', ...({ order: 3 } as object) },
  paymentText: { fontSize: 15, fontWeight: '400', fontVariant: ['tabular-nums'] },
  paymentAmount: {
    marginLeft: 'auto',
    fontSize: 15,
    fontWeight: '700',
    color: c.text,
    fontVariant: ['tabular-nums'],
  },
  paymentAmountMobile: { ...({ order: 2 } as object) },
  showMore: {
    alignSelf: 'flex-start',
    paddingHorizontal: 18,
    paddingVertical: 0,
    borderRadius: 12,
    borderColor: 'rgba(17,21,15,0.16)',
  },
  showMoreHover: { borderColor: c.hoverBorder },
  showMoreText: { fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
