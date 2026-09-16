/** Filing notices load with Campaign money rather than every page. */
import { formatDay, type FilingSchedule } from './legislatorCampaignMoney';

/** The special-election and filing-list gaps share this closer. The calendar gap
 * names our missing calendar and carries its own shorter filing-status sentence. */
const OUR_GAP_CLOSER = "The gap is ours and says nothing about this committee's own filing.";

/**
 * Minnesota publishes on a schedule, and this says which schedule THIS committee is
 * on and what it owes next (#1642).
 *
 * Returns one paragraph per sentence group, so a printed exemption sits on its own
 * line under the date it qualifies rather than trailing it in the same block.
 *
 * **Two things this may never do**, and both have their own test:
 *
 * 1. **Never say a report is late.** The signal that marks an unfiled report is only
 *    readable in the current year, so the claim cannot be supported — and telling a
 *    reader that a named politician missed a deadline they may not even have is the
 *    worst thing this tab could produce.
 * 2. **Never print a due date without the exemption the Board prints beside it.** The
 *    2026 pre-general is the live case: everyone who advanced past the primary owes
 *    it, everyone who lost does not, and no record we hold says which happened.
 *
 * **No year is written into any sentence here.** The year and every date arrive from
 * the server, which reads them off the Board's own calendars. That is the failure this
 * replaces: the fixed paragraph that shipped before spelled 2026's dates out in its own
 * words, so on 1 January 2027 it would have quietly described a finished election year.
 */
export function filingScheduleNote(
  schedule: FilingSchedule | null | undefined,
  year: number,
  currentYear = new Date().getUTCFullYear(),
): string[] {
  // A response with no schedule block is our gap like any other, and reads as one.
  if (!schedule) return cannotSayBecause(ourFilingsCannotAnswer(year));

  switch (schedule.state) {
    case 'on_the_ballot': {
      if (year < currentYear) {
        return [
          `This committee was on the ${year} ballot and followed Minnesota's election-year filing schedule`,
        ];
      }
      const timing = nextReportSentence(schedule);
      return [
        `This committee is on the ${year} ballot and follows Minnesota’s ` +
          'election-year filing schedule.' +
          (timing ? ` ${timing}` : '') +
          ' New money appears here when a report is filed.',
        ...conditionParagraph(schedule),
      ];
    }
    case 'not_on_the_ballot': {
      if (year < currentYear) {
        return [
          `This committee was not on the ${year} ballot. Minnesota's schedule for candidates not running required a year-end report.`,
        ];
      }
      const timing = nextReportSentence(schedule);
      return [
        `This committee is not on the ${year} ballot, so Minnesota puts it on the ` +
          'schedule for candidates who are not running, which asks for a report once a ' +
          'year rather than around each election.' +
          (timing ? ` ${timing}` : '') +
          ' A long stretch with nothing new here is that schedule working as written, ' +
          'not money going unreported.',
        ...conditionParagraph(schedule),
      ];
    }
    case 'registration_closed': {
      const closedOn = formatDay(schedule.terminatedOn);
      return [
        (closedOn
          ? `This committee closed its registration with the state on ${closedOn}, so no `
          : 'This committee has closed its registration with the state, so no ') +
          `further report is due from it. Nothing more is expected for ${year} than what ` +
          'it had already filed.',
      ];
    }
    case 'special_election_filer':
      return cannotSayBecause(
        `It has a ${year} special-election report, and special elections run on their ` +
          'own set of filing periods that we have not written down.',
      );
    case 'calendar_not_transcribed':
      return [
        `We have not yet copied Minnesota’s ${year} filing calendar for this kind of ` +
          'candidate, so we cannot give its next report’s due date. ' +
          'This says nothing about the committee’s own filing.',
      ];
    case 'filings_cannot_answer':
      return cannotSayBecause(ourFilingsCannotAnswer(year));
    default:
      return cannotSayBecause(ourFilingsCannotAnswer(year));
  }
}

/** The middle sentence of the state where our copy of the filings is what falls short. */
function ourFilingsCannotAnswer(year: number): string {
  return (
    `Our copy of the state’s own list of filings cannot answer it for ${year}: it ` +
    'either does not carry this committee yet or was taken too early to settle the ' +
    'question.'
  );
}

/** The common shape for the special-election and filing-list gaps. */
function cannotSayBecause(middle: string): string[] {
  return [`We cannot say when this committee's next report is due. ${middle} ${OUR_GAP_CLOSER}`];
}

/**
 * The next report, its due date and the period it covers, or nothing.
 *
 * Every part is dropped rather than guessed. A schedule that named a report and no
 * date would otherwise print "due", followed by nothing.
 */
function nextReportSentence(schedule: FilingSchedule): string | null {
  const due = formatDay(schedule.nextReportDueOn);
  if (!schedule.nextReportName || !due) return null;
  const start = formatDay(schedule.periodStart);
  const end = formatDay(schedule.periodEnd);
  const sameYear = schedule.periodStart?.slice(0, 4) === schedule.periodEnd?.slice(0, 4);
  const rangeStart = sameYear ? start?.replace(/, \d{4}$/, '') : start;
  const covering = rangeStart && end ? ` and covers ${rangeStart} to ${end}` : '';
  return `Its next “${schedule.nextReportName}” is due ${due}${covering}.`;
}

/**
 * The Board's printed exemption, quoted, when the next report carries one.
 *
 * Its own paragraph rather than a clause, because it changes who the date above
 * applies to and a reader who skims a long sentence must not miss it.
 */
function conditionParagraph(schedule: FilingSchedule): string[] {
  if (!schedule.condition || !formatDay(schedule.nextReportDueOn)) return [];
  return [`The state prints one exemption on that report: “${schedule.condition}”`];
}
