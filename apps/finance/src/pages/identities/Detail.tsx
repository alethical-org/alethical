import { RECORDS_CHANGED, useVersionedRead } from '../../api/versionedRead';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { apiPath, useRead } from '../../api/read';
import { useFinanceSession } from '../../auth/session';
import { Link } from '../../router';
import { withFrom } from '../../returnContext';
import { hrefFor, isBuilt } from '../../routes';
import { useAddressState } from '../../ui/addressState';
import { LoadingRows, Refused, Updating } from '../../ui/controls';
import { discardDraft, readDraft, saveDraft } from '../../ui/drafts';
import { Arrow, Chevron } from '../../ui/parts';
import { Pager } from '../media/shared';
import { useRecords, write, type WriteResult } from './api';
import { IdentityForm, type FormErrors, type FormSpec } from './Form';
import { Refs } from './Refs';
import { confirmationNote, confirmationSource, historyRows } from './history';
import { useIdentities } from './reads';
import type {
  Confirmation,
  EntityPage,
  Fingerprint,
  Identity,
  IdentitySummary,
  PrintedKind,
} from './types';
import {
  beyondName,
  blankDraft,
  coveredDates,
  coveredRows,
  coverageLine,
  printableKey,
  roleTitle,
  sumCounts,
  day,
  draftKey,
  evidenceSource,
  eyebrow,
  hasEntries,
  identityKindLabel,
  isPrintedKind,
  period,
  plural,
  recordAmount,
  recordDate,
  registrationOf,
  relationOf,
  ROLE_LABELS,
  named,
  nameDotRef,
  optional,
  refOf,
  type DraftFields,
  type DraftKeyFields,
  type Mode,
} from './words';

const PAGE_SIZE = 50;
export const REVISION =
  'These records changed since this form opened. Review the current records and select again.';
const STALE_LINE = 'The Board’s file changed. Reload the records and select again.';
const SCOPE = (kind: string) =>
  `The records you select will appear on the ${kind}’s profile. Other records under this spelling, and records added later, stay unconfirmed.`;

interface Ui {
  tried: boolean;
  saving: boolean;
  storeFailed: boolean;
  /** A withdrawal of several confirmations stopped after {k} of {n} were withdrawn. */
  partial: { k: number; n: number } | null;
  refused: boolean;
  planError: string;
  stale: boolean;
}
/** A withdrawal of several confirmations that stopped part way (settled wording row 66);
 * each verb follows its own count ("1 of 2 confirmations was withdrawn"). */
export function partlyWithdrawn({ k, n }: { k: number; n: number }): string {
  const m = n - k;
  const verb = (count: number) => (count === 1 ? 'was' : 'were');
  return `${k} of ${n} confirmations ${verb(k)} withdrawn. The other ${m} ${verb(m)} not saved. Your note is kept below.`;
}

const READY: Ui = {
  tried: false,
  saving: false,
  storeFailed: false,
  partial: null,
  refused: false,
  planError: '',
  stale: false,
};

/** A profile page for an identity, when that page is built. */
export function profileHref(identity: IdentitySummary, here: string): string | null {
  if (identity.kind === 'organization' && isBuilt('organization'))
    return withFrom(hrefFor('organization', { id: identity.id }), here);
  if (identity.kind === 'person' && isBuilt('person'))
    return withFrom(hrefFor('person', { id: identity.id }), here);
  return null;
}

function yearOf(record: Fingerprint): number | null {
  const filed = record.rows.find((row) => row.year !== null)?.year ?? null;
  if (filed !== null) return filed;
  const date = recordDate(record.fields);
  return date ? Number(date.slice(0, 4)) || null : null;
}

function committeeTab(kind: PrintedKind): string | null {
  if (kind === 'payee_name') return 'expenditures';
  if (kind === 'independent_payee_name') return 'independent';
  return null;
}

function spellingConfirmations(identity: Identity | undefined, kind: PrintedKind, name: string) {
  return (identity?.confirmations ?? []).filter(
    (c) => c.record_kind === kind && c.record_key === name && c.status === 'confirmed',
  );
}

function identityLine(groups: Confirmation[], k: number, n: number): string {
  const checked =
    groups.length === 1 && groups[0].checked_at ? ` · Checked on ${day(groups[0].checked_at)}` : '';
  return `Confirmed for ${k} of ${n} records${groups.length > 1 ? ` · ${groups.length} confirmations` : checked}`;
}

function focusFirstInvalid() {
  window.setTimeout(() => {
    document
      .querySelector<HTMLElement>(
        '#identity-form [aria-invalid="true"], #identity-form input[type="checkbox"]',
      )
      ?.focus();
  }, 0);
}

/** The open printed name: its identities, suggestions, form, records and history. */
export function Detail({
  kind,
  name,
  single,
  phone,
  here,
  onBackToQueue,
  onSaved,
  onDraftsChanged,
  onLive,
  onSource,
}: {
  kind: PrintedKind;
  name: string;
  single: boolean;
  phone: boolean;
  here: string;
  onBackToQueue: () => void;
  onSaved: () => void;
  onDraftsChanged: () => void;
  onLive: (text: string) => void;
  /** The file this name is read from and its copy date, for Sources and updates. */
  onSource: (source: { file: string; copied_at: string | null } | null) => void;
}) {
  const { apiBaseUrl, accessToken } = useFinanceSession();
  const [address, setAddress] = useAddressState({ records_page: '1' });
  const page = Math.max(1, Math.trunc(Number(address.records_page) || 1));
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  // Page 1 reads the current copy; later pages stay on the copy page 1 showed, and a
  // changed copy is refused (409) rather than mixed in.
  const records = useRecords(
    { kind, key: name, page, pageSize: PAGE_SIZE, snapshotId: page > 1 ? snapshot : null },
    version,
  );
  const data = records.data;
  useEffect(() => {
    if (data && (snapshot === null || data.page === 1) && data.snapshot_id !== snapshot)
      setSnapshot(data.snapshot_id);
  }, [data, snapshot]);
  useEffect(() => {
    onSource(data ? { file: data.file, copied_at: data.copied_at } : null);
  }, [data?.file, data?.copied_at, onSource]);
  const n = data?.records ?? 0;
  const k = data?.confirmed ?? 0;
  const held = data?.identities ?? [];
  const [touched, setTouched] = useState<string[]>([]);
  const ids = useMemo(
    () => [
      ...new Set([
        ...held.map((i) => i.id),
        ...(data?.history_identities ?? []).map((i) => i.id),
        ...touched,
      ]),
    ],
    [held, data?.history_identities, touched],
  );
  const reads = useIdentities(ids, version);
  const [ident, setIdent] = useState<string | null>(null);
  const conf = held.find((i) => i.id === ident) ?? held[0] ?? null;
  const confIdentity = conf ? reads.byId.get(conf.id) : undefined;
  const groups = spellingConfirmations(confIdentity, kind, name);
  const remaining = Math.max(0, n - k);

  const [form, setForm] = useState<DraftFields | null>(null);
  const [ui, setUi] = useState<Ui>(READY);
  // Confirmations this open withdrawal has already withdrawn: a retry skips them.
  const withdrawn = useRef<Set<string>>(new Set());
  const withdrawTotal = useRef(0);
  const [histOpen, setHistOpen] = useState<Record<string, boolean>>({});

  // Every change to the open form is kept as its draft; an emptied form keeps none.
  useEffect(() => {
    if (!form) return;
    const key = draftKey(kind, name, form);
    if (hasEntries(form)) saveDraft(key, form);
    else discardDraft(key);
    onDraftsChanged();
  }, [form, kind, name, onDraftsChanged]);

  function open(fields: DraftKeyFields | null) {
    setUi(READY);
    withdrawn.current = new Set();
    withdrawTotal.current = 0;
    onLive('');
    if (!fields) {
      setForm(null);
      return;
    }
    const stored = readDraft<Partial<DraftFields>>(draftKey(kind, name, fields));
    const restored = { ...blankDraft(fields), ...(stored ?? {}), ...fields };
    // A selection made in another copy of the Board's file is not carried over.
    if (restored.snapshot && data && restored.snapshot !== data.snapshot_id)
      Object.assign(restored, { picked: {}, quick: null });
    setForm(restored);
  }
  const update = (patch: Partial<DraftFields>) =>
    setForm((current) => (current ? { ...current, ...patch } : current));
  const keyOf = (patch: Partial<DraftKeyFields>): DraftKeyFields => ({
    mode: 'confirm',
    target: null,
    newKind: null,
    ident: conf?.id ?? null,
    pick: null,
    ...patch,
  });
  const toggle = (mode: Mode, patch: Partial<DraftKeyFields> = {}) => {
    const next = keyOf({ mode, ...patch });
    const same =
      form &&
      form.mode === next.mode &&
      form.target === next.target &&
      form.newKind === next.newKind;
    open(same ? null : next);
  };

  // Merge: the current identities of the same kind, a page at a time.
  const [pickPage, setPickPage] = useState(1);
  const entities = useVersionedRead<EntityPage>(
    form?.mode === 'merge' && conf
      ? apiPath(['finance', 'identities'], { kind: conf.kind, page: pickPage, page_size: 20 })
      : null,
    { page: pickPage, onRestart: () => setPickPage(1), refresh: version },
  );
  const pickRead = useRead<Identity>(
    form?.mode === 'merge' && form.pick ? apiPath(['finance', 'identities', form.pick]) : null,
  );
  const pickName =
    pickRead.data?.name ?? entities.data?.rows.find((row) => row.id === form?.pick)?.name ?? null;
  // A quick selection for 1 year counts that year's unconfirmed records.
  const quickYear = form?.quick?.year ?? null;
  const yearCount = useRead<{ records: number; confirmed: number }>(
    form?.quick && quickYear !== null && snapshot
      ? apiPath(['finance', 'identities', 'records'], {
          record_kind: kind,
          record_key: name,
          year: quickYear,
          snapshot_id: snapshot,
          page: 1,
          page_size: 1,
        })
      : null,
  );

  const target = form?.mode === 'confirm' ? held.find((i) => i.id === form.target) : undefined;
  const newKindWord = (form?.newKind ?? 'organization').toLowerCase();
  const spec: FormSpec | null = !form
    ? null
    : form.mode === 'confirm'
      ? target
        ? {
            title: `Confirm “${name}” as ${target.name}`,
            lead: SCOPE(identityKindLabel(target.kind).toLowerCase()),
            noteLabel: 'Evidence besides the name',
            submit: 'Confirm identity',
            busy: 'Confirming…',
            src: true,
            name: false,
            recs: 'name',
            pick: false,
            beyond: target.name,
          }
        : null
      : form.mode === 'create'
        ? {
            title: `Create a new ${newKindWord} for “${name}”`,
            lead: `Use this only when no existing record is the same one. ${SCOPE(`new ${newKindWord}`)}`,
            noteLabel: 'Evidence besides the name',
            submit: 'Create and confirm',
            busy: 'Creating…',
            src: true,
            name: true,
            recs: 'name',
            pick: false,
            beyond: form.newName,
          }
        : !conf
          ? null
          : form.mode === 'withdraw'
            ? {
                title: `Withdraw the confirmation as ${conf.name}`,
                lead: 'The confirmation is removed from every page that shows it, and its records return to this printed name alone. The history below keeps the earlier confirmation and your reason.',
                noteLabel: 'Reason for withdrawing',
                submit: 'Withdraw confirmation',
                busy: 'Withdrawing…',
                src: false,
                name: false,
                recs: null,
                pick: false,
                beyond: null,
              }
            : form.mode === 'merge'
              ? {
                  title: `Merge another record into ${named(conf)}`,
                  lead: 'Choose the record to merge in, then check every link that will move before you save',
                  noteLabel: 'Evidence that they are the same',
                  submit: 'Merge records',
                  busy: 'Merging…',
                  src: true,
                  name: false,
                  recs: null,
                  pick: true,
                  beyond: pickName ?? '',
                }
              : {
                  title: `Split ${named(conf)} into 2 records`,
                  lead: `Only the records you choose move to a new record. ${refOf(conf)} will then open a page listing both records. Both histories are kept.`,
                  noteLabel: 'Evidence that they are different',
                  submit: 'Split record',
                  busy: 'Splitting…',
                  src: true,
                  name: true,
                  recs: 'split',
                  pick: false,
                  beyond: null,
                };

  // Split: every active confirmation of the identity goes to exactly 1 part.
  const active = (confIdentity?.confirmations ?? []).filter((c) => c.status === 'confirmed');
  const printedActive = active.filter((c) => c.records !== null && isPrintedKind(c.record_kind));
  const roleActive = active.filter((c) => !(c.records !== null && isPrintedKind(c.record_kind)));
  const rowsIn = (list: Confirmation[]) => sumCounts(list.map(coveredRows));

  const unconfirmed = (data?.fingerprints ?? []).filter((record) => !record.confirmation);
  const pickedKeys = form ? Object.keys(form.picked) : [];
  const pickedRows = form ? pickedKeys.reduce((sum, fp) => sum + form.picked[fp].count, 0) : 0;
  const stale = records.stale || ui.stale;

  const errors: FormErrors = {};
  if (ui.tried && form && spec) {
    const note = form.note.trim();
    if (!note)
      errors.note =
        form.mode === 'withdraw'
          ? 'Write why this confirmation is withdrawn'
          : 'Write what in the records shows this';
    else if (spec.beyond !== null && !beyondName(note, [name, spec.beyond]))
      errors.note =
        'Name something besides the shared name, such as a registration number or filing';
    if (spec.src && !form.src.trim()) errors.src = 'Name the record, file or address that shows it';
    if (spec.pick && !form.pick) errors.pick = 'Choose the record to merge in';
    if (spec.recs === 'name' && !pickedKeys.length && !form.quick)
      errors.recs = 'Choose at least 1 record';
    if (spec.recs === 'split' && !form.parts.length && !form.roles.length)
      errors.recs = 'Choose at least 1 record';
    if (spec.name && !form.newName.trim()) errors.name = 'Write the name of the new record';
  }

  async function perform(current: DraftFields, mode: Mode): Promise<WriteResult<unknown>> {
    const post = (parts: string[], body: unknown) =>
      write(apiBaseUrl, accessToken, apiPath(['finance', 'identities', ...parts]), body);
    const basis = current.note.trim();
    const source = optional(current.src);
    const confirmation = () => {
      const first = pickedKeys.length ? current.picked[pickedKeys[0]].row : null;
      return {
        record_kind: kind,
        record_key: name,
        relation: relationOf(kind),
        evidence_source: evidenceSource(kind),
        evidence_snapshot_id: snapshot,
        evidence_locator: first ?? data?.fingerprints[0]?.rows[0]?.row_number ?? null,
        evidence_quote: name,
        basis,
        ...(source ? { source } : {}),
        ...(current.quick
          ? {
              record_selection: {
                snapshot_id: snapshot,
                ...(current.quick.year !== null ? { year: current.quick.year } : {}),
              },
            }
          : { fingerprints: pickedKeys }),
      };
    };
    if (mode === 'confirm') return post([current.target ?? '', 'confirmations'], confirmation());
    if (mode === 'create')
      return post([], {
        kind: current.newKind ?? 'organization',
        name: current.newName.trim(),
        confirmation: confirmation(),
      });
    if (mode === 'merge' && conf)
      return post([current.pick ?? '', 'merge'], {
        into: conf.id,
        reason: basis,
        ...(source ? { source } : {}),
      });
    if (mode === 'split' && conf) {
      const moving = [...current.parts, ...current.roles];
      return post([conf.id, 'split'], {
        reason: basis,
        ...(source ? { source } : {}),
        parts: [
          {
            name: conf.name,
            confirmations: active.map((c) => c.id).filter((id) => !moving.includes(id)),
          },
          { name: current.newName.trim(), confirmations: moving },
        ],
      });
    }
    // Withdraw: each confirmation of this spelling for the shown identity, 1 request
    // each; a retry skips the ones already withdrawn.
    // The withdrawal's size is fixed when it starts; a refresh drops withdrawn ones.
    if (withdrawn.current.size === 0) withdrawTotal.current = groups.length;
    const pending = groups.filter((group) => !withdrawn.current.has(group.id));
    let last: WriteResult<unknown> =
      pending.length || withdrawn.current.size
        ? { ok: true, data: null }
        : { ok: false, reason: 'failed' };
    for (const group of pending) {
      last = await post(['confirmations', group.id, 'withdraw'], { reason: current.note.trim() });
      if (!last.ok) return last;
      withdrawn.current.add(group.id);
    }
    return last;
  }

  async function submit() {
    if (!form || !spec || ui.saving) return;
    if (stale) {
      setUi((value) => ({ ...value, tried: true }));
      return;
    }
    const note = form.note.trim();
    const bad =
      !note ||
      (spec.beyond !== null && !beyondName(note, [name, spec.beyond])) ||
      (spec.src && !form.src.trim()) ||
      (spec.pick && !form.pick) ||
      (spec.recs === 'name' && !pickedKeys.length && !form.quick) ||
      (spec.recs === 'split' && !form.parts.length && !form.roles.length) ||
      (spec.name && !form.newName.trim());
    if (bad) {
      setUi((value) => ({ ...value, tried: true }));
      focusFirstInvalid();
      return;
    }
    if (spec.recs === 'split' && form.parts.length + form.roles.length >= active.length) {
      setUi((value) => ({
        ...value,
        tried: true,
        planError: 'Every part needs at least 1 record',
      }));
      return;
    }
    const current = form;
    const mode = form.mode;
    setUi({ ...READY, saving: true });
    onLive(spec.busy.replace('…', ''));
    if (conf)
      setTouched((list) => [
        ...new Set([...list, conf.id, ...(current.pick ? [current.pick] : [])]),
      ]);
    const result = await perform(current, mode);
    if (result.ok) {
      withdrawn.current = new Set();
      discardDraft(draftKey(kind, name, current));
      setForm(null);
      setUi(READY);
      onLive('Saved');
      setVersion((value) => value + 1);
      onSaved();
      onDraftsChanged();
      return;
    }
    if (mode === 'withdraw' && withdrawn.current.size > 0) {
      // Part of the withdrawal saved: show what changed and keep the note for the rest.
      const partial = { k: withdrawn.current.size, n: withdrawTotal.current };
      setUi({ ...READY, partial });
      onLive(partlyWithdrawn(partial));
      setVersion((value) => value + 1);
      onSaved();
    } else if (result.reason === 'source-changed') {
      setUi({ ...READY, tried: true, stale: true });
      onLive('');
    } else if (
      result.reason === 'conflict' ||
      (result.reason === 'refused' &&
        /already confirmed|not in the Board's current file|merged or split/i.test(result.message))
    ) {
      setUi({ ...READY, tried: true, stale: spec.recs !== null, planError: REVISION });
      onLive('Not saved');
    } else if (result.reason === 'refused') {
      setUi({ ...READY, tried: true, planError: result.message });
      onLive('Not saved');
    } else if (result.reason === 'rejected') {
      setUi({ ...READY, refused: true });
      onLive('Not saved');
    } else {
      setUi({ ...READY, storeFailed: true });
      onLive('Not saved');
    }
  }

  function reload() {
    setSnapshot(null);
    setAddress({ records_page: '1' });
    if (form) update({ picked: {}, quick: null, snapshot: null });
    setUi((value) => ({ ...value, stale: false, tried: false, planError: '' }));
    setVersion((value) => value + 1);
    onLive('Records reloaded');
  }
  // The selection belongs to the source copy it was made in.
  useEffect(() => {
    if (
      form &&
      data &&
      form.snapshot !== data.snapshot_id &&
      !Object.keys(form.picked).length &&
      !form.quick
    )
      update({ snapshot: data.snapshot_id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.snapshot, data?.snapshot_id]);

  const staleNotice = stale ? (
    <div role="alert" className="ci-stale">
      {STALE_LINE}
      <button type="button" className="f-btn f-btn-secondary ci-btn-s" onClick={reload}>
        Reload the records
      </button>
    </div>
  ) : null;

  const pager =
    data && data.pages > 1 ? (
      <Pager
        page={data.page}
        pages={data.pages}
        busy={records.pending}
        onChange={(next) => setAddress({ records_page: String(next) })}
      />
    ) : null;

  // ---- Form pieces ----
  let recOptions: Array<{
    key: string;
    title: string;
    meta: string;
    checked: boolean;
    toggle: () => void;
  }> = [];
  let periodChips: Array<{ label: string; selected: boolean; pick: () => void }> = [];
  let recsCount = '';
  let roleOptions: typeof recOptions = [];
  if (form && spec?.recs === 'name' && data) {
    const inQuick = (record: Fingerprint) =>
      !!form.quick && (form.quick.year === null || yearOf(record) === form.quick.year);
    periodChips = [
      { label: 'All records', year: null as number | null },
      ...data.years.map((year) => ({ label: `${year} records`, year })),
    ].map((chip) => ({
      label: chip.label,
      selected: !!form.quick && form.quick.year === chip.year,
      pick: () => update({ quick: { year: chip.year }, picked: {}, snapshot: data.snapshot_id }),
    }));
    recOptions = unconfirmed.map((record) => {
      const checked = inQuick(record) || !!form.picked[record.fingerprint];
      const filer = record.display?.filer_name ?? (registrationOf(record.fields) || '');
      const type = record.display?.record_type ?? record.display?.record_types?.join(' · ') ?? '';
      const date = recordDate(record.fields);
      return {
        key: record.fingerprint,
        title: [day(date) ?? 'Date not given', filer].filter(Boolean).join(' · '),
        meta: [
          type,
          recordAmount(record.fields),
          record.rows.length > 1 ? `${record.rows.length} identical records` : '',
        ]
          .filter(Boolean)
          .join(' · '),
        checked,
        toggle: () => {
          const base: DraftFields['picked'] = {};
          if (form.quick)
            for (const item of unconfirmed)
              if (inQuick(item))
                base[item.fingerprint] = {
                  row: item.rows[0]?.row_number ?? null,
                  date: recordDate(item.fields),
                  count: item.rows.length,
                };
          const picked = form.quick ? base : { ...form.picked };
          if (checked) delete picked[record.fingerprint];
          else
            picked[record.fingerprint] = {
              row: record.rows[0]?.row_number ?? null,
              date,
              count: record.rows.length,
            };
          update({ picked, quick: null, snapshot: data.snapshot_id });
        },
      };
    });
    const pool = Math.max(0, n - k);
    if (form.quick) {
      const selected =
        form.quick.year === null
          ? pool
          : yearCount.data
            ? Math.max(0, yearCount.data.records - yearCount.data.confirmed)
            : null;
      recsCount =
        selected === null ? '' : `${selected} of ${plural(pool, 'record', 'records')} selected`;
    } else {
      const dates = pickedKeys.map((fp) => form.picked[fp].date);
      recsCount = `${pickedRows} of ${plural(pool, 'record', 'records')} selected${pickedRows ? ` · ${period(dates)}` : ''}`;
    }
  }
  if (form && spec?.recs === 'split') {
    recOptions = printedActive.map((c) => {
      const checked = form.parts.includes(c.id);
      return {
        key: c.id,
        title: c.record_key,
        meta: coverageLine(c),
        checked,
        toggle: () =>
          update({
            parts: checked ? form.parts.filter((id) => id !== c.id) : [...form.parts, c.id],
          }),
      };
    });
    roleOptions = roleActive.map((c) => {
      const checked = form.roles.includes(c.id);
      return {
        key: c.id,
        title: roleTitle(c),
        meta: '',
        checked,
        toggle: () =>
          update({
            roles: checked ? form.roles.filter((id) => id !== c.id) : [...form.roles, c.id],
          }),
      };
    });
    const moving = printedActive.filter((c) => form.parts.includes(c.id));
    const movingRows = rowsIn(moving);
    const allRows = rowsIn(printedActive);
    // A count whose file is not held is left out, never summed as 0.
    const selected =
      movingRows === null
        ? 'Records selected'
        : allRows === null
          ? `${plural(movingRows, 'record', 'records')} selected`
          : `${movingRows} of ${plural(allRows, 'record', 'records')} selected`;
    recsCount = `${selected}${moving.length ? ` · ${period(moving.flatMap(coveredDates))}` : ''}`;
  }

  const pickOptions =
    form?.mode === 'merge' && conf
      ? (entities.data?.rows ?? [])
          .filter((row) => row.id !== conf.id)
          .map((row) => ({
            key: row.id,
            label: nameDotRef(row),
            checked: form.pick === row.id,
            choose: () => open({ ...keyOf({ mode: 'merge' }), pick: row.id }),
          }))
      : [];
  const pickPager =
    form?.mode === 'merge' ? (
      <>
        {entities.failed && (
          <Refused onRetry={entities.retry} retrying={entities.pending}>
            {entities.changed
              ? RECORDS_CHANGED
              : `We couldn’t load the records to merge in.${entities.data ? ' Previous results are shown.' : ''}`}
          </Refused>
        )}
        {entities.data && entities.data.pages > 1 && (
          <Pager
            page={entities.data.page}
            pages={entities.data.pages}
            busy={entities.pending}
            onChange={setPickPage}
          />
        )}
      </>
    ) : null;

  let mergePreview: ReactNode = null;
  if (form?.mode === 'merge' && form.pick && conf) {
    if (pickRead.loading) mergePreview = <LoadingRows label="Loading…" />;
    else if (pickRead.failed)
      mergePreview = (
        <Refused onRetry={pickRead.retry} retrying={pickRead.pending}>
          We couldn’t load the links that will move
        </Refused>
      );
    else if (pickRead.data) {
      const moving = pickRead.data.confirmations.filter((c) => c.status === 'confirmed');
      const count = sumCounts(moving.map((c) => (c.records ? coveredRows(c) : 1)));
      const from = named(pickRead.data);
      // A count whose file is not held is never read as 0 or a partial sum: the lead
      // keeps its words without the number (settled wording row 27).
      const lead =
        count === null
          ? `These confirmed records will move from ${from} to ${named(conf)}. Each keeps its own evidence. ${refOf(pickRead.data)} will then open ${refOf(conf)}.`
          : count
            ? `${count === 1 ? 'This confirmed record' : `These ${count} confirmed records`} will move from ${from} to ${named(conf)}. Each keeps its own evidence. ${refOf(pickRead.data)} will then open ${refOf(conf)}.`
            : `${from} holds no confirmed records. ${refOf(pickRead.data)} will then open ${refOf(conf)}.`;
      mergePreview = (
        <section aria-labelledby="move-h" className="ci-preview">
          <h4 id="move-h">Links that will move</h4>
          <p>
            <Refs>{lead}</Refs>
          </p>
          {moving.length > 0 && (
            <ul>
              {moving.map((c) => (
                <li key={c.id}>
                  <span className="ci-strong">
                    {printableKey(c) ?? ROLE_LABELS[c.record_kind] ?? c.record_kind}
                  </span>
                  <span className="ci-muted f-num">
                    {c.records
                      ? coverageLine(c)
                      : [
                          printableKey(c) === null
                            ? null
                            : (ROLE_LABELS[c.record_kind] ?? c.record_kind),
                          c.checked_at ? `Checked on ${day(c.checked_at)}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </span>
                  <span>
                    <span className="ci-strong">Evidence:</span> {confirmationNote(c)} ·{' '}
                    {confirmationSource(c)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      );
    }
  }

  // ---- Page ----
  const heldSuggestions = remaining > 0 ? held : [];
  const showSuggest = !conf || remaining > 0;
  const history = data ? historyRows(reads.byId, kind, name, n) : [];
  const confHref = conf ? profileHref(conf, here) : null;
  const draftOpen = !!form && hasEntries(form);

  if (records.loading)
    return (
      <section className="ci-detail" aria-label={name}>
        <LoadingRows label="Loading records…" />
      </section>
    );
  if (!data)
    return (
      <section className="ci-detail" aria-label={name}>
        {records.stale ? (
          staleNotice
        ) : (
          <Refused onRetry={records.retry} retrying={records.pending}>
            We couldn’t load the records
          </Refused>
        )}
      </section>
    );

  return (
    <section className="ci-detail" aria-labelledby="name-h">
      {single && (
        <button type="button" className="f-back ci-back-button" onClick={onBackToQueue}>
          <Chevron />
          <span>Back to Names to review</span>
        </button>
      )}
      <div className="ci-card ci-name-card">
        <span className="f-label">{eyebrow(kind)}</span>
        <h2 id="name-h">{name}</h2>
        {conf ? (
          <div className="ci-status">
            <CheckedIcon />
            <span className="f-num">
              {held.length > 1
                ? `${held.length} identities · Confirmed for ${k} of ${n} records`
                : identityLine(groups, conf.confirmed, n)}
            </span>
          </div>
        ) : (
          <div className="ci-status">
            <UncheckedIcon />
            Not confirmed
          </div>
        )}
      </div>

      {held.length > 1 && (
        <ul className="ci-identities">
          {held.map((identity) => {
            const href = profileHref(identity, here);
            const shown = identity.id === conf?.id;
            return (
              <li key={identity.id}>
                <span className="ci-identity-text">
                  <span className="ci-strong">{identity.name}</span>
                  <span className="ci-muted ci-small f-num">
                    {identityKindLabel(identity.kind)} ·{' '}
                    <Refs>
                      {identity.reference
                        ? `Alethical reference ${identity.reference}`
                        : identity.name}
                    </Refs>{' '}
                    ·{' '}
                    {identityLine(
                      spellingConfirmations(reads.byId.get(identity.id), kind, name),
                      identity.confirmed,
                      n,
                    )}
                  </span>
                </span>
                <span className="ci-identity-actions">
                  {shown ? (
                    <span className="ci-muted ci-small ci-strong">Shown below</span>
                  ) : (
                    <button
                      type="button"
                      className="f-btn f-btn-secondary ci-btn-s"
                      onClick={() => {
                        setIdent(identity.id);
                        open(null);
                      }}
                    >
                      Show this identity
                    </button>
                  )}
                  {href && (
                    <Link to={href} className="ci-link">
                      Open profile
                    </Link>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {draftOpen && form && (
        <div className="ci-discard">
          <button
            type="button"
            className="f-btn f-btn-secondary ci-btn-s"
            onClick={() => {
              discardDraft(draftKey(kind, name, form));
              setForm(null);
              setUi(READY);
              onDraftsChanged();
            }}
          >
            Discard draft
          </button>
        </div>
      )}
      {ui.storeFailed && (
        <div role="alert" className="ci-failed">
          <span>Not saved. Your entries are kept.</span>
          <button
            type="button"
            className="f-btn f-btn-secondary ci-btn-s"
            onClick={() => void submit()}
          >
            Try again
          </button>
        </div>
      )}
      {ui.partial && (
        <div role="alert" className="ci-failed">
          <span>{partlyWithdrawn(ui.partial)}</span>
          <button
            type="button"
            className="f-btn f-btn-secondary ci-btn-s"
            onClick={() => void submit()}
          >
            Try again
          </button>
        </div>
      )}
      {ui.planError && (
        <div role="alert" className="ci-plan-error">
          {ui.planError}
        </div>
      )}
      {ui.refused && (
        <Refused>
          We couldn’t save this change, so nothing was changed. Your note is kept below; try again.
        </Refused>
      )}

      {conf && (
        <section aria-labelledby="conf-h" className="ci-card ci-confirmed">
          <span id="conf-h" className="f-label">
            CONFIRMED IDENTITY
          </span>
          <div className="ci-confirmed-head">
            <span className="ci-identity-text">
              <span className="ci-confirmed-name">{conf.name}</span>
              <span className="ci-muted ci-small f-num">
                {identityKindLabel(conf.kind)} ·{' '}
                <Refs>{conf.reference ? `Alethical reference ${conf.reference}` : conf.name}</Refs>
              </span>
            </span>
            {confHref && (
              <Link to={confHref} className="f-dest ci-dest">
                <span>
                  Open{' '}
                  <span className="f-nowrap">
                    profile
                    <Arrow className="f-arrow f-arrow-after" />
                  </span>
                </span>
              </Link>
            )}
          </div>
          {reads.failed && (
            <Refused onRetry={reads.retry}>We couldn’t load the confirmations</Refused>
          )}
          {groups.length > 1 && (
            <dl className="ci-dl">
              <dt>Records covered</dt>
              <dd className="f-num">
                {conf.confirmed} of {n} records · {period(groups.flatMap(coveredDates))}
              </dd>
            </dl>
          )}
          {groups.map((group) => (
            <dl key={group.id} className="ci-dl" data-group={groups.length > 1 || undefined}>
              <dt>{groups.length > 1 ? 'Confirmation' : 'Records covered'}</dt>
              <dd className="f-num">{coverageLine(group)}</dd>
              <dt>Evidence</dt>
              <dd>{confirmationNote(group)}</dd>
              <dt>Source</dt>
              <dd className="ci-wrap">{confirmationSource(group)}</dd>
            </dl>
          ))}
          <div className="ci-actions">
            {(
              [
                ['withdraw', 'Withdraw confirmation'],
                ['merge', 'Merge with another record'],
                ['split', 'Split this record'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className="f-btn f-btn-secondary ci-btn"
                aria-expanded={form?.mode === mode}
                onClick={() => toggle(mode)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      )}

      {showSuggest && (
        <section aria-labelledby="sug-h" className="ci-suggest">
          {conf && remaining > 0 && (
            <p className="ci-muted ci-small14 f-num">
              {remaining} of {n} records not confirmed
            </p>
          )}
          <h3 id="sug-h">Suggested matches</h3>
          {heldSuggestions.length === 0 && (
            <p className="ci-muted ci-small14">
              No person or organization was suggested for this spelling
            </p>
          )}
          {heldSuggestions.map((identity) => {
            const href = profileHref(identity, here);
            const opened = form?.mode === 'confirm' && form.target === identity.id;
            return (
              <div
                key={identity.id}
                className="ci-card ci-suggestion"
                data-open={opened || undefined}
              >
                <div className="ci-suggestion-head">
                  <span className="ci-identity-text">
                    {href ? (
                      <Link to={href} className="ci-suggestion-name">
                        {identity.name}
                      </Link>
                    ) : (
                      <span className="ci-suggestion-plain">{identity.name}</span>
                    )}
                    <span className="ci-muted ci-small f-num">
                      {identityKindLabel(identity.kind)} ·{' '}
                      <Refs>
                        {identity.reference
                          ? `Alethical reference ${identity.reference}`
                          : identity.name}
                      </Refs>
                    </span>
                  </span>
                  <span className="ci-status ci-small">
                    <UncheckedIcon />
                    Not checked
                  </span>
                </div>
                <p className="ci-muted ci-small14">
                  <span className="ci-strong ci-ink">Why suggested:</span> Already confirmed for{' '}
                  {identity.confirmed} of {n} records under this spelling
                </p>
                <button
                  type="button"
                  className="f-btn f-btn-secondary ci-btn ci-start"
                  aria-expanded={opened}
                  onClick={() => toggle('confirm', { target: identity.id })}
                >
                  Confirm as this {identityKindLabel(identity.kind).toLowerCase()}
                </button>
              </div>
            );
          })}
          <div className="ci-create">
            <span>Is this a person or organization we don’t hold yet?</span>
            {(['organization', 'person'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className="f-btn f-btn-secondary ci-btn"
                aria-expanded={form?.mode === 'create' && form.newKind === value}
                onClick={() => toggle('create', { newKind: value })}
              >
                Create a new {value}
              </button>
            ))}
          </div>
        </section>
      )}

      {form && spec && (
        <IdentityForm
          spec={spec}
          errors={errors}
          newNameLabel={
            form.mode === 'split' ? 'Name of the new record' : `Name of the new ${newKindWord}`
          }
          newName={form.newName}
          onNewName={(newName) => update({ newName })}
          recsLegend={
            spec.recs === 'split'
              ? 'Records to move to the new record'
              : 'Records this confirmation covers'
          }
          periodChips={periodChips}
          recOptions={recOptions}
          recsCount={recsCount}
          recsPager={spec.recs === 'name' ? pager : null}
          roleOptions={roleOptions}
          staleNotice={staleNotice}
          pickOptions={pickOptions}
          pickPager={pickPager}
          mergePreview={mergePreview}
          note={form.note}
          onNote={(note) => update({ note })}
          src={form.src}
          onSrc={(src) => update({ src })}
          saving={ui.saving}
          onSubmit={() => void submit()}
          onCancel={() => open(null)}
        />
      )}

      <section aria-labelledby="rec-h" className="ci-records-section">
        <div className="ci-records-head">
          <h3 id="rec-h">Records under this exact spelling</h3>
          <span className="ci-muted ci-small f-num">{plural(n, 'record', 'records')}</span>
        </div>
        {records.updating && <Updating />}
        {records.failed && (
          <Refused onRetry={records.retry} retrying={records.pending}>
            We couldn’t load the records
          </Refused>
        )}
        {(!form || spec?.recs !== 'name') && staleNotice}
        <div
          role="table"
          aria-label="Records under this exact spelling"
          className="ci-card ci-table"
        >
          {!phone && (
            <div role="row" className="ci-row ci-row-head">
              <span role="columnheader">DATE</span>
              <span role="columnheader">FILER</span>
              <span role="columnheader" className="ci-right">
                AMOUNT
              </span>
              <span role="columnheader">STATUS</span>
            </div>
          )}
          {data.fingerprints.map((record) => (
            <RecordRow
              key={record.fingerprint}
              record={record}
              kind={kind}
              name={name}
              here={here}
              phone={phone}
            />
          ))}
        </div>
        {(!form || spec?.recs !== 'name') && pager}
      </section>

      <section aria-labelledby="hist-h" className="ci-history-section">
        <h3 id="hist-h">History</h3>
        {reads.failed && <Refused onRetry={reads.retry}>We couldn’t load the history</Refused>}
        {history.length === 0 && !reads.settled && !reads.failed && <LoadingRows />}
        {(history.length > 0 || reads.settled) && (
          <ol className="ci-card ci-history">
            {/* Empty only when every identity read finished: never while loading or
              after a failure (settled wording row 29). */}
            {history.length === 0 && reads.settled && (
              <li>
                <span />
                <span>No confirmations or suggestions yet</span>
              </li>
            )}
            {history.map((row) => (
              <li key={row.key}>
                <span className="ci-history-date f-num">{row.date}</span>
                <span className="ci-history-body">
                  <span className="f-num ci-wrap">
                    <Refs>{row.text}</Refs>
                  </span>
                  {row.evidence.length > 0 && (
                    <span>
                      <button
                        type="button"
                        className="f-btn f-btn-secondary ci-btn-s"
                        aria-expanded={!!histOpen[row.key]}
                        onClick={() =>
                          setHistOpen((value) => ({ ...value, [row.key]: !value[row.key] }))
                        }
                      >
                        View evidence
                      </button>
                    </span>
                  )}
                  {histOpen[row.key] && (
                    <ul className="ci-evidence">
                      {row.evidence.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}

function RecordRow({
  record,
  kind,
  name,
  here,
  phone,
}: {
  record: Fingerprint;
  kind: PrintedKind;
  name: string;
  here: string;
  phone: boolean;
}) {
  const registration = record.display?.filer_registration_number ?? registrationOf(record.fields);
  const filer =
    record.display?.filer_name ??
    (registration ? `Registration number ${registration}` : 'Filer not given');
  const date = day(recordDate(record.fields)) ?? 'Date not given';
  const type = record.display?.record_type ?? record.display?.record_types?.join(' · ') ?? '';
  const year = yearOf(record);
  const href =
    record.display?.filer_is_held && registration
      ? withFrom(
          hrefFor(
            'committee',
            { id: registration },
            { year: year ? String(year) : null, tab: committeeTab(kind), q: name },
          ),
          here,
        )
      : null;
  const amountMissing = record.fields?.amount === null || record.fields?.amount === undefined;
  const status = record.confirmation
    ? `Confirmed as ${record.confirmation.identity.name}`
    : 'Not confirmed';
  const filerNode = href ? (
    <Link to={href} className="ci-filer">
      {filer}
    </Link>
  ) : (
    <span className="ci-filer-plain">{filer}</span>
  );
  const amount = (
    <>
      {recordAmount(record.fields)}
      {record.rows.length > 1 && (
        <span className="ci-muted ci-small"> · {record.rows.length} identical records</span>
      )}
    </>
  );
  if (phone)
    return (
      <div role="row" className="ci-row-phone">
        <div className="ci-row-phone-top">
          <span role="cell">{filerNode}</span>
          <span role="cell" className="f-num ci-amount" data-missing={amountMissing || undefined}>
            {amount}
          </span>
        </div>
        <div role="cell" className="ci-muted ci-small f-num">
          {[date, type, status].filter(Boolean).join(' · ')}
        </div>
      </div>
    );
  return (
    <div role="row" className="ci-row">
      <span role="cell" className="ci-date f-num">
        {date}
      </span>
      <span role="cell" className="ci-filer-cell">
        {filerNode}
        {type && <span className="ci-muted ci-small">{type}</span>}
      </span>
      <span
        role="cell"
        className="ci-right ci-amount f-num"
        data-missing={amountMissing || undefined}
      >
        {amount}
      </span>
      <span
        role="cell"
        className="ci-row-status"
        data-confirmed={!!record.confirmation || undefined}
      >
        {status}
      </span>
    </div>
  );
}

function CheckedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="#0E6A82" strokeWidth="2" />
      <path
        d="M8 12.5 L10.8 15.2 L16 9.5"
        stroke="#0E6A82"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UncheckedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="#5F6B76" strokeWidth="2" strokeDasharray="3 3" />
    </svg>
  );
}
