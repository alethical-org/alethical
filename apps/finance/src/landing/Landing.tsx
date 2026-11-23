import { useEffect, useRef, useState, type MouseEvent } from 'react';

import { useFinanceSession } from '../auth/session';
import { Link } from '../router';
import { Diagram } from './Diagram';
import { LandingShare } from './LandingShare';
import { Logo } from '../parts/Logo';
import {
  dateOf,
  fetchCounts,
  figureGroups,
  recordsHeading,
  type CountKey,
  type ServedCounts,
} from './counts';
import { startSilk, type Silk } from './silk';
import './fonts.css';
import './landing.css';

/**
 * Alethical.AI's public landing page, built from Design's "Product Landing"
 * drawing (Alethical.AI landing and investor pages handoff, 23 Nov 2026). Its
 * words are the drawing's; its counts and dates are read live (./counts.ts).
 */

export const CONTACT_URL = 'https://www.alethical.com/about/contact?purpose=alethical-ai';
const PLATFORM_URL = 'https://www.alethical.com/';
const NO_DATE = 'Copy date not recorded';

const BENEFITS = [
  {
    title: 'See who gives, who spends and who gets paid',
    detail:
      'See who gave to a campaign, who its committee paid and what outside groups reported spending for or against candidates',
  },
  {
    title: 'Understand the people behind the records',
    detail:
      'See the fundraising committee a candidate registered and a legislator’s service in the Legislature. We plan to train the analyst on expert-checked examples of names that refer to the same person or organization.',
  },
  {
    title: 'Put lobbying and legislation in context',
    detail:
      'See who is registered to lobby, which clients they represent and what spending they report. Explore bills, votes and committee work.',
  },
  {
    title: 'See the business behind a media buy',
    detail:
      'Find political ad filings by station or advertiser. An invoice can name the agency, show what each spot cost and list the agency’s commission.',
  },
  {
    title: 'Compare political money with election results',
    detail:
      'Compare Minnesota election results with campaign money and outside spending where filings are available',
  },
];

const BUILDING = [
  {
    title: 'Bring your own research',
    detail: 'Upload a report and compare its findings with the public records it cites',
  },
  {
    title: 'See what changed',
    detail: 'Save a comparison and run it again when new filings arrive',
  },
  {
    title: 'Finish a brief with your team',
    detail:
      'Keep the files, sources and feedback together so your team can review and approve the brief in one place',
  },
];

/** The logo as a picture: the landing page is where it would link to. */
function LandingLogo() {
  return (
    <div className="lp-logo" role="img" aria-label="Alethical.AI">
      <Logo className="lp-wordmark" />
    </div>
  );
}

/** For investors and Sign in, in both the opening header and the slim bar. */
function LandingNav({ hidden }: { hidden: boolean }) {
  const tab = hidden ? -1 : 0;
  return (
    <nav aria-label="Alethical.AI" className="lp-nav">
      <Link to="/investors" className="lp-investors" tabIndex={tab}>
        For investors
      </Link>
      <Link to="/sign-in" className="lp-signin" tabIndex={tab}>
        Sign in
      </Link>
    </nav>
  );
}

export function Landing() {
  const { apiBaseUrl } = useFinanceSession();
  const hero = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const silk = useRef<Silk | null>(null);
  const [pastHero, setPastHero] = useState(false);
  const [counts, setCounts] = useState<ServedCounts>({});

  useEffect(() => {
    let active = true;
    void fetchCounts(apiBaseUrl).then((served) => {
      if (active) setCounts(served);
    });
    return () => {
      active = false;
    };
  }, [apiBaseUrl]);

  useEffect(() => {
    if (canvas.current) silk.current = startSilk(canvas.current);
    const watched = hero.current;
    const observer =
      watched && typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            ([entry]) => {
              setPastHero(!entry.isIntersecting);
              silk.current?.setVisible(entry.isIntersecting);
            },
            { threshold: 0.05 },
          )
        : null;
    if (watched) observer?.observe(watched);
    return () => {
      observer?.disconnect();
      silk.current?.stop();
      silk.current = null;
    };
  }, []);

  function point(event: MouseEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    silk.current?.point(
      (event.clientX - box.left) / box.width,
      1 - (event.clientY - box.top) / box.height,
    );
  }

  const groups = figureGroups(counts);
  // A source's own date shows only where it differs from its figure group's
  // date; a missing one is said plainly, never guessed.
  const sourceDate = (key: CountKey, label?: string, verb = 'copied') => {
    const date = dateOf(counts, key);
    const group = groups.find((each) => each.figures.some((figure) => figure.key === key));
    if (date && date === group?.date) return null;
    if (!label) return date ? `${verb[0].toUpperCase()}${verb.slice(1)} ${date}` : NO_DATE;
    return date ? `${label} ${verb} ${date}` : `${label}: ${NO_DATE.toLowerCase()}`;
  };
  const money = sourceDate('campaign_money_records');
  const lobbying = sourceDate('lobbying_spending_reports');
  const sources = [
    {
      name: 'Minnesota Campaign Finance and Public Disclosure Board',
      href: 'https://cfb.mn.gov/',
      supplies: 'Campaign money and lobbying',
      dates:
        money === lobbying
          ? [money]
          : [
              sourceDate('campaign_money_records', 'Campaign money'),
              sourceDate('lobbying_spending_reports', 'Lobbying'),
            ],
    },
    {
      name: 'Minnesota Legislature',
      href: 'https://www.leg.mn.gov/',
      supplies: 'Bills and recorded votes',
      dates: [sourceDate('current_legislature_bills', undefined, 'updated')],
    },
    {
      name: 'Federal Communications Commission',
      href: 'https://publicfiles.fcc.gov/',
      supplies:
        'Nationwide political ad filings and the locally copied KSTP-TV, KARE and KMSP-TV files',
      dates: [
        sourceDate('national_fcc_filings', 'Nationwide index', 'as of'),
        sourceDate('tv_station_files', 'Station files'),
      ],
    },
    {
      name: 'Minnesota Secretary of State',
      href: 'https://www.sos.state.mn.us/',
      supplies: 'Election results and their published status',
      dates: [sourceDate('election_races_with_results')],
    },
  ];

  return (
    <div className="lp">
      <div className={`lp-bar${pastHero ? ' lp-bar--shown' : ''}`} aria-hidden={!pastHero}>
        <LandingLogo />
        <LandingNav hidden={!pastHero} />
      </div>
      <header className="lp-hero" ref={hero} onMouseMove={point}>
        <canvas className="lp-silk" ref={canvas} aria-hidden="true" />
        <div className="lp-wrap">
          <div className="lp-top">
            <LandingLogo />
            <div aria-hidden={pastHero} className="lp-top-nav">
              <LandingNav hidden={pastHero} />
            </div>
          </div>
          <div className="lp-hero-copy">
            <h1 tabIndex={-1}>A clearer view of money and media in elections and legislation</h1>
            <p>
              We’re building a specialized AI analyst for political and policy researchers who need
              answers no single filing can give. Today, bring your question to our team. You’ll get
              a report with links to the original filings.
            </p>
            <a className="lp-demo" href={CONTACT_URL}>
              Contact our team
            </a>
          </div>
        </div>
      </header>
      <main id="main">
        <section className="lp-story lp-wrap" aria-labelledby="lp-story-heading">
          <h2 id="lp-story-heading">Start with a name, follow the connections</h2>
          <p className="lp-story-intro">
            Start with a candidate, committee or agency. Our team compares the records that name
            them. We’re building an AI analyst to help researchers follow the same trail.
          </p>
          <Diagram />
          <ul className="lp-benefits">
            {BENEFITS.map(({ title, detail }) => (
              <li key={title} className="lp-benefit">
                <h3>{title}</h3>
                <p>{detail}</p>
              </li>
            ))}
          </ul>
        </section>
        <section className="lp-building" aria-labelledby="lp-building-heading">
          <div className="lp-wrap">
            <h2 id="lp-building-heading">What we’re building</h2>
            <p className="lp-building-intro">
              We’re building a private workspace where you can ask a question in your own words and
              follow the answer back to the filings
            </p>
            <ul className="lp-plans">
              {BUILDING.map(({ title, detail }) => (
                <li key={title} className="lp-plan">
                  <h3>{title}</h3>
                  <p>{detail}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section className="lp-dark" aria-labelledby={groups.length ? 'lp-fig-heading' : undefined}>
          <div className="lp-glow lp-glow--one" aria-hidden="true" />
          <div className="lp-glow lp-glow--two" aria-hidden="true" />
          {groups.length > 0 && (
            <div className="lp-figures">
              <h2 id="lp-fig-heading">{recordsHeading(groups)}</h2>
              <div className="lp-figure-groups">
                {groups.map((group) => (
                  <div
                    key={group.id}
                    role="group"
                    aria-labelledby={group.id}
                    className={`lp-figure-group lp-figure-group--${group.figures.length > 1 ? 'many' : 'one'}`}
                  >
                    <div id={group.id} className="lp-figure-group-head">
                      <h3 className="lp-eyebrow">{group.name}</h3>
                      {group.date && <span>As of {group.date}</span>}
                    </div>
                    <div className="lp-figure-grid">
                      {group.figures.map((figure) => (
                        <div key={figure.key} className="lp-figure">
                          <div className="lp-figure-value">{figure.value}</div>
                          <div className="lp-figure-text">
                            <div className="lp-figure-label">{figure.label}</div>
                            {figure.span && <div className="lp-figure-span">{figure.span}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <LandingShare />
        </section>
      </main>
      <section className="lp-sources" aria-labelledby="land-src-h">
        <div className="lp-sources-inner">
          <h2 id="land-src-h">Sources and updates</h2>
          <dl>
            {sources.map((source) => (
              <div key={source.name}>
                <dt>
                  <a href={source.href}>{source.name}</a>
                </dt>
                <dd>{source.supplies}</dd>
                {source.dates.filter(Boolean).map((date) => (
                  <dd key={date} className="lp-source-date">
                    {date}
                  </dd>
                ))}
              </div>
            ))}
          </dl>
        </div>
      </section>
      <footer className="lp-footer">
        <p>
          Alethical.AI is the professional research product on the{' '}
          <a href={PLATFORM_URL}>Alethical platform</a>
        </p>
      </footer>
    </div>
  );
}
