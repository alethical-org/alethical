import { tooShortTitle } from '@alethical/shared/moneyNameSearch';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { apiGet } from '../api/read';
import { useFinanceSession } from '../auth/session';
import { navigate } from '../router';
import { withFrom } from '../returnContext';
import { RecordMark, type RecordKind } from '../ui/marks';
import { Arrow } from '../ui/parts';
import {
  MIN_SUGGEST_LENGTH,
  searchHref,
  suggestionGroups,
  type SuggestionGroup,
  type SuggestionKind,
  type SuggestionsAnswer,
} from './suggestions';

type Status = 'idle' | 'loading' | 'ready' | 'failed' | 'too-short';

const DEBOUNCE_MS = 140;
const CACHE_MS = 60_000;
const CACHE_LIMIT = 20;
let requestCounter = 0;

/**
 * The Finance Home search field (Search Suggestions drawing): suggestions from
 * 2 characters, 1 request
 * per pause in typing, a reply for an earlier query dropped by its request id,
 * arrow keys through every row and View all results, Enter to open, Escape to
 * close.
 */
export function useSuggestionBox(id: string, from: string | null) {
  const {
    apiBaseUrl,
    accessToken,
    email,
    signInPath,
    status: accessStatus,
    retry: checkAccess,
  } = useFinanceSession();
  const allowed = accessStatus === 'granted';
  // Refreshing the same account's token must not erase what the reader typed.
  // Without a known identity, retain the stricter token boundary.
  const accountScope = `${apiBaseUrl}|${email ?? accessToken}|${signInPath}|${allowed}`;
  const scope = `${accountScope}|${accessToken}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const accessCheck = useRef(checkAccess);
  accessCheck.current = checkAccess;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [held, setHeld] = useState<{
    scope: string;
    query: string;
    groups: SuggestionGroup[];
  } | null>(null);
  const own = held?.scope === scope ? held : null;
  const groups = own?.groups ?? [];
  const [active, setActive] = useState(-1);
  const [maxHeight, setMaxHeight] = useState(420);
  const root = useRef<HTMLElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const retryButton = useRef<HTMLButtonElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef('');
  const controller = useRef<AbortController | null>(null);
  const pendingQuery = useRef<{ scope: string; typed: string } | null>(null);
  // Only this mounted field and account can reuse these short-lived answers.
  const cache = useRef(new Map<string, { at: number; groups: SuggestionGroup[] }>());
  const cacheScope = useRef(scope);

  const close = useCallback(() => {
    setOpen(false);
    setActive(-1);
  }, []);

  // The room between the field and the visible bottom of the screen, which
  // shrinks while an on-screen keyboard is up.
  const measure = useCallback(() => {
    const field = input.current;
    if (!field) return;
    const viewport = window.visualViewport;
    const bottom = viewport ? viewport.height + viewport.offsetTop : window.innerHeight;
    const room = Math.round(bottom - field.getBoundingClientRect().bottom - 14);
    setMaxHeight(Math.max(150, Math.min(480, room)));
  }, []);

  const run = useCallback(
    (value: string, immediate = false) => {
      const typed = value.trim();
      if (pendingQuery.current?.scope === scope && pendingQuery.current.typed === typed) {
        setOpen(true);
        measure();
        return;
      }
      clearTimeout(timer.current);
      controller.current?.abort();
      pendingQuery.current = null;
      const requestId = `sg${++requestCounter}`;
      // Invalidate now, not after the debounce: an older reply can arrive while
      // the reader is still typing the next query.
      latest.current = requestId;
      if (!allowed || !accessToken || typed.length < MIN_SUGGEST_LENGTH) {
        setStatus('idle');
        setHeld(null);
        close();
        return;
      }
      setOpen(true);
      setActive(-1);
      measure();
      if (cacheScope.current !== scope) {
        cache.current.clear();
        cacheScope.current = scope;
      }
      const cached = cache.current.get(typed);
      if (cached && Date.now() - cached.at < CACHE_MS) {
        setHeld({ scope, query: typed, groups: cached.groups });
        setStatus('ready');
        return;
      }
      cache.current.delete(typed);
      setStatus('loading');
      const abort = new AbortController();
      controller.current = abort;
      pendingQuery.current = { scope, typed };
      function request() {
        const path = `finance/suggestions?q=${encodeURIComponent(typed)}&request_id=${requestId}`;
        void apiGet<SuggestionsAnswer>(apiBaseUrl, path, accessToken, fetch, abort.signal).then(
          (answer) => {
            if (
              latest.current !== requestId ||
              currentScope.current !== scope ||
              abort.signal.aborted
            )
              return;
            pendingQuery.current = null;
            if (answer.state === 'ok' && answer.data.request_id === requestId) {
              const next = suggestionGroups(answer.data);
              const money = answer.data.money;
              if (money?.groups?.some((group) => group.reason === 'query_too_short')) {
                setHeld(null);
                setActive(-1);
                setStatus('too-short');
                return;
              }
              if (
                !money ||
                money.state === 'unavailable' ||
                money.groups?.some((group) => group.state === 'unavailable')
              ) {
                if (next.length) setHeld({ scope, query: typed, groups: next });
                setActive(-1);
                setStatus('failed');
                return;
              }
              cache.current.set(typed, { at: Date.now(), groups: next });
              if (cache.current.size > CACHE_LIMIT)
                cache.current.delete(cache.current.keys().next().value!);
              setHeld({ scope, query: typed, groups: next });
              setActive(-1);
              setStatus('ready');
            } else {
              if (answer.state === 'failed' && answer.accessDenied) {
                cache.current.clear();
                setHeld(null);
                setActive(-1);
                accessCheck.current?.();
              }
              setStatus('failed');
            }
          },
        );
      }
      if (immediate) request();
      else timer.current = setTimeout(request, DEBOUNCE_MS);
    },
    [accessToken, allowed, apiBaseUrl, close, measure, scope],
  );

  useEffect(() => {
    cache.current.clear();
    setHeld(null);
    setStatus('idle');
    close();
    return () => {
      latest.current = '';
      pendingQuery.current = null;
      clearTimeout(timer.current);
      controller.current?.abort();
      cache.current.clear();
    };
  }, [scope, close]);

  useEffect(() => setQuery(''), [accountScope]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) close();
    }
    const viewport = window.visualViewport ?? window;
    document.addEventListener('pointerdown', onPointer);
    viewport.addEventListener('resize', measure);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      viewport.removeEventListener('resize', measure);
    };
  }, [close, measure, open]);

  const rows = groups.flatMap((group) =>
    group.rows.map((row) => ({ ...row, href: withFrom(row.href, from) })),
  );
  const allHref = withFrom(searchHref(query), from);
  const hrefs = [...rows.map((row) => row.href), allHref];
  const allIndex = rows.length;
  const optionId = (index: number) => (index === allIndex ? `${id}-all` : `${id}-opt-${index}`);

  function keepVisible(index: number) {
    if (index === allIndex) return;
    window.setTimeout(() => {
      const element = document.getElementById(optionId(index));
      const list = element?.closest<HTMLElement>('[data-sg-list]');
      if (!element || !list) return;
      if (element.offsetTop < list.scrollTop + 8)
        list.scrollTop = Math.max(0, element.offsetTop - 30);
      else if (element.offsetTop + element.offsetHeight > list.scrollTop + list.clientHeight - 50) {
        list.scrollTop = element.offsetTop + element.offsetHeight - list.clientHeight + 50;
      }
    }, 0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const key = event.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        run(event.currentTarget.value);
        return;
      }
      const count = hrefs.length;
      const next =
        key === 'ArrowDown' ? (active + 1) % count : active <= 0 ? count - 1 : active - 1;
      setActive(next);
      keepVisible(next);
    } else if (key === 'Enter') {
      if (open && active >= 0) {
        event.preventDefault();
        close();
        navigate(hrefs[active]);
      }
    } else if (key === 'Escape') {
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    } else if (key === 'Tab') {
      if (open && !event.shiftKey && retryButton.current) {
        event.preventDefault();
        retryButton.current.focus();
      } else close();
    }
  }

  const count = rows.length;
  const failure =
    count > 0 && own?.query === query.trim()
      ? 'Some suggestions couldn’t load'
      : 'Suggestions couldn’t load';
  const previous =
    count > 0 && own && own.query !== query.trim() && (status === 'loading' || status === 'failed')
      ? `Previous suggestions for “${own.query}”`
      : '';
  const live = !open
    ? ''
    : status === 'too-short'
      ? tooShortTitle(3)
      : status === 'loading'
        ? 'Searching…'
        : status === 'failed'
          ? failure
          : count
            ? `${count} ${count === 1 ? 'suggestion' : 'suggestions'}`
            : 'No matching suggestions';

  const inputProps = {
    ref: input,
    type: 'search' as const,
    role: 'combobox',
    'aria-autocomplete': 'list' as const,
    'aria-expanded': open,
    'aria-controls': `${id}-list`,
    'aria-activedescendant': open && active >= 0 ? optionId(active) : undefined,
    autoComplete: 'off',
    enterKeyHint: 'search' as const,
    value: query,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      setQuery(event.target.value);
      run(event.target.value);
    },
    onFocus: () => {
      if (query.trim().length >= MIN_SUGGEST_LENGTH && !open) run(query);
    },
    onBlur: (event: FocusEvent<HTMLInputElement>) => {
      if (!root.current?.contains(event.relatedTarget as Node | null)) close();
    },
    onKeyDown,
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    close();
    navigate(withFrom(searchHref(query), from));
  }

  let index = -1;
  const panel = open ? (
    <SuggestionPanel
      listId={`${id}-list`}
      allId={`${id}-all`}
      allHref={allHref}
      allActive={active === allIndex}
      status={status}
      maxHeight={maxHeight}
      live={previous ? `${live} ${previous}` : live}
      previous={previous}
      failure={failure}
      retryRef={retryButton}
      onRetry={() => {
        input.current?.focus();
        run(query, true);
      }}
      onRetryBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node | null)) close();
      }}
      onRetryEscape={() => {
        input.current?.focus();
        close();
      }}
      onPick={close}
    >
      {groups.map((group) => (
        <div
          key={group.id}
          role="group"
          aria-labelledby={`${id}-h-${group.id}`}
          className="f-sg-group"
        >
          <div id={`${id}-h-${group.id}`} className="f-sg-group-title">
            {group.title}
          </div>
          {group.rows.map((row) => {
            index += 1;
            const at = index;
            return (
              <SuggestionRow
                key={rows[at].href}
                id={optionId(at)}
                kind={group.id}
                name={row.name}
                context={row.context}
                code={row.code}
                href={rows[at].href}
                selected={active === at}
                onPick={close}
              />
            );
          })}
        </div>
      ))}
    </SuggestionPanel>
  ) : null;

  // A callback ref, so the field's wrapper can be a form or a div.
  const rootRef = useCallback((element: HTMLElement | null) => {
    root.current = element;
  }, []);

  return { rootRef, inputProps, panel, submit, query };
}

const MARKS: Record<Exclude<SuggestionKind, 'bills'>, RecordKind> = {
  people: 'person',
  orgs: 'organization',
  committees: 'committee',
  printed: 'printed',
};

function Mark({ kind, code }: { kind: SuggestionKind; code?: string }) {
  if (code) return <span className="f-code">{code}</span>;
  return kind === 'bills' ? null : <RecordMark kind={MARKS[kind]} />;
}

function SuggestionRow(props: {
  id: string;
  kind: SuggestionKind;
  name: string;
  context: string;
  code?: string;
  href: string;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <a
      id={props.id}
      role="option"
      aria-selected={props.selected}
      tabIndex={-1}
      href={props.href}
      className="f-sg-row"
      data-active={props.selected || undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
          return;
        event.preventDefault();
        props.onPick();
        navigate(props.href);
      }}
    >
      <Mark kind={props.kind} code={props.code} />
      <span className="f-sg-text">
        <span className="f-sg-name">{props.name}</span>
        {props.context && <span className="f-sg-context">{props.context}</span>}
      </span>
    </a>
  );
}

function SuggestionPanel(props: {
  listId: string;
  allId: string;
  allHref: string;
  allActive: boolean;
  status: Status;
  maxHeight: number;
  live: string;
  previous: string;
  failure: string;
  retryRef: RefObject<HTMLButtonElement | null>;
  onRetry: () => void;
  onRetryBlur: (event: FocusEvent<HTMLButtonElement>) => void;
  onRetryEscape: () => void;
  onPick: () => void;
  children: ReactNode;
}) {
  const empty = props.status === 'ready' && !hasRows(props.children);
  const previous = props.previous && (
    <span className="f-sg-context" style={{ overflowWrap: 'anywhere' }}>
      {props.previous}
    </span>
  );
  return (
    <div
      className="f-sg-panel"
      // Pressing inside the panel must not blur the field before a row's click lands.
      onMouseDown={(event) => event.preventDefault()}
      ref={(element) => {
        if (element) element.style.maxHeight = `${props.maxHeight}px`;
      }}
    >
      {props.status === 'loading' && (
        <div className="f-sg-note">
          <span className="f-spinner" aria-hidden="true" />
          <span className="f-sg-text">Searching…{previous}</span>
        </div>
      )}
      {empty && (
        <div className="f-sg-empty">
          <span>No matching suggestions</span>
          <span>Try another name or bill number</span>
        </div>
      )}
      {props.status === 'too-short' && <div className="f-sg-note">{tooShortTitle(3)}</div>}
      {props.status === 'failed' && (
        <div className="f-sg-note">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="#5F6B76" strokeWidth="2" />
            <path
              d="M12 7.5 V13 M12 16 V16.5"
              stroke="#5F6B76"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
          <span className="f-sg-text">
            {props.failure}
            {previous}
          </span>
          <button
            ref={props.retryRef}
            type="button"
            className="f-btn f-btn-secondary f-btn-small"
            onClick={props.onRetry}
            onBlur={props.onRetryBlur}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              props.onRetryEscape();
            }}
          >
            Try again
          </button>
        </div>
      )}
      <div
        id={props.listId}
        role="listbox"
        aria-label="Suggestions"
        data-sg-list="1"
        className="f-sg-list"
      >
        {props.children}
        <a
          id={props.allId}
          role="option"
          aria-selected={props.allActive}
          tabIndex={-1}
          href={props.allHref}
          className="f-sg-all"
          data-active={props.allActive || undefined}
          onClick={(event) => {
            if (
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey ||
              event.button !== 0
            )
              return;
            event.preventDefault();
            props.onPick();
            navigate(props.allHref);
          }}
        >
          <span className="f-nowrap">
            View all results
            <Arrow className="f-arrow f-arrow-after" />
          </span>
        </a>
      </div>
      <span role="status" className="f-visually-hidden">
        {props.live}
      </span>
    </div>
  );
}

function hasRows(children: ReactNode): boolean {
  return Array.isArray(children) ? children.length > 0 : Boolean(children);
}
