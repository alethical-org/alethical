import { defaultCandidateElection, PERSON_RECORD_COPY } from '../../lib/personRecords';
import { CANDIDATE_LOOKUP_COPY } from '../../lib/candidatePublicCopy';
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useResponsive } from '../../hooks/useResponsive';
import { joinAddressUnit } from '../../lib/candidateAddressUnit';
import type { AddressFieldHandle } from '../address/AddressSuggestionField';
import { CandidateAddressForm } from './CandidateAddressForm';
import { CandidateLocationConfirm } from './CandidateLocationConfirm';
import {
  CandidateButton,
  CandidateLink,
  CandidateNotice,
  candidateDate,
  candidateText,
  sampleBallotUrl,
} from './CandidateControls';
import {
  CandidateCoverage,
  CandidateRaceGroups,
  candidateElectionLabel,
} from './CandidateResultsContent';
import { createCandidateFlow, type CandidateFlow } from './candidateFlow';
import type {
  CandidateAddressChoice,
  CandidateElection,
  CandidateSearchContentBaseProps,
} from './types';

type SearchProps = CandidateSearchContentBaseProps & {
  flow?: CandidateFlow;
  /** False while another page covers this one; an unfinished location attempt ends. */
  active?: boolean;
};

const LOCATION_NOTICES = {
  blocked: 'Location access is blocked: enter your street address',
  imprecise: 'Your location isn’t precise enough: enter your street address',
  unavailable: 'Your location isn’t available right now: enter your street address',
  'outside-minnesota': 'This search covers Minnesota addresses',
} as const;
type LocationNotice = keyof typeof LOCATION_NOTICES;
type LocationState =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'notice'; notice: LocationNotice }
  // previous is the text typed before the tap; the suggestion stays in this card only.
  | { kind: 'confirm'; street: string; unit: string; previous: string; missing: boolean };
// Covers a permission prompt nobody answers and a reverse lookup that never replies.
const LOCATION_LIMIT_MS = 30_000;

export function CandidateSearchContent(props: SearchProps) {
  const [localFlow] = useState(() => createCandidateFlow(props.services));
  const flow = props.flow ?? localFlow;
  const state = useSyncExternalStore(flow.subscribe, flow.getState, flow.getState);
  const initialVersion = useRef(state.resetVersion);
  return (
    <CandidateSearchSession
      {...props}
      key={state.resetVersion}
      flow={flow}
      initialAddress={
        state.draftAddress ||
        (state.resetVersion === initialVersion.current ? props.initialAddress : undefined)
      }
    />
  );
}

function CandidateSearchSession({
  services,
  recordsAvailable = true,
  onOpenProfile,
  initialAddress,
  addressLost,
  privacyDisclosure,
  imageSource,
  flow,
  active = true,
}: SearchProps & { flow: CandidateFlow }) {
  const { isMobile, isDesktop } = useResponsive();
  const fieldRef = useRef<AddressFieldHandle>(null);
  const [location, setLocation] = useState<LocationState>({ kind: 'idle' });
  const locationAttempt = useRef(0);
  const locationCleanup = useRef<(() => void) | null>(null);
  // The confirmed address whose search is running from the confirmation card.
  const confirmPending = useRef<string | null>(null);
  const queuedConfirm = useRef<{ street: string; unit: string } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const focusFieldSoon = useRef(false);
  const state = useSyncExternalStore(flow.subscribe, flow.getState, flow.getState);
  const [address, setAddress] = useState(
    () => state.draftAddress || state.requested?.address || initialAddress || '',
  );
  const [elections, setElections] = useState<CandidateElection[]>([]);
  const [selected, setSelected] = useState(state.requested?.electionId ?? '');
  const [electionLoad, setElectionLoad] = useState<'loading' | 'ready' | 'error'>(
    recordsAvailable ? 'loading' : 'ready',
  );
  const [reload, setReload] = useState(0);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (state.status !== 'updating' && state.status !== 'loading') setRetrying(false);
  }, [state.status]);
  const [changingAddress, setChangingAddress] = useState(() =>
    Boolean(
      state.displayed &&
      state.draftAddress &&
      state.draftAddress.trim() !== state.displayed.request.address.trim(),
    ),
  );
  const autoStarted = useRef(false);
  const initialSearchAddress = useRef(initialAddress).current;
  const displayed = state.displayed;
  const resultsPhase = Boolean(displayed?.results.resultsAvailable);
  const previousDisplayed = useRef(displayed);
  const changeAddressRef = useRef<View>(null);
  const restoreEditFocus = useRef(false);
  const busy = state.status === 'loading' || state.status === 'updating';
  const retryBusy = retrying && busy;
  const addressRetry = retryBusy && (!displayed || changingAddress);
  useEffect(() => {
    if (!recordsAvailable) return;
    const controller = new AbortController();
    setElectionLoad('loading');
    void services
      .getElections(controller.signal)
      .then((records) => {
        if (controller.signal.aborted) return;
        const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date));
        setElections(sorted);
        setSelected((current) =>
          current && sorted.some((election) => election.id === current)
            ? current
            : (defaultCandidateElection(sorted)?.id ?? ''),
        );
        setElectionLoad('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setElectionLoad('error');
      });
    return () => controller.abort();
  }, [services, reload, recordsAvailable]);
  useEffect(() => {
    if (!initialSearchAddress?.trim() || autoStarted.current || state.requested || !selected)
      return;
    const election = elections.find((item) => item.id === selected);
    if (!election) return;
    autoStarted.current = true;
    void flow.search({ address: initialSearchAddress, electionId: selected }, election);
  }, [initialSearchAddress, selected, elections, flow, state.requested]);
  useEffect(() => {
    // A new successful result ends editing, including a submitted cached result.
    // Typing the previous request is not a submission and must keep the form open.
    if (displayed && displayed !== previousDisplayed.current) setChangingAddress(false);
    previousDisplayed.current = displayed;
  }, [displayed]);
  const endLocationAttempt = () => {
    locationAttempt.current += 1;
    locationCleanup.current?.();
    locationCleanup.current = null;
  };
  const editAddress = (value: string) => {
    // Typing wins over an unfinished location attempt, whichever finishes first.
    endLocationAttempt();
    setLocation((current) =>
      current.kind === 'locating' || current.kind === 'notice' ? { kind: 'idle' } : current,
    );
    setAddress(value);
    flow.setDraftAddress(value, !value.trim());
  };
  const cancelAddressEdit = () => {
    if (!displayed) return;
    setAddress(displayed.results.matchedAddress);
    setSelected(displayed.election.id);
    flow.setDraftAddress(displayed.results.matchedAddress);
    restoreEditFocus.current = true;
    setChangingAddress(false);
  };
  useEffect(() => {
    if (!changingAddress && restoreEditFocus.current) {
      restoreEditFocus.current = false;
      (changeAddressRef.current as unknown as HTMLElement | null)?.focus?.();
    }
  }, [changingAddress]);
  const submit = (value: string, choice?: CandidateAddressChoice) => {
    const election = elections.find((item) => item.id === selected);
    if (!election || busy) return;
    // A manual search wins over an unfinished location attempt.
    endLocationAttempt();
    setLocation({ kind: 'idle' });
    void flow.search(
      { address: value, electionId: election.id, ...(choice ? { confirmedChoice: choice } : {}) },
      election,
    );
  };
  const selectElection = (election: CandidateElection) => {
    setSelected(election.id);
    const currentAddress = changingAddress ? address : (displayed?.request.address ?? address);
    if (currentAddress.trim())
      void flow.search(
        {
          address: currentAddress,
          electionId: election.id,
          ...(!changingAddress && displayed?.request.confirmedChoice
            ? { confirmedChoice: displayed.request.confirmedChoice }
            : {}),
        },
        election,
      );
  };
  const beginAddressEdit = () => {
    if (!displayed) return;
    const draft =
      state.draftAddress && state.draftAddress.trim() !== displayed.request.address.trim()
        ? state.draftAddress
        : displayed.results.matchedAddress;
    setAddress(draft);
    flow.setDraftAddress(draft);
    setChangingAddress(true);
  };
  const showNotice = (notice: LocationNotice) => {
    endLocationAttempt();
    setLocation({ kind: 'notice', notice });
    fieldRef.current?.focus();
  };
  const useLocation = () => {
    if (location.kind === 'locating') return;
    endLocationAttempt();
    // The newest request wins: an unfinished search stops, and an earlier outcome
    // for the typed text clears so its error does not sit beside the new attempt.
    flow.setDraftAddress(address);
    const geolocation =
      Platform.OS === 'web' && typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    const locate = services.locate;
    if (!geolocation || !locate) {
      showNotice('unavailable');
      return;
    }
    const attempt = locationAttempt.current;
    const controller = new AbortController();
    const limit = setTimeout(() => {
      if (attempt === locationAttempt.current) showNotice('unavailable');
    }, LOCATION_LIMIT_MS);
    locationCleanup.current = () => {
      clearTimeout(limit);
      controller.abort();
    };
    setLocation({ kind: 'locating' });
    // Permission is requested only here, after the reader's tap.
    geolocation.getCurrentPosition(
      (position) => {
        if (attempt !== locationAttempt.current) return;
        const { latitude, longitude, accuracy } = position.coords;
        locate({ latitude, longitude, accuracy }, controller.signal).then(
          (suggestion) => {
            if (attempt !== locationAttempt.current) return;
            if (suggestion.kind !== 'address') {
              showNotice(suggestion.kind);
              return;
            }
            endLocationAttempt();
            setLocation({
              kind: 'confirm',
              street: suggestion.address,
              unit: '',
              previous: address,
              missing: false,
            });
          },
          () => {
            if (attempt === locationAttempt.current) showNotice('unavailable');
          },
        );
      },
      (error) => {
        if (attempt !== locationAttempt.current) return;
        showNotice(error.code === error.PERMISSION_DENIED ? 'blocked' : 'unavailable');
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };
  const cancelConfirmSearch = (previous: string) => {
    if (confirmPending.current === null) return;
    confirmPending.current = null;
    setConfirmBusy(false);
    // Existing invalidation: the late reply can no longer replace anything.
    flow.setDraftAddress(previous);
  };
  const editConfirm = (patch: { street?: string; unit?: string }) => {
    if (location.kind !== 'confirm') return;
    // Editing either field ends a running search; its reply cannot replace the edit.
    cancelConfirmSearch(location.previous);
    queuedConfirm.current = null;
    setLocation((current) =>
      current.kind === 'confirm' ? { ...current, ...patch, missing: false } : current,
    );
  };
  const confirmHome = (street: string, unit: string) => {
    if (location.kind !== 'confirm' || confirmPending.current !== null) return;
    if (!street.trim()) {
      setLocation({ ...location, street, unit, missing: true });
      return;
    }
    const election = elections.find((item) => item.id === selected);
    if (!election) {
      // Elections are still loading: confirm as soon as they arrive.
      if (electionLoad === 'loading') {
        queuedConfirm.current = { street, unit };
        setConfirmBusy(true);
      }
      return;
    }
    queuedConfirm.current = null;
    const confirmed = joinAddressUnit(street, unit);
    confirmPending.current = confirmed;
    setConfirmBusy(true);
    void flow.search({ address: confirmed, electionId: election.id }, election);
    const started = flow.getState().status;
    if (started !== 'loading' && started !== 'updating' && !flow.getState().displayed) {
      // The flow refused to start, for example during a privacy reset.
      confirmPending.current = null;
      setConfirmBusy(false);
    }
  };
  const enterDifferentAddress = () => {
    if (location.kind !== 'confirm') return;
    const { previous } = location;
    queuedConfirm.current = null;
    setConfirmBusy(false);
    if (confirmPending.current !== null) cancelConfirmSearch(previous);
    else flow.setDraftAddress(previous);
    setAddress(previous);
    focusFieldSoon.current = true;
    setLocation({ kind: 'idle' });
  };
  useEffect(() => {
    // A finished confirmed search leaves the card: results replace the page, and
    // every other outcome returns to the form holding the address that was searched.
    const confirmed = confirmPending.current;
    if (confirmed === null || state.status === 'loading' || state.status === 'updating') return;
    confirmPending.current = null;
    setConfirmBusy(false);
    setLocation({ kind: 'idle' });
    if (!state.displayed) {
      setAddress(confirmed);
      focusFieldSoon.current = true;
    }
  }, [state.status, state.displayed]);
  useEffect(() => {
    const queued = queuedConfirm.current;
    if (!queued || location.kind !== 'confirm') return;
    if (electionLoad === 'error') {
      queuedConfirm.current = null;
      setConfirmBusy(false);
    } else if (electionLoad === 'ready' && selected) {
      setConfirmBusy(false);
      confirmHome(queued.street, queued.unit);
    }
    // confirmHome reads the current render's elections and selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [electionLoad, selected, location.kind]);
  useEffect(() => {
    if (location.kind === 'idle' && focusFieldSoon.current) {
      focusFieldSoon.current = false;
      fieldRef.current?.focus();
    }
  }, [location]);
  useEffect(() => {
    if (active) return;
    // Leaving the page ends the attempt and discards an unconfirmed suggestion.
    endLocationAttempt();
    if (location.kind === 'confirm') {
      cancelConfirmSearch(location.previous);
      setAddress(location.previous);
      setLocation({ kind: 'idle' });
    } else if (location.kind === 'locating') setLocation({ kind: 'idle' });
    // Only leaving the page acts here; later edits use their own handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useEffect(
    () => () => {
      locationAttempt.current += 1;
      locationCleanup.current?.();
    },
    [],
  );
  const noElection =
    !recordsAvailable ||
    (electionLoad === 'ready' && !selected) ||
    state.outcome?.kind === 'no-elections';
  const form =
    noElection || electionLoad === 'error' ? null : location.kind === 'confirm' && !displayed ? (
      <CandidateLocationConfirm
        street={location.street}
        unit={location.unit}
        missing={location.missing}
        busy={confirmBusy && (busy || queuedConfirm.current !== null)}
        onStreet={(street) => editConfirm({ street })}
        onUnit={(unit) => editConfirm({ unit })}
        onConfirm={confirmHome}
        onDifferent={enterDifferentAddress}
      />
    ) : (
      <CandidateAddressForm
        services={services}
        fieldRef={fieldRef}
        onUseLocation={displayed || !services.locate ? undefined : useLocation}
        onFindPress={() => {
          // Any Find press, even with an empty box, wins over a location attempt.
          endLocationAttempt();
          setLocation((current) => (current.kind === 'locating' ? { kind: 'idle' } : current));
        }}
        locating={location.kind === 'locating'}
        notice={location.kind === 'notice' ? LOCATION_NOTICES[location.notice] : null}
        address={address}
        onAddress={editAddress}
        onSubmit={submit}
        busy={busy || electionLoad === 'loading'}
        showBusyMessage={!retryBusy || addressRetry}
        outcome={state.outcome}
        focus={changingAddress}
        compact={Boolean(displayed)}
        privacyDisclosure={privacyDisclosure}
        onCancel={changingAddress ? cancelAddressEdit : undefined}
      />
    );
  const unavailable = electionLoad === 'error' || state.status === 'error';
  const errorNotice =
    unavailable || retryBusy ? (
      <CandidateNotice error={!retryBusy}>
        <View style={{ position: 'relative' }}>
          <Text
            aria-hidden={retryBusy || undefined}
            style={[candidateText.strong, retryBusy && { opacity: 0 }]}
          >
            {displayed ? 'We couldn’t update the results' : 'Candidate results are unavailable'}
          </Text>
          {retryBusy && !addressRetry ? (
            <Text
              style={[candidateText.strong, { position: 'absolute', top: 0, left: 0, right: 0 }]}
            >
              {displayed
                ? resultsPhase
                  ? 'Updating election results…'
                  : 'Updating candidates…'
                : 'Finding candidates…'}
            </Text>
          ) : null}
        </View>
        {displayed ? (
          <Text style={[candidateText.body, isDesktop && styles.spokenCaption]}>
            Showing results for {candidateElectionLabel(displayed.election)} ·{' '}
            {candidateDate(displayed.election.date)}
          </Text>
        ) : null}
        <CandidateButton
          label="Try again"
          kind="outline"
          busy={retryBusy}
          onPress={() => {
            if (electionLoad === 'error') setReload((value) => value + 1);
            else {
              endLocationAttempt();
              setLocation({ kind: 'idle' });
              setRetrying(true);
              void flow.retry();
            }
          }}
          style={{ marginTop: 12 }}
        />
      </CandidateNotice>
    ) : null;
  const noElectionNotice = noElection ? (
    <CandidateNotice>
      <Text style={candidateText.strong}>Records for upcoming elections are not available yet</Text>
      <CandidateLink label="Minnesota sample ballot information" url={sampleBallotUrl} />
    </CandidateNotice>
  ) : null;
  return (
    <View
      style={[
        styles.page,
        {
          paddingHorizontal: isMobile ? 20 : isDesktop ? 56 : 32,
          paddingTop: isMobile ? 32 : isDesktop ? 64 : 48,
        },
      ]}
    >
      {displayed ? (
        <View
          style={[
            styles.resultsLayout,
            { gap: isMobile ? 26 : 30 },
            isDesktop && styles.desktopResults,
          ]}
        >
          <View style={[styles.sidebar, isDesktop && { width: 360 }]}>
            <Text
              accessibilityRole="header"
              aria-level={1}
              style={[
                candidateText.title,
                { fontSize: isMobile ? 28 : isDesktop ? 34 : 32, lineHeight: 40 },
              ]}
            >
              {resultsPhase ? 'Election results' : CANDIDATE_LOOKUP_COPY.heading}
            </Text>
            {changingAddress ? (
              <View style={styles.addressEditor}>
                <Text style={[candidateText.body, { fontSize: 15.5, lineHeight: 23 }]}>
                  Showing results for{' '}
                  <Text style={candidateText.strong}>{displayed.results.matchedAddress}</Text>
                </Text>
                {form}
              </View>
            ) : (
              <View style={{ gap: 2 }}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                  <AddressPin />
                  <Text style={[candidateText.strong, { fontSize: 16.5, lineHeight: 23, flex: 1 }]}>
                    {displayed.results.matchedAddress}
                  </Text>
                </View>
                <CandidateButton
                  kind="text"
                  label="Change address"
                  buttonRef={changeAddressRef}
                  onPress={beginAddressEdit}
                  style={{ marginLeft: 26 }}
                />
              </View>
            )}
            {!noElection && elections.length && selected ? (
              <ElectionMenu elections={elections} selectedId={selected} onChange={selectElection} />
            ) : null}
            {errorNotice}
            {noElectionNotice}
            {state.status === 'updating' && !changingAddress && !retryBusy ? (
              <CandidateNotice>
                <Text style={candidateText.strong}>
                  {resultsPhase ? 'Updating election results…' : 'Updating candidates…'}
                </Text>
                <Text style={[candidateText.body, isDesktop && styles.spokenCaption]}>
                  Showing results for {candidateElectionLabel(displayed.election)} ·{' '}
                  {candidateDate(displayed.election.date)}
                </Text>
              </CandidateNotice>
            ) : null}
          </View>
          <View style={styles.races}>
            {state.outcome && !changingAddress && state.outcome.kind !== 'no-elections' ? (
              <CandidateNotice error>
                <Text style={candidateText.strong}>
                  {state.outcome.kind === 'historical-match-unavailable'
                    ? PERSON_RECORD_COPY.historicalMatchUnavailable
                    : state.outcome.kind === 'ambiguous'
                      ? 'Choose your address'
                      : state.outcome.kind === 'outside-minnesota'
                        ? 'This search covers Minnesota addresses'
                        : state.outcome.kind === 'rate-limited'
                          ? 'Too many searches: try again shortly'
                          : 'We couldn’t match that address to election records'}
                </Text>
                <Text style={[candidateText.body, isDesktop && styles.spokenCaption]}>
                  Showing results for {candidateElectionLabel(displayed.election)} ·{' '}
                  {candidateDate(displayed.election.date)}
                </Text>
                {state.outcome.kind === 'historical-match-unavailable' ? (
                  <CandidateLink
                    label="Official election results"
                    url={state.outcome.officialResultsUrl}
                  />
                ) : (
                  <CandidateButton kind="text" label="Change address" onPress={beginAddressEdit} />
                )}
              </CandidateNotice>
            ) : null}
            {isDesktop &&
            (!(changingAddress && selected === displayed.election.id) ||
              state.status === 'error' ||
              Boolean(state.outcome)) &&
            (state.status === 'updating' ||
              state.status === 'error' ||
              Boolean(state.outcome) ||
              selected !== displayed.election.id) ? (
              <Text style={styles.resultElection}>
                Showing results for {candidateElectionLabel(displayed.election)} ·{' '}
                {candidateDate(displayed.election.date)}
              </Text>
            ) : null}
            <View style={{ gap: 40 }}>
              <CandidateRaceGroups
                races={displayed.results.races}
                resultsPhase={resultsPhase}
                election={displayed.election}
                busy={busy}
                openGroups={state.openGroups}
                onGroupOpen={flow.setGroupOpen}
                onOpenProfile={onOpenProfile}
              />
              {!noElection ? (
                <CandidateCoverage
                  gaps={displayed.results.coverage}
                  resultsPhase={resultsPhase}
                  officialResultsUrl={displayed.election.officialResultsUrl}
                />
              ) : null}
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.entryLayout}>
          <View style={styles.entryWords}>
            <View style={styles.titleRow}>
              <Text
                accessibilityRole="header"
                aria-level={1}
                style={[
                  candidateText.title,
                  {
                    fontSize: isMobile ? 32 : isDesktop ? 48 : 42,
                    lineHeight: isMobile ? 36 : 52,
                    flexShrink: 1,
                  },
                ]}
              >
                {CANDIDATE_LOOKUP_COPY.heading}
              </Text>
            </View>
            <Text
              style={[
                candidateText.body,
                {
                  marginTop: 14,
                  fontSize: isMobile ? 16.5 : isDesktop ? 19 : 18,
                  lineHeight: isMobile ? 25 : isDesktop ? 28.5 : 27,
                },
              ]}
            >
              {noElection
                ? 'Candidates for Minnesota state and local offices'
                : CANDIDATE_LOOKUP_COPY.intro}
            </Text>
            {addressLost ? (
              <View style={{ marginTop: 22 }}>
                <CandidateNotice>
                  <Text style={candidateText.strong}>
                    Enter your address again to find candidates
                  </Text>
                </CandidateNotice>
              </View>
            ) : null}
            {form}
            {errorNotice || noElectionNotice ? (
              <View style={{ marginTop: 16, gap: 12 }}>
                {errorNotice}
                {noElectionNotice}
              </View>
            ) : null}
          </View>
          {imageSource ? (
            <Image
              source={imageSource}
              aria-hidden
              accessible={false}
              resizeMode="contain"
              style={{
                width: isMobile ? 160 : 200,
                height: isMobile ? 176 : 220,
                marginTop: 40,
                alignSelf: 'center',
              }}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

function AddressPin() {
  return Platform.OS === 'web' ? (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, marginTop: 2 }}
    >
      <path
        d="M12 21 C12 21 5 14.5 5 9.5 A7 7 0 0 1 19 9.5 C19 14.5 12 21 12 21Z"
        stroke="#4f5651"
        strokeWidth="2"
      />
      <circle cx="12" cy="9.5" r="2.5" stroke="#4f5651" strokeWidth="2" />
    </svg>
  ) : null;
}

function ElectionMenu({
  elections,
  selectedId,
  onChange,
}: {
  elections: CandidateElection[];
  selectedId: string;
  onChange(election: CandidateElection): void;
}) {
  const { isMobile } = useResponsive();
  const [open, setOpen] = useState(false);
  const [optionHover, setOptionHover] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const id = useId().replace(/:/g, '');
  const wrap = useRef<View>(null);
  const button = useRef<HTMLButtonElement>(null);
  const selected = elections.find((item) => item.id === selectedId);
  useEffect(() => {
    if (!open || Platform.OS !== 'web') return;
    const close = (event: Event) => {
      if (!(wrap.current as unknown as HTMLElement)?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [open]);
  const openMenu = () => {
    setActive(
      Math.max(
        0,
        elections.findIndex((item) => item.id === selectedId),
      ),
    );
    setOptionHover(null);
    setOpen(true);
  };
  const choose = (index: number) => {
    onChange(elections[index]);
    setOpen(false);
    button.current?.focus();
  };
  const key = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Tab' || event.key === 'Escape') {
      setOpen(false);
      if (event.key === 'Escape') event.preventDefault();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (!open) {
      openMenu();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp')
      setActive(
        (index) =>
          (index + (event.key === 'ArrowDown' ? 1 : -1) + elections.length) % elections.length,
      );
    else if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(elections.length - 1);
    else choose(active);
  };
  const words = (
    <View style={{ gap: 1, flex: 1, minWidth: 0 }}>
      <Text style={candidateText.strong}>{selected ? candidateElectionLabel(selected) : ''}</Text>
      <Text style={[candidateText.body, { fontSize: 14.5, lineHeight: 22 }]}>
        {selected ? candidateDate(selected.date) : ''}
      </Text>
    </View>
  );
  return (
    <View ref={wrap} style={{ gap: 6, position: 'relative', zIndex: 3 }}>
      <Text
        nativeID={`${id}-label`}
        style={[candidateText.strong, { fontSize: 14.5, color: '#4f5651' }]}
      >
        Election
      </Text>
      <View style={{ position: 'relative' }}>
        {Platform.OS === 'web' ? (
          <button
            ref={button}
            type="button"
            role="combobox"
            aria-labelledby={`${id}-label ${id}-value`}
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={`${id}-options`}
            aria-activedescendant={open ? `${id}-option-${active}` : undefined}
            onClick={() => (open ? setOpen(false) : openMenu())}
            onKeyDown={key}
            onBlur={() => setOpen(false)}
            onMouseEnter={() => !isMobile && setHovered(true)}
            onMouseLeave={() => {
              setHovered(false);
              setPressed(false);
            }}
            onPointerDown={() => setPressed(true)}
            onPointerUp={() => setPressed(false)}
            style={{
              minHeight: 62,
              width: '100%',
              border: `1px solid ${hovered ? '#2ed47e' : 'rgba(17,21,15,0.2)'}`,
              borderRadius: 12,
              padding: '8px 14px 8px 16px',
              background: pressed ? '#f7f8fa' : '#fff',
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              textAlign: 'left',
              cursor: 'pointer',
              fontFamily: candidateText.body.fontFamily,
            }}
          >
            <span
              id={`${id}-value`}
              style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}
            >
              <span style={{ fontSize: 16, fontWeight: 700, color: '#11150f' }}>
                {selected ? candidateElectionLabel(selected) : ''}
              </span>
              <span
                style={{ fontSize: 14.5, fontWeight: 600, lineHeight: '22px', color: '#4f5651' }}
              >
                {selected ? candidateDate(selected.date) : ''}
              </span>
            </span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              style={{ flexShrink: 0 }}
            >
              <path
                d="M6 9 L12 15 L18 9"
                stroke="#11150f"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : (
          <Pressable
            accessibilityRole="combobox"
            accessibilityLabel="Election"
            aria-expanded={open}
            onPress={() => (open ? setOpen(false) : openMenu())}
            style={styles.electionControl}
          >
            {words}
            <Text aria-hidden>⌄</Text>
          </Pressable>
        )}
        {open ? (
          <View
            nativeID={`${id}-options`}
            {...({ role: 'listbox' } as object)}
            accessibilityLabel="Election"
            style={styles.electionOptions}
          >
            {elections.map((election, index) => (
              <Pressable
                key={election.id}
                nativeID={`${id}-option-${index}`}
                role="option"
                aria-selected={selectedId === election.id}
                tabIndex={-1}
                {...(Platform.OS === 'web'
                  ? { onMouseDown: (event: React.MouseEvent) => event.preventDefault() }
                  : {})}
                onPress={() => choose(index)}
                onHoverIn={() => !isMobile && setOptionHover(index)}
                onHoverOut={() => setOptionHover(null)}
                style={[
                  styles.electionOption,
                  active === index && { backgroundColor: '#e9f7ef' },
                  optionHover === index && { backgroundColor: '#f5f6f7' },
                ]}
              >
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={candidateText.strong}>{candidateElectionLabel(election)}</Text>
                  <Text style={[candidateText.body, { fontSize: 14.5, fontWeight: '600' }]}>
                    {candidateDate(election.date)}
                  </Text>
                </View>
                {selectedId === election.id ? (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                    style={{ flexShrink: 0 }}
                  >
                    <path
                      d="M5 12.5 L10 17.5 L19 7.5"
                      stroke="#0f7a45"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      {selected?.type === 'primary' ? (
        <Text
          style={[
            candidateText.body,
            { paddingLeft: 12, marginTop: 2, fontSize: 14.5, lineHeight: 21 },
          ]}
        >
          Not every office has a primary
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { width: '100%', paddingBottom: 64 },
  // 1 centred column on every band; the outline sits below the source line.
  entryLayout: { maxWidth: 840, width: '100%', alignSelf: 'center' },
  // RNW gives every View a stacking context: lift the form above the later outline
  // so an open suggestion list covers it and takes every click.
  entryWords: { flex: 1, minWidth: 0, width: '100%', zIndex: 1 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  privacy: {
    marginTop: 30,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,21,15,0.08)',
    gap: 8,
  },
  resultsLayout: { maxWidth: 1168, width: '100%', alignSelf: 'center', gap: 32 },
  desktopResults: { flexDirection: 'row', alignItems: 'flex-start', gap: 48 },
  // Keep the election popup above the following race column on narrow screens.
  sidebar: { gap: 22, width: '100%', zIndex: 1 },
  // The suggestion list cannot escape an RNW parent's stacking context. Keep
  // the editor above its sibling Election menu, but inside the page below navigation.
  addressEditor: { gap: 16, zIndex: 4 },
  races: { flex: 1, minWidth: 0, width: '100%', gap: 18 },
  resultElection: { ...candidateText.strong, fontSize: 15, lineHeight: 23 },
  // The desktop status is in a separate column from the visible caption.
  // Keep its election context in the spoken announcement without a second label.
  spokenCaption: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
  electionControl: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.18)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fff',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
  },
  electionOptions: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    zIndex: 40,
    marginTop: 6,
    boxShadow: '0 16px 40px rgba(17,21,15,0.16)',
    padding: 6,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.14)',
    borderRadius: 12,
  },
  electionOption: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 9,
    justifyContent: 'center',
  },
});
