import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { ReviewAction, ReviewField, ReviewSection, reviewStyles as s } from './ReviewControls';
import { TargetPreview, type ConnectionTarget } from './TargetPreview';
import type { VersionPayload } from './api';

export function FolderReview({
  version,
  folderSource,
  token,
  publicationId,
  busy,
  onDenied,
  onMutation,
}: {
  version?: VersionPayload;
  folderSource?: {
    facility_id: string;
    folder_id: string;
    folder_content_hash: string;
    folder_evidence: { content_hash: string; source_url: string; text: string };
  };
  token: string;
  publicationId?: string;
  busy: boolean;
  onDenied(): void;
  onMutation(path: string, data: object): void;
}) {
  const [target, setTarget] = useState('');
  const [quote, setQuote] = useState('');
  const [role, setRole] = useState('');
  const [evidence, setEvidence] = useState('');
  const [preview, setPreview] = useState<ConnectionTarget | null>(null);
  const [checked, setChecked] = useState(false);
  const [publish, setPublish] = useState(false);
  const inspectedTarget = useCallback((value: ConnectionTarget | null) => {
    setPreview(value);
    setChecked(false);
    setPublish(false);
  }, []);
  const document = version?.document ?? folderSource;
  const source = document?.folder_evidence ?? version?.folder_evidence;
  if (!source || !document?.folder_content_hash) return null;
  const change = (set: (value: string) => void) => (value: string) => {
    set(value);
    setChecked(false);
    setPublish(false);
  };
  return (
    <ReviewSection title="Check this folder’s committee relationship">
      <Text style={s.body}>
        This describes the station’s folder only. Files in the folder need separate evidence and
        never inherit this connection.
      </Text>
      <Text style={s.label}>Retained folder listing</Text>
      <Text selectable style={s.note}>
        {source.text}
      </Text>
      <Text selectable style={s.note}>
        Source contents: {source.content_hash}
      </Text>
      <ReviewField
        label="Folder committee registration number"
        value={target}
        onChange={change(setTarget)}
        disabled={busy}
      />
      <ReviewField
        label="Folder relationship role printed in the source (if stated)"
        value={role}
        onChange={change(setRole)}
        disabled={busy}
      />
      <TargetPreview
        token={token}
        kind="committee"
        target={target}
        stage=""
        role={role.trim()}
        publicationId={publicationId}
        disabled={busy}
        onTarget={inspectedTarget}
        onDenied={onDenied}
      />
      <ReviewField
        label="Quote from the retained folder listing"
        value={quote}
        onChange={change(setQuote)}
        disabled={busy}
        multiline
      />
      <ReviewField
        label="Folder relationship evidence"
        value={evidence}
        onChange={change(setEvidence)}
        disabled={busy}
        multiline
      />
      <View style={s.stack}>
        <label style={{ fontFamily: 'Libre Franklin', lineHeight: '25px', padding: '8px 0' }}>
          <input
            type="checkbox"
            checked={checked}
            disabled={busy}
            onChange={(event) => setChecked(event.target.checked)}
          />{' '}
          I checked this folder’s relationship to the exact committee shown above
        </label>
        <label style={{ fontFamily: 'Libre Franklin', lineHeight: '25px', padding: '8px 0' }}>
          <input
            type="checkbox"
            checked={publish}
            disabled={busy}
            onChange={(event) => setPublish(event.target.checked)}
          />{' '}
          I approve displaying the folder relationship and safe quote
        </label>
      </View>
      <ReviewAction
        label="Save checked folder relationship"
        disabled={
          busy ||
          !checked ||
          !preview ||
          preview.target_id !== target.trim() ||
          !preview.target_fingerprint ||
          !quote.trim() ||
          !source.text.includes(quote.trim()) ||
          !evidence.trim()
        }
        onPress={() =>
          onMutation(
            publicationId
              ? `/copies/${encodeURIComponent(publicationId)}/connections`
              : '/connections',
            {
              scope: 'folder',
              facility_id: document.facility_id,
              folder_id: document.folder_id,
              folder_content_hash: source.content_hash,
              kind: 'committee',
              target_id: target.trim(),
              role: role.trim() || null,
              expected_target_fingerprint: preview?.target_fingerprint,
              quote: quote.trim(),
              evidence: evidence.trim(),
              correctness_reviewed: checked,
              publication_approved: publish,
              privacy_reviewed: publish,
            },
          )
        }
      />
    </ReviewSection>
  );
}
