import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { registerKindLabel } from "@alethical/shared/committeeMoneyShared";
import { useDebouncedSearchCommit } from "@alethical/shared/hooks/useDebouncedSearchCommit";
import { tooShortTitle } from "@alethical/shared/moneyNameSearch";
import { apiGet, useRead } from "../../api/read";
import { useFinanceSession } from "../../auth/session";
import { Link, useLocation } from "../../router";
import { withFrom } from "../../returnContext";
import { matchRoute } from "../../routes";
import { discardDraft, readDraft, saveDraft } from "../../ui/drafts";
import { Refused } from "../../ui/controls";
import { BackLink, LoadingLine, WithArrow } from "../../ui/parts";
import { StationEvidencePanel, type StationEvidence } from "../media/evidence";
import { MenuButton } from "../media/menu";
import {
  FACT_FIELDS,
  PageImage,
  PageSteps,
  ReadState,
  connectionLabel,
  day,
  fieldLabel,
  fileHref,
  lastSegment,
  mediaPath,
  serverKind,
  versionLabel,
} from "../media/shared";
import type {
  Connection,
  Fact,
  FileDetail,
  Queue,
  Suggestion,
  Suggestions,
  TargetPreview,
} from "../media/types";
import {
  ROLE_TYPES,
  SEARCHABLE_TYPES,
  blankConnection,
  blankDraft,
  blankFact,
  checkRows,
  connectionBody,
  correctionOf,
  currentFacts,
  draftKey,
  factBody,
  findDuplicate,
  hasEntries,
  hasMoneyContext,
  historyRows,
  pageText,
  previewKey,
  refusalField,
  validate,
  type ConnectionEntries,
  type Draft,
  type FactEntries,
  type Mode,
  type TargetResult,
} from "./model";
import { postCheck } from "./write";

type Address = Partial<
  Record<"file" | "version" | "page" | "check" | "action", string>
>;

function focusSoon(id: string, scroll = false) {
  setTimeout(() => {
    const element = document.getElementById(id);
    if (!element) return;
    if (scroll) element.scrollIntoView({ block: "start", behavior: "smooth" });
    element.focus({ preventScroll: scroll });
  }, 0);
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <span className="ck-warn">
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M12 3 L22 20 H2 Z"
          stroke="#9A6114"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M12 10 V14 M12 17 V17.5"
          stroke="#9A6114"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      {children}
    </span>
  );
}
function Tick() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
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

/** The chosen file: its current version, or the notice for a link naming another. */
export function Review({
  fileKey,
  askedVersion,
  page,
  check,
  action,
  onAddress,
  onDraftChange,
  onLoaded,
}: {
  fileKey: string;
  askedVersion: string;
  page: number;
  check: string;
  action: string;
  onAddress: (changes: Address) => void;
  onDraftChange: () => void;
  onLoaded: (file: FileDetail) => void;
}) {
  const read = useRead<FileDetail>(mediaPath(["files", fileKey]));
  const file = read.data && read.data.key === fileKey ? read.data : null;
  useEffect(() => {
    if (file) onLoaded(file);
    // Only a newly read file is reported.
  }, [file]);
  if (read.notFound)
    return (
      <section className="ck-card ck-padded ck-detail">
        <h2>This record is not held</h2>
      </section>
    );
  if (!file)
    return (
      <div className="ck-detail">
        {read.failed ? (
          <Refused onRetry={read.retry} retrying={read.pending}>
            Couldn’t load TV station file
          </Refused>
        ) : (
          <div
            className="ck-detail-loading"
            role="status"
            aria-busy="true"
            aria-label="Loading"
          />
        )}
      </div>
    );
  if (askedVersion && askedVersion !== file.version_id) {
    const older = file.versions.find((v) => v.id === askedVersion);
    const current = versionLabel(
      file.versions.find((v) => v.id === file.version_id),
    );
    const lower = (text: string) =>
      text.charAt(0).toLowerCase() + text.slice(1);
    return (
      <section
        aria-labelledby="mm-h"
        className="ck-card ck-padded ck-detail ck-mismatch"
      >
        <h2 id="mm-h">{file.name}</h2>
        <p role="status">
          {older
            ? `This link is for the version ${lower(versionLabel(older))}, which can’t be checked. Checks are added to the current copy, ${lower(current)}.`
            : `This link names a version that isn’t held for this file. Checks are added to the current copy, ${lower(current)}.`}
        </p>
        <button
          type="button"
          className="f-btn f-btn-secondary"
          onClick={() => onAddress({ version: file.version_id })}
        >
          Check the current copy
        </button>
      </section>
    );
  }
  return (
    <Workbench
      key={file.version_id}
      file={file}
      fileKey={fileKey}
      page={Math.min(Math.max(1, file.page_count), page)}
      check={check}
      action={action}
      onAddress={onAddress}
      onDraftChange={onDraftChange}
      refresh={read.retry}
    />
  );
}

type SaveState = "idle" | "busy" | "saved" | "failed";
interface Withdrawal {
  id: string;
  reason: string;
  error: string;
  status: "idle" | "busy" | "failed";
}
interface MoneyResult {
  kind: string;
  name?: string;
  registration_number?: string | number | null;
  entity_id?: string | number | null;
  filer_kind?: string | null;
}

// The suggestions service uses campaign_finance_search.MIN_QUERY_LENGTH.
const MONEY_LOOKUP_MIN_LENGTH = 3;
interface MoneyGroup {
  kind: string;
  state: string;
  reason?: string | null;
  results: MoneyResult[];
}
type MoneyMatches = { money: { state?: string; groups?: MoneyGroup[] } | null };
type LookupResults = {
  scope: string;
  kind: string;
  query: string;
  rows: TargetResult[];
};

function matchingRecords(
  data: Queue | MoneyMatches,
  kind: string,
  fileKey: string,
): TargetResult[] | "too-short" | "unavailable" {
  if ("rows" in data)
    return data.rows
      .filter((row) => row.key !== fileKey)
      .map((row) => ({
        id: `${row.key}@${row.version_id}`,
        name: row.name,
        line: [
          row.station,
          row.folder_label,
          row.uploaded_at ? `Uploaded ${day(row.uploaded_at)}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      }));
  const group = data.money?.groups?.find((item) =>
    kind === "committee"
      ? item.kind === "committees"
      : item.kind === "principals",
  );
  if (group?.reason === "query_too_short") return "too-short";
  if (data.money?.state === "unavailable" || !group) return "unavailable";
  if (group.state === "not_reported") return [];
  if (group.state !== "reported" || !Array.isArray(group.results))
    return "unavailable";
  return kind === "committee"
    ? group.results
        .filter(
          (row) => row.kind === "committee" && row.registration_number != null,
        )
        .map((row) => ({
          id: String(row.registration_number),
          name: row.name ?? "",
          line: [
            registerKindLabel(row.filer_kind),
            `Registration number ${row.registration_number}`,
          ]
            .filter(Boolean)
            .join(" · "),
        }))
    : group.results
        .filter((row) => row.kind === "principal" && row.entity_id != null)
        .map((row) => ({
          id: String(row.entity_id),
          name: row.name ?? "",
          line: `State entity ID ${row.entity_id}`,
        }));
}

function Workbench({
  file,
  fileKey,
  page,
  check,
  action,
  onAddress,
  onDraftChange,
  refresh,
}: {
  file: FileDetail;
  fileKey: string;
  page: number;
  check: string;
  action: string;
  onAddress: (changes: Address) => void;
  onDraftChange: () => void;
  refresh: () => void;
}) {
  const { apiBaseUrl, accessToken, canEdit } = useFinanceSession();
  const location = useLocation();
  const here = location.pathname + location.search;
  const version = file.version_id;
  const store = draftKey(fileKey, version);
  const [draft, setDraft] = useState<Draft>(
    () => readDraft<Draft>(store) ?? blankDraft(String(page)),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [stale, setStale] = useState(false);
  const [changed, setChanged] = useState(false);
  const [dupOf, setDupOf] = useState<Fact | Connection | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [withdrawal, setWithdrawal] = useState<Withdrawal | null>(null);
  const [withdrawn, setWithdrawn] = useState(false);
  const [evidence, setEvidence] = useState<StationEvidence | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [used, setUsed] = useState<Set<string>>(new Set());
  const [showDismissed, setShowDismissed] = useState(false);
  const [appliedLookup, setAppliedLookup] = useState("");
  const [heldLookup, setHeldLookup] = useState<LookupResults | null>(null);
  const [previewing, setPreviewing] = useState<"idle" | "busy" | "failed">(
    "idle",
  );
  const live = useRef(true);
  const previewRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      previewRequest.current?.abort();
    };
  }, []);

  const suggestions = useRead<Suggestions>(
    mediaPath(["files", fileKey, "suggestions"], { version }),
    {
      acceptData: (data) => data.key === fileKey && data.version_id === version,
    },
  );

  // One draft per exact file and version, kept while the reader types.
  useEffect(() => {
    if (hasEntries(draft)) saveDraft(store, draft);
    else discardDraft(store);
    onDraftChange();
    // onDraftChange only re-renders the queue's tags.
  }, [draft, store]);

  const busy = saveState === "busy";
  const anyBusy = busy || withdrawal?.status === "busy";
  const rows = checkRows(file);
  const history = historyRows(file);
  const facts = currentFacts(file);
  const fact = draft.fact;
  const conn = draft.connection;
  const lookupScope = `${apiBaseUrl}|${accessToken}|${canEdit}|${fileKey}|${version}`;
  const currentScope = useRef(lookupScope);
  currentScope.current = lookupScope;
  const mayLookUp =
    !!accessToken && canEdit !== false && draft.mode === "connection";
  const lookupQuery = conn.query.trim();
  const lookupKey =
    mayLookUp &&
    conn.type &&
    conn.type !== "issue" &&
    (lookupQuery || conn.type === "related_document")
      ? JSON.stringify([lookupScope, conn.type, lookupQuery])
      : "";
  useDebouncedSearchCommit(
    lookupKey,
    lookupKey ? appliedLookup : "",
    setAppliedLookup,
  );
  // Drop the old request as soon as the input changes, including during the pause
  // before the next read. The earlier answer keeps its own query below.
  const lookupPath =
    lookupKey && lookupKey === appliedLookup
      ? conn.type === "related_document"
        ? mediaPath(["queue"], { q: lookupQuery, limit: 20 })
        : `finance/suggestions?${new URLSearchParams({ q: lookupQuery, request_id: "station-check", limit: "10" })}`
      : null;
  const lookup = useRead<Queue | MoneyMatches>(lookupPath);
  const remote = useMemo(
    () =>
      lookup.data ? matchingRecords(lookup.data, conn.type, fileKey) : null,
    [conn.type, fileKey, lookup.data],
  );
  const remoteRows = Array.isArray(remote) ? remote : null;
  const lookupTooShort = remote === "too-short";
  useEffect(() => {
    if (lookup.accessDenied) {
      setHeldLookup(null);
      return;
    }
    if (!remoteRows || !lookupPath) return;
    setHeldLookup({
      scope: lookupScope,
      kind: conn.type,
      query: lookupQuery,
      rows: remoteRows,
    });
  }, [
    conn.type,
    lookup.accessDenied,
    lookupPath,
    lookupQuery,
    lookupScope,
    remoteRows,
  ]);
  const retainedLookup =
    lookupKey &&
    !lookup.accessDenied &&
    !lookupTooShort &&
    heldLookup?.scope === lookupScope &&
    heldLookup.kind === conn.type
      ? heldLookup
      : null;
  const currentRows =
    mayLookUp && conn.type === "issue" && lookupQuery
      ? [{ id: lookupQuery, name: lookupQuery, line: "" }]
      : remoteRows;
  const lookupRows = currentRows ?? retainedLookup?.rows ?? null;
  const lookupStale = currentRows === null && retainedLookup !== null;
  const lookupFailed =
    !!lookupPath &&
    !lookup.pending &&
    (lookup.failed || lookup.notFound || remote === "unavailable");
  const lookupBusy =
    !!lookupKey &&
    (!lookupPath || lookup.loading || lookup.pending) &&
    !lookupFailed;
  const correcting = fact.correcting
    ? (facts.find((f) => f.id === fact.correcting) ?? null)
    : null;

  function touch() {
    setDupOf(null);
    setSaveState((was) => (was === "saved" ? "idle" : was));
    setWithdrawn(false);
  }
  function setFact(patch: Partial<FactEntries>, clear?: string) {
    touch();
    setDraft((was) => ({ ...was, fact: { ...was.fact, ...patch } }));
    if (clear) setErrors((was) => ({ ...was, [clear]: "" }));
  }
  function setConn(patch: Partial<ConnectionEntries>, clear?: string) {
    touch();
    setDraft((was) => ({
      ...was,
      connection: { ...was.connection, ...patch },
    }));
    if (clear) setErrors((was) => ({ ...was, [clear]: "" }));
  }
  function cancelPreview() {
    previewRequest.current?.abort();
    previewRequest.current = null;
    setPreviewing("idle");
    setChanged(false);
  }
  function leaveLookup() {
    if (!previewRequest.current) return;
    cancelPreview();
    setPreviewing("failed");
  }
  function resetTarget(
    patch: Partial<ConnectionEntries> = {},
    clear = "target",
  ) {
    cancelPreview();
    setConn(
      {
        target: null,
        preview: null,
        previewKey: "",
        moneyChecked: false,
        ...patch,
      },
      clear,
    );
  }
  function switchMode(mode: Mode) {
    if (anyBusy || draft.mode === mode) return;
    if (mode === "fact") leaveLookup();
    setDraft((was) => ({ ...was, mode }));
    setErrors({});
    setSaveState("idle");
    setStale(false);
    setDupOf(null);
  }
  function startCorrection(target: Fact) {
    leaveLookup();
    setDraft((was) => ({ ...was, mode: "fact", fact: correctionOf(target) }));
    setErrors({});
    setSaveState("idle");
    setStale(false);
    setEvidence(null);
    focusSoon("f-value", true);
  }
  function openWithdraw(id: string) {
    setEvidence(null);
    setWithdrawn(false);
    setWithdrawal({ id, reason: "", error: "", status: "idle" });
    focusSoon(`wr-${id}`, true);
  }

  // Arriving from a TV station file's evidence: open the named action once.
  useEffect(() => {
    if (!check || !action) return;
    const row = rows.find((r) => r.id === check);
    if (row) {
      if (action === "correct" && row.kind === "fact")
        startCorrection(row.item as Fact);
      else if (action === "withdraw") openWithdraw(row.id);
    }
    onAddress({ check: "", action: "" });
    // Runs for the action the address named on arrival.
  }, [check, action]);

  function showEvidence(item: Fact | Connection, kind: "fact" | "connection") {
    const isFact = kind === "fact";
    const label = isFact ? (item as Fact).kind : connectionLabel(item.kind);
    const value = isFact
      ? ((item as Fact).value ?? "")
      : ((item as Connection).label ?? "");
    setEvidence({
      title: `${label}: ${value}`,
      authority: `${file.station} public inspection file`,
      rows: [
        { label: "File", value: file.name },
        {
          label: "Source version",
          value: versionLabel(file.versions.find((v) => v.id === version)),
        },
        { label: isFact ? "Fact" : "Connection", value: label },
        { label: isFact ? "Value" : "Record", value },
        ...(item.role
          ? [{ label: isFact ? "Printed role" : "Role", value: item.role }]
          : []),
      ],
      quote: item.quote ?? undefined,
      page: item.page != null ? String(item.page) : undefined,
      checked: `Checked on ${day(item.checked_at)}`,
      machineText: item.page != null ? pageText(file, item.page) : null,
      actions:
        item.status === "checked"
          ? [
              ...(isFact
                ? [
                    {
                      label: "Correct fact",
                      onClick: () => startCorrection(item as Fact),
                    },
                  ]
                : []),
              { label: "Withdraw check", onClick: () => openWithdraw(item.id) },
            ]
          : [],
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || stale) return;
    const found = validate(draft, file, fileKey);
    const order =
      draft.mode === "fact"
        ? [
            ["kind", "fact-btn"],
            ["value", "f-value"],
            ["page", "f-page"],
            ["role", "f-role"],
            ["org", "f-org"],
            ["quote", "f-quote"],
            ["evidence", "f-evidence"],
            ["confirm", "f-confirm"],
          ]
        : [
            ["type", "conn-btn"],
            ["target", "c-query"],
            ["money", "f-money"],
            ["page", "f-page"],
            ["quote", "f-quote"],
            ["evidence", "f-evidence"],
            ["confirm", "f-confirm"],
          ];
    const first = order.find(([name]) => found[name]);
    if (first) {
      setErrors(found);
      setSaveState("idle");
      focusSoon(first[1]);
      return;
    }
    const duplicate = findDuplicate(draft, file);
    if (duplicate) {
      setErrors({});
      setDupOf(duplicate);
      return;
    }
    setErrors({});
    setSaveState("busy");
    const mode = draft.mode;
    const result = await postCheck(
      apiBaseUrl,
      accessToken,
      mediaPath([
        "files",
        fileKey,
        "versions",
        version,
        mode === "fact" ? "facts" : "connections",
      ]),
      mode === "fact" ? factBody(draft.fact) : connectionBody(draft.connection),
    );
    if (!live.current) return;
    if (result.state === "saved") {
      setDraft((was) => ({
        ...blankDraft(mode === "fact" ? was.fact.page : was.connection.page),
        mode,
      }));
      setSavedIds((was) => [...was, result.id]);
      setSaveState("saved");
      refresh();
      suggestions.retry();
      return;
    }
    if (result.state === "refused") {
      const where = refusalField(
        result.detail,
        draft,
        Math.max(1, file.page_count),
      );
      if (where === "stale") {
        setStale(true);
        setSaveState("idle");
        return;
      }
      if (where === "changed") {
        setChanged(true);
        setSaveState("idle");
        return;
      }
      if (where) {
        setErrors({ [where.field]: where.message });
        setSaveState("idle");
        const target = order.find(([name]) => name === where.field);
        if (target) focusSoon(target[1]);
        return;
      }
    }
    if (
      result.state === "conflict" &&
      mode === "fact" &&
      draft.fact.correcting
    ) {
      setStale(true);
      setSaveState("idle");
      return;
    }
    setSaveState("failed");
  }

  async function withdraw(id: string, kind: "fact" | "connection") {
    if (!withdrawal || withdrawal.status === "busy") return;
    const reason = withdrawal.reason.trim();
    if (!reason) {
      setWithdrawal({ ...withdrawal, error: "Give a reason" });
      focusSoon(`wr-${id}`);
      return;
    }
    setWithdrawal({ ...withdrawal, error: "", status: "busy" });
    const result = await postCheck(
      apiBaseUrl,
      accessToken,
      mediaPath([kind === "fact" ? "facts" : "connections", id, "withdraw"]),
      { reason },
    );
    if (!live.current) return;
    if (result.state === "saved" && result.status === "withdrawn") {
      setWithdrawal(null);
      setWithdrawn(true);
      refresh();
      suggestions.retry();
      focusSoon("checks-heading");
      return;
    }
    // The check and the typed reason stay; nothing says withdrawn (Round 41 item 3).
    setWithdrawal((was) =>
      was && was.id === id ? { ...was, status: "failed" } : was,
    );
  }

  function runSearch() {
    if (busy) return;
    if (!conn.type) {
      setErrors((was) => ({
        ...was,
        type: "Choose the connection this page shows",
      }));
      focusSoon("conn-btn");
      return;
    }
    if (!lookupKey) return;
    setErrors((was) => ({ ...was, target: "" }));
    if (lookupKey !== appliedLookup) setAppliedLookup(lookupKey);
    else if (lookupFailed) lookup.retry();
  }

  async function preview(
    target: TargetResult,
    entries: ConnectionEntries = conn,
  ) {
    previewRequest.current?.abort();
    const request = new AbortController();
    previewRequest.current = request;
    setConn(
      { target, preview: null, previewKey: "", moneyChecked: false },
      "target",
    );
    setChanged(false);
    setPreviewing("busy");
    const answer = await apiGet<TargetPreview>(
      apiBaseUrl,
      mediaPath(["files", fileKey, "versions", version, "target-preview"], {
        kind: entries.type,
        target_id: target.id,
        role:
          ROLE_TYPES.includes(entries.type) && entries.role.trim()
            ? entries.role.trim()
            : null,
      }),
      accessToken,
      fetch,
      request.signal,
    );
    if (
      !live.current ||
      request.signal.aborted ||
      currentScope.current !== lookupScope
    )
      return;
    previewRequest.current = null;
    if (answer.state !== "ok") {
      setPreviewing("failed");
      return;
    }
    setPreviewing("idle");
    setConn({
      target,
      preview: answer.data,
      previewKey: previewKey({ ...entries, target }, fileKey, version),
      moneyChecked: false,
    });
    focusSoon("rec-panel");
  }

  function useSuggestion(suggestion: Suggestion, id: string) {
    if (anyBusy) return;
    leaveLookup();
    setUsed((was) => new Set([...was, id]));
    setDraft((was) => ({
      ...was,
      mode: "fact",
      fact: {
        ...blankFact(String(suggestion.page)),
        field: FACT_FIELDS.some(([key]) => key === suggestion.field)
          ? suggestion.field
          : "",
        value: suggestion.value,
        quote: suggestion.quote,
      },
    }));
    setErrors({});
    setSaveState("idle");
    setStale(false);
    setDupOf(null);
    onAddress({ page: String(suggestion.page) });
  }

  const fromValue = new URLSearchParams(location.search).get("from");
  const fromMatch = fromValue
    ? matchRoute(fromValue.split(/[?#]/, 1)[0])
    : null;
  const fromFile =
    fromMatch?.route.name === "station-file" &&
    fromMatch.params.key === fileKey;
  const backToFile = (() => {
    if (!fromFile || !fromValue) return null;
    const [path, query = ""] = fromValue.split("?");
    const params = new URLSearchParams(query);
    params.set("version", version);
    if (page > 1) params.set("page", String(page));
    else params.delete("page");
    if (savedIds.length) params.set("new", savedIds.join(","));
    return `${path}?${params.toString()}`;
  })();
  const today = day(new Date().toISOString());
  const versionText = versionLabel(file.versions.find((v) => v.id === version));
  const scope = [
    file.station,
    file.year,
    file.category,
    lastSegment(file.folder.label),
  ]
    .filter((part) => part !== null && part !== "")
    .join(" · ");
  const text = pageText(file, page);
  const suggestionKey = (s: Suggestion) =>
    JSON.stringify([s.field, s.value, s.page, s.quote]);
  const allSuggestions = suggestions.data?.facts ?? [];
  const activeCount = allSuggestions.filter(
    (s) => !dismissed.has(suggestionKey(s)),
  ).length;
  const shownSuggestions = allSuggestions.filter(
    (s) => showDismissed || !dismissed.has(suggestionKey(s)),
  );
  const err = (name: string) => errors[name] ?? "";
  const needRole =
    fact.field === "organization_address" || fact.field === "officer_name";
  const needOrg = fact.field === "organization_address";
  const detailsShown =
    fact.detailsOpen || !!fact.qualifier || (!needRole && !!fact.role);
  const agencyChecked = facts.some((f) => f.kind === serverKind("agency_name"));
  const previewOk =
    !!conn.preview &&
    conn.previewKey === previewKey(conn, fileKey, version) &&
    !changed;
  const saveLabel =
    saveState === "failed"
      ? "Try again"
      : draft.mode === "fact"
        ? correcting
          ? "Save correction"
          : "Save"
        : "Save connection";

  const savedLine = saveState === "saved" && (
    <>
      <span className="ck-saved">
        <Tick />
        Saved · Checked on {today}
      </span>
      {backToFile && (
        <span className="ck-back-file">
          <BackLink to={backToFile} name="TV station file" />
        </span>
      )}
    </>
  );
  const dupNotice = dupOf && (
    <div role="status" className="ck-dup">
      <span>
        <Tick />
        <span>
          Already saved ·{" "}
          <span className="f-num">Checked on {day(dupOf.checked_at)}</span>
        </span>
      </span>
      <button
        type="button"
        className="ck-link-btn"
        onClick={() => showEvidence(dupOf, draft.mode)}
      >
        View evidence
      </button>
    </div>
  );
  const submitRow = (
    <div className="ck-submit">
      {busy ? (
        <button type="button" aria-disabled="true" className="f-btn ck-save">
          <span className="ck-spin" aria-hidden="true" />
          Saving…
        </button>
      ) : (
        <button type="submit" className="f-btn ck-save">
          {saveLabel}
        </button>
      )}
      {draft.mode === "fact" && correcting && (
        <button
          type="button"
          className="f-btn f-btn-secondary"
          aria-disabled={busy || undefined}
          onClick={() => {
            if (busy) return;
            const id = correcting.id;
            setDraft((was) => ({ ...was, fact: blankFact(String(page)) }));
            setStale(false);
            setErrors({});
            focusSoon(`ev-${id}`);
          }}
        >
          Cancel
        </button>
      )}
      <div aria-live="polite" className="ck-live">
        {busy && <span className="f-visually-hidden">Saving</span>}
        {savedLine}
      </div>
    </div>
  );
  const failedBanner = saveState === "failed" && (
    <Refused>Not saved. Your entries are kept.</Refused>
  );
  const discard = hasEntries(draft) && (
    <div className="ck-discard">
      <button
        type="button"
        className="f-btn f-btn-secondary ck-small-btn"
        aria-disabled={busy || undefined}
        onClick={() => {
          if (busy) return;
          cancelPreview();
          setHeldLookup(null);
          discardDraft(store);
          setDraft(blankDraft(String(page)));
          setErrors({});
          setSaveState("idle");
          setStale(false);
          setUsed(new Set());
          focusSoon("fact-btn");
        }}
      >
        Discard draft
      </button>
    </div>
  );
  const field = (
    name: string,
    id: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
    options: {
      multiline?: boolean;
      readOnly?: boolean;
      numeric?: boolean;
      wide?: boolean;
    } = {},
  ) => (
    <label className={`ck-field${options.wide ? " ck-wide" : ""}`}>
      <span className="ck-label">{label}</span>
      {options.multiline ? (
        <textarea
          id={id}
          rows={2}
          value={value}
          readOnly={busy || options.readOnly}
          data-error={err(name) ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          readOnly={busy || options.readOnly}
          inputMode={options.numeric ? "numeric" : undefined}
          className={options.numeric ? "f-num ck-strong" : undefined}
          data-error={err(name) ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {err(name) && <Warning>{err(name)}</Warning>}
    </label>
  );
  const confirmBox = (
    words: string,
    entries: { confirmed: boolean },
    set: (value: boolean) => void,
  ) => (
    <div className="ck-check-wrap">
      <label className="ck-check">
        <input
          id="f-confirm"
          type="checkbox"
          checked={entries.confirmed}
          disabled={busy}
          onChange={(event) => set(event.target.checked)}
        />
        <span>{words}</span>
      </label>
      {err("confirm") && <Warning>{err("confirm")}</Warning>}
    </div>
  );

  return (
    <div className="ck-detail">
      <section className="ck-card ck-padded" aria-labelledby="file-heading">
        <div className="ck-detail-head">
          <div>
            <h2 id="file-heading">{file.name}</h2>
            <p className="ck-note f-num">
              {scope} · Source version {versionText}
            </p>
          </div>
          <Link
            className="f-dest ck-open"
            to={withFrom(fileHref(fileKey, version, page), here)}
          >
            <span>
              <WithArrow>Open file</WithArrow>
            </span>
          </Link>
        </div>
        <div className="ck-review-columns">
          <div>
            {file.page_count > 0 ? (
              <PageImage
                fileKey={fileKey}
                version={version}
                page={page}
                alt={`Page ${page} of ${file.page_count} of the original TV station file ${file.name}`}
                failure={{
                  text: "Couldn’t load page image",
                  retry: "Retry image",
                }}
              />
            ) : (
              <p className="mb-no-pages">Page images are unavailable</p>
            )}
          </div>
          <div className="ck-text-col">
            {file.page_count > 0 && (
              <PageSteps
                page={page}
                pages={file.page_count}
                onChange={(next) => onAddress({ page: String(next) })}
              />
            )}
            <div className="f-evidence-quote-label ck-mono">
              MACHINE-READ TEXT · NOT CHECKED
            </div>
            <pre className="ck-machine">
              {text ?? "Machine-read text not held for this page"}
            </pre>
          </div>
        </div>
      </section>

      <section className="ck-card ck-padded" aria-labelledby="sugg-heading">
        <div className="ck-detail-head ck-center">
          <h2 id="sugg-heading">
            Suggestions{" "}
            {suggestions.data && (
              <span className="ck-count f-num">{activeCount}</span>
            )}
          </h2>
          <button
            type="button"
            className="f-btn f-btn-secondary ck-small-btn"
            aria-pressed={showDismissed}
            onClick={() => setShowDismissed((was) => !was)}
          >
            Show dismissed
          </button>
        </div>
        <p className="ck-note">
          Using a suggestion fills the form below; it isn’t a check until saved
        </p>
        <ReadState read={suggestions} noun="suggestions" />
        {shownSuggestions.length > 0 && (
          <ul className="ck-suggestions">
            {shownSuggestions.map((suggestion) => {
              const id = suggestionKey(suggestion);
              const isDismissed =
                dismissed.has(id) && !suggestion.already_checked;
              const isUsed =
                used.has(id) && !suggestion.already_checked && !isDismissed;
              const savedFact = suggestion.already_checked
                ? facts.find(
                    (f) =>
                      f.kind === serverKind(suggestion.field) &&
                      f.value === suggestion.value,
                  )
                : undefined;
              const kind =
                fieldLabel(suggestion.field) ||
                suggestion.field.replaceAll("_", " ");
              const status = suggestion.already_checked
                ? `Already checked${savedFact ? ` · Checked on ${day(savedFact.checked_at)}` : ""}`
                : isUsed
                  ? "Used · fills the form below"
                  : isDismissed
                    ? "Dismissed"
                    : `Read from page ${suggestion.page} · Not checked${suggestion.in_source_text ? "" : " · possible reading error"}`;
              return (
                <li
                  key={id}
                  data-state={
                    suggestion.already_checked
                      ? "saved"
                      : isDismissed
                        ? "dismissed"
                        : isUsed
                          ? "used"
                          : undefined
                  }
                >
                  <div className="ck-sugg-text">
                    <span className="ck-sugg-kind">{kind}</span>
                    <span className="ck-sugg-value f-num">
                      {suggestion.value}
                    </span>
                    <span className="ck-note f-num">{status}</span>
                  </div>
                  {suggestion.already_checked ? (
                    savedFact && (
                      <button
                        type="button"
                        className="f-btn f-btn-secondary ck-btn"
                        onClick={() => showEvidence(savedFact, "fact")}
                      >
                        View evidence
                      </button>
                    )
                  ) : isDismissed ? (
                    <button
                      type="button"
                      className="f-btn f-btn-secondary ck-btn"
                      onClick={() =>
                        setDismissed(
                          (was) => new Set([...was].filter((x) => x !== id)),
                        )
                      }
                    >
                      Restore
                    </button>
                  ) : isUsed ? null : (
                    <div className="ck-sugg-actions">
                      <button
                        type="button"
                        className="f-btn ck-btn"
                        aria-label={`Use suggestion: ${kind} ${suggestion.value}`}
                        onClick={() => useSuggestion(suggestion, id)}
                      >
                        Use suggestion
                      </button>
                      <button
                        type="button"
                        className="f-btn f-btn-secondary ck-btn"
                        aria-label={`Dismiss suggestion: ${kind} ${suggestion.value}`}
                        onClick={() =>
                          setDismissed((was) => new Set([...was, id]))
                        }
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {suggestions.data && shownSuggestions.length === 0 && (
          <div className="mb-dashed">
            No suggestions waiting for this version
          </div>
        )}
      </section>

      <section
        id="check-form"
        aria-labelledby="check-heading"
        className="ck-card ck-padded ck-form-card"
      >
        <h2 id="check-heading" className="f-visually-hidden">
          {draft.mode === "fact" ? "Check a fact" : "Check a connection"}
        </h2>
        <div role="group" aria-label="What to check" className="ck-modes">
          {(["fact", "connection"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className="ck-mode"
              aria-pressed={draft.mode === mode}
              disabled={anyBusy && draft.mode !== mode}
              onClick={() => switchMode(mode)}
            >
              {mode === "fact" ? "Check a fact" : "Check a connection"}
            </button>
          ))}
        </div>
        {draft.mode === "fact" ? (
          <form noValidate className="ck-form" onSubmit={save}>
            {discard}
            {failedBanner}
            {stale && (
              <div role="alert" className="f-alert ck-stale">
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    stroke="#c0392b"
                    strokeWidth="2"
                  />
                  <path
                    d="M12 7.5 V13 M12 16 V16.5"
                    stroke="#c0392b"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                </svg>
                <div>
                  This fact was corrected a moment ago. Reload and check.
                </div>
                <button
                  type="button"
                  className="f-btn f-btn-secondary"
                  onClick={() => {
                    setStale(false);
                    setDraft((was) => ({
                      ...was,
                      fact: blankFact(String(page)),
                    }));
                    refresh();
                    focusSoon("fact-btn");
                  }}
                >
                  Reload
                </button>
              </div>
            )}
            <div className="ck-grid">
              {field("", "f-version", "Source version", versionText, () => {}, {
                readOnly: true,
              })}
              <div className="ck-field">
                <span id="fact-label" className="ck-label">
                  Fact
                </span>
                <MenuButton
                  id="fact-btn"
                  labelledBy="fact-label fact-btn"
                  value={fact.field}
                  wide
                  disabled={busy || !!correcting}
                  className={`ck-select${err("kind") ? " ck-select-error" : ""}`}
                  options={FACT_FIELDS.map(([value, label]) => ({
                    value,
                    label,
                  }))}
                  onChange={(value) => setFact({ field: value }, "kind")}
                >
                  <span className={fact.field ? undefined : "ck-placeholder"}>
                    {fieldLabel(fact.field) || "Choose a fact"}
                  </span>
                </MenuButton>
                {err("kind") && <Warning>{err("kind")}</Warning>}
              </div>
              {correcting &&
                field(
                  "",
                  "f-current",
                  "Current value",
                  correcting.value ?? "",
                  () => {},
                  {
                    readOnly: true,
                    wide: true,
                  },
                )}
              {field("value", "f-value", "Value", fact.value, (v) =>
                setFact({ value: v }, "value"),
              )}
              {field(
                "page",
                "f-page",
                "Page",
                fact.page,
                (v) => setFact({ page: v }, "page"),
                {
                  numeric: true,
                },
              )}
              {needRole &&
                field("role", "f-role", "Printed role", fact.role, (v) =>
                  setFact({ role: v }, "role"),
                )}
              {needOrg &&
                field(
                  "org",
                  "f-org",
                  "Printed organization name",
                  fact.orgName,
                  (v) => setFact({ orgName: v }, "org"),
                )}
            </div>
            {field(
              "quote",
              "f-quote",
              "Quote",
              fact.quote,
              (v) => setFact({ quote: v }, "quote"),
              {
                multiline: true,
              },
            )}
            {field(
              "evidence",
              "f-evidence",
              "Supporting evidence",
              fact.evidence,
              (v) => setFact({ evidence: v }, "evidence"),
              {
                multiline: true,
              },
            )}
            {detailsShown ? (
              <div className="ck-grid">
                {!needRole &&
                  field(
                    "role",
                    "f-role",
                    "Printed role (optional)",
                    fact.role,
                    (v) => setFact({ role: v }, "role"),
                  )}
                {field(
                  "qualifier",
                  "f-qualifier",
                  "Qualifier (optional)",
                  fact.qualifier,
                  (v) => setFact({ qualifier: v }),
                )}
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  className="ck-link-btn"
                  aria-expanded="false"
                  disabled={busy}
                  onClick={() => {
                    setFact({ detailsOpen: true });
                    focusSoon(needRole ? "f-qualifier" : "f-role");
                  }}
                >
                  Add details
                </button>
              </div>
            )}
            {needOrg && agencyChecked && (
              <label className="ck-check">
                <input
                  id="f-agency"
                  type="checkbox"
                  checked={fact.agencyAddress}
                  disabled={busy}
                  onChange={(event) =>
                    setFact({ agencyAddress: event.target.checked })
                  }
                />
                <span>This is the checked agency’s address</span>
              </label>
            )}
            {confirmBox("I checked this against the page image", fact, (v) =>
              setFact({ confirmed: v }, "confirm"),
            )}
            {dupNotice}
            {submitRow}
          </form>
        ) : (
          <form noValidate className="ck-form" onSubmit={save}>
            {discard}
            {failedBanner}
            <div className="ck-grid">
              {field("", "c-version", "Source version", versionText, () => {}, {
                readOnly: true,
              })}
              <div className="ck-field">
                <span id="conn-label" className="ck-label">
                  Connection
                </span>
                <MenuButton
                  id="conn-btn"
                  labelledBy="conn-label conn-btn"
                  value={conn.type}
                  wide
                  disabled={busy}
                  className={`ck-select${err("type") ? " ck-select-error" : ""}`}
                  options={SEARCHABLE_TYPES.map((value) => ({
                    value,
                    label: connectionLabel(value),
                  }))}
                  onChange={(value) => {
                    setHeldLookup(null);
                    resetTarget(
                      {
                        type: value,
                        results: null,
                        role: ROLE_TYPES.includes(value) ? conn.role : "",
                      },
                      "type",
                    );
                  }}
                >
                  <span className={conn.type ? undefined : "ck-placeholder"}>
                    {conn.type
                      ? connectionLabel(conn.type)
                      : "Choose a connection"}
                  </span>
                </MenuButton>
                {err("type") && <Warning>{err("type")}</Warning>}
              </div>
              {ROLE_TYPES.includes(conn.type) &&
                field("connRole", "c-role", "Role", conn.role, (v) =>
                  resetTarget({ role: v }),
                )}
            </div>
            <div className="ck-field">
              <label htmlFor="c-query" className="ck-label">
                Find a record
              </label>
              <div className="ck-search">
                <input
                  id="c-query"
                  type="search"
                  autoComplete="off"
                  value={conn.query}
                  readOnly={busy}
                  data-error={err("target") ? true : undefined}
                  onChange={(event) => {
                    const query = event.target.value;
                    if (query.trim() === lookupQuery) setConn({ query });
                    else {
                      if (!query.trim() && conn.type !== "related_document")
                        setHeldLookup(null);
                      resetTarget({ query, results: null });
                    }
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      runSearch();
                    }
                  }}
                />
                <button
                  type="button"
                  className="f-btn f-btn-secondary ck-search-btn"
                  aria-disabled={busy || undefined}
                  onClick={runSearch}
                >
                  Search
                </button>
              </div>
              {err("target") && <Warning>{err("target")}</Warning>}
            </div>
            {!conn.target && lookupBusy && (
              <LoadingLine>Searching…</LoadingLine>
            )}
            {!conn.target && lookupTooShort && (
              <div className="mb-dashed ck-flat" role="status">
                {tooShortTitle(MONEY_LOOKUP_MIN_LENGTH)}
              </div>
            )}
            {!conn.target && lookupFailed && (
              <Refused onRetry={runSearch}>Couldn’t load records</Refused>
            )}
            {!conn.target && lookupStale && (lookupRows?.length ?? 0) > 0 && (
              <p className="ck-note" role="status">
                {retainedLookup?.query
                  ? `Previous results for “${retainedLookup.query}”`
                  : "Previous results for all records"}
              </p>
            )}
            {lookupRows && lookupRows.length > 0 && !conn.target && (
              <ul aria-label="Records found" className="ck-results">
                {lookupRows.map((result) => (
                  <li key={result.id}>
                    <div>
                      <span className="ck-sugg-value f-num">{result.name}</span>
                      {result.line && (
                        <span className="ck-note f-num">{result.line}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="f-btn f-btn-secondary ck-btn"
                      aria-label={`Preview record: ${result.name}${result.line ? `, ${result.line}` : ""}`}
                      aria-disabled={busy || lookupStale || undefined}
                      onClick={() =>
                        !busy && !lookupStale && void preview(result)
                      }
                    >
                      Preview record
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {currentRows?.length === 0 &&
              !conn.target &&
              !lookupBusy &&
              !lookupFailed && (
                <div className="mb-dashed ck-flat">No held records match</div>
              )}
            {conn.target && (
              <div id="rec-panel" tabIndex={-1} className="ck-record">
                <div className="ck-record-head">
                  <div>
                    <span className="ck-sugg-kind">Selected record</span>
                    <span className="ck-sugg-value f-num">
                      {conn.preview?.label ?? conn.target.name}
                    </span>
                    <span className="ck-note f-num">
                      {connectionLabel(conn.type)}
                      {conn.target.line ? ` · ${conn.target.line}` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="ck-link-btn"
                    disabled={busy}
                    onClick={() => {
                      resetTarget();
                      focusSoon("c-query");
                    }}
                  >
                    Choose another record
                  </button>
                </div>
                {previewing === "busy" && <LoadingLine>Loading…</LoadingLine>}
                {previewing === "failed" && (
                  <Refused
                    onRetry={() => conn.target && void preview(conn.target)}
                  >
                    Couldn’t load record
                  </Refused>
                )}
                {previewOk && conn.preview && (
                  <>
                    {conn.preview.fields.length > 0 && (
                      <dl className="ck-record-fields">
                        {conn.preview.fields.map((item) => (
                          <div key={item.label}>
                            <dt>{item.label}</dt>
                            <dd className="f-num">{item.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    <p className="ck-note">
                      A matching name alone does not establish identity
                    </p>
                    {hasMoneyContext(conn.preview) && (
                      <div className="ck-check-wrap">
                        <label className="ck-check">
                          <input
                            id="f-money"
                            type="checkbox"
                            checked={conn.moneyChecked}
                            disabled={busy}
                            onChange={(event) =>
                              setConn(
                                { moneyChecked: event.target.checked },
                                "money",
                              )
                            }
                          />
                          <span>I checked this office and district</span>
                        </label>
                        {err("money") && <Warning>{err("money")}</Warning>}
                      </div>
                    )}
                  </>
                )}
                {changed && (
                  <div className="ck-changed">
                    <Warning>
                      The selected record changed. Preview it again before
                      saving.
                    </Warning>
                    <button
                      type="button"
                      className="f-btn f-btn-secondary"
                      aria-disabled={busy || undefined}
                      onClick={() =>
                        !busy && conn.target && void preview(conn.target)
                      }
                    >
                      Preview again
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="ck-grid">
              {field(
                "page",
                "f-page",
                "Page",
                conn.page,
                (v) => setConn({ page: v }, "page"),
                {
                  numeric: true,
                },
              )}
            </div>
            {field(
              "quote",
              "f-quote",
              "Quote",
              conn.quote,
              (v) => setConn({ quote: v }, "quote"),
              {
                multiline: true,
              },
            )}
            {field(
              "evidence",
              "f-evidence",
              "Supporting evidence",
              conn.evidence,
              (v) => setConn({ evidence: v }, "evidence"),
              {
                multiline: true,
              },
            )}
            {confirmBox("I checked this against the page image", conn, (v) =>
              setConn({ confirmed: v }, "confirm"),
            )}
            {dupNotice}
            {submitRow}
          </form>
        )}
      </section>

      <section aria-labelledby="checks-heading" className="ck-card ck-padded">
        <h2 id="checks-heading" tabIndex={-1}>
          Checks on this version{" "}
          <span className="ck-count f-num">{rows.length}</span>
        </h2>
        <div aria-live="polite">
          {withdrawn && (
            <div className="ck-withdrawn">
              <span className="ck-saved">
                <Tick />
                Check withdrawn
              </span>
            </div>
          )}
        </div>
        {rows.length === 0 ? (
          <div className="mb-dashed">No checks on this version</div>
        ) : (
          <ul className="ck-checks">
            {rows.map((row) => {
              const open = withdrawal?.id === row.id ? withdrawal : null;
              return (
                <li key={row.id} id={`row-${row.id}`}>
                  <div className="ck-check-row">
                    <div className="ck-sugg-text">
                      <span className="ck-sugg-kind">{row.label}</span>
                      <span className="ck-sugg-value f-num">{row.value}</span>
                      <span className="ck-note f-num">{row.meta}</span>
                    </div>
                    {!open && (
                      <button
                        type="button"
                        id={`ev-${row.id}`}
                        className="f-btn f-btn-secondary ck-btn"
                        aria-label={`View evidence: ${row.label} ${row.value}`}
                        aria-disabled={anyBusy || undefined}
                        onClick={() =>
                          !anyBusy && showEvidence(row.item, row.kind)
                        }
                      >
                        View evidence
                      </button>
                    )}
                  </div>
                  {open && (
                    <div className="ck-withdraw">
                      {open.status === "failed" && (
                        <Refused>
                          Couldn’t withdraw this check. This is a problem on our
                          side; your reason is kept.
                        </Refused>
                      )}
                      <label className="ck-field">
                        <span className="ck-label">Reason</span>
                        <textarea
                          id={`wr-${row.id}`}
                          rows={2}
                          value={open.reason}
                          readOnly={open.status === "busy"}
                          data-error={open.error ? true : undefined}
                          onChange={(event) =>
                            setWithdrawal({
                              ...open,
                              reason: event.target.value,
                              error: "",
                            })
                          }
                        />
                        {open.error && <Warning>{open.error}</Warning>}
                      </label>
                      <div className="ck-withdraw-actions">
                        {open.status === "busy" ? (
                          <>
                            <button
                              type="button"
                              aria-disabled="true"
                              className="f-btn ck-save"
                            >
                              <span className="ck-spin" aria-hidden="true" />
                              Withdrawing…
                            </button>
                            <span role="status" className="f-visually-hidden">
                              Withdrawing
                            </span>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="f-btn ck-save"
                            onClick={() => void withdraw(row.id, row.kind)}
                          >
                            {open.status === "failed"
                              ? "Try again"
                              : "Withdraw check"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="f-btn f-btn-secondary"
                          aria-disabled={open.status === "busy" || undefined}
                          onClick={() => {
                            if (open.status === "busy") return;
                            setWithdrawal(null);
                            focusSoon(`ev-${row.id}`);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {history.length > 0 && (
          <>
            <h3 className="ck-history-title">History</h3>
            <ul className="ck-history">
              {history.map((item) => (
                <li key={item.key}>
                  <span className="ck-sugg-kind">{item.label}</span>
                  {item.value && (
                    <span className="ck-history-value f-num">{item.value}</span>
                  )}
                  <span className="ck-note f-num">{item.meta}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <StationEvidencePanel
        evidence={evidence}
        onClose={() => setEvidence(null)}
      />
    </div>
  );
}
