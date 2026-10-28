import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';

import { useFinanceSession } from '../auth/session';
import { Link } from '../router';
import { PANES, linePaths, type RecordId } from './connections';
import { copyDate, fetchCounts, figuresFrom, type ServedCounts } from './counts';
import { startSilk, type Silk } from './silk';
import './fonts.css';
import './landing.css';

/**
 * Alethical Finance's public landing page, built from the approved Design drawing
 * "Product Landing" (Alethical B2B project). Its words are the drawing's; its
 * counts and source dates are read live (./counts.ts).
 */

export const DEMO_MAIL =
  'mailto:angel@alethical.com?cc=ask@alethical.com&subject=Alethical%20Finance%20demo';

const CONNECTIONS_WE_MAKE = [
  'People and organizations are linked to their records by registration number or a checked confirmation with its evidence, never by a matching name alone',
  'A TV station’s invoice is linked to the campaign payment it matches, and a station file to the committee or candidate it names',
  'One record for each person and organization across elections, offices and roles',
];

const BENEFITS = [
  {
    n: '01',
    title: 'Follow political money',
    detail:
      'Contributions, spending, outside spending, lobbying, media buys and who got paid, each linked to its source record',
  },
  {
    n: '02',
    title: 'Check records against your priorities',
    detail:
      'Compare candidates’ and legislators’ records, authored bills and roll-call votes, on the issues you care about',
  },
  {
    n: '03',
    title: 'Decide where to give, with evidence',
    detail:
      'Recommendations from Alethical, linked to the records, before the election; a review of what happened after it',
  },
];

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

function Diagram() {
  const frame = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<{ w: number; h: number; d: string[] } | null>(null);

  useLayoutEffect(() => {
    const box = frame.current;
    if (!box) return;
    const measure = () => {
      const f = box.getBoundingClientRect();
      const at = (selector: string) => box.querySelector(selector)?.getBoundingClientRect() ?? null;
      const d = linePaths({
        frame: f,
        text: (id: RecordId) => at(`[data-text="${id}"]`),
        dot: (id: RecordId) => at(`[data-dot="${id}"]`),
        pane: (id: string) => at(`[data-pane="${id}"]`),
      });
      setPaths((old) => {
        const next = { w: f.width, h: f.height, d };
        return old && old.w === next.w && old.h === next.h && old.d.join() === d.join()
          ? old
          : next;
      });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(box);
    window.addEventListener('resize', measure);
    void document.fonts?.ready.then(measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <div className="lp-diagram" ref={frame}>
      {paths && paths.d.length > 0 && (
        <svg className="lp-lines" width={paths.w} height={paths.h} aria-hidden="true">
          {paths.d.map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
      )}
      <ul className="lp-panes" aria-label="Records connected">
        {PANES.map((pane) => (
          <li key={pane.id} className="lp-pane" data-pane={pane.id}>
            <span className="lp-eyebrow lp-eyebrow--teal">{pane.title}</span>
            <ul className="lp-records">
              {pane.records.map((record, index) => (
                <li key={record} className="lp-record">
                  <span className="lp-dot" data-dot={`${pane.id}${index}`} aria-hidden="true" />
                  <span data-text={`${pane.id}${index}`}>{record}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DemoLink() {
  return (
    <a className="lp-demo" href={DEMO_MAIL}>
      Request a demo
    </a>
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
      lines: [['Media buys · Station files', copyDate(counts, 'tv_station_files')]],
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
      <div className="lp-hero" ref={hero} onMouseMove={point}>
        <canvas className="lp-silk" ref={canvas} aria-hidden="true" />
        <div className="lp-wrap">
          <header className="lp-top">
            <Lockup className="lp-lockup--hero" />
            <Link to="/sign-in" className="lp-signin">
              Sign in
            </Link>
          </header>
          <div className="lp-hero-copy">
            <h1>Turn policy priorities into a focused giving strategy</h1>
            <p>Political intelligence for law firms and PACs</p>
            <DemoLink />
          </div>
        </div>
      </div>
      <main id="main">
        <div className="lp-light">
          <h2>Connect money, people and policy</h2>
          <Diagram />
          <div className="lp-made">
            <h3>The connections we make</h3>
            <ul>
              {CONNECTIONS_WE_MAKE.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="lp-dark">
          <div className="lp-glow lp-glow--one" aria-hidden="true" />
          <div className="lp-glow lp-glow--two" aria-hidden="true" />
          {figures.length > 0 && (
            <div className="lp-figures">
              <div className="lp-eyebrow">BUILT ON MINNESOTA PUBLIC RECORDS</div>
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
          <div className="lp-benefits">
            <div className="lp-eyebrow">WHAT IT DOES</div>
            {BENEFITS.map((benefit) => (
              <div key={benefit.n} className="lp-benefit">
                <span className="lp-benefit-line" aria-hidden="true" />
                <div className="lp-benefit-n">{benefit.n}</div>
                <h3>{benefit.title}</h3>
                <p>{benefit.detail}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="lp-close">
          <DemoLink />
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
