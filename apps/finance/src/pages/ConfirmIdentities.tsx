import { useCallback, useEffect, useState } from 'react';

import { apiPath, useRead } from '../api/read';
import { useLocation } from '../router';
import { returnTarget } from '../returnContext';
import type { RouteMatch } from '../routes';
import { useAddressState } from '../ui/addressState';
import { useBand } from '../ui/band';
import { LoadingRows, Refused } from '../ui/controls';
import { BackLink, SourcesAndUpdates, WithArrow } from '../ui/parts';
import { Detail } from './identities/Detail';
import { Queue } from './identities/Queue';
import type { PrintedKind, QueuePage, RecordsPage } from './identities/types';
import { day, isPrintedKind, kindsForRole } from './identities/words';
import './identities/identities.css';

const BOARD = 'Minnesota Campaign Finance and Public Disclosure Board';
const BOARD_FILES =
  'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/';

/**
 * Which file a contextual arrival's name is read from: the exact record kind when the
 * address names one, else each kind its role may mean, in order. A name with no
 * records in any of them is not held.
 */
function useArrival(name: string, kinds: PrintedKind[]) {
  const probe = (kind: PrintedKind | undefined) =>
    name && kind
      ? apiPath(['finance', 'identities', 'records'], {
          record_kind: kind,
          record_key: name,
          page: 1,
          page_size: 1,
        })
      : null;
  const reads = [
    useRead<RecordsPage>(probe(kinds[0])),
    useRead<RecordsPage>(probe(kinds[1])),
    useRead<RecordsPage>(probe(kinds[2])),
    useRead<RecordsPage>(probe(kinds[3])),
  ].slice(0, kinds.length);
  if (!name) return { state: 'none' as const };
  for (let index = 0; index < reads.length; index += 1) {
    const read = reads[index];
    if (read.data && read.data.records > 0) return { state: 'held' as const, kind: kinds[index] };
    if (read.loading || read.pending) return { state: 'loading' as const };
    if (read.failed) return { state: 'failed' as const, retry: read.retry };
  }
  return { state: 'not-held' as const };
}

const FILE_WORDS: Record<string, string> = {
  contributions: 'contribution file',
  expenditures: 'expenditure file',
  independent_expenditures: 'independent expenditure file',
};
const ALETHICAL_LINE =
  'Confirmations, merges and splits are Alethical’s, each with its own evidence and date.';

/** The printed names' source line: 1 copy date when every file shares it, else each
 * file with its own (eug-135: each dataset keeps its own date). */
export function sourceLine(queue: QueuePage | null): string {
  const sources = Object.values(queue?.sources ?? {});
  const dated = sources.filter((source) => day(source.copied_at));
  if (dated.length === 0) return ALETHICAL_LINE;
  const dates = [...new Set(dated.map((source) => day(source.copied_at)))];
  const both =
    dated.some((source) => source.file === 'contributions') &&
    dated.some((source) => source.file !== 'contributions');
  const files =
    dates.length === 1 && both
      ? `contribution and expenditure files, copied ${dates[0]}`
      : [...new Map(dated.map((source) => [source.file, source])).values()]
          .map(
            (source) =>
              `${FILE_WORDS[source.file] ?? source.file}, copied ${day(source.copied_at)}`,
          )
          .join('; ');
  return `Printed names: ${BOARD} ${files}. ${ALETHICAL_LINE}`;
}

/** Confirm identities (`/money/identities`): link records under a printed name to 1
 * person or organization, record by record, with evidence (decisions D23 and D24). */
export function ConfirmIdentities(_props: { match?: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const back = returnTarget(location.search);
  const band = useBand();
  const single = band !== 'computer';
  const [address, setAddress] = useAddressState({
    name: '',
    kind: '',
    role: '',
    records_page: '1',
  });
  const [queue, setQueue] = useState<QueuePage | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [, setDraftTick] = useState(0);
  const [live, setLive] = useState('');
  const onLoaded = useCallback((page: QueuePage) => setQueue(page), []);
  const onDraftsChanged = useCallback(() => setDraftTick((value) => value + 1), []);

  const asked = address.name;
  const kinds = isPrintedKind(address.kind) ? [address.kind] : kindsForRole(address.role);
  const arrival = useArrival(asked, kinds);
  // With no name asked for, a computer opens the first name in the queue.
  const first = !asked && !single ? queue?.rows[0] : undefined;
  const open =
    arrival.state === 'held'
      ? { kind: arrival.kind, name: asked }
      : first
        ? { kind: first.record_kind, name: first.record_key }
        : null;
  const notHeld = arrival.state === 'not-held';
  const showQueue = !single || !asked || notHeld;
  const showDetail = !!open && (!single || !!asked);

  useEffect(() => {
    if (single && asked) window.scrollTo({ top: 0 });
  }, [single, asked]);

  const copyLine = sourceLine(queue);

  return (
    <main id="main" className="f-page ci-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
        <header className="ci-header">
          <h1 tabIndex={-1} className="f-page-title">
            Confirm identities
          </h1>
          <p className="ci-lead">
            Link records under a printed name to one person or organization, with evidence. Until a
            record is confirmed, it stays separate from every other spelling.
          </p>
          {notHeld && (
            <div role="status" className="ci-miss">
              <span className="ci-strong">This record is not held</span>
              <span className="ci-miss-next">
                No records under “{asked}” are waiting to be confirmed
              </span>
            </div>
          )}
          {arrival.state === 'failed' && (
            <div className="ci-arrival">
              <Refused onRetry={arrival.retry}>
                We couldn’t load these records. This is a problem on our side.
              </Refused>
            </div>
          )}
        </header>
        <div aria-live="polite" className="f-visually-hidden">
          {live}
        </div>
        <div className="ci-layout" data-single={single || undefined}>
          {showQueue && (
            <Queue
              selected={open ? { kind: open.kind, key: open.name } : null}
              onSelect={(row) =>
                setAddress({
                  name: row.record_key,
                  kind: row.record_kind,
                  role: '',
                  records_page: '1',
                })
              }
              onLoaded={onLoaded}
              version={savedCount}
            />
          )}
          {arrival.state === 'loading' && !showQueue && <LoadingRows label="Loading records…" />}
          {showDetail && open && (
            <Detail
              key={`${open.kind}|${open.name}`}
              kind={open.kind}
              name={open.name}
              single={single}
              phone={band === 'phone'}
              here={here}
              onBackToQueue={() => setAddress({ name: '', kind: '', role: '', records_page: '1' })}
              onSaved={() => setSavedCount((value) => value + 1)}
              onDraftsChanged={onDraftsChanged}
              onLive={setLive}
            />
          )}
        </div>
      </div>
      <SourcesAndUpdates>
        <p className="ci-copy f-num">{copyLine}</p>
        <a
          href={BOARD_FILES}
          target="_blank"
          rel="noopener noreferrer"
          className="f-dest ci-board-link"
        >
          <span>
            <WithArrow>View the Board’s payment files</WithArrow>
          </span>
          <span className="f-visually-hidden"> (opens in a new tab)</span>
        </a>
      </SourcesAndUpdates>
    </main>
  );
}
