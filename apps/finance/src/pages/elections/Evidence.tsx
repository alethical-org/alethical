import type { ReactNode } from 'react';

import { useRead } from '../../api/read';
import { EvidencePanel, Refused, type Evidence } from '../../ui/controls';
import { LoadingLine } from '../../ui/parts';
import { useElectionAttachment } from './attachments';
import type { SourceLinesAnswer } from './data';

export interface ElectionEvidence {
  evidence: Evidence;
  attachment: string | null;
  lines?: string | null;
  selectedLines?: number[];
  pdfPage?: number;
  children?: ReactNode;
}

/** Original bytes stay inside Finance access. Never point a private source button
 * at the vendor's current download or send an account token to a source URL. */
export function RetainedEvidence({
  selection,
  onClose,
  onReload,
}: {
  selection: ElectionEvidence;
  onClose: () => void;
  onReload?: () => void;
}) {
  const attachment = useElectionAttachment(selection.attachment);
  const lines = useRead<SourceLinesAnswer>(selection.lines ?? null);
  const body = lines.data?.lines.filter(
    (line) => !selection.selectedLines || selection.selectedLines.includes(line.number),
  );
  const evidence: Evidence = {
    ...selection.evidence,
    ...(body?.length
      ? {
          quote: body.map((line) => `${line.number}  ${line.text}`).join('\n'),
          quoteLabel: 'SOURCE LINES',
        }
      : {}),
    ...(attachment.objectUrl
      ? {
          sourceHref:
            attachment.objectUrl + (selection.pdfPage ? `#page=${selection.pdfPage}` : ''),
          sourceLabel: selection.pdfPage
            ? `Open retained report · Page ${selection.pdfPage}`
            : 'Download original source',
        }
      : {}),
  };
  return (
    <EvidencePanel evidence={evidence} onClose={onClose}>
      {selection.attachment && attachment.state === 'loading' && (
        <LoadingLine>Loading original source…</LoadingLine>
      )}
      {selection.attachment && attachment.changed && (
        <div className="ec-notice" role="status">
          These records changed
          <button className="ec-button" onClick={onReload ?? attachment.retry}>
            Reload comparison
          </button>
        </div>
      )}
      {selection.attachment && attachment.state === 'failed' && !attachment.changed && (
        <Refused onRetry={attachment.retry}>We couldn’t load this source</Refused>
      )}
      {selection.lines && lines.loading && <LoadingLine>Loading source lines…</LoadingLine>}
      {selection.lines && lines.failed && (
        <Refused onRetry={lines.retry} retrying={lines.pending}>
          We couldn’t load source lines
        </Refused>
      )}
      {selection.lines && lines.notFound && <p>This source is not held</p>}
      {selection.children}
    </EvidencePanel>
  );
}
