import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useFinanceSession } from '../auth/session';
import { Link, navigate } from '../router';
import type { NavSection } from '../routes';

export const NAV_ITEMS: ReadonlyArray<{ section: NavSection; label: string; to: string }> = [
  { section: 'money', label: 'Campaign money', to: '/money' },
  { section: 'lobbying', label: 'Lobbying', to: '/lobbying' },
  { section: 'people', label: 'People', to: '/people' },
  { section: 'legislation', label: 'Legislation', to: '/bills' },
  { section: 'media-buys', label: 'Media buys', to: '/media-buys' },
];

function AccountMenu() {
  const { email, signOut } = useFinanceSession();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="account" ref={wrapper}>
      <button
        ref={button}
        type="button"
        className="secondary"
        aria-expanded={open}
        aria-controls="account-menu"
        onClick={() => setOpen((value) => !value)}
      >
        Account
      </button>
      {open && (
        <div id="account-menu" className="menu">
          {email && <p className="menu-email">{email}</p>}
          <button
            type="button"
            onClick={async () => {
              await signOut();
              navigate('/sign-in', { replace: true });
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** The signed-in frame: lockup, record families and the Account menu. */
export function AppShell({ section, children }: { section?: NavSection; children: ReactNode }) {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="shell">
        <Link to="/" className="lockup">
          Alethical <span>Finance</span>
        </Link>
        <nav aria-label="Record families">
          <ul>
            {NAV_ITEMS.map((item) => (
              <li key={item.section}>
                <Link to={item.to} aria-current={item.section === section ? 'page' : undefined}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <AccountMenu />
      </header>
      {children}
    </>
  );
}
