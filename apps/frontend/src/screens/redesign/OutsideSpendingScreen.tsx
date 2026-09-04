import { useRef } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { UnderDevelopmentNotice } from '../../components/campaignMoney/UnderDevelopmentNotice';
import { Skeleton } from '../../components/Skeleton';
import { useOutsideSpendingRecord, usePrefetchCommitteeMoney } from '../../hooks/useAppQueries';
import { useResponsive } from '../../hooks/useResponsive';
import { committeeSlug, registerKindLabel } from '../../lib/committeeMoney';
import { campaignMoneyYears, formatMoney } from '../../lib/legislatorCampaignMoney';
import { centralDateLabel } from '../../lib/moneyLanding';
import {
  ALL_YEARS,
  BACK_TO_OUTSIDE_SPENDING,
  checkedLine,
  DIRECTION_AS_FILED,
  DIRECTION_NOT_STATED,
  directionAmountLine,
  directionCountLine,
  directionNotRecordedLine,
  directionShares,
  EVERY_ROW_SHOWN_NOTE,
  EVERY_ROW_STATES_A_DIRECTION,
  FIGURES_AS_ACCEPTED,
  FIGURES_WITHHELD,
  figuresAsAcceptedNote,
  FILING_YEAR_LABEL,
  HOW_TO_READ_IT,
  IN_KIND_COUNTED_INSIDE,
  IN_KIND_LABEL,
  inKindCountLine,
  LANE_BY_COMMITTEE_TITLE,
  LANE_BY_SPENDER,
  laneByCommitteeBody,
  NEXT_PAGE,
  NOT_IN_REGISTER_ROW_NOTE,
  NOT_IN_THIS_RECORD,
  NOTHING_ON_RECORD,
  nothingOnRecordWhy,
  OPPOSING_CHIP,
  OUTSIDE_SPENDING_EYEBROW,
  OUTSIDE_SPENDING_HEADING,
  OUTSIDE_SPENDING_PATH,
  OUTSIDE_SPENDING_STANDFIRST,
  OUTSIDE_SPENDING_VIEW_LABELS,
  outsideSpendingPageNumber,
  outsideSpendingSort,
  outsideSpendingView,
  outsideSpendingYear,
  pageLine,
  paidLine,
  periodNote,
  PREVIOUS_PAGE,
  purposeText,
  READ_FROM_THE_BOARDS_FILE,
  RECORD_UNAVAILABLE_TITLE,
  RECORD_UNAVAILABLE_WHY,
  recordSpanLine,
  registrationChip,
  registrationLine,
  rowCounterparty,
  ROWS_DEK,
  rowsCountLine,
  rowsHeading,
  SEARCH_A_GROUP_OR_COMMITTEE,
  SEE_ALL_YEARS,
  SEE_OWN_MONEY,
  SEE_OWN_MONEY_SPENDER,
  SERVICE_NOT_ANSWERING_TITLE,
  SERVICE_NOT_ANSWERING_WHY,
  SORT_LABELS,
  SPENDER_INTRO,
  SPENDER_OWN_MONEY_LINK,
  SPENDER_OWN_MONEY_TAIL,
  SUBJECT_NOT_FOUND_TITLE,
  SUBJECT_NOT_FOUND_WHY,
  subjectCountLine,
  subjectName,
  subjectScopeLine,
  SUPPORTING_CHIP,
  typeText,
  unpaidNote,
  vendorText,
  WHAT_THE_RECORD_HOLDS,
  WHOSE_COMMITTEE_THIS_IS,
  whoseCommitteeConfirmed,
  whoseCommitteeUnconfirmed,
  type OutsideSpendingRecordFigures,
  type OutsideSpendingRecordPage,
  type OutsideSpendingRecordRow,
  type OutsideSpendingSort,
  type OutsideSpendingSubject,
  type OutsideSpendingView,
} from '../../lib/outsideSpending';
import { useDocumentTitle } from '../../navigation/documentTitle';
import { linkProps, routePath } from '../../navigation/links';
import type { RootScreenProps, RootStackParamList } from '../../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';

/**
 * The outside-spending record at /money/outside-spending ("Money outside
 * spending.dc.html"; issue #1945).
 *
 * Money spent by groups that are not the candidate's campaign, supporting or
 * opposing a committee. Three views over the one record, chosen in the address:
 * the whole record (no parameter), one group that spent (`?spender=`), and one
 * committee the spending was about (`?about=`). The filing year, the sort and
 * the page ride in the address too, so whatever a reader sees is a link they
 * can send (grounded-answers.md rule 5).
 *
 * Every sentence comes from `lib/outsideSpending.ts`, and 4 rules from that
 * file shape the layout: one subject per figure (nothing sets 2 groups side by
 * side); the committee is the subject, not the person (a confirmation adds one
 * sentence and changes no figure); absence is never a zero ("Nothing on record",
 * in grey, with the reason); a name we cannot link is still printed, as filed.
 *
 * Two bands, one switch at 768: the phone column stacks each row into a card
 * with the amount left-aligned under the name (phone band rule D2), and nothing
 * is sticky.
 */

type Address = NonNullable<RootStackParamList['OutsideSpending']>;
type Navigation = RootScreenProps<'OutsideSpending'>['navigation'];

// The drawing's direction colours: cyan for supporting, ink for opposing. Never
// green against red, which would score the spending as good and bad.
const SUPPORTING_COLOR = t.colors.cyan.ink;
const OPPOSING_COLOR = t.colors.ink;

function BackChevron() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path
        d="M15 5 L8 12 L15 19"
        stroke={t.colors.text.secondary}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ForwardArrow({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path
        d="M5 12 H19 M13 6 L19 12 L13 18"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function SearchGlyph() {
  return (
    <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Path
        d="M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z M16 16 L21 21"
        stroke={t.colors.ink}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function OutsideSpendingScreen({ navigation, route }: RootScreenProps<'OutsideSpending'>) {
  const { isMobile } = useResponsive();
  const address: Address = route.params ?? {};
  const view = outsideSpendingView(address);
  const year = outsideSpendingYear(address.year);
  const sort = outsideSpendingSort(address.sort);
  const pageNumber = outsideSpendingPageNumber(address.page);

  const query = useOutsideSpendingRecord({
    about: address.about,
    spender: address.spender,
    year,
    sort,
    page: pageNumber,
  });

  useDocumentTitle(OUTSIDE_SPENDING_PATH, `${OUTSIDE_SPENDING_HEADING} | Alethical`);

  // `data` is the current answer, or the previous one kept while a new page or year
  // loads. `null` is a 404: the subject is in neither the register nor the file. When
  // a later request fails, `data` is gone, so the last answer accepted is held here
  // and printed under the "figures as accepted" note rather than replaced by a blank;
  // it is the held answer's own year and sort that label its figures, never the
  // address's, so a stale figure is never captioned with a period it does not cover.
  const lastAccepted = useRef<OutsideSpendingRecordPage | null | undefined>(undefined);
  if (query.data !== undefined) lastAccepted.current = query.data;
  const serviceDown = query.isError;
  const page =
    query.data !== undefined ? query.data : serviceDown ? (lastAccepted.current ?? null) : null;
  const checkedOn = page?.fetchedAt ? centralDateLabel(page.fetchedAt) : null;

  const go = (next: Address) => {
    navigation.setParams(next as RootStackParamList['OutsideSpending']);
  };
  const hrefFor = (next: Address) => routePath.moneyOutsideSpending(next);
  // The same subject with one thing changed. Changing the year or the sort goes
  // back to page 1, because the pages are pages of a different list.
  const withChange = (change: Partial<Address>): Address => {
    const kept: Address = {};
    if (address.spender) kept.spender = address.spender;
    if (address.about) kept.about = address.about;
    if (address.year) kept.year = address.year;
    if (address.sort && address.sort !== 'newest') kept.sort = address.sort;
    const next: Address = { ...kept, ...change };
    for (const key of Object.keys(next) as (keyof Address)[]) {
      if (!next[key]) delete next[key];
    }
    return next;
  };

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />

        {/* The money section is still being built. Deleting the element and its
            component file is the whole removal. */}
        <UnderDevelopmentNotice />

        <Container style={[styles.main, isMobile && styles.mainMobile]}>
          <ViewStrip view={view} address={address} navigation={navigation} />

          {query.isPending && !page ? (
            <LoadingBlock />
          ) : serviceDown && !page ? (
            <View style={styles.card}>
              <Text accessibilityRole="alert" style={styles.h3}>
                {SERVICE_NOT_ANSWERING_TITLE}
              </Text>
              <Text style={styles.explain}>{SERVICE_NOT_ANSWERING_WHY}</Text>
            </View>
          ) : page === null ? (
            <View style={styles.card}>
              <Text accessibilityRole="header" aria-level={1} style={styles.h3}>
                {SUBJECT_NOT_FOUND_TITLE}
              </Text>
              <Text style={styles.explain}>{SUBJECT_NOT_FOUND_WHY}</Text>
            </View>
          ) : view === 'record' ? (
            <WholeRecord
              page={page}
              isMobile={isMobile}
              checkedOn={checkedOn}
              serviceDown={serviceDown}
              navigation={navigation}
            />
          ) : (
            <SubjectView
              view={view}
              page={page}
              year={year}
              isMobile={isMobile}
              checkedOn={checkedOn}
              serviceDown={serviceDown}
              navigation={navigation}
              hrefFor={(change) => hrefFor(withChange(change))}
              goTo={(change) => go(withChange(change))}
            />
          )}
        </Container>
        <Footer />
      </ScrollView>
    </PageBackground>
  );
}

/**
 * The 3 view buttons. The current view is pressed; the whole-record button always
 * links back to the bare address. The 2 subject buttons need a subject, so where
 * the page is not already on one they open the register's list of the filers of
 * that kind, from which a committee's page leads here.
 */
function ViewStrip({
  view,
  address,
  navigation,
}: {
  view: OutsideSpendingView;
  address: Address;
  navigation: Navigation;
}) {
  const buttons: { key: OutsideSpendingView; href: string; onPress: () => void }[] = [
    {
      key: 'record',
      href: routePath.moneyOutsideSpending(),
      onPress: () => navigation.setParams(undefined),
    },
    {
      key: 'spender',
      href:
        view === 'spender'
          ? routePath.moneyOutsideSpending({ spender: address.spender })
          : routePath.moneyCommittees({ kind: 'political_committee_or_fund' }),
      onPress: () =>
        view === 'spender'
          ? undefined
          : navigation.push('CommitteeList', { kind: 'political_committee_or_fund' }),
    },
    {
      key: 'about',
      href:
        view === 'about'
          ? routePath.moneyOutsideSpending({ about: address.about })
          : routePath.moneyCommittees({ kind: 'candidate_committee' }),
      onPress: () =>
        view === 'about'
          ? undefined
          : navigation.push('CommitteeList', { kind: 'candidate_committee' }),
    },
  ];
  return (
    <View style={styles.viewStrip} role="group" aria-label="View">
      {buttons.map((button) => {
        const active = button.key === view;
        return (
          <Pressable
            key={button.key}
            {...linkProps(button.href, button.onPress)}
            aria-pressed={active}
            style={[styles.viewButton, active && styles.viewButtonActive]}
          >
            <Text style={[styles.viewButtonLabel, active && styles.viewButtonLabelActive]}>
              {OUTSIDE_SPENDING_VIEW_LABELS[button.key]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function LoadingBlock() {
  return (
    <View style={styles.loading}>
      <View role="status" aria-busy style={styles.hidden}>
        <Text>Loading the outside-spending record</Text>
      </View>
      <Skeleton width="60%" height={34} />
      <Skeleton width="80%" height={16} style={{ marginTop: 14 }} />
      <Skeleton width="100%" height={180} style={{ marginTop: 26 }} radius={16} />
    </View>
  );
}

// --- The whole record -----------------------------------------------------------

function WholeRecord({
  page,
  isMobile,
  checkedOn,
  serviceDown,
  navigation,
}: {
  page: OutsideSpendingRecordPage;
  isMobile: boolean;
  checkedOn: string | null;
  serviceDown: boolean;
  navigation: Navigation;
}) {
  const figures = page.figures;
  return (
    <View>
      <Text style={styles.eyebrow}>{OUTSIDE_SPENDING_EYEBROW.toUpperCase()}</Text>
      <Text
        accessibilityRole="header"
        aria-level={1}
        style={[styles.h1, isMobile && styles.h1Mobile]}
      >
        {OUTSIDE_SPENDING_HEADING}
      </Text>
      <Text style={styles.standfirst}>{OUTSIDE_SPENDING_STANDFIRST}</Text>

      {serviceDown ? <StaleNote checkedOn={checkedOn} /> : null}

      <View style={[styles.twoColumns, isMobile && styles.oneColumn]}>
        <View style={[styles.figureCard, !isMobile && styles.figureCardWide]}>
          <Text style={styles.monoLabelGreen}>{WHAT_THE_RECORD_HOLDS.toUpperCase()}</Text>
          {page.state === 'reported' && figures ? (
            <RecordFigures figures={figures} isMobile={isMobile} />
          ) : page.state === 'unavailable' ? (
            <>
              <Text style={styles.h3}>{RECORD_UNAVAILABLE_TITLE}</Text>
              <Text style={styles.explain}>{RECORD_UNAVAILABLE_WHY}</Text>
            </>
          ) : (
            <>
              <Text style={styles.nothingTitle}>{NOTHING_ON_RECORD}</Text>
              <Text style={styles.explain}>{nothingOnRecordWhy('record')}</Text>
            </>
          )}
        </View>

        <View style={styles.lanes}>
          <Pressable
            {...linkProps(routePath.moneyCommittees({ kind: 'political_committee_or_fund' }), () =>
              navigation.push('CommitteeList', { kind: 'political_committee_or_fund' }),
            )}
            style={styles.laneCard}
          >
            <View style={styles.laneHead}>
              <Text style={styles.laneTitle}>{LANE_BY_SPENDER.title}</Text>
              <ForwardArrow color={t.colors.brand.deep} />
            </View>
            <Text style={styles.laneBody}>{LANE_BY_SPENDER.body}</Text>
          </Pressable>
          <Pressable
            {...linkProps(routePath.moneyCommittees({ kind: 'candidate_committee' }), () =>
              navigation.push('CommitteeList', { kind: 'candidate_committee' }),
            )}
            style={styles.laneCard}
          >
            <View style={styles.laneHead}>
              <Text style={styles.laneTitle}>{LANE_BY_COMMITTEE_TITLE}</Text>
              <ForwardArrow color={t.colors.brand.deep} />
            </View>
            <Text style={styles.laneBody}>
              {laneByCommitteeBody(figures?.committeesNotLinkable ?? null)}
            </Text>
          </Pressable>
          <Pressable
            {...linkProps(routePath.moneySearch(), () => navigation.push('MoneySearch'))}
            style={styles.searchRow}
          >
            <SearchGlyph />
            <Text style={styles.searchPlaceholder}>{SEARCH_A_GROUP_OR_COMMITTEE}</Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.readingColumns, isMobile && styles.oneColumn]}>
        <View style={styles.readingBlock}>
          <Text style={styles.monoLabel}>{HOW_TO_READ_IT.heading.toUpperCase()}</Text>
          <Text style={styles.readingBody}>{HOW_TO_READ_IT.body}</Text>
        </View>
        <View style={styles.readingBlock}>
          <Text style={styles.monoLabel}>{NOT_IN_THIS_RECORD.heading.toUpperCase()}</Text>
          <Text style={styles.readingBody}>{NOT_IN_THIS_RECORD.body}</Text>
        </View>
      </View>

      {/* The whole record lists no rows: a list across every group would rank one
          group's payment beside another's, which is the comparison this record
          cannot support. The 2 lanes lead to a subject, where the rows are. */}
      <SourceStamp sourceUrl={page.sourceUrl} checkedOn={checkedOn} />
    </View>
  );
}

function RecordFigures({
  figures,
  isMobile,
}: {
  figures: OutsideSpendingRecordFigures;
  isMobile: boolean;
}) {
  const total = formatMoney(figures.amountTotal);
  const everyRowStated = figures.directionNotRecordedCount === 0;
  const shares = directionShares(String(figures.supportingCount), String(figures.opposingCount));
  return (
    <View>
      {total ? (
        <Text style={[styles.bigFigure, isMobile && styles.bigFigureMobile]}>{total}</Text>
      ) : (
        <Text style={styles.explain}>{FIGURES_WITHHELD}</Text>
      )}
      <Text style={styles.figureUnder}>{recordSpanLine(figures)}</Text>

      <Text style={[styles.monoLabel, { marginTop: 26 }]}>{DIRECTION_AS_FILED.toUpperCase()}</Text>
      <DirectionBar shares={shares} />
      <View style={styles.legendRow}>
        <Legend color={SUPPORTING_COLOR}>
          {directionCountLine(figures.supportingCount, 'supporting')}
        </Legend>
        <Legend color={OPPOSING_COLOR}>
          {directionCountLine(figures.opposingCount, 'opposing')}
        </Legend>
        {everyRowStated ? null : (
          <Legend color={t.colors.text.muted}>
            {directionNotRecordedLine(figures.directionNotRecordedCount)}
          </Legend>
        )}
        <View style={styles.legendItem}>
          <Text style={styles.inKindLabel}>{IN_KIND_LABEL.toUpperCase()}</Text>
          <Text style={styles.legendText}>{inKindCountLine(figures.inKindCount)}</Text>
        </View>
      </View>
      <Text style={styles.figureNote}>
        {everyRowStated ? EVERY_ROW_STATES_A_DIRECTION : IN_KIND_COUNTED_INSIDE}
      </Text>
    </View>
  );
}

// --- One subject ----------------------------------------------------------------

function SubjectView({
  view,
  page,
  year,
  isMobile,
  checkedOn,
  serviceDown,
  navigation,
  hrefFor,
  goTo,
}: {
  view: OutsideSpendingView;
  page: OutsideSpendingRecordPage;
  /** The year the address asks for, which picks the pressed chip. The figures are
   *  captioned with `page.year`, the year the answer on screen actually covers. */
  year: number | null;
  isMobile: boolean;
  checkedOn: string | null;
  serviceDown: boolean;
  navigation: Navigation;
  hrefFor: (change: Partial<Address>) => string;
  goTo: (change: Partial<Address>) => void;
}) {
  const subject = view === 'spender' ? page.spender : page.about;
  const figures = page.figures;
  const kind = registerKindLabel(subject?.kind);
  const ownMoneyHref = subject?.linkable
    ? routePath.moneyCommittee(committeeSlug(subject.name, subject.registrationNumber))
    : null;
  const openOwnMoney = () => {
    if (!subject) return;
    navigation.push('CommitteeMoney', {
      slug: committeeSlug(subject.name, subject.registrationNumber),
    });
  };

  return (
    <View>
      <Pressable
        {...linkProps(routePath.moneyOutsideSpending(), () => navigation.setParams(undefined))}
        style={styles.backLink}
      >
        <BackChevron />
        <Text style={styles.backLabel}>{BACK_TO_OUTSIDE_SPENDING}</Text>
      </Pressable>

      {subject ? (
        <>
          <View style={styles.chipRow}>
            {kind ? <Text style={styles.kindChip}>{kind.toUpperCase()}</Text> : null}
            <Text style={styles.regLine}>{registrationLine(subject.registrationNumber)}</Text>
          </View>
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={[styles.h1, isMobile && styles.h1Mobile]}
          >
            {subjectName(subject)}
          </Text>

          {view === 'spender' ? (
            <Text style={styles.standfirst}>
              {SPENDER_INTRO}{' '}
              {ownMoneyHref ? (
                <>
                  <Text {...linkProps(ownMoneyHref, openOwnMoney)} style={styles.inlineLink}>
                    {SPENDER_OWN_MONEY_LINK}
                  </Text>
                  {SPENDER_OWN_MONEY_TAIL}
                </>
              ) : null}
            </Text>
          ) : (
            <WhoseCommittee subject={subject} navigation={navigation} />
          )}
        </>
      ) : null}

      <View style={styles.yearRow}>
        <Text style={styles.monoLabel}>{FILING_YEAR_LABEL.toUpperCase()}</Text>
        <YearChips year={year} hrefFor={hrefFor} goTo={goTo} />
      </View>

      {serviceDown ? <StaleNote checkedOn={checkedOn} /> : null}

      {page.state === 'reported' && figures ? (
        <View style={styles.figureCard}>
          <Text style={styles.monoLabelGreen}>
            {subjectScopeLine(page.year, figures).toUpperCase()}
          </Text>
          <SubjectFigures view={view} figures={figures} isMobile={isMobile} />
          <Text style={styles.figureNote}>{periodNote(page.year, figures)}</Text>
        </View>
      ) : page.state === 'unavailable' ? (
        <View style={styles.card}>
          <Text style={styles.h3}>{RECORD_UNAVAILABLE_TITLE}</Text>
          <Text style={styles.explain}>{RECORD_UNAVAILABLE_WHY}</Text>
        </View>
      ) : (
        <View style={styles.nothingCard}>
          <Text style={styles.monoLabelMuted}>
            {subjectScopeLine(page.year, null).toUpperCase()}
          </Text>
          <Text style={styles.nothingTitle}>{NOTHING_ON_RECORD}</Text>
          <Text style={styles.explain}>{nothingOnRecordWhy(view)}</Text>
          {year !== null ? (
            <Pressable
              {...linkProps(hrefFor({ year: undefined }), () => goTo({ year: undefined }))}
              style={styles.seeAll}
            >
              <Text style={styles.seeAllLabel}>{SEE_ALL_YEARS}</Text>
              <ForwardArrow color={t.colors.brand.deep} />
            </Pressable>
          ) : ownMoneyHref ? (
            <Pressable {...linkProps(ownMoneyHref, openOwnMoney)} style={styles.seeAll}>
              <Text style={styles.seeAllLabel}>
                {view === 'spender' ? SEE_OWN_MONEY_SPENDER : SEE_OWN_MONEY}
              </Text>
              <ForwardArrow color={t.colors.brand.deep} />
            </Pressable>
          ) : null}
        </View>
      )}

      {page.state === 'reported' ? (
        <RowsBlock
          view={view}
          page={page}
          sort={page.sort}
          isMobile={isMobile}
          navigation={navigation}
          hrefFor={hrefFor}
          goTo={goTo}
        />
      ) : null}

      <SourceStamp sourceUrl={page.sourceUrl} checkedOn={checkedOn} />
    </View>
  );
}

function WhoseCommittee({
  subject,
  navigation,
}: {
  subject: OutsideSpendingSubject;
  navigation: Navigation;
}) {
  const member = subject.confirmedMember;
  return (
    <View style={[styles.whoseCard, member && styles.whoseCardConfirmed]}>
      <Text style={member ? styles.monoLabelGreen : styles.monoLabelCyan}>
        {WHOSE_COMMITTEE_THIS_IS.toUpperCase()}
      </Text>
      <Text style={styles.whoseText}>
        {member ? whoseCommitteeConfirmed(subject) : whoseCommitteeUnconfirmed(subject)}
      </Text>
      {member ? (
        <Pressable
          {...linkProps(routePath.legislator(member.slug, { tab: 'money' }), () =>
            navigation.push('LegislatorProfile', { legislatorId: member.slug, tab: 'money' }),
          )}
          style={styles.seeAll}
        >
          <Text style={styles.seeAllLabel}>{`See ${member.fullName}’s campaign money`}</Text>
          <ForwardArrow color={t.colors.brand.deep} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** All years, then the 2 filing years the section offers, newest first. */
function YearChips({
  year,
  hrefFor,
  goTo,
}: {
  year: number | null;
  hrefFor: (change: Partial<Address>) => string;
  goTo: (change: Partial<Address>) => void;
}) {
  const options: { label: string; value: number | null }[] = [
    { label: ALL_YEARS, value: null },
    ...campaignMoneyYears().map((option) => ({ label: String(option), value: option })),
  ];
  return (
    <View style={styles.years} role="group" aria-label="Choose a filing year">
      {options.map((option) => {
        const active = option.value === year;
        const change: Partial<Address> = {
          year: option.value === null ? undefined : String(option.value),
          page: undefined,
        };
        return (
          <Pressable
            key={option.label}
            {...linkProps(hrefFor(change), () => goTo(change))}
            aria-pressed={active}
            style={[styles.yearButton, active && styles.yearButtonActive]}
          >
            <Text style={[styles.yearLabel, active && styles.yearLabelActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SubjectFigures({
  view,
  figures,
  isMobile,
}: {
  view: OutsideSpendingView;
  figures: OutsideSpendingRecordFigures;
  isMobile: boolean;
}) {
  const total = formatMoney(figures.amountTotal);
  const shares = directionShares(figures.supportingAmount, figures.opposingAmount);
  const supporting = directionAmountLine(figures.supportingAmount, 'supporting');
  const opposing = directionAmountLine(figures.opposingAmount, 'opposing');
  const notRecorded =
    figures.directionNotRecordedCount > 0
      ? directionNotRecordedLine(figures.directionNotRecordedCount)
      : null;
  return (
    <View style={[styles.subjectFigures, isMobile && styles.oneColumn]}>
      <View>
        {total ? (
          <Text style={[styles.bigFigure, isMobile && styles.bigFigureMobile]}>{total}</Text>
        ) : (
          <Text style={styles.explain}>{FIGURES_WITHHELD}</Text>
        )}
        <Text style={styles.figureUnder}>{subjectCountLine(view, figures)}</Text>
      </View>
      {total ? (
        <View style={styles.directionColumn}>
          <DirectionBar shares={shares} />
          <View style={[styles.legendRow, isMobile && styles.legendColumn]}>
            {supporting ? <Legend color={SUPPORTING_COLOR}>{supporting}</Legend> : null}
            {opposing ? <Legend color={OPPOSING_COLOR}>{opposing}</Legend> : null}
            {notRecorded ? <Legend color={t.colors.text.muted}>{notRecorded}</Legend> : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function DirectionBar({ shares }: { shares: { supporting: number; opposing: number } }) {
  return (
    <View style={styles.bar} aria-hidden>
      <View
        style={[styles.barSegment, { flex: shares.supporting, backgroundColor: SUPPORTING_COLOR }]}
      />
      <View
        style={[styles.barSegment, { flex: shares.opposing, backgroundColor: OPPOSING_COLOR }]}
      />
    </View>
  );
}

function Legend({ color, children }: { color: string; children: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{children}</Text>
    </View>
  );
}

function StaleNote({ checkedOn }: { checkedOn: string | null }) {
  return (
    <View style={styles.staleCard} role="status">
      <Text style={styles.monoLabelAmber}>{FIGURES_AS_ACCEPTED.toUpperCase()}</Text>
      <Text style={styles.whoseText}>{figuresAsAcceptedNote(checkedOn)}</Text>
    </View>
  );
}

// --- The rows -------------------------------------------------------------------

function RowsBlock({
  view,
  page,
  sort,
  isMobile,
  navigation,
  hrefFor,
  goTo,
}: {
  view: OutsideSpendingView;
  page: OutsideSpendingRecordPage;
  sort: OutsideSpendingSort;
  isMobile: boolean;
  navigation: Navigation;
  hrefFor: (change: Partial<Address>) => string;
  goTo: (change: Partial<Address>) => void;
}) {
  const countLine = rowsCountLine(view, page);
  const pages = pageLine(page);
  const totalPages =
    page.totalRows !== null && page.totalRows > page.pageSize
      ? Math.ceil(page.totalRows / page.pageSize)
      : 1;
  return (
    <View style={styles.rowsBlock}>
      <Text accessibilityRole="header" aria-level={2} style={styles.rowsHeading}>
        {rowsHeading(view)}
      </Text>
      <Text style={styles.rowsDek}>{ROWS_DEK}</Text>

      <View style={styles.listHead}>
        {countLine ? <Text style={styles.listCount}>{countLine}</Text> : <View />}
        <View style={styles.sortRow} role="group" aria-label="Order">
          {(['newest', 'largest'] as OutsideSpendingSort[]).map((option) => {
            const active = option === sort;
            const change: Partial<Address> = {
              sort: option === 'newest' ? undefined : option,
              page: undefined,
            };
            return (
              <Pressable
                key={option}
                {...linkProps(hrefFor(change), () => goTo(change))}
                aria-pressed={active}
                style={[styles.sortButton, active && styles.sortButtonActive]}
              >
                <Text style={[styles.sortLabel, active && styles.sortLabelActive]}>
                  {SORT_LABELS[option]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.rows}>
        {page.rows.map((row, index) => (
          <PaymentRow
            key={`${index}-${row.paidOn ?? ''}-${row.amount ?? ''}`}
            view={view}
            row={row}
            isMobile={isMobile}
            navigation={navigation}
          />
        ))}
        <View style={styles.rowsFoot}>
          <Text style={styles.rowsFootNote}>{EVERY_ROW_SHOWN_NOTE}</Text>
          {pages ? (
            <View style={styles.pager}>
              {page.pageNumber > 1 ? (
                <PagerButton
                  label={PREVIOUS_PAGE}
                  href={hrefFor({
                    page: page.pageNumber - 1 > 1 ? String(page.pageNumber - 1) : undefined,
                  })}
                  onPress={() =>
                    goTo({
                      page: page.pageNumber - 1 > 1 ? String(page.pageNumber - 1) : undefined,
                    })
                  }
                />
              ) : null}
              <Text style={styles.pageLine}>{pages}</Text>
              {page.pageNumber < totalPages ? (
                <PagerButton
                  label={NEXT_PAGE}
                  href={hrefFor({ page: String(page.pageNumber + 1) })}
                  onPress={() => goTo({ page: String(page.pageNumber + 1) })}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function PagerButton({
  label,
  href,
  onPress,
}: {
  label: string;
  href: string;
  onPress: () => void;
}) {
  return (
    <Pressable {...linkProps(href, onPress)} style={styles.pagerButton}>
      <Text style={styles.pagerButtonLabel}>{label}</Text>
    </Pressable>
  );
}

function PaymentRow({
  view,
  row,
  isMobile,
  navigation,
}: {
  view: OutsideSpendingView;
  row: OutsideSpendingRecordRow;
  isMobile: boolean;
  navigation: Navigation;
}) {
  const counterparty = rowCounterparty(view, row);
  const purpose = purposeText(row.purpose);
  const vendor = vendorText(row.vendorName);
  const amount = formatMoney(row.amount);
  const unpaid = unpaidNote(row.unpaidAmount);
  const paid = paidLine(row.paidOn);
  const linked = counterparty.linkable && counterparty.registrationNumber;
  const slug = linked ? committeeSlug(counterparty.name, counterparty.registrationNumber!) : null;
  const prefetchCommitteeMoney = usePrefetchCommitteeMoney();
  // Warm the committee page's cache on navigation intent, matching the bill and
  // legislator lists (usePrefetchBill / usePrefetchLegislator, #1966).
  const warm = () => {
    if (linked && counterparty.registrationNumber) {
      prefetchCommitteeMoney(counterparty.registrationNumber);
    }
  };

  const name = slug ? (
    <Pressable
      {...linkProps(routePath.moneyCommittee(slug), () =>
        navigation.push('CommitteeMoney', { slug }),
      )}
      onPressIn={warm}
      onHoverIn={warm}
      style={styles.nameRow}
    >
      <Text style={styles.nameLink}>{counterparty.name}</Text>
      <Text style={styles.regChip}>{registrationChip(counterparty.registrationNumber!)}</Text>
    </Pressable>
  ) : (
    <Text style={styles.name}>{counterparty.name}</Text>
  );

  const direction =
    row.direction === 'For' ? (
      <Text style={styles.supportingChip}>{SUPPORTING_CHIP.toUpperCase()}</Text>
    ) : row.direction === 'Against' ? (
      <Text style={styles.opposingChip}>{OPPOSING_CHIP.toUpperCase()}</Text>
    ) : (
      <Text style={styles.rowNote}>{DIRECTION_NOT_STATED}</Text>
    );

  return (
    <View style={[styles.row, isMobile && styles.rowMobile]}>
      <View style={styles.rowText}>
        {name}
        <View style={styles.rowChips}>
          {direction}
          {!linked ? <Text style={styles.rowNote}>{NOT_IN_REGISTER_ROW_NOTE}</Text> : null}
        </View>
        <Text style={styles.rowMeta}>
          <Text style={purpose.isMissing ? styles.rowMetaMissing : undefined}>{purpose.text}</Text>
          {' · '}
          <Text style={vendor.isMissing ? styles.rowMetaMissing : undefined}>{vendor.text}</Text>
          {' · '}
          {typeText(row)}
        </Text>
        {isMobile ? (
          <View style={styles.rowBottomMobile}>
            <Text style={styles.amountMobile}>{amount ?? ''}</Text>
            {unpaid ? <Text style={styles.unpaid}>{unpaid}</Text> : null}
            {paid ? <Text style={styles.paidMobile}>{paid}</Text> : null}
          </View>
        ) : null}
      </View>
      {isMobile ? null : (
        <>
          <View style={styles.amountColumn}>
            <Text style={styles.amount}>{amount ?? ''}</Text>
            {unpaid ? <Text style={styles.unpaid}>{unpaid}</Text> : null}
          </View>
          <Text style={styles.paid}>{paid ?? ''}</Text>
        </>
      )}
    </View>
  );
}

function SourceStamp({
  sourceUrl,
  checkedOn,
}: {
  sourceUrl: string | null;
  checkedOn: string | null;
}) {
  const checked = checkedLine(checkedOn);
  return (
    <View style={styles.stamp}>
      {sourceUrl ? (
        <Pressable {...linkProps(sourceUrl, () => void Linking.openURL(sourceUrl))}>
          <Text style={[styles.stampText, styles.stampLink]}>{READ_FROM_THE_BOARDS_FILE}</Text>
        </Pressable>
      ) : (
        <Text style={styles.stampText}>{READ_FROM_THE_BOARDS_FILE}</Text>
      )}
      {checked ? (
        <>
          <Text style={styles.stampText} aria-hidden>
            ·
          </Text>
          <Text style={styles.stampText}>{checked}</Text>
        </>
      ) : null}
    </View>
  );
}

const mono = (size: number, color: string, letterSpacing = 1.4) => ({
  fontFamily: t.typography.mono,
  fontSize: size,
  fontWeight: t.fontWeights.bold,
  letterSpacing,
  color,
});

const styles = StyleSheet.create({
  page: { flexGrow: 1 },
  main: { paddingTop: 28, paddingBottom: 64 },
  mainMobile: { paddingTop: 18 },
  hidden: { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden' },
  loading: { marginTop: 26 },

  viewStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    padding: 4,
    alignSelf: 'flex-start',
    backgroundColor: t.colors.surfaces.s200,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 12,
  },
  viewButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 15,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  viewButtonActive: { backgroundColor: t.colors.ink, borderColor: t.colors.ink },
  viewButtonLabel: {
    fontFamily: t.typography.body,
    fontSize: 14.5,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.secondary,
  },
  viewButtonLabelActive: { color: t.colors.surfaces.base },

  eyebrow: {
    marginTop: 26,
    fontFamily: t.typography.body,
    fontSize: 13,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 2.4,
    color: t.colors.brand.deep,
  },
  h1: {
    marginTop: 12,
    maxWidth: 900,
    fontFamily: t.typography.title,
    fontSize: 42,
    lineHeight: 46,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -1.2,
    color: t.colors.text.primary,
  },
  h1Mobile: { fontSize: 30, lineHeight: 34, letterSpacing: -0.6 },
  standfirst: {
    marginTop: 16,
    maxWidth: 760,
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 27,
    color: t.colors.text.secondary,
  },
  inlineLink: {
    color: t.colors.brand.deep,
    fontWeight: t.fontWeights.bold,
    textDecorationLine: 'underline',
  },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    marginTop: 22,
    minHeight: 44,
  },
  backLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.secondary,
  },
  chipRow: { marginTop: 18, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 11 },
  kindChip: {
    ...mono(10.5, t.colors.brand.deep, 1.3),
    backgroundColor: t.colors.tint.t50,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  regLine: { ...mono(12, t.colors.text.muted, 0.4), fontWeight: t.fontWeights.medium as never },

  twoColumns: { marginTop: 34, flexDirection: 'row', alignItems: 'flex-start', gap: 24 },
  oneColumn: { flexDirection: 'column' },
  figureCard: {
    marginTop: 24,
    backgroundColor: t.colors.tint.t50,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    borderRadius: 16,
    padding: 26,
    flexShrink: 1,
  },
  figureCardWide: { flex: 1.25, marginTop: 0 },
  monoLabel: mono(11, t.colors.text.secondary),
  monoLabelGreen: mono(11, t.colors.brand.deep),
  monoLabelCyan: mono(10.5, t.colors.cyan.ink),
  monoLabelMuted: mono(11, t.colors.text.muted),
  monoLabelAmber: mono(11, t.colors.omnibus.text),
  bigFigure: {
    marginTop: 16,
    fontFamily: t.typography.title,
    fontSize: 44,
    lineHeight: 48,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -1.3,
    color: t.colors.brand.display,
  },
  bigFigureMobile: { fontSize: 32, lineHeight: 36, letterSpacing: -0.9 },
  figureUnder: {
    marginTop: 9,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
  bar: {
    marginTop: 12,
    flexDirection: 'row',
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: t.colors.surfaces.s200,
  },
  barSegment: { height: '100%' },
  legendRow: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 24 },
  legendColumn: { flexDirection: 'column', gap: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  swatch: { width: 11, height: 11, borderRadius: 3 },
  legendText: { fontFamily: t.typography.body, fontSize: 15.5, color: t.colors.text.primary },
  inKindLabel: {
    ...mono(10, t.colors.omnibus.text, 1.2),
    borderWidth: 1,
    borderColor: t.colors.omnibus.border,
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 7,
    overflow: 'hidden',
  },
  figureNote: {
    marginTop: 18,
    maxWidth: 820,
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
  subjectFigures: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: 40,
  },
  directionColumn: { minWidth: 280, flex: 1 },

  lanes: { flex: 1, gap: 14 },
  laneCard: {
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 24,
  },
  laneHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  laneTitle: {
    flex: 1,
    fontFamily: t.typography.title,
    fontSize: 20,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.2,
    color: t.colors.text.primary,
  },
  laneBody: {
    marginTop: 8,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    minHeight: 48,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 2,
    borderColor: t.colors.ink,
    borderRadius: 13,
    paddingVertical: 12,
    paddingHorizontal: 15,
  },
  searchPlaceholder: {
    flex: 1,
    fontFamily: t.typography.body,
    fontSize: 15.5,
    color: t.colors.text.muted,
  },

  readingColumns: {
    marginTop: 34,
    paddingTop: 26,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink10,
    flexDirection: 'row',
    gap: 28,
  },
  readingBlock: { flex: 1 },
  readingBody: {
    marginTop: 12,
    fontFamily: t.typography.body,
    fontSize: 15.5,
    lineHeight: 25,
    color: t.colors.text.secondary,
  },

  whoseCard: {
    marginTop: 18,
    maxWidth: 820,
    backgroundColor: t.colors.cyan.surface,
    borderWidth: 1,
    borderColor: t.colors.cyan.border,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 20,
  },
  whoseCardConfirmed: { backgroundColor: t.colors.tint.t50, borderColor: t.colors.tint.border },
  whoseText: {
    marginTop: 10,
    fontFamily: t.typography.body,
    fontSize: 15.5,
    lineHeight: 25,
    color: t.colors.text.primary,
  },
  staleCard: {
    marginTop: 24,
    maxWidth: 820,
    backgroundColor: t.colors.omnibus.fill,
    borderWidth: 1,
    borderColor: t.colors.omnibus.border,
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 24,
  },
  yearRow: { marginTop: 26, flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  years: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  yearButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    backgroundColor: t.colors.surfaces.base,
  },
  yearButtonActive: { backgroundColor: t.colors.brand.base, borderColor: t.colors.brand.base },
  yearLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.secondary,
  },
  yearLabelActive: { color: t.colors.surfaces.base },

  nothingCard: {
    marginTop: 24,
    maxWidth: 820,
    backgroundColor: t.colors.surfaces.s50,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 16,
    padding: 26,
  },
  nothingTitle: {
    marginTop: 12,
    fontFamily: t.typography.body,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: t.fontWeights.semibold,
    letterSpacing: -0.3,
    color: t.colors.text.muted,
  },
  seeAll: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    alignSelf: 'flex-start',
  },
  seeAllLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.deep,
  },

  rowsBlock: { marginTop: 34 },
  rowsHeading: {
    fontFamily: t.typography.title,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.4,
    color: t.colors.cyan.ink,
  },
  rowsDek: {
    marginTop: 10,
    maxWidth: 760,
    fontFamily: t.typography.body,
    fontSize: 15.5,
    lineHeight: 24,
    color: t.colors.text.secondary,
  },
  listHead: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
  },
  listCount: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    color: t.colors.text.secondary,
  },
  sortRow: { flexDirection: 'row', gap: 4 },
  sortButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sortButtonActive: { borderColor: t.colors.alpha.ink16, backgroundColor: t.colors.surfaces.base },
  sortLabel: mono(11, t.colors.text.muted, 0.9),
  sortLabelActive: { color: t.colors.text.primary },

  rows: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: t.colors.surfaces.base,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    paddingVertical: 18,
    paddingHorizontal: 22,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.alpha.ink08,
  },
  rowMobile: {
    flexDirection: 'column',
    alignItems: 'stretch',
    paddingHorizontal: 18,
    minHeight: 60,
  },
  rowText: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 9 },
  nameLink: {
    fontFamily: t.typography.body,
    fontSize: 17,
    fontWeight: t.fontWeights.bold,
    letterSpacing: -0.2,
    color: t.colors.brand.deep,
  },
  name: {
    fontFamily: t.typography.body,
    fontSize: 17,
    fontWeight: t.fontWeights.bold,
    letterSpacing: -0.2,
    color: t.colors.text.primary,
  },
  regChip: { ...mono(11, t.colors.text.muted, 0.3), fontWeight: t.fontWeights.medium as never },
  rowChips: { marginTop: 6, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 9 },
  supportingChip: {
    ...mono(10, t.colors.cyan.ink, 1.2),
    backgroundColor: t.colors.cyan.surface,
    borderWidth: 1,
    borderColor: t.colors.cyan.border,
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 7,
    overflow: 'hidden',
  },
  opposingChip: {
    ...mono(10, t.colors.ink, 1.2),
    backgroundColor: t.colors.surfaces.s100,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 7,
    overflow: 'hidden',
  },
  rowNote: { fontFamily: t.typography.body, fontSize: 13.5, color: t.colors.text.muted },
  rowMeta: {
    marginTop: 7,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
  rowMetaMissing: { color: t.colors.text.muted },
  amountColumn: { width: 190, alignItems: 'flex-end' },
  amount: {
    fontFamily: t.typography.body,
    fontSize: 19,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.2,
    color: t.colors.brand.display,
  },
  unpaid: {
    marginTop: 4,
    fontFamily: t.typography.body,
    fontSize: 13,
    color: t.colors.text.secondary,
  },
  paid: {
    width: 150,
    textAlign: 'right',
    ...mono(11.5, t.colors.text.muted, 0.4),
    fontWeight: t.fontWeights.medium as never,
  },
  rowBottomMobile: { marginTop: 10, gap: 4 },
  amountMobile: {
    fontFamily: t.typography.body,
    fontSize: 19,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.2,
    color: t.colors.brand.display,
  },
  paidMobile: {
    marginTop: 4,
    ...mono(11, t.colors.text.muted, 0.4),
    fontWeight: t.fontWeights.medium as never,
  },
  rowsFoot: {
    paddingVertical: 16,
    paddingHorizontal: 22,
    backgroundColor: t.colors.surfaces.s50,
    gap: 12,
  },
  rowsFootNote: {
    fontFamily: t.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
    color: t.colors.text.secondary,
  },
  pager: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  pageLine: mono(11, t.colors.text.secondary, 0.9),
  pagerButton: {
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink16,
    borderRadius: 11,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  pagerButtonLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.body,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },

  stamp: { marginTop: 28, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  stampText: {
    ...mono(12, t.colors.text.secondary, 0.5),
    fontWeight: t.fontWeights.medium as never,
  },
  stampLink: { textDecorationLine: 'underline' },

  card: {
    marginTop: 26,
    maxWidth: 820,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: t.radii.lg,
    padding: 26,
    gap: 12,
  },
  h3: {
    fontFamily: t.typography.title,
    fontSize: 21,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.3,
    color: t.colors.text.primary,
  },
  explain: {
    marginTop: 8,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    lineHeight: 25,
    color: t.colors.text.secondary,
  },
});
