import { outsideSpendingReturnContext } from '../../hooks/useOutsideSpendingReturn';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { useOutsideSpendingRecord } from '../../hooks/useAppQueries';
import { useOutsideSpendingNames } from '../../hooks/useOutsideSpendingNames';
import { useHistoryScrollRestoration } from '../../hooks/useHistoryScrollRestoration';
import { useResponsive } from '../../hooks/useResponsive';
import { formatMoney } from '../../lib/legislatorCampaignMoney';
import { centralDateLabel, formatCount } from '../../lib/moneyLanding';
import { MONEY_SECTION_NAME } from '../../lib/moneySectionName';
import {
  OUTSIDE_SPENDING_HEADING,
  outsideSpendingPageNumber,
  outsideSpendingYear,
  RECORD_UNAVAILABLE_TITLE,
  RECORD_UNAVAILABLE_WHY,
  type OutsideSpendingRecordPage,
} from '../../lib/outsideSpending';
import {
  COMMITTEE_DEFINITION,
  HOW_TO_READ_OUTSIDE,
  NAME_WITHOUT_RECORD,
  OUTSIDE_BROWSE_INTRO,
  OUTSIDE_BROWSE_SCOPE,
  OUTSIDE_DOWNLOADS,
  OUTSIDE_LIMITS,
  OUTSIDE_OUTCOMES,
  outsideBrowseChange,
  outsideBrowseMode,
  outsideBrowsePeriod,
  type OutsideSpendingBrowseAddress,
} from '../../lib/outsideSpendingBrowse';
import { useDocumentTitle } from '../../navigation/documentTitle';
import { externalLinkProps, linkProps, routePath } from '../../navigation/links';
import type { RootScreenProps } from '../../navigation/types';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';

function Chevron({
  right = false,
  color = t.colors.text.secondary,
}: {
  right?: boolean;
  color?: string;
}) {
  return (
    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path
        d={right ? 'M9 5 L16 12 L9 19' : 'M15 5 L8 12 L15 19'}
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.action}>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

function Message({ title, body, retry }: { title: string; body?: string; retry?: () => void }) {
  return (
    <View style={styles.message} role={retry ? 'alert' : 'status'}>
      <Text style={styles.h2}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {retry ? <Action label="Try again" onPress={retry} /> : null}
    </View>
  );
}

export function OutsideSpendingBrowseScreen({
  navigation,
  route,
}: RootScreenProps<'OutsideSpending'>) {
  const { isMobile, isDesktop } = useResponsive();
  const address = route.params ?? {};
  const mode = outsideBrowseMode(address.browse);
  const year = outsideSpendingYear(address.year);
  const q = (address.q ?? '').trim().slice(0, 200);
  const requestedPage = outsideSpendingPageNumber(address.page);
  const [input, setInput] = useState(q);
  const { focused, focusProps } = useFieldFocus();
  const inputRef = useRef<TextInput>(null);
  const resultRef = useRef<View>(null);
  const pageChanged = useRef(false);
  const lastAccepted = useRef<OutsideSpendingRecordPage | null>(null);
  const lastYears = useRef<number[]>([]);
  const overview = useOutsideSpendingRecord({ year, sort: 'newest', page: 1 });
  if (overview.data) lastAccepted.current = overview.data;
  const record = overview.data ?? (overview.isError ? lastAccepted.current : null);
  const waitingForYear = !overview.isError && (overview.isPending || overview.isPlaceholderData);
  const names = useOutsideSpendingNames({
    browse: mode,
    year: record ? record.year : year,
    q,
    page: requestedPage,
    snapshotId: record?.snapshotId ?? null,
    enabled: !waitingForYear,
  });
  if (names.data?.years.length) lastYears.current = names.data.years;
  const data =
    names.data?.state === 'unavailable' || names.data?.snapshot_id === record?.snapshotId
      ? names.data
      : undefined;
  const scroll = useHistoryScrollRestoration(
    !waitingForYear && (record?.state !== 'reported' || Boolean(data) || names.isError),
  );
  const years = [...new Set([...lastYears.current, ...(year === null ? [] : [year])])].sort(
    (a, b) => b - a,
  );
  const checkedOn = record?.fetchedAt ? centralDateLabel(record.fetchedAt) : null;
  const plural = mode === 'groups' ? 'groups' : 'committees';
  const title = mode === 'groups' ? 'Groups' : 'Committees';
  const apply = (change: Partial<OutsideSpendingBrowseAddress>) =>
    navigation.setParams(outsideBrowseChange(address, change));

  useDocumentTitle('/money/outside-spending', `${OUTSIDE_SPENDING_HEADING} | Alethical`);
  useEffect(() => {
    setInput(q);
  }, [q, mode]);
  useEffect(() => {
    if (input.trim().slice(0, 200) === q) return;
    const timer = setTimeout(() => apply({ q: input.trim().slice(0, 200) || undefined }), 300);
    return () => clearTimeout(timer);
  }, [input, q, mode, year]); // The pending input belongs to this browsing choice and year.
  useEffect(() => {
    if (data?.state === 'reported' && data.page.number !== requestedPage) {
      navigation.setParams({ page: data.page.number > 1 ? String(data.page.number) : undefined });
    }
    if (data && pageChanged.current) {
      pageChanged.current = false;
      const node = resultRef.current as unknown as HTMLElement | null;
      node?.scrollIntoView?.({ block: 'start' });
      node?.focus?.({ preventScroll: true });
    }
  }, [data, requestedPage, navigation]);

  const retry = () => {
    void overview.refetch();
    if (record?.snapshotId) void names.refetch();
  };
  const changePage = (next: number) => {
    pageChanged.current = true;
    apply({ page: next > 1 ? String(next) : undefined });
  };
  const pageHref = (next: number) =>
    routePath.moneyOutsideSpending(
      outsideBrowseChange(address, { page: next > 1 ? String(next) : undefined }),
    );

  const summary =
    record?.state === 'reported' && record.figures ? (
      <Overview record={record} wide={!isDesktop && !isMobile} />
    ) : null;
  const controls = (
    <View style={[styles.controls, isMobile && styles.cardMobile]}>
      <View
        style={[styles.choices, isMobile && styles.stacked]}
        role="group"
        aria-label="Browse outside spending"
      >
        {(['groups', 'committees'] as const).map((choice) => (
          <Pressable
            key={choice}
            accessibilityRole="button"
            aria-pressed={choice === mode}
            onPress={() => {
              setInput('');
              apply({ browse: choice, q: undefined });
            }}
            style={[styles.choice, choice === mode && styles.choiceActive]}
          >
            <View style={[styles.radio, choice === mode && styles.radioActive]}>
              {choice === mode ? <View style={styles.radioDot} /> : null}
            </View>
            <View style={styles.choiceWords}>
              <Text style={styles.choiceTitle}>
                {choice === 'groups' ? 'Who spent?' : 'Who was supported or opposed?'}
              </Text>
              <Text style={styles.choiceBody}>
                {choice === 'groups'
                  ? 'Find groups that reported outside spending'
                  : 'Find committees named in outside-spending records'}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
      <Text nativeID="outside-name-label" style={styles.fieldLabel}>
        Search {plural}
      </Text>
      <View style={[styles.field, ...fieldFocusRing(focused)]}>
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
          <Circle cx={10.5} cy={10.5} r={6.5} stroke={t.colors.text.primary} strokeWidth={2} />
          <Path d="M16 16 L21 21" stroke={t.colors.text.primary} strokeWidth={2} />
        </Svg>
        <TextInput
          role="searchbox"
          ref={inputRef}
          value={input}
          onChangeText={setInput}
          {...focusProps}
          aria-labelledby="outside-name-label"
          accessibilityLabel={`Search ${plural}`}
          maxLength={200}
          onSubmitEditing={() => apply({ q: input.trim().slice(0, 200) || undefined })}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={[styles.input, fieldOutlineReset]}
        />
      </View>
      {q && (data?.names.length ?? 0) > 0 ? (
        <Action
          label="Clear search"
          onPress={() => {
            setInput('');
            apply({ q: undefined });
            inputRef.current?.focus();
          }}
        />
      ) : null}
    </View>
  );

  const results = (
    <View ref={resultRef} tabIndex={-1} style={[styles.results, isMobile && styles.cardMobile]}>
      <View style={styles.resultHeading}>
        <Text accessibilityRole="header" aria-level={2} style={styles.h2}>
          {title}
        </Text>
        {data?.state === 'reported' && data.page.total_names != null ? (
          <Text style={styles.count} accessibilityLiveRegion="polite">
            Showing {formatCount(data.names.length)} of {formatCount(data.page.total_names)}{' '}
            {data.page.total_names === 1 ? (mode === 'groups' ? 'group' : 'committee') : plural}
          </Text>
        ) : null}
      </View>
      {mode === 'committees' ? <Text style={styles.definition}>{COMMITTEE_DEFINITION}</Text> : null}
      {names.isError && data ? (
        <Message
          title="These names could not be refreshed"
          body="We are showing the names already loaded for this search."
          retry={() => void names.refetch()}
        />
      ) : null}
      {names.isError && !data ? (
        <Message
          title="We could not load the names"
          body="The overview is available, but the list of names did not load."
          retry={() => void names.refetch()}
        />
      ) : !data ? (
        <Message title={`Loading ${plural}…`} />
      ) : data.state === 'unavailable' ? (
        <Message title={RECORD_UNAVAILABLE_TITLE} body={RECORD_UNAVAILABLE_WHY} retry={retry} />
      ) : data.names.length === 0 ? (
        <>
          <Message
            title={
              q
                ? `No matching ${plural}`
                : `No ${mode === 'groups' ? 'group' : 'committee'} names are recorded for this period`
            }
            body={
              q
                ? 'Try another name or choose a different year'
                : 'We hold spending records for this period, but no names to list in this view.'
            }
          />
          {q ? (
            <Action
              label="Clear search"
              onPress={() => {
                setInput('');
                apply({ q: undefined });
                inputRef.current?.focus();
              }}
            />
          ) : null}
        </>
      ) : (
        <>
          <View>
            {data.names.map((name) => {
              const id = name.registration_number;
              const target = {
                ...(mode === 'groups' ? { spender: id ?? undefined } : { about: id ?? undefined }),
                year: record?.year ? String(record.year) : undefined,
              };
              const href = routePath.moneyOutsideSpending(target);
              return (
                <View style={styles.nameRow} key={`${id ? 'id' : 'name'}:${id ?? name.name}`}>
                  {id ? (
                    <Text
                      {...linkProps(href, () =>
                        navigation.push('OutsideSpending', {
                          ...target,
                          returnTo: routePath.moneyOutsideSpending(address),
                          returnContext: outsideSpendingReturnContext(
                            routePath.moneyOutsideSpending(address),
                            target,
                          ),
                        }),
                      )}
                      style={[styles.name, styles.nameLink]}
                    >
                      {name.name}
                    </Text>
                  ) : (
                    <Text style={styles.name}>{name.name}</Text>
                  )}
                  <Text style={styles.nameNote}>
                    {!id
                      ? NAME_WITHOUT_RECORD
                      : name.in_register
                        ? `Registration ${id}`
                        : 'Name as filed'}
                  </Text>
                </View>
              );
            })}
          </View>
          <View
            role="navigation"
            aria-label="Pages"
            style={[styles.pagination, isMobile && styles.paginationMobile]}
          >
            <Pressable
              {...(data.page.number > 1
                ? linkProps(pageHref(data.page.number - 1), () => changePage(data.page.number - 1))
                : { accessibilityRole: 'button' as const })}
              disabled={data.page.number <= 1}
              accessibilityState={{ disabled: data.page.number <= 1 }}
              style={[
                styles.pageButton,
                isMobile && styles.pageButtonMobile,
                data.page.number <= 1 && styles.disabledButton,
              ]}
            >
              <Chevron color={data.page.number <= 1 ? '#9aa09a' : '#2c322c'} />
              <Text
                style={[
                  styles.pageButtonText,
                  isMobile && styles.pageButtonTextMobile,
                  data.page.number <= 1 && styles.disabledText,
                ]}
              >
                Previous
              </Text>
            </Pressable>
            <Text style={styles.pageCount} accessibilityLiveRegion="polite">
              Page {data.page.number} of{' '}
              {Math.max(1, Math.ceil((data.page.total_names ?? 0) / data.page.size))}
            </Text>
            <Pressable
              {...(data.page.has_more
                ? linkProps(pageHref(data.page.number + 1), () => changePage(data.page.number + 1))
                : { accessibilityRole: 'button' as const })}
              disabled={!data.page.has_more}
              accessibilityState={{ disabled: !data.page.has_more }}
              style={[
                styles.pageButton,
                isMobile && styles.pageButtonMobile,
                !data.page.has_more && styles.disabledButton,
              ]}
            >
              <Text
                style={[
                  styles.pageButtonText,
                  isMobile && styles.pageButtonTextMobile,
                  !data.page.has_more && styles.disabledText,
                ]}
              >
                Next
              </Text>
              <Chevron right color={!data.page.has_more ? '#9aa09a' : '#2c322c'} />
            </Pressable>
          </View>
        </>
      )}
    </View>
  );

  return (
    <PageBackground>
      <ScrollView {...scroll} contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        <Container style={[styles.main, isMobile && styles.mainMobile]}>
          <Pressable
            {...linkProps(routePath.money(), () => navigation.navigate('MoneyLanding'))}
            style={styles.back}
          >
            <Chevron />
            <Text style={styles.backText}>{MONEY_SECTION_NAME}</Text>
          </Pressable>
          <Text style={styles.eyebrow}>CAMPAIGN MONEY</Text>
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={[styles.h1, isMobile && styles.h1Mobile]}
          >
            {OUTSIDE_SPENDING_HEADING}
          </Text>
          <Text style={[styles.intro, isMobile && styles.introMobile]}>{OUTSIDE_BROWSE_INTRO}</Text>
          {overview.isError && record ? (
            <Message
              title="These records could not be refreshed"
              body={`We are showing the records already loaded for ${outsideBrowsePeriod(record)}. Their period and copy date still apply.`}
              retry={retry}
            />
          ) : null}
          {record || years.length ? (
            <View style={styles.yearSection}>
              <Text style={styles.fieldLabel}>Year</Text>
              {isMobile && Platform.OS === 'web' ? (
                <select
                  aria-label="Year"
                  value={year ?? ''}
                  onChange={(e) => apply({ year: e.target.value || undefined })}
                  style={{
                    minHeight: 48,
                    width: '100%',
                    padding: '0 14px',
                    borderRadius: 11,
                    border: '2px solid #11150f',
                    background: '#fff',
                    color: '#11150f',
                    fontFamily: t.typography.body,
                    fontSize: 16,
                    fontWeight: 700,
                  }}
                >
                  <option value="">All years</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              ) : (
                <View style={styles.years} role="group" aria-label="Year">
                  {[null, ...years].map((y) => (
                    <Pressable
                      key={y ?? 'all'}
                      accessibilityRole="button"
                      aria-pressed={year === y}
                      onPress={() => apply({ year: y === null ? undefined : String(y) })}
                      style={[styles.yearButton, year === y && styles.yearActive]}
                    >
                      <Text style={[styles.yearText, year === y && styles.yearTextActive]}>
                        {y ?? 'All years'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          ) : null}
          {waitingForYear ? (
            <Message title="Loading outside-spending records…" />
          ) : !record ? (
            <Message
              title="We could not load these records"
              body="Please try again. This is a problem with loading our records, not a sign that nothing was spent."
              retry={retry}
            />
          ) : record.state === 'unavailable' ? (
            <Message title={RECORD_UNAVAILABLE_TITLE} body={RECORD_UNAVAILABLE_WHY} retry={retry} />
          ) : record.state === 'not_reported' ? (
            <>
              <Message
                title={
                  record.year
                    ? `No outside-spending records for ${record.year}`
                    : 'No outside-spending records available'
                }
                body={
                  record.year
                    ? 'We have no matching records for this year. That does not mean nothing was spent.'
                    : 'We have no outside-spending records to show from our current copy'
                }
              />
              {record.year ? (
                <Action label="See all years" onPress={() => apply({ year: undefined })} />
              ) : null}
            </>
          ) : isDesktop ? (
            <View style={styles.desktopColumns}>
              <View style={styles.browseColumn}>
                {controls}
                {results}
              </View>
              <View style={styles.overviewColumn}>{summary}</View>
            </View>
          ) : (
            <View style={styles.narrowColumns}>
              {controls}
              {summary}
              {results}
            </View>
          )}
          <View style={[styles.explanations, !isDesktop && styles.stacked]}>
            <View style={styles.explanation}>
              <Text accessibilityRole="header" aria-level={2} style={styles.h2}>
                How to read these records
              </Text>
              <Text style={styles.body}>{HOW_TO_READ_OUTSIDE}</Text>
            </View>
            <View style={styles.explanation}>
              <Text accessibilityRole="header" aria-level={2} style={styles.h2}>
                Limits of these records
              </Text>
              <Text style={styles.body}>{OUTSIDE_LIMITS}</Text>
              <Text style={styles.body}>{OUTSIDE_OUTCOMES}</Text>
            </View>
          </View>
          <View style={styles.source}>
            <Text style={styles.sourceLabel}>
              Source: Minnesota Campaign Finance and Public Disclosure Board
            </Text>
            <Text {...externalLinkProps(OUTSIDE_DOWNLOADS)} style={styles.sourceLink}>
              Minnesota’s campaign-finance downloads
            </Text>
            <Text style={styles.sourceBody}>
              On the state’s download page, choose ‘All’ under ‘Itemized independent expenditures of
              over $200’
            </Text>
            {checkedOn ? <Text style={styles.sourceDate}>Records copied {checkedOn}</Text> : null}
          </View>
        </Container>
        <Footer />
      </ScrollView>
    </PageBackground>
  );
}

function Overview({ record, wide }: { record: OutsideSpendingRecordPage; wide: boolean }) {
  const figures = record.figures!;
  const total = formatMoney(figures.amountTotal);
  const count = figures.rowCount;
  const directions = [
    { label: 'supporting', count: figures.supportingCount, color: '#2b6377' },
    { label: 'opposing', count: figures.opposingCount, color: '#11150f' },
    ...(figures.directionNotRecordedCount
      ? [
          {
            label: 'with no direction stated',
            count: figures.directionNotRecordedCount,
            color: t.colors.text.muted,
          },
        ]
      : []),
  ];
  return (
    <View style={styles.overview}>
      <Text accessibilityRole="header" aria-level={2} style={styles.h2}>
        Spending in these records
      </Text>
      <Text style={styles.period}>{outsideBrowsePeriod(record)}</Text>
      <Text style={styles.scope}>{OUTSIDE_BROWSE_SCOPE}</Text>
      <View style={[styles.figures, wide && styles.figuresWide]}>
        <View style={styles.figureColumn}>
          {total !== null ? (
            <>
              <Text style={styles.total}>{total}</Text>
              <Text style={styles.figureNote}>Total of the listed payments for this period</Text>
            </>
          ) : (
            <Text style={styles.body}>
              Some payments have no amount recorded, so we cannot show a complete total
            </Text>
          )}
          <Text style={styles.paymentCount}>
            {formatCount(count)} {count === 1 ? 'payment' : 'payments'}
          </Text>
        </View>
        <View style={styles.figureColumn}>
          <Text style={styles.directionTitle}>Payments supporting or opposing</Text>
          <View style={styles.bar} aria-hidden>
            {directions.map((d) => (
              <View
                key={d.label}
                style={{
                  width: `${count ? (d.count / count) * 100 : 0}%`,
                  backgroundColor: d.color,
                  height: 13,
                }}
              />
            ))}
          </View>
          {directions.map((d) => (
            <View style={styles.legend} key={d.label}>
              <View style={[styles.swatch, { backgroundColor: d.color }]} />
              <Text style={styles.legendText}>
                {formatCount(d.count)} {d.count === 1 ? 'payment' : 'payments'} {d.label}
              </Text>
            </View>
          ))}
          <View style={styles.inKind}>
            <Text style={styles.directionTitle}>
              {formatCount(figures.inKindCount)}{' '}
              {figures.inKindCount === 1 ? 'payment' : 'payments'} in goods or services
            </Text>
            <Text style={styles.figureNote}>
              Payments in goods or services are included in the counts above
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1 },
  main: { paddingTop: 32, paddingBottom: 60 },
  mainMobile: { paddingTop: 22, paddingBottom: 40 },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'flex-start',
    minHeight: 44,
    marginBottom: 20,
  },
  backText: {
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.text.secondary,
  },
  eyebrow: {
    fontFamily: t.typography.body,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2.4,
    color: t.colors.text.greenOnLight,
    marginBottom: 12,
  },
  h1: {
    fontFamily: t.typography.title,
    fontSize: 38,
    lineHeight: 44,
    fontWeight: '800',
    letterSpacing: -1.1,
    color: t.colors.text.primary,
    maxWidth: 1040,
  },
  h1Mobile: { fontSize: 29, lineHeight: 34, letterSpacing: -0.7 },
  intro: {
    fontFamily: t.typography.body,
    fontSize: 18,
    lineHeight: 28,
    color: t.colors.text.secondary,
    maxWidth: 870,
    marginTop: 16,
    marginBottom: 34,
  },
  introMobile: { fontSize: 16, lineHeight: 25, marginBottom: 26 },
  yearSection: { marginBottom: 24 },
  fieldLabel: {
    fontFamily: t.typography.body,
    fontSize: 14.5,
    fontWeight: '700',
    color: t.colors.text.primary,
    marginBottom: 10,
  },
  years: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  yearButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    backgroundColor: '#fff',
    justifyContent: 'center',
  },
  yearActive: { backgroundColor: '#11150f', borderColor: '#11150f' },
  yearText: {
    fontFamily: t.typography.body,
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    color: t.colors.text.secondary,
  },
  yearTextActive: { color: '#fff' },
  desktopColumns: { flexDirection: 'row', gap: 24, alignItems: 'flex-start' },
  browseColumn: { flex: 1, minWidth: 0, gap: 18 },
  overviewColumn: { width: 372 },
  narrowColumns: { gap: 18 },
  controls: {
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    backgroundColor: '#fff',
  },
  cardMobile: { padding: 18 },
  choices: { flexDirection: 'row', gap: 14, marginBottom: 20 },
  stacked: { flexDirection: 'column' },
  choice: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: t.colors.alpha.ink14,
    padding: 16,
  },
  choiceActive: { borderColor: '#11150f' },
  choiceWords: { flex: 1, minWidth: 0 },
  choiceTitle: {
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
    color: t.colors.text.primary,
  },
  choiceBody: {
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 21,
    color: t.colors.text.secondary,
    marginTop: 4,
  },
  radio: {
    width: 19,
    height: 19,
    borderWidth: 2,
    borderColor: t.colors.text.primary,
    borderRadius: 10,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: t.colors.text.primary },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: t.colors.text.primary },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    borderWidth: 2,
    borderColor: t.colors.text.primary,
    borderRadius: 13,
    paddingHorizontal: 14,
    maxWidth: 600,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontFamily: t.typography.body,
    fontSize: 16,
    color: t.colors.text.primary,
    paddingVertical: 12,
  },
  results: {
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: 16,
    backgroundColor: '#fff',
    padding: 24,
  },
  resultHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  h2: {
    fontFamily: t.typography.title,
    fontWeight: '800',
    fontSize: 21,
    lineHeight: 28,
    letterSpacing: -0.35,
    color: t.colors.text.primary,
  },
  count: {
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    color: t.colors.text.secondary,
  },
  definition: {
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 23,
    color: t.colors.text.secondary,
    marginTop: 8,
    marginBottom: 10,
  },
  nameRow: {
    paddingVertical: 12,
    minHeight: 60,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.alpha.ink08,
  },
  name: {
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '700',
    color: t.colors.text.primary,
  },
  nameLink: {
    color: t.colors.text.greenOnLight,
    textDecorationLine: 'underline',
    minHeight: 44,
    paddingVertical: 10,
    ...(Platform.OS === 'web' ? ({ overflowWrap: 'anywhere' } as object) : {}),
  },
  nameNote: {
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 21,
    color: t.colors.text.secondary,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    flexWrap: 'wrap',
    marginTop: 20,
  },
  paginationMobile: { gap: 12, marginTop: 18 },
  pageButtonMobile: { gap: 8, paddingHorizontal: 15 },
  pageButtonTextMobile: { fontSize: 15 },
  pageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.16)',
    backgroundColor: '#fff',
  },
  pageButtonText: {
    fontFamily: t.typography.body,
    fontSize: 15.5,
    fontWeight: '700',
    color: '#2c322c',
  },
  disabledButton: { borderColor: 'rgba(17,21,15,0.1)' },
  disabledText: { color: '#9aa09a' },
  pageCount: {
    fontFamily: t.typography.body,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.28,
    fontVariant: ['tabular-nums'],
    color: t.colors.text.secondary,
  },
  overview: {
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: 16,
    backgroundColor: '#fff',
    padding: 24,
  },
  period: {
    fontFamily: t.typography.body,
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    color: t.colors.text.secondary,
    marginTop: 4,
  },
  scope: {
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 21,
    color: t.colors.text.secondary,
    marginTop: 8,
  },
  figures: { gap: 24, marginTop: 18 },
  figuresWide: { flexDirection: 'row', gap: 28 },
  figureColumn: { flex: 1, minWidth: 0 },
  total: {
    fontFamily: t.typography.body,
    fontSize: 30,
    lineHeight: 39,
    fontWeight: '800',
    letterSpacing: -0.9,
    fontVariant: ['tabular-nums'],
    color: t.colors.text.primary,
  },
  figureNote: {
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 22,
    color: t.colors.text.secondary,
    marginTop: 6,
  },
  paymentCount: {
    fontFamily: t.typography.body,
    fontSize: 18,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    color: t.colors.text.primary,
    marginTop: 16,
  },
  directionTitle: {
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    color: t.colors.text.primary,
  },
  bar: {
    flexDirection: 'row',
    height: 13,
    borderRadius: 8,
    overflow: 'hidden',
    marginTop: 10,
    marginBottom: 12,
  },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  swatch: { width: 11, height: 11, borderRadius: 3 },
  legendText: {
    flex: 1,
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    color: t.colors.text.primary,
  },
  inKind: {
    marginTop: 10,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink08,
  },
  message: { gap: 10, paddingVertical: 22 },
  body: {
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 26,
    color: t.colors.text.secondary,
    marginTop: 10,
  },
  action: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: 11,
    backgroundColor: '#fff',
    justifyContent: 'center',
    marginTop: 6,
  },
  actionLabel: {
    fontFamily: t.typography.body,
    fontSize: 15,
    fontWeight: '700',
    color: t.colors.text.primary,
  },
  explanations: {
    flexDirection: 'row',
    gap: 36,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink14,
    marginTop: 28,
    paddingTop: 26,
  },
  explanation: { flex: 1, minWidth: 0 },
  source: {
    marginTop: 26,
    paddingTop: 22,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink14,
  },
  sourceLabel: {
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '700',
    color: t.colors.text.primary,
  },
  sourceLink: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingVertical: 11,
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '700',
    color: t.colors.text.greenOnLight,
    textDecorationLine: 'underline',
  },
  sourceBody: {
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
  sourceDate: {
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '600',
    color: t.colors.text.secondary,
    marginTop: 10,
    fontVariant: ['tabular-nums'],
  },
});
