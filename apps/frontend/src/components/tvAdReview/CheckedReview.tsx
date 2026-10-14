import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { ReviewAction, ReviewField, ReviewSection, reviewStyles as s } from './ReviewControls';
import {
  CommitteeSuggestions,
  ExpenseSuggestions,
  FactSuggestions,
  type SuggestionState,
} from './Suggestions';
import { FACT_FIELDS, centralDate, factLabel, type ReviewPayload } from './types';
import { ReviewImage } from './ReviewImage';
import { TargetPreview, type ConnectionTarget } from './TargetPreview';

function Attestation({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
  disabled: boolean;
}) {
  return (
    <label
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        fontFamily: 'Libre Franklin',
        fontSize: 16,
        lineHeight: '25px',
        minHeight: 44,
        padding: '8px 0',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        style={{ width: 20, height: 20, flexShrink: 0, marginTop: 3, accentColor: '#0f7a45' }}
      />
      {label}
    </label>
  );
}
export function CheckedReview({
  token,
  review,
  busy,
  onDenied,
  onMutation,
  onEdit,
  extractionVersion,
  suggestions = null,
  dismissed = new Set<string>(),
  onDismiss = () => {},
  onRestore = () => {},
  onRetrySuggestions = () => {},
}: {
  token: string;
  extractionVersion?: string;
  review: ReviewPayload;
  busy: boolean;
  onDenied(): void;
  onEdit(): void;
  onMutation(path: string, data: object, done?: () => void): void;
  suggestions?: SuggestionState | null;
  dismissed?: Set<string>;
  onDismiss?(key: string): void;
  onRestore?(keys: string[]): void;
  onRetrySuggestions?(): void;
}) {
  const copy = review.publication;
  const [page, setPage] = useState(1);
  const [seenPages, setSeenPages] = useState<Set<number>>(new Set());
  const [privacy, setPrivacy] = useState(false);
  const [metadata, setMetadata] = useState(false);
  const [text, setText] = useState(false);
  const [note, setNote] = useState('');
  const [withdrawal, setWithdrawal] = useState('');
  const [field, setField] = useState<string>('agency_name');
  const [value, setValue] = useState('');
  const [quote, setQuote] = useState('');
  const [qualifier, setQualifier] = useState('');
  const [role, setRole] = useState('');
  const [organization, setOrganization] = useState('');
  const [agencyAddress, setAgencyAddress] = useState(false);
  const [supersedes, setSupersedes] = useState('');
  const [keepHistory, setKeepHistory] = useState(false);
  const [historyPrivacy, setHistoryPrivacy] = useState(false);
  const earlierFact = review.facts.find((item) => item.id === supersedes);
  const [factEvidence, setFactEvidence] = useState('');
  const [factChecked, setFactChecked] = useState(false);
  const [factPublish, setFactPublish] = useState(false);
  const [kind, setKind] = useState('committee');
  const [target, setTarget] = useState('');
  const [stage, setStage] = useState('');
  const [candidateRole, setCandidateRole] = useState('named');
  const [connectionRole, setConnectionRole] = useState('');
  const [moneyOffice, setMoneyOffice] = useState('');
  const [moneyDistrict, setMoneyDistrict] = useState('');
  const [moneyChecked, setMoneyChecked] = useState(false);
  const [connectionQuote, setConnectionQuote] = useState('');
  const [connectionEvidence, setConnectionEvidence] = useState('');
  const [connectionChecked, setConnectionChecked] = useState(false);
  const [connectionPublish, setConnectionPublish] = useState(false);
  const [targetPreview, setTargetPreview] = useState<ConnectionTarget | null>(null);
  const inspectedTarget = useCallback((value: ConnectionTarget | null) => {
    setTargetPreview(value);
    setConnectionChecked(false);
    setConnectionPublish(false);
    setMoneyChecked(false);
  }, []);
  const safeText = copy.safe_pages.find((entry) => entry.page === page)?.text ?? '';
  const approved = copy.status === 'approved';
  const prefix = `/copies/${encodeURIComponent(copy.id)}`;
  const factValid =
    value.trim() &&
    quote.trim() &&
    safeText.includes(quote.trim()) &&
    factEvidence.trim() &&
    factChecked &&
    (field !== 'organization_address' || Boolean(organization.trim() && role.trim())) &&
    (field !== 'officer_name' || Boolean(role.trim())) &&
    (!keepHistory || historyPrivacy);
  const connectionValid =
    target.trim() &&
    connectionQuote.trim() &&
    safeText.includes(connectionQuote.trim()) &&
    connectionEvidence.trim() &&
    connectionChecked &&
    targetPreview?.target_id === target.trim() &&
    Boolean(targetPreview.target_fingerprint) &&
    (!['election', 'candidate'].includes(kind) ||
      ['primary', 'general', 'special'].includes(stage)) &&
    (kind !== 'election' ||
      ((!moneyDistrict.trim() || moneyOffice.trim()) && (!moneyOffice.trim() || moneyChecked)));
  const fieldChanged = (set: (value: string) => void) => (next: string) => {
    set(next);
    setFactChecked(false);
    setFactPublish(false);
    setKeepHistory(false);
    setHistoryPrivacy(false);
    setAgencyAddress(false);
  };
  const connectionChanged = (set: (value: string) => void) => (next: string) => {
    set(next);
    setConnectionChecked(false);
    setConnectionPublish(false);
    setMoneyChecked(false);
  };
  const [used, setUsed] = useState('');
  // Using a suggestion fills the reviewer's own fields and clears every check,
  // exactly as typing would; nothing is saved until the reviewer saves it.
  const resetChecks = () => {
    setFactChecked(false);
    setFactPublish(false);
    setAgencyAddress(false);
    setKeepHistory(false);
    setHistoryPrivacy(false);
    setMoneyChecked(false);
    setConnectionChecked(false);
    setConnectionPublish(false);
  };
  const shared = {
    state: suggestions,
    dismissed,
    disabled: busy,
    onDismiss,
    onRestore,
    onRetry: onRetrySuggestions,
  };
  return (
    <>
      <ReviewSection title="2. Inspect the prepared copy">
        <Text style={s.body}>{copy.safe_title}</Text>
        <Text style={s.note}>
          {copy.safe_folder} · {copy.category}
        </Text>
        <Text selectable style={s.note}>
          Source contents: {copy.content_hash}
        </Text>
        <Text style={s.note}>
          Prepared {centralDate(copy.created_at)} · {copy.status}
        </Text>
        {!copy.metadata_only ? (
          <>
            <View style={s.row}>
              <ReviewAction
                label="Previous prepared page"
                disabled={busy || page <= 1}
                onPress={() => {
                  setPage(page - 1);
                  resetChecks();
                }}
              />
              <Text style={s.body}>
                Page {page} of {copy.pages.length}
              </Text>
              <ReviewAction
                label="Next prepared page"
                disabled={busy || page >= copy.pages.length}
                onPress={() => {
                  setPage(page + 1);
                  resetChecks();
                }}
              />
            </View>
            {copy.status !== 'withdrawn' ? (
              <ReviewImage
                token={token}
                path={`${prefix}/pages/${page}`}
                label={`Prepared copy · page ${page}`}
                onDenied={onDenied}
                onLoaded={() => setSeenPages((seen) => new Set([...seen, page]))}
              />
            ) : null}
            <Text style={s.label}>Safe machine-read text · Not checked</Text>
            <Text selectable style={s.body}>
              {safeText || 'Text unavailable'}
            </Text>
          </>
        ) : (
          <Text style={s.note}>Metadata only: no page image or text is approved</Text>
        )}
        {!approved && !copy.metadata_only && copy.status !== 'withdrawn' ? (
          <>
            <Attestation
              label="I inspected every prepared page and the private details have been removed"
              checked={privacy}
              onChange={setPrivacy}
              disabled={busy}
            />
            <Attestation
              label="I checked the title, folder label and category for private details"
              checked={metadata}
              onChange={setMetadata}
              disabled={busy}
            />
            <Attestation
              label="I inspected the text for every page and removed private details from searchable text"
              checked={text}
              onChange={setText}
              disabled={busy}
            />
            <ReviewField
              label="Copy approval evidence"
              value={note}
              onChange={setNote}
              multiline
              disabled={busy}
            />
            <Text style={s.note}>
              Approve only after completing this review yourself. Approval applies to this exact
              prepared copy; it does not check its facts or connections.
            </Text>
            <ReviewAction
              label="Approve this exact copy"
              busy={busy}
              disabled={
                !privacy ||
                !metadata ||
                !text ||
                !note.trim() ||
                seenPages.size !== copy.pages.length
              }
              onPress={() =>
                onMutation(`${prefix}/approve`, {
                  expected_fingerprint: copy.fingerprint,
                  privacy_reviewed: privacy,
                  metadata_reviewed: metadata,
                  text_reviewed: text,
                  evidence: note.trim(),
                })
              }
            />
          </>
        ) : null}
        {copy.metadata_only && copy.status !== 'withdrawn' && !copy.metadata_approved ? (
          <>
            <Attestation
              label="I checked the title, folder label and category for private details"
              checked={metadata}
              onChange={setMetadata}
              disabled={busy}
            />
            <ReviewField
              label="Metadata approval evidence"
              value={note}
              onChange={setNote}
              multiline
              disabled={busy}
            />
            <ReviewAction
              label="Approve metadata only"
              busy={busy}
              disabled={!metadata || !note.trim()}
              onPress={() =>
                onMutation(`${prefix}/approve-metadata`, {
                  expected_fingerprint: copy.fingerprint,
                  metadata_reviewed: true,
                  evidence: note.trim(),
                })
              }
            />
          </>
        ) : null}
        {copy.metadata_approved ? (
          <Text style={s.note}>Metadata approved {centralDate(copy.metadata_reviewed_at)}</Text>
        ) : null}
        <ReviewAction label="Prepare a corrected copy" disabled={busy} onPress={onEdit} />
      </ReviewSection>
      {approved ? (
        <>
          <ReviewSection title="3. Check a fact">
            <Text style={s.note}>
              A fact belongs to this source version and the prepared page shown above. Enter the
              printed value without inferring payment, identity or a total.
            </Text>
            <FactSuggestions
              {...shared}
              onUse={(item) => {
                setField(item.field);
                setValue(item.value);
                setQuote(item.quote);
                setQualifier('');
                setRole('');
                setOrganization('');
                setSupersedes('');
                setPage(item.page);
                resetChecks();
                setUsed(
                  `Suggested ${factLabel(item.field)} copied into the form. Check it against page ${item.page} before saving.`,
                );
              }}
            />
            <View accessibilityLiveRegion="polite" style={{ minHeight: 25 }}>
              <Text style={s.body}>{used.startsWith('Suggested ') ? used : ''}</Text>
            </View>
            <label style={{ fontFamily: 'Libre Franklin', lineHeight: '25px' }}>
              Fact kind
              <select
                aria-label="Fact kind"
                value={field}
                disabled={busy}
                onChange={(event) => fieldChanged(setField)(event.target.value)}
                style={{ display: 'block', minHeight: 48, width: '100%', font: 'inherit' }}
              >
                {FACT_FIELDS.map((item) => (
                  <option key={item} value={item}>
                    {factLabel(item)}
                  </option>
                ))}
              </select>
            </label>
            <ReviewField
              label="Printed value"
              value={value}
              onChange={fieldChanged(setValue)}
              disabled={busy}
            />
            <ReviewField
              label="Exact quote from the safe page text"
              value={quote}
              onChange={fieldChanged(setQuote)}
              disabled={busy}
              multiline
            />
            {quote.trim() && !safeText.includes(quote.trim()) ? (
              <Text style={s.body}>The quote must appear in the safe text for page {page}</Text>
            ) : null}
            <ReviewField
              label="Meaning or period"
              value={qualifier}
              onChange={fieldChanged(setQualifier)}
              disabled={busy}
            />
            <ReviewField
              label="Printed role"
              value={role}
              onChange={fieldChanged(setRole)}
              disabled={busy}
              hint={
                field === 'requested_by'
                  ? 'Copy the role printed beside the name, such as Treasurer, when the agreement states one'
                  : undefined
              }
            />
            {field === 'organization_address' ? (
              <ReviewField
                label="Organization named in the address quote"
                value={organization}
                onChange={fieldChanged(setOrganization)}
                disabled={busy}
              />
            ) : null}
            {field === 'organization_address' ? (
              <Attestation
                label="I checked that this address belongs to the exact approved agency named on this copy, not another organization or role"
                checked={agencyAddress}
                onChange={setAgencyAddress}
                disabled={
                  busy ||
                  !review.facts.some(
                    (item) =>
                      item.field === 'agency_name' &&
                      item.value === organization.trim() &&
                      item.status !== 'withdrawn' &&
                      item.publication_approved,
                  )
                }
              />
            ) : null}
            <ReviewField
              label="Fact review evidence"
              value={factEvidence}
              onChange={fieldChanged(setFactEvidence)}
              multiline
              disabled={busy}
            />
            {supersedes ? (
              <Text style={s.note}>
                This correction replaces fact {supersedes}; the earlier decision remains in its
                history
              </Text>
            ) : null}
            {supersedes && earlierFact?.publication_approved ? (
              <>
                <Attestation
                  label="Keep the earlier reviewed value visible in correction history"
                  checked={keepHistory}
                  onChange={(checked) => {
                    setKeepHistory(checked);
                    setHistoryPrivacy(false);
                  }}
                  disabled={busy}
                />
                {keepHistory ? (
                  <Attestation
                    label="I inspected the earlier value and approve keeping it visible; it contains no withheld information"
                    checked={historyPrivacy}
                    onChange={setHistoryPrivacy}
                    disabled={busy}
                  />
                ) : null}
              </>
            ) : null}
            <Attestation
              label="I checked this fact against the prepared page and its exact source version"
              checked={factChecked}
              onChange={setFactChecked}
              disabled={busy}
            />
            <Attestation
              label="I approve displaying this fact and quote; they contain no withheld information"
              checked={factPublish}
              onChange={setFactPublish}
              disabled={busy}
            />
            <ReviewAction
              label={supersedes ? 'Save corrected fact' : 'Save checked fact'}
              disabled={!factValid}
              busy={busy}
              onPress={() =>
                onMutation(
                  `${prefix}/facts`,
                  {
                    field,
                    organization_name: organization.trim() || null,
                    agency_address_reviewed: field === 'organization_address' && agencyAddress,
                    value: value.trim(),
                    page,
                    quote: quote.trim(),
                    qualifier: qualifier.trim() || null,
                    role: role.trim() || null,
                    evidence: factEvidence.trim(),
                    supersedes_id: supersedes || null,
                    history_publication_approved: keepHistory,
                    history_privacy_reviewed: keepHistory && historyPrivacy,
                    correctness_reviewed: factChecked,
                    publication_approved: factPublish,
                    privacy_reviewed: factPublish,
                  },
                  () => {
                    setValue('');
                    setQuote('');
                    setSupersedes('');
                    setKeepHistory(false);
                    setHistoryPrivacy(false);
                    setFactEvidence('');
                    setFactChecked(false);
                    setFactPublish(false);
                  },
                )
              }
            />
          </ReviewSection>
          <ReviewSection title="4. Check a connection">
            <Text style={s.note}>
              A matching name is not evidence of identity. This decision applies to this file only.
              An expense connection needs an exact retained expense row, with its identity checked
              separately.
            </Text>
            <CommitteeSuggestions
              {...shared}
              onUse={(item) => {
                const printed = /\b(advertiser|payer)\b/i.exec(item.evidence.quote)?.[1] ?? '';
                setKind('committee');
                setTarget(item.registration_number);
                setConnectionRole(printed);
                setConnectionQuote(item.evidence.quote);
                setPage(item.evidence.page);
                resetChecks();
                setUsed(
                  `Connection: committee ${item.registration_number} copied into the form. Inspect the target and check it before saving.`,
                );
              }}
            />
            <ExpenseSuggestions
              {...shared}
              onUse={(item) => {
                setKind('expense');
                setTarget(item.target_id);
                setConnectionQuote(item.evidence?.quote ?? '');
                if (item.evidence) setPage(item.evidence.page);
                resetChecks();
                setUsed(
                  `Connection: expense row ${item.source_row_number} copied into the form. Inspect the retained row and check it before saving.`,
                );
              }}
            />
            <View accessibilityLiveRegion="polite" style={{ minHeight: 25 }}>
              <Text style={s.body}>{used.startsWith('Connection: ') ? used : ''}</Text>
            </View>
            <label style={{ fontFamily: 'Libre Franklin', lineHeight: '25px' }}>
              Connection kind
              <select
                aria-label="Connection kind"
                value={kind}
                disabled={busy}
                onChange={(event) => {
                  connectionChanged(setKind)(event.target.value);
                  setTarget('');
                }}
                style={{ display: 'block', minHeight: 48, width: '100%', font: 'inherit' }}
              >
                {[
                  'committee',
                  'candidate',
                  'election',
                  'expense',
                  'principal',
                  'related_document',
                  'issue',
                ].map((item) => (
                  <option key={item} value={item}>
                    {item.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <ReviewField
              label={
                kind === 'expense'
                  ? 'Exact expense source and row, or accepted match ID'
                  : kind === 'committee'
                    ? 'Committee registration number'
                    : kind === 'candidate'
                      ? 'Candidate record ID'
                      : kind === 'election'
                        ? 'Election contest ID'
                        : kind === 'related_document'
                          ? 'Related approved copy ID'
                          : kind === 'principal'
                            ? 'Lobbying principal entity number'
                            : 'Exact printed issue'
              }
              hint={
                kind === 'expense'
                  ? 'Use dataset:snapshot-ID:row-number or an accepted match ID. Inspect the retained row before saving.'
                  : kind === 'election'
                    ? 'Use the exact race record for this office, district and stage; a statewide election ID is not a contest.'
                    : undefined
              }
              value={target}
              onChange={connectionChanged(setTarget)}
              disabled={busy}
            />
            {['election', 'candidate'].includes(kind) ? (
              <ReviewField
                label="Election stage"
                value={stage}
                onChange={connectionChanged(setStage)}
                disabled={busy}
                hint="primary, general or special; office and year alone do not identify an election"
              />
            ) : null}
            {['committee', 'principal'].includes(kind) ? (
              <ReviewField
                label="Connection role printed in the source (if stated)"
                value={connectionRole}
                onChange={connectionChanged(setConnectionRole)}
                disabled={busy}
                hint="Copy the role exactly; the role must appear in the source quote"
              />
            ) : null}
            {kind === 'candidate' ? (
              <label style={{ fontFamily: 'Libre Franklin', lineHeight: '25px' }}>
                Candidate role printed in the file
                <select
                  aria-label="Candidate role printed in the file"
                  value={candidateRole}
                  disabled={busy}
                  onChange={(event) => connectionChanged(setCandidateRole)(event.target.value)}
                  style={{ display: 'block', minHeight: 48, width: '100%', font: 'inherit' }}
                >
                  <option value="named">Named</option>
                  <option value="advertiser">Advertiser</option>
                  <option value="payer">Payer</option>
                </select>
                <Text style={s.note}>Advertiser and payer must be stated in the source quote</Text>
              </label>
            ) : null}
            {kind === 'election' ? (
              <>
                <ReviewField
                  label="Campaign-money office (optional)"
                  value={moneyOffice}
                  onChange={connectionChanged(setMoneyOffice)}
                  disabled={busy}
                  hint="Enter the exact office in campaign-money records only when the source supports this connection"
                />
                <ReviewField
                  label="Campaign-money district (when applicable)"
                  value={moneyDistrict}
                  onChange={connectionChanged(setMoneyDistrict)}
                  disabled={busy}
                />
              </>
            ) : null}
            <TargetPreview
              token={token}
              kind={kind}
              target={target}
              stage={['candidate', 'election'].includes(kind) ? stage : ''}
              role={
                kind === 'candidate'
                  ? candidateRole
                  : ['committee', 'principal'].includes(kind)
                    ? connectionRole.trim()
                    : ''
              }
              moneyOffice={kind === 'election' ? moneyOffice.trim() : ''}
              moneyDistrict={kind === 'election' ? moneyDistrict.trim() : ''}
              publicationId={copy.id}
              disabled={busy}
              onTarget={inspectedTarget}
              onDenied={onDenied}
            />
            {kind === 'election' && moneyOffice.trim() ? (
              <Attestation
                label="I checked that this exact office, district and election year match the campaign-money records"
                checked={moneyChecked}
                onChange={setMoneyChecked}
                disabled={busy || !targetPreview}
              />
            ) : null}
            <ReviewField
              label="Connection quote from the safe page text"
              value={connectionQuote}
              onChange={connectionChanged(setConnectionQuote)}
              disabled={busy}
              multiline
            />
            {connectionQuote.trim() && !safeText.includes(connectionQuote.trim()) ? (
              <Text style={s.body}>
                The connection quote must appear in the safe text for page {page}
              </Text>
            ) : null}
            <ReviewField
              label="Connection evidence and printed role"
              value={connectionEvidence}
              onChange={connectionChanged(setConnectionEvidence)}
              disabled={busy}
              multiline
            />
            <Attestation
              label="I checked this exact connection and its retained evidence"
              checked={connectionChecked}
              onChange={setConnectionChecked}
              disabled={busy}
            />
            <Attestation
              label="I approve displaying this connection and quote; they contain no withheld information"
              checked={connectionPublish}
              onChange={setConnectionPublish}
              disabled={busy}
            />
            <ReviewAction
              label="Save checked connection"
              disabled={!connectionValid}
              busy={busy}
              onPress={() =>
                onMutation(
                  `${prefix}/connections`,
                  {
                    scope: 'file',
                    publication_id: copy.id,
                    kind,
                    target_id: target.trim(),
                    expected_target_fingerprint: targetPreview?.target_fingerprint,
                    page,
                    quote: connectionQuote.trim(),
                    evidence: connectionEvidence.trim(),
                    ...(['election', 'candidate'].includes(kind) ? { election_stage: stage } : {}),
                    ...(kind === 'candidate'
                      ? { role: candidateRole }
                      : ['committee', 'principal'].includes(kind)
                        ? { role: connectionRole.trim() || null }
                        : {}),
                    ...(kind === 'election' && moneyOffice.trim()
                      ? {
                          money_office: moneyOffice.trim(),
                          money_district: moneyDistrict.trim() || null,
                          money_context_reviewed: moneyChecked,
                        }
                      : {}),
                    file_identity_reviewed: connectionChecked,
                    ...(kind === 'expense'
                      ? {
                          source_content_hash: targetPreview?.source_content_hash,
                          extraction_version:
                            targetPreview?.extraction_version ?? extractionVersion,
                        }
                      : {}),
                    correctness_reviewed: connectionChecked,
                    publication_approved: connectionPublish,
                    privacy_reviewed: connectionPublish,
                  },
                  () => {
                    setTarget('');
                    setConnectionQuote('');
                    setConnectionEvidence('');
                    setConnectionChecked(false);
                    setConnectionPublish(false);
                  },
                )
              }
            />
          </ReviewSection>
        </>
      ) : null}
      <ReviewSection title="Decisions and corrections">
        <ReviewField
          label="Reason for withdrawal"
          value={withdrawal}
          onChange={setWithdrawal}
          multiline
          disabled={busy}
          hint="Required for each withdrawal. The reason stays in the review history."
        />
        {review.facts.map((fact) => (
          <View key={fact.id} style={s.card}>
            <Text style={s.body}>
              {factLabel(fact.field)}: {fact.value}
              {fact.role ? ` · ${fact.role}` : ''}
            </Text>
            <Text style={s.note}>
              Page {fact.page} · “{fact.quote}”
            </Text>
            <Text style={s.note}>
              {fact.withdrawn_at || fact.status === 'withdrawn'
                ? 'Withdrawn'
                : fact.publication_approved
                  ? 'Checked · approved for display'
                  : 'Checked · not approved for display'}
            </Text>
            {approved && !fact.withdrawn_at && fact.status !== 'withdrawn' ? (
              <View style={s.row}>
                <ReviewAction
                  label={`Correct ${factLabel(fact.field)}`}
                  disabled={busy}
                  onPress={() => {
                    setField(fact.field);
                    setValue(fact.value);
                    setQuote(fact.quote);
                    setQualifier(fact.qualifier ?? '');
                    setRole(fact.role ?? '');
                    setOrganization(fact.organization_name ?? '');
                    setAgencyAddress(false);
                    setPage(fact.page);
                    setSupersedes(fact.id);
                    setKeepHistory(false);
                    setHistoryPrivacy(false);
                    setFactChecked(false);
                    setFactPublish(false);
                  }}
                />
                <ReviewAction
                  label={`Withdraw ${factLabel(fact.field)}`}
                  disabled={busy || !withdrawal.trim()}
                  onPress={() =>
                    onMutation(`/facts/${encodeURIComponent(fact.id)}/withdraw`, {
                      evidence: withdrawal.trim(),
                    })
                  }
                />
              </View>
            ) : null}
          </View>
        ))}
        {review.connections.map((connection) => (
          <View key={connection.id} style={s.card}>
            <Text style={s.body}>
              {connection.kind}: {connection.target_id}
            </Text>
            <Text style={s.note}>
              {connection.scope} · “{connection.quote}”
            </Text>
            <Text style={s.note}>
              {connection.withdrawn_at || connection.status === 'withdrawn'
                ? 'Withdrawn'
                : connection.publication_approved
                  ? 'Checked · approved for display'
                  : 'Checked · not approved for display'}
            </Text>
            {!connection.withdrawn_at && connection.status !== 'withdrawn' ? (
              <ReviewAction
                label={`Withdraw ${connection.kind} connection`}
                disabled={busy || !withdrawal.trim()}
                onPress={() =>
                  onMutation(`/connections/${encodeURIComponent(connection.id)}/withdraw`, {
                    evidence: withdrawal.trim(),
                  })
                }
              />
            ) : null}
          </View>
        ))}
        {copy.status !== 'withdrawn' ? (
          <ReviewAction
            label="Withdraw this copy from every reader path"
            disabled={busy || !withdrawal.trim()}
            onPress={() => onMutation(`${prefix}/withdraw`, { evidence: withdrawal.trim() })}
          />
        ) : null}
        {review.events.map((event, index) => (
          <Text key={event.id ?? index} style={s.note}>
            {centralDate(event.created_at)} · {event.action}
            {event.evidence ? ` · ${event.evidence}` : ''}
          </Text>
        ))}
      </ReviewSection>
    </>
  );
}
