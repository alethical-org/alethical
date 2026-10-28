import { useEffect, useRef, useState, type ReactNode } from 'react';

import { clearReadCache } from '../api/read';
import { useFinanceSession } from '../auth/session';
import { clearSavedScroll, Link, navigate, useLocation } from '../router';
import { isBuilt, type NavSection, type RouteName } from '../routes';
import { useSuggestionBox } from '../search/SuggestionBox';
import { useBand } from '../ui/band';

/** The record families, in the drawing's order and words (Finance Nav). A family
 * whose page is not built yet is left out, never linked to a missing page. */
const FAMILIES: ReadonlyArray<{ section: NavSection; label: string; to: string; route: RouteName }> = [
  { section: 'money', label: 'Money', to: '/money', route: 'campaign-money' },
  { section: 'lobbying', label: 'Lobbying', to: '/lobbying', route: 'lobbying' },
  { section: 'people', label: 'People', to: '/people', route: 'people' },
  { section: 'legislation', label: 'Legislation', to: '/bills', route: 'legislation' },
  { section: 'media-buys', label: 'Media buys', to: '/media-buys', route: 'media-buys' },
];

export function navItems() {
  return FAMILIES.filter((item) => isBuilt(item.route));
}

function Lockup() {
  return (
    <Link to="/home" aria-label="Alethical Finance home" className="f-nav-lockup">
      <svg width="20" height="20" viewBox="8 9 84 84" aria-hidden="true">
        <path d="M8,92 L46,10 L46,92 Z" fill="#5CC2DC" />
        <path d="M92,92 L54,10 L54,92 Z" fill="#5CC2DC" />
      </svg>
      <span className="f-nav-wordmark">ALETHICAL</span>
      <span aria-hidden="true" className="f-nav-divider" />
      <span className="f-nav-product">Finance</span>
    </Link>
  );
}

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
      <path d="M16 16 L20.5 20.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

async function signOutTo(signOut: () => Promise<void>) {
  clearReadCache();
  clearSavedScroll();
  await signOut();
  navigate('/sign-in', { replace: true });
}

/** The signed-in frame: lockup, record families, search with suggestions and
 * the Account menu; on phone, a menu holding the families and Sign out. */
export function AppShell({ section, children }: { section?: NavSection; children: ReactNode }) {
  const band = useBand();
  const location = useLocation();
  const { email, signOut } = useFinanceSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const here = location.pathname + location.search;
  const search = useSuggestionBox('nav-sg', here);
  const accountButton = useRef<HTMLButtonElement>(null);
  const accountWrap = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);
  const items = navItems();

  // Every new page closes the header's menus.
  useEffect(() => {
    setMenuOpen(false);
    setAccountOpen(false);
    setSearchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen && !accountOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (accountOpen) accountButton.current?.focus();
      if (menuOpen) menuButton.current?.focus();
      setAccountOpen(false);
      setMenuOpen(false);
    }
    function onPointer(event: PointerEvent) {
      const target = event.target as Node;
      if (accountOpen && !accountWrap.current?.contains(target)) setAccountOpen(false);
      if (menuOpen && !header.current?.contains(target)) setMenuOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [accountOpen, menuOpen]);

  const isPhone = band === 'phone';
  const isComputer = band === 'computer';

  const searchField = (rowStyle: boolean) => (
    <form
      role="search"
      ref={search.rootRef}
      onSubmit={search.submit}
      className={rowStyle ? 'f-nav-search-row' : 'f-nav-search'}
    >
      <label htmlFor={rowStyle ? 'nav-search-row' : 'nav-search'} className="f-visually-hidden">
        Search records
      </label>
      <input
        {...search.inputProps}
        id={rowStyle ? 'nav-search-row' : 'nav-search'}
        placeholder="Search records"
        className="f-nav-field"
      />
      <button type="submit" className="f-nav-submit">
        Search
      </button>
      {search.panel && <div className="f-sg-anchor">{search.panel}</div>}
    </form>
  );

  return (
    <div className="f-app">
      <a className="f-skip" href="#main">
        Skip to content
      </a>
      <header className="f-nav" ref={header}>
        <div className="f-nav-bar">
          <Lockup />
          {!isPhone && (
            <nav aria-label="Record families" className="f-nav-families">
              {items.map((item) => (
                <Link
                  key={item.section}
                  to={item.to}
                  aria-current={item.section === section ? 'page' : undefined}
                  className="f-nav-link"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          )}
          {isPhone && <div className="f-nav-spacer" />}
          {isComputer && searchField(false)}
          {!isComputer && (
            <button
              type="button"
              aria-label="Search records"
              aria-expanded={searchOpen}
              className="f-nav-icon"
              onClick={() => {
                setSearchOpen((value) => !value);
                setMenuOpen(false);
                setAccountOpen(false);
              }}
            >
              <SearchIcon />
            </button>
          )}
          {!isPhone && (
            <div className="f-nav-account" ref={accountWrap}>
              <button
                ref={accountButton}
                type="button"
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                aria-controls="account-menu"
                className="f-nav-account-button"
                onClick={() => {
                  setAccountOpen((value) => !value);
                  setMenuOpen(false);
                }}
              >
                Account
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M6 9 L12 15 L18 9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {accountOpen && (
                <div id="account-menu" role="menu" className="f-nav-account-menu">
                  <div className="f-nav-account-who">
                    <div className="f-label">SIGNED IN AS</div>
                    <div className="f-nav-account-email">{email}</div>
                  </div>
                  <div className="f-nav-rule" />
                  <button
                    type="button"
                    role="menuitem"
                    className="f-nav-menuitem"
                    onClick={() => void signOutTo(signOut)}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
          {isPhone && (
            <button
              ref={menuButton}
              type="button"
              aria-label="Menu"
              aria-expanded={menuOpen}
              className="f-nav-icon"
              onClick={() => {
                setMenuOpen((value) => !value);
                setSearchOpen(false);
                setAccountOpen(false);
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 7 H20 M4 12 H20 M4 17 H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        {searchOpen && !isComputer && searchField(true)}
        {menuOpen && isPhone && (
          <nav aria-label="Record families" className="f-nav-phone-menu">
            {items.map((item) => (
              <Link
                key={item.section}
                to={item.to}
                aria-current={item.section === section ? 'page' : undefined}
                className="f-nav-phone-link"
              >
                {item.label}
              </Link>
            ))}
            <div className="f-nav-rule f-nav-rule-dark" />
            <div className="f-nav-phone-who">
              <div className="f-label">SIGNED IN AS</div>
              <div className="f-nav-phone-email">{email}</div>
            </div>
            <button type="button" className="f-nav-phone-link f-nav-phone-signout" onClick={() => void signOutTo(signOut)}>
              Sign out
            </button>
          </nav>
        )}
      </header>
      {children}
    </div>
  );
}
