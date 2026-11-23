import { Logo } from '../parts/Logo';
import { Link } from '../router';
import './fonts.css';
import './landing.css';

const PLATFORM_URL = 'https://www.alethical.com/';

/**
 * Alethical.AI for investors, at /investors, from Design's "For Investors"
 * drawing (Alethical.AI landing and investor pages handoff, 23 Nov 2026). An
 * introduction only: raise amount, terms and milestones stay in the deck.
 */
export function Investors() {
  return (
    <div className="lp lp-investor-page">
      <div className="lp-glow lp-glow--one" aria-hidden="true" />
      <div className="lp-glow lp-glow--two" aria-hidden="true" />
      <header className="lp-wrap lp-top">
        <Link to="/" className="lp-logo lp-logo--link" aria-label="Alethical.AI">
          <Logo className="lp-wordmark" />
        </Link>
        <nav aria-label="Alethical.AI" className="lp-nav">
          <Link to="/investors" className="lp-investors" aria-current="page">
            For investors
          </Link>
          <Link to="/sign-in" className="lp-signin">
            Sign in
          </Link>
        </nav>
      </header>
      <main id="main" className="lp-investor-main">
        <div className="lp-wrap">
          <div className="lp-investor-copy">
            <h1 tabIndex={-1}>Alethical.AI for investors</h1>
            <div className="lp-investor-text">
              <p>
                Our team draws on more than 20 million public records to answer questions about
                politics and policy, from who paid for a campaign ad to how lawmakers voted on a
                bill.
              </p>
              <p>
                We plan to train an AI analyst on expert-checked examples so researchers can ask
                those questions directly and see the filings behind each answer.
              </p>
              <p>
                We’re asking political and policy researchers which questions come up most or are
                hardest to answer, what decisions depend on those answers and what research they’d
                pay for.
              </p>
            </div>
            <Link to="/investor-access" className="lp-demo">
              Investor access
            </Link>
          </div>
        </div>
      </main>
      <footer className="lp-footer">
        <p>
          Alethical.AI is the professional research product on the{' '}
          <a href={PLATFORM_URL}>Alethical platform</a>
        </p>
      </footer>
    </div>
  );
}
