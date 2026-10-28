import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { plainBillSummary } from '@alethical/shared/billSummaryText';
import {
  cleanSectionText,
  parseChangeRuns,
  resolveSectionAnchor,
  sectionAnchorId,
  splitSectionLabel,
  type SectionAnchor,
} from '@alethical/shared/billText';

import { useRead, type Read } from '../api/read';
import { returnTarget, withFrom } from '../returnContext';
import { Link, useLocation } from '../router';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { billSession } from '../search/suggestions';
import { useAddressState } from '../ui/addressState';
import { Empty, LoadingRows, Refused, Tabs, type Tab } from '../ui/controls';
import { Arrow, BackLink, LoadingLine, WithArrow } from '../ui/parts';
import {
  actionRow,
  billCode,
  billHeading,
  billOverviewUrl,
  billPath,
  billStatus,
  chamberName,
  dayLabel,
  defaultTextVersion,
  fileChamber,
  legislatureSource,
  orderActions,
  orderVersions,
  orderVotes,
  ownAuthors,
  roleLabel,
  seatLabel,
  sessionShortLabel,
  versionPhrase,
  voteForAction,
  votesPath,
  versionTextPath,
  type BillDetail,
  type ServedVote,
  type Sponsor,
  type VersionRow,
} from './legislationRecords';
import './legislation.css';

type BillTab = 'summary' | 'actions' | 'votes' | 'text' | 'versions';
const TABS: readonly BillTab[] = ['summary', 'actions', 'votes', 'text', 'versions'];

export function tabFromParam(raw: string): BillTab {
  return (TABS as readonly string[]).includes(raw) ? (raw as BillTab) : 'summary';
}

interface CampaignAccount {
  registration_number: string;
  committee_name: string;
}

export interface AuthorWithAccounts extends Sponsor {
  campaign_accounts?: { link_state: string; confirmed: CampaignAccount[] } | null;
}

export interface AuthorsAnswer {
  authors: AuthorWithAccounts[];
}

interface TextSection {
  section_id: string;
  source_order: number;
  heading?: string | null;
  article_heading?: string | null;
  text?: string | null;
}

interface VersionText {
  sections: TextSection[];
}

/** Bill (Bill drawing): the bill's summary, actions, roll calls, text and
 * versions, its authors, and each author's confirmed campaign accounts. */
export function Bill({ match }: { match: RouteMatch }) {
  const id = match.params.id ?? '';
  const location = useLocation();
  const here = location.pathname + location.search;
  const back = returnTarget(location.search);
  const [address, setAddress] = useAddressState({ tab: 'summary', version: '' });
  const tab = tabFromParam(address.tab);
  const record = useRead<BillDetail>(billPath(id));
  const votes = useRead<ServedVote[]>(votesPath(id));
  const authors = useRead<AuthorsAnswer>(`finance/bills/${encodeURIComponent(id)}/authors`);
  const [target, setTarget] = useState<SectionAnchor | null>(null);

  const bill = record.data;
  const versions = useMemo(
    () => (bill ? orderVersions(bill.versions ?? [], bill.actions ?? []) : []),
    [bill],
  );
  const chosenVersion =
    versions.find((row) => row.code === address.version && !row.isLaw) ??
    defaultTextVersion(versions);
  const text = useRead<VersionText>(
    bill && tab === 'text' && chosenVersion ? versionTextPath(id, chosenVersion.code) : null,
  );

  function openText(version: VersionRow | null, anchor: SectionAnchor | null) {
    setTarget(anchor);
    setAddress({ tab: 'text', version: version && !version.isCurrent ? version.code : '' });
    if (!anchor) window.scrollTo?.({ top: 0 });
  }

  if (record.loading) {
    return (
      <Frame back={back}>
        <LoadingLine>Loading…</LoadingLine>
      </Frame>
    );
  }
  if (record.notFound) {
    const session = billSession(id);
    return (
      <Frame back={back}>
        <section className="f-card lg-unavailable">
          <h1 tabIndex={-1} className="lg-unavailable-title">
            This record is no longer available
          </h1>
          <p>
            {session
              ? `No bill with this number is in the current copy of the ${session} session. Check the bill number, or search the session.`
              : 'No bill with this number is in the current copy. Check the bill number, or search the session.'}
          </p>
        </section>
      </Frame>
    );
  }
  if (!bill) {
    return (
      <Frame back={back}>
        <Refused onRetry={record.retry} retrying={record.pending}>
          We couldn’t load this bill right now. Please try again in a moment.
        </Refused>
      </Frame>
    );
  }

  const code = billCode(null, null, bill.id);
  const chamber = fileChamber(code);
  const session = bill.session ? sessionShortLabel(bill.session) : billSession(bill.id);
  const status = billStatus(bill.status_key, bill.current_status);
  const statusDate = dayLabel(bill.latest_action_at);
  const actions = orderActions(bill.actions ?? [])
    .map(actionRow)
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const voteList = votes.data ? orderVotes(votes.data) : [];
  const source = legislatureSource(bill.last_pulled_at);
  const current = versions.find((row) => row.isCurrent) ?? defaultTextVersion(versions);
  const sponsors = ownAuthors(bill.all_sponsors ?? bill.chief_sponsors ?? [], chamber);
  const chiefs = sponsors.filter((sponsor) => sponsor.role === 'chief_author');
  const coauthors = sponsors.filter((sponsor) => sponsor.role === 'co_author');
  const committee =
    orderActions(bill.actions ?? [])
      .map((action) => (action.committee_name ?? '').trim())
      .find(Boolean) ?? null;
  const overview = billOverviewUrl(bill.official_url);
  const summary = plainBillSummary(bill.ai_analysis?.summary);
  const citations = summary ? (bill.ai_analysis?.citations ?? []) : [];
  const legislatorLink = (legislatorId: string | null | undefined) =>
    legislatorId && isBuilt('legislator')
      ? withFrom(hrefFor('legislator', { id: legislatorId }), here)
      : null;
  const voteLink = (voteId: string) =>
    isBuilt('roll-call')
      ? withFrom(hrefFor('roll-call', { id: voteId }, { bill: bill.id }), here)
      : null;
  // A tally on an action with no roll call to match means the copy lacks it.
  const tallyWithoutVote = actions.some((row) => row.tally && !voteForAction(row, voteList));

  const tabs: Tab<BillTab>[] = [
    { value: 'summary', label: 'Summary' },
    { value: 'actions', label: 'Actions', count: String(actions.length) },
    { value: 'votes', label: 'Votes', count: votes.data ? String(voteList.length) : null },
    { value: 'text', label: 'Bill Text' },
    { value: 'versions', label: 'Versions', count: String(versions.length) },
  ];

  return (
    <Frame back={back}>
      <header className="bl-header">
        <div className="bl-tags">
          {code && <span className="f-code bl-code">{code}</span>}
          <span className="bl-session">
            {[session ? `${session} session` : null, chamber].filter(Boolean).join(' · ')}
          </span>
          {bill.is_omnibus && <span className="bl-omnibus">OMNIBUS</span>}
        </div>
        <h1 tabIndex={-1} className="f-page-title bl-title">
          {billHeading(bill.ai_analysis?.short_title, code) || bill.id}
        </h1>
        <p className="bl-status">{[status, statusDate].filter(Boolean).join(' · ')}</p>
      </header>

      <div className="bl-layout">
        <div className="bl-main">
          <div className="bl-tabs">
            <Tabs
              label="Bill sections"
              value={tab}
              tabs={tabs}
              onChange={(value) => setAddress({ tab: value })}
            />
          </div>

          {tab === 'summary' && (
            <section aria-label="Summary" className="bl-panel bl-summary">
              {summary ? (
                <>
                  <div className="f-card">
                    <h2 className="f-card-title">Summary</h2>
                    <p className="bl-summary-text">{summary}</p>
                    <p className="bl-meta">Alethical summary · {source}</p>
                  </div>
                  {citations.length > 0 && (
                    <div>
                      <h2 className="f-card-title bl-from">
                        <CheckCircle />
                        From the bill
                      </h2>
                      <ol className="bl-citations">
                        {citations.map((citation) => (
                          <li key={citation.id} className="bl-citation">
                            <div className="bl-citation-head">
                              <span className="bl-citation-where">
                                {citationLabel(citation.label, citation.section_topic)}
                              </span>
                              {current && (
                                <span className="bl-citation-version">{current.label} version</span>
                              )}
                            </div>
                            <blockquote>{citation.excerpt}</blockquote>
                            {current && (
                              <button
                                type="button"
                                className="bl-text-button"
                                onClick={() =>
                                  openText(current, {
                                    sectionId: citation.section_id,
                                    sourceOrder: citation.section_order ?? null,
                                  })
                                }
                              >
                                <span>
                                  <WithArrow>Read the bill text</WithArrow>
                                </span>
                              </button>
                            )}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </>
              ) : (
                <div className="f-card">
                  <h2 className="f-card-title">Official description</h2>
                  <p className={bill.description ? 'bl-summary-text' : 'bl-summary-text bl-muted'}>
                    {bill.description?.trim() || 'Not held in this copy'}
                  </p>
                  <p className="bl-meta">
                    No Alethical summary yet. The official description and full text are available.
                  </p>
                  {current && (
                    <button
                      type="button"
                      className="bl-text-button bl-text-button-tall"
                      onClick={() => openText(current, null)}
                    >
                      <span>
                        <WithArrow>Read the bill text</WithArrow>
                      </span>
                    </button>
                  )}
                </div>
              )}
            </section>
          )}

          {tab === 'actions' && (
            <section aria-label="Actions" className="bl-panel">
              {actions.length === 0 ? (
                <Empty title="Not held in this copy" />
              ) : (
                <ol className="bl-actions">
                  {actions.map((row) => {
                    const vote = voteForAction(row, voteList);
                    const href = vote ? voteLink(vote.id) : null;
                    return (
                      <li key={row.key} className="bl-action">
                        <span className="bl-action-date">{row.date ?? ''}</span>
                        <span className="bl-action-text">
                          {row.text}
                          {href && (
                            <>
                              {' '}
                              <Link to={href} className="bl-inline-link">
                                Roll call
                              </Link>
                            </>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
              <p className="lg-note">
                Actions are recorded events from the Legislature’s journal. The latest action is the
                bill’s recorded status.
              </p>
            </section>
          )}

          {tab === 'votes' && (
            <section aria-label="Votes" className="bl-panel">
              {votes.loading && <LoadingRows />}
              {votes.failed && (
                <Refused onRetry={votes.retry} retrying={votes.pending}>
                  We couldn’t load this bill’s votes right now. Please try again in a moment.
                </Refused>
              )}
              {votes.data && voteList.length === 0 && (
                <Empty
                  title={
                    tallyWithoutVote
                      ? 'Roll calls for this bill are not held in this copy'
                      : 'No roll call is recorded for this bill'
                  }
                />
              )}
              {voteList.length > 0 && (
                <>
                  <ul className="bl-votes">
                    {voteList.map((vote) => (
                      <li key={vote.id}>
                        <VoteCard vote={vote} href={voteLink(vote.id)} />
                      </li>
                    ))}
                  </ul>
                  <p className="lg-note">
                    Each roll call is one recorded motion. A vote result differs from the bill’s
                    eventual status.
                  </p>
                </>
              )}
            </section>
          )}

          {tab === 'text' && (
            <section aria-label="Bill Text" className="f-card bl-panel bl-text">
              {chosenVersion ? (
                <>
                  <div className="bl-text-head">
                    <h2 className="f-card-title">
                      Bill text · {versionPhrase(chosenVersion.label)} version
                    </h2>
                    {chosenVersion.date && (
                      <span className="bl-meta-inline">Posted {chosenVersion.date}</span>
                    )}
                  </div>
                  <BillText
                    read={text}
                    versionLabel={versionPhrase(chosenVersion.label)}
                    target={target}
                  />
                </>
              ) : (
                <div className="bl-missing">Not held in this copy</div>
              )}
            </section>
          )}

          {tab === 'versions' && (
            <section aria-label="Versions" className="bl-panel">
              {versions.length === 0 ? (
                <Empty title="Not held in this copy" />
              ) : (
                <ul className="bl-versions">
                  {versions.map((row) => (
                    <li key={row.code} className="bl-version">
                      <span>
                        <span className="bl-version-label">{row.label}</span>
                        {row.date && <span className="bl-version-date">Posted {row.date}</span>}
                      </span>
                      {row.isLaw ? (
                        row.url && (
                          <a
                            href={row.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="f-dest bl-version-action"
                          >
                            <span>
                              <WithArrow>Read the full law</WithArrow>
                            </span>
                            <span className="f-visually-hidden"> (opens in a new tab)</span>
                          </a>
                        )
                      ) : (
                        <button
                          type="button"
                          className="bl-text-button bl-version-action"
                          onClick={() => openText(row, null)}
                        >
                          <span>
                            <WithArrow>Read the bill text</WithArrow>
                          </span>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        <aside className="bl-aside">
          <section className="f-card bl-facts">
            <dl>
              <div>
                <dt>Chief author</dt>
                <dd>
                  {chiefs.length === 0 ? (
                    <span className="bl-muted">Not held in this copy</span>
                  ) : (
                    chiefs.map((author, index) => (
                      <span key={author.legislator_id ?? author.name} className="bl-chief">
                        {index > 0 && '; '}
                        <PersonName
                          name={author.name}
                          href={legislatorLink(author.legislator_id)}
                        />
                        {seatLabel(author.district, author.chamber) && (
                          <span className="bl-secondary">
                            {' '}
                            · {seatLabel(author.district, author.chamber)}
                          </span>
                        )}
                      </span>
                    ))
                  )}
                </dd>
              </div>
              <div>
                <dt>Co-authors</dt>
                <dd className={coauthors.length ? undefined : 'bl-muted'}>
                  {coauthors.length
                    ? coauthors.map((author) => author.name).join('; ')
                    : 'Not held in this copy'}
                </dd>
              </div>
              <div>
                <dt>Companion bill</dt>
                <dd>
                  {bill.companion ? (
                    isBuilt('bill') ? (
                      <Link
                        to={withFrom(hrefFor('bill', { id: bill.companion.id }), here)}
                        className="f-code bl-companion"
                      >
                        {bill.companion.code}
                      </Link>
                    ) : (
                      <span className="f-code">{bill.companion.code}</span>
                    )
                  ) : (
                    <span className="bl-muted">None recorded</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Committee</dt>
                <dd className={committee ? undefined : 'bl-muted'}>
                  {committee ?? 'Not held in this copy'}
                </dd>
              </div>
            </dl>
            {overview && (
              <a
                href={overview}
                target="_blank"
                rel="noopener noreferrer"
                className="f-dest bl-official"
              >
                <span>
                  <WithArrow>Official source website</WithArrow>
                </span>
                <span className="f-visually-hidden"> (opens in a new tab)</span>
              </a>
            )}
            <p className="bl-meta bl-facts-source">{source}</p>
          </section>
          <AuthorsAccounts
            read={authors}
            chamber={chamber}
            here={here}
            legislatorLink={legislatorLink}
          />
        </aside>
      </div>
    </Frame>
  );
}

function Frame({
  back,
  children,
}: {
  back: { to: string; name: string } | null;
  children: ReactNode;
}) {
  return (
    <main id="main" className="f-page bl-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
        {children}
      </div>
    </main>
  );
}

function CheckCircle() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="#0E6A82" strokeWidth="2" />
      <path
        d="M8 12.5 L10.8 15.2 L16 9.5"
        stroke="#0E6A82"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * "Sec. 2 · Topic": the stored label with the bill code and closing period
 * dropped, and the served section topic added when the label carries none or
 * carries one cut off mid-word (the public site's `citationChipLabel`).
 */
export function citationLabel(label: string, topic?: string | null): string {
  let value = label
    .trim()
    .replace(/^(?:HF|SF)\s*\d+\s*,\s*/i, '')
    .replace(/\bSection\s+/i, 'Sec. ');
  const cut = / · .*…$/.test(value);
  if (cut) value = value.replace(/ · .*$/, '');
  value = value.replace(/\.\s*$/, '');
  const served = (topic ?? '').trim();
  if (!served || (!cut && value.includes(' · '))) return value;
  if (!/^(?:Art\. [\w.-]+, )?Sec\. [\w.-]+$/.test(value)) return value;
  return `${value} · ${served}`;
}

function PersonName({ name, href }: { name: string; href: string | null }) {
  return href ? (
    <Link to={href} className="bl-name-link">
      {name}
    </Link>
  ) : (
    <span className="bl-name">{name}</span>
  );
}

function VoteCard({ vote, href }: { vote: ServedVote; href: string | null }) {
  const meta = [chamberName(vote.chamber), dayLabel(vote.occurred_at)].filter(Boolean).join(' · ');
  const body = (
    <>
      <span className="bl-vote-main">
        <span className="bl-vote-motion">{vote.motion_text?.trim() || 'Roll call'}</span>
        {meta && <span className="bl-vote-meta">{meta}</span>}
      </span>
      <span className="bl-vote-figures">
        <span>
          <span className="bl-vote-label">Yes</span>
          <span className="bl-vote-count">{vote.yes_count ?? '—'}</span>
        </span>
        <span>
          <span className="bl-vote-label">No</span>
          <span className="bl-vote-count">{vote.no_count ?? '—'}</span>
        </span>
        {vote.result_text && <span className="bl-vote-result">{vote.result_text}</span>}
      </span>
      {href && <Arrow />}
    </>
  );
  return href ? (
    <Link to={href} className="bl-vote">
      {body}
    </Link>
  ) : (
    <div className="bl-vote">{body}</div>
  );
}

function ChangeRuns({ text }: { text: string }) {
  return (
    <>
      {parseChangeRuns(text).map((run, index) =>
        run.kind === 'removed' ? (
          <del key={index}>{run.text}</del>
        ) : run.kind === 'added' ? (
          <ins key={index}>{run.text}</ins>
        ) : (
          <span key={index}>{run.text}</span>
        ),
      )}
    </>
  );
}

function BillText({
  read,
  versionLabel,
  target,
}: {
  read: Read<VersionText>;
  versionLabel: string;
  target: SectionAnchor | null;
}) {
  const sections = useMemo(
    () =>
      (read.data?.sections ?? []).map((section) => ({
        ...section,
        sectionId: section.section_id,
        sourceOrder: section.source_order,
      })),
    [read.data],
  );
  const highlighted = resolveSectionAnchor(sections, target);
  const highlightId = highlighted ? sectionAnchorId(highlighted) : null;

  // A citation's Read opens its own section: scrolled below the header, focused, tinted.
  useEffect(() => {
    if (!highlightId) return;
    const element = document.getElementById(highlightId);
    element?.scrollIntoView?.({ block: 'start' });
    element?.focus({ preventScroll: true });
  }, [highlightId]);

  if (read.loading) return <LoadingRows />;
  if (read.failed) {
    return (
      <Refused onRetry={read.retry} retrying={read.pending}>
        We couldn’t load the full text right now. Please try again in a moment.
      </Refused>
    );
  }
  if (read.notFound || sections.length === 0) {
    return (
      <div className="bl-missing">Text of the {versionLabel} version is not held in this copy</div>
    );
  }
  let article: string | null = null;
  return (
    <div className="bl-sections">
      {sections.map((section) => {
        const { number, title } = splitSectionLabel(section.heading);
        const label = [number, title].filter(Boolean).join(' · ');
        const anchor = sectionAnchorId(section);
        const articleHeading = (section.article_heading ?? '').trim();
        const showArticle = articleHeading && articleHeading !== article;
        if (articleHeading) article = articleHeading;
        const paragraphs = cleanSectionText(section.text ?? '')
          .split(/\n\s*\n/)
          .map((paragraph) => paragraph.trim())
          .filter(Boolean);
        return (
          <div key={anchor}>
            {showArticle && <h3 className="bl-article">{articleHeading}</h3>}
            <div
              id={anchor}
              tabIndex={-1}
              className="bl-section"
              data-highlight={anchor === highlightId || undefined}
            >
              {label && <div className="bl-section-label">{label}</div>}
              {paragraphs.map((paragraph, index) => (
                <p key={index}>
                  <ChangeRuns text={paragraph} />
                </p>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AuthorsAccounts({
  read,
  chamber,
  here,
  legislatorLink,
}: {
  read: Read<AuthorsAnswer>;
  chamber: 'House' | 'Senate' | null;
  here: string;
  legislatorLink: (id: string | null | undefined) => string | null;
}) {
  const authors = read.data ? ownAuthors(read.data.authors ?? [], chamber) : [];
  return (
    <section aria-labelledby="authors-acc-h" className="f-card bl-accounts">
      <h2 id="authors-acc-h" className="f-card-title">
        Authors’ campaign accounts
      </h2>
      <p className="bl-accounts-intro">
        Each author’s own confirmed account. These are records only; they say nothing about why
        anyone authored this bill.
      </p>
      {read.loading && <LoadingRows />}
      {read.failed && (
        <div role="alert" className="bl-accounts-failed">
          <span>
            We couldn’t load the authors’ campaign accounts. This is a problem on our side.
          </span>
          <button
            type="button"
            className="f-btn f-btn-secondary f-btn-small"
            aria-disabled={read.pending || undefined}
            onClick={() => !read.pending && read.retry()}
          >
            Try again
          </button>
        </div>
      )}
      {read.data && authors.length === 0 && (
        <p className="bl-accounts-none">No authors are held in this copy</p>
      )}
      {authors.length > 0 && (
        <ul className="bl-accounts-list">
          {authors.map((author) => {
            const accounts =
              author.campaign_accounts?.link_state === 'confirmed'
                ? author.campaign_accounts.confirmed
                : [];
            return (
              <li key={author.legislator_id ?? author.name} className="bl-account">
                <span className="bl-account-head">
                  <PersonName name={author.name} href={legislatorLink(author.legislator_id)} />
                  <span className="bl-account-role">{roleLabel(author.role)}</span>
                </span>
                {accounts.length === 0 ? (
                  <span className="bl-secondary">
                    No campaign account is confirmed for this author
                  </span>
                ) : (
                  accounts.map((account) =>
                    isBuilt('committee') ? (
                      <Link
                        key={account.registration_number}
                        to={withFrom(
                          hrefFor('committee', { id: account.registration_number }),
                          here,
                        )}
                        className="f-dest bl-account-link"
                      >
                        <span>
                          <WithArrow>{account.committee_name}</WithArrow>
                        </span>
                      </Link>
                    ) : (
                      <span key={account.registration_number}>{account.committee_name}</span>
                    ),
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
