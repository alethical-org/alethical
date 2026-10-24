import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { denied, reviewError, reviewRequest } from './api';
import { ReviewAction, ReviewField, ReviewSection, reviewStyles as s } from './ReviewControls';
import { FolderReview } from './FolderReview';
import { centralDate } from './types';

type Folder = {
  facility_id: string;
  folder_id: string;
  content_hash: string;
  source_url: string;
  stored_at: string;
  label: string;
  path: string;
  year?: number;
  category?: string;
};
type FolderApproval = {
  id: string;
  status: string;
  safe_label: string;
  safe_path: string;
  fingerprint: string;
  category?: string;
  year?: number | null;
};
type FolderDetail = Folder & { text: string; approvals: FolderApproval[] };
type FolderQueue = { rows: Folder[]; total: number; page: number; page_size: number };
export function FolderMetadata({ token, onDenied }: { token: string; onDenied(): void }) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState({ query: '', page: 1, attempt: 0 });
  const [queue, setQueue] = useState<FolderQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [folder, setFolder] = useState<FolderDetail | null>(null);
  const [approval, setApproval] = useState<FolderApproval | null>(null);
  const [label, setLabel] = useState('');
  const [path, setPath] = useState('');
  const [category, setCategory] = useState('');
  const [year, setYear] = useState('');
  const [evidence, setEvidence] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => () => mutation.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ q: search.query, page: String(search.page) });
    void reviewRequest<FolderQueue>(token, `/folders?${params}`, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) {
          setQueue(data);
          setLoading(false);
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          if (denied(error)) onDenied();
          else {
            setLoading(false);
            setMessage('We couldn’t load folders. Search again to retry.');
          }
        }
      },
    );
    return () => controller.abort();
  }, [search, token, onDenied]);
  const request = async (url: string, data?: object, keepApproval = false) => {
    if (busy) return;
    mutation.current?.abort();
    const controller = new AbortController();
    mutation.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const result = await reviewRequest<FolderDetail | FolderApproval>(
        token,
        url,
        controller.signal,
        data,
      );
      if (controller.signal.aborted) return;
      if (keepApproval) {
        setMessage('Folder relationship saved');
      } else if ('text' in result) {
        setFolder(result);
        setApproval(null);
        setLabel('');
        setPath('');
        setCategory('');
        setYear('');
        setEvidence('');
      } else {
        setApproval(result);
        setEvidence('');
        setMessage('Folder review saved');
      }
      setChecked(false);
      setBusy(false);
    } catch (error) {
      if (!controller.signal.aborted) {
        if (denied(error)) onDenied();
        else {
          setBusy(false);
          setMessage(reviewError(error));
        }
      }
    }
  };
  return (
    <ReviewSection title="Folder labels, including empty folders">
      <Text style={s.note}>
        Approve safe folder labels separately from readable copies and committee relationships
      </Text>
      <ReviewField
        label="Find a station folder"
        value={query}
        onChange={setQuery}
        disabled={busy}
      />
      <ReviewAction
        label="Search private folders"
        disabled={busy}
        onPress={() =>
          setSearch((old) => ({ query: query.trim(), page: 1, attempt: old.attempt + 1 }))
        }
      />
      <View style={s.notice} accessibilityLiveRegion="polite">
        <Text style={s.body}>{loading ? 'Updating folders…' : message}</Text>
      </View>
      {queue ? (
        <>
          <Text style={s.note}>
            {queue.total} retained folder {queue.total === 1 ? 'version' : 'versions'} · page{' '}
            {queue.page}
          </Text>
          {queue.rows.map((row) => (
            <View style={s.card} key={`${row.facility_id}:${row.folder_id}:${row.content_hash}`}>
              <Text style={s.label}>{row.label}</Text>
              <Text style={s.note}>
                {row.path} · {centralDate(row.stored_at)}
              </Text>
              <ReviewAction
                label={`Review folder ${row.label}`}
                disabled={busy}
                onPress={() =>
                  void request(
                    `/folders/${encodeURIComponent(row.facility_id)}/${encodeURIComponent(row.folder_id)}/${encodeURIComponent(row.content_hash)}`,
                  )
                }
              />
            </View>
          ))}
          <View style={s.row}>
            <ReviewAction
              label="Previous folder page"
              disabled={busy || loading || queue.page <= 1}
              onPress={() => setSearch((old) => ({ ...old, page: queue.page - 1 }))}
            />
            <ReviewAction
              label="Next folder page"
              disabled={busy || loading || queue.page * queue.page_size >= queue.total}
              onPress={() => setSearch((old) => ({ ...old, page: queue.page + 1 }))}
            />
          </View>
        </>
      ) : null}
      {folder ? (
        <View style={s.card}>
          <Text style={s.label}>{folder.label}</Text>
          <Text style={s.note}>Private retained listing</Text>
          <Text selectable style={s.note}>
            {folder.text}
          </Text>
          {!approval ? (
            <>
              <ReviewField
                label="Safe folder name"
                value={label}
                onChange={setLabel}
                disabled={busy}
              />
              <ReviewField
                label="Safe folder path"
                value={path}
                onChange={setPath}
                disabled={busy}
              />
              <ReviewField
                label="Safe folder category"
                value={category}
                onChange={setCategory}
                disabled={busy}
                hint="Use the literal source category, such as Federal or State"
              />
              <ReviewField
                label="Safe folder year (optional)"
                value={year}
                onChange={setYear}
                disabled={busy}
                hint="Use the source year only when it is stated"
              />
              <ReviewField
                label="Folder preparation evidence"
                value={evidence}
                onChange={setEvidence}
                disabled={busy}
                multiline
              />
              <ReviewAction
                label="Prepare folder metadata"
                disabled={
                  busy ||
                  !label.trim() ||
                  !path.trim() ||
                  !category.trim() ||
                  !evidence.trim() ||
                  Boolean(year && !/^\d{4}$/.test(year))
                }
                onPress={() =>
                  void request('/folders', {
                    facility_id: folder.facility_id,
                    folder_id: folder.folder_id,
                    content_hash: folder.content_hash,
                    safe_label: label.trim(),
                    safe_path: path.trim(),
                    category: category.trim(),
                    year: year ? Number(year) : null,
                    evidence: evidence.trim(),
                  })
                }
              />
              {folder.approvals.map((item) => (
                <ReviewAction
                  key={item.id}
                  label={`Open ${item.status} folder label: ${item.safe_label}`}
                  disabled={busy}
                  onPress={() => {
                    setApproval(item);
                    setChecked(false);
                    setEvidence('');
                  }}
                />
              ))}
            </>
          ) : (
            <>
              <Text style={s.label}>{approval.safe_label}</Text>
              <Text style={s.body}>{approval.safe_path}</Text>
              <Text style={s.note}>
                {approval.category ?? 'Category not recorded'}
                {approval.year ? ` · ${approval.year}` : ''}
              </Text>
              <Text style={s.note}>{approval.status}</Text>
              {approval.status === 'draft' ? (
                <>
                  <label
                    style={{ fontFamily: 'Libre Franklin', lineHeight: '25px', padding: '8px 0' }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busy}
                      onChange={(event) => setChecked(event.target.checked)}
                    />{' '}
                    I inspected the folder name, path, category and year and removed private details
                  </label>
                  <ReviewField
                    label="Folder approval evidence"
                    value={evidence}
                    onChange={setEvidence}
                    disabled={busy}
                    multiline
                  />
                  <ReviewAction
                    label="Approve this exact folder metadata"
                    disabled={busy || !checked || !evidence.trim()}
                    onPress={() =>
                      void request(`/folders/${encodeURIComponent(approval.id)}/approve`, {
                        expected_fingerprint: approval.fingerprint,
                        metadata_reviewed: checked,
                        evidence: evidence.trim(),
                      })
                    }
                  />
                </>
              ) : approval.status === 'approved' ? (
                <>
                  <ReviewField
                    label="Folder withdrawal reason"
                    value={evidence}
                    onChange={setEvidence}
                    disabled={busy}
                    multiline
                  />
                  <ReviewAction
                    label="Withdraw folder metadata"
                    disabled={busy || !evidence.trim()}
                    onPress={() =>
                      void request(`/folders/${encodeURIComponent(approval.id)}/withdraw`, {
                        evidence: evidence.trim(),
                      })
                    }
                  />
                </>
              ) : null}
              {approval.status === 'approved' ? (
                <FolderReview
                  token={token}
                  busy={busy}
                  onDenied={onDenied}
                  folderSource={{
                    facility_id: folder.facility_id,
                    folder_id: folder.folder_id,
                    folder_content_hash: folder.content_hash,
                    folder_evidence: {
                      content_hash: folder.content_hash,
                      source_url: folder.source_url,
                      text: folder.text,
                    },
                  }}
                  onMutation={(url, data) => void request(url, data, true)}
                />
              ) : null}
              <ReviewAction
                label="Prepare a new folder label"
                disabled={busy}
                onPress={() => {
                  setApproval(null);
                  setEvidence('');
                  setChecked(false);
                }}
              />
            </>
          )}
        </View>
      ) : null}
    </ReviewSection>
  );
}
