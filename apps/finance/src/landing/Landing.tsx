import { useEffect, useRef, useState, type MouseEvent } from 'react';

import { useFinanceSession } from '../auth/session';
import { Link } from '../router';
import { Diagram } from './Diagram';
import { LandingShare } from './LandingShare';
import { copyDate, fetchCounts, figuresFrom, type ServedCounts } from './counts';
import { startSilk, type Silk } from './silk';
import './fonts.css';
import './landing.css';

/**
 * Alethical Finance's public landing page, built from the approved Design drawing
 * "Product Landing" (Alethical B2B project). Its words are the drawing's; its
 * counts and source dates are read live (./counts.ts).
 */

const BENEFITS = [
  {
    title: 'See who gives, who spends and who gets paid',
    detail:
      'Follow contributions and payments across candidate campaigns, Committees and Funds, and Party Units. See who funds a campaign, who receives its spending and who pays for outside support or opposition.',
  },
  {
    title: 'Understand the people behind the records',
    detail:
      'Explore professional roles, firm ties, affiliations and political giving, including committee chairs, treasurers and officer history. Expand the connections around a profile to follow your next lead.',
  },
  {
    title: 'Put lobbying and legislation in context',
    detail:
      'Connect lobbyists, firms and the clients they represent. Compare reported spending and explore documented involvement in bills, committee work and regulatory issues.',
  },
  {
    title: 'See the business behind a media buy',
    detail:
      'Find an agency, client or station and explore the purchases that connect them. See who arranged and signed a buy, compare documented purchase amounts and commissions, and open the contracts and invoices behind them.',
  },
  {
    title: 'Compare political money with election results',
    detail:
      'Compare campaign money and outside support or opposition with race and precinct results. See how candidates a contributor backed performed across races and election cycles.',
  },
];

function Flow({ steps }: { steps: readonly [string, string, string] }) {
  return (
    <ol className="lp-flow" role="list">
      {steps.map((step, index) => (
        <li key={step}>
          <span className="lp-dot" aria-hidden="true" />
          {step}
          {index < steps.length - 1 && (
            <svg viewBox="0 0 24 26" width="24" height="26" aria-hidden="true" focusable="false">
              <path d="M0 0 C0 15 24 10 24 26" />
            </svg>
          )}
        </li>
      ))}
    </ol>
  );
}

function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="8 9 84 84" aria-hidden="true" focusable="false">
      <path d="M8,92 L46,10 L46,92 Z" fill="#5CC2DC" />
      <path d="M92,92 L54,10 L54,92 Z" fill="#5CC2DC" />
    </svg>
  );
}

function Lockup({ className }: { className: string }) {
  return (
    <div className={`lp-lockup ${className}`}>
      <Mark size={className === 'lp-lockup--bar' ? 20 : 22} />
      <span className="lp-wordmark">ALETHICAL</span>
      <span className="lp-divider" aria-hidden="true" />
      <span className="lp-product">Finance</span>
    </div>
  );
}

export function Landing() {
  const { apiBaseUrl, screens } = useFinanceSession();
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

  const figures = figuresFrom(counts);
  const sources = [
    {
      name: 'Minnesota Campaign Finance and Public Disclosure Board',
      lines: [
        ['Campaign money · Payment files', copyDate(counts, 'campaign_money_records')],
        ['Lobbying · Spending file; lobbyist list', copyDate(counts, 'lobbying_spending_reports')],
      ],
    },
    {
      name: 'Minnesota Legislature',
      lines: [['Legislation · Bills', copyDate(counts, 'current_legislature_bills'), 'updated']],
    },
    {
      name: 'KSTP-TV, KARE and KMSP-TV, from the FCC’s public files',
      lines: [['Media buys · TV station files', copyDate(counts, 'tv_station_files')]],
    },
  ];

  return (
    <div className="lp">
      <div className={`lp-bar${pastHero ? ' lp-bar--shown' : ''}`} aria-hidden={!pastHero}>
        <Lockup className="lp-lockup--bar" />
        <Link to="/sign-in" className="lp-signin lp-signin--bar" tabIndex={pastHero ? 0 : -1}>
          Sign in
        </Link>
      </div>
      <main id="main">
        <div className="lp-hero" ref={hero} onMouseMove={point}>
          <canvas className="lp-silk" ref={canvas} aria-hidden="true" />
          <div className="lp-wrap">
            <header className="lp-top">
              <Lockup className="lp-lockup--hero" />
              <Link
                to="/sign-in"
                className="lp-signin"
                tabIndex={pastHero ? -1 : 0}
                aria-hidden={pastHero}
              >
                Sign in
              </Link>
            </header>
            <div className="lp-hero-copy">
              <h1 tabIndex={-1}>Connect political money, people and policy</h1>
              <p>Political intelligence for law firms, PACs and research teams</p>
              {screens && (
                <Link className="lp-demo" to="/investor-access">
                  Investor access
                </Link>
              )}
            </div>
          </div>
        </div>
        <section className="lp-story lp-wrap" aria-labelledby="lp-story-heading">
          <h2 id="lp-story-heading">Start with a name, follow the connections</h2>
          <p className="lp-story-intro">
            Search across candidates, contributors, committees and organizations, then explore the
            money, people and activity connected to them
          </p>
          <Diagram />
          <div className="lp-benefits">
            {BENEFITS.map(({ title, detail }) => (
              <div key={title} className="lp-benefit">
                <h3>{title}</h3>
                <p>{detail}</p>
              </div>
            ))}
          </div>
        </section>
        <div className="lp-research">
          <div className="lp-support lp-wrap">
            <section aria-labelledby="lp-import-heading">
              <h2 id="lp-import-heading">Put your research to work</h2>
              <p>
                Upload reports, review the evidence and add selected findings to relevant profiles
                and records
              </p>
              <Flow steps={['Your reports', 'Supported findings', 'Connected records']} />
            </section>
            <div className="lp-support-stack">
              <section aria-labelledby="lp-repeat-heading">
                <h2 id="lp-repeat-heading">Build on your research</h2>
                <p>Save sourced reports and comparisons, run them again and see what changed</p>
              </section>
              <section aria-labelledby="lp-evidence-heading">
                <h2 id="lp-evidence-heading">Go straight to the evidence</h2>
                <p>
                  Open the filing, source document or passage behind a figure or relationship, so
                  you can check the basis for your decisions
                </p>
              </section>
            </div>
          </div>
        </div>
        <section className="lp-support lp-service lp-wrap" aria-labelledby="lp-service-heading">
          <div>
            <h2 id="lp-service-heading">Keep client work moving</h2>
            <p>
              Bring files, research requests, feedback and approvals together in a private
              workspace. Review and receive briefs with the sources behind them.
            </p>
          </div>
          <Flow steps={['Files and requests', 'Research and review', 'Delivered briefs']} />
        </section>
        <div className="lp-dark">
          <div className="lp-glow lp-glow--one" aria-hidden="true" />
          <div className="lp-glow lp-glow--two" aria-hidden="true" />
          {figures.length > 0 && (
            <div className="lp-figures">
              <h2 className="lp-eyebrow">BUILT ON MINNESOTA PUBLIC RECORDS</h2>
              <div className="lp-figure-grid">
                {figures.map((figure) => (
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
          )}
          <LandingShare />
        </div>
      </main>
      <section className="lp-sources" aria-labelledby="land-src-h">
        <div className="lp-sources-inner">
          <h2 id="land-src-h">Sources and updates</h2>
          <dl>
            {sources.map((source) => (
              <div key={source.name}>
                <dt>{source.name}</dt>
                {source.lines.map(([what, date, verb = 'copied']) => (
                  <dd key={what}>
                    {what}
                    {date && (
                      <>
                        {` ${verb} `}
                        <span className="lp-nowrap">{date}</span>
                      </>
                    )}
                  </dd>
                ))}
              </div>
            ))}
          </dl>
        </div>
      </section>
    </div>
  );
}
