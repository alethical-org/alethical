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
import { CandidateAddressForm } from './CandidateAddressForm';
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

type SearchProps = CandidateSearchContentBaseProps & { flow?: CandidateFlow };

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
}: SearchProps & { flow: CandidateFlow }) {
  const { isMobile, isDesktop } = useResponsive();
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
  const previousDisplayed = useRef(displayed);
  const busy = state.status === 'loading' || state.status === 'updating';
  const retryBusy = retrying && busy;
  useEffect(() => {
    if (!recordsAvailable) return;
    const controller = new AbortController();
    setElectionLoad('loading');
    void services
      .getElections(controller.signal)
      .then((records) => {
        if (controller.signal.aborted) return;
        const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
        setElections(sorted);
        setSelected((current) =>
          current && sorted.some((election) => election.id === current)
            ? current
            : (sorted.find(
                (election) =>
                  election.date >=
                  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(
                    new Date(),
                  ),
              )?.id ?? ''),
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
  const editAddress = (value: string) => {
    setAddress(value);
    flow.setDraftAddress(value);
  };
  const submit = (value: string, choice?: CandidateAddressChoice) => {
    const election = elections.find((item) => item.id === selected);
    if (!election || busy) return;
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
  const noElection =
    !recordsAvailable ||
    (electionLoad === 'ready' && !selected) ||
    state.outcome?.kind === 'no-elections';
  const form =
    noElection || electionLoad === 'error' ? null : (
      <CandidateAddressForm
        services={services}
        address={address}
        onAddress={editAddress}
        onSubmit={submit}
        busy={busy || electionLoad === 'loading'}
        showBusyMessage={!retryBusy}
        outcome={state.outcome}
        focus={changingAddress}
        compact={Boolean(displayed)}
        privacyDisclosure={privacyDisclosure}
        onCancel={changingAddress ? () => setChangingAddress(false) : undefined}
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
          {retryBusy ? (
            <Text
              style={[candidateText.strong, { position: 'absolute', top: 0, left: 0, right: 0 }]}
            >
              {displayed ? 'Updating candidates…' : 'Finding candidates…'}
            </Text>
          ) : null}
        </View>
        {displayed ? (
          <>
            <Text style={candidateText.body}>
              Showing results for {candidateElectionLabel(displayed.election)} ·{' '}
              {candidateDate(displayed.election.date)}
            </Text>
          </>
        ) : null}
        <CandidateButton
          label="Try again"
          kind="outline"
          busy={retryBusy}
          onPress={() => {
            if (electionLoad === 'error') setReload((value) => value + 1);
            else {
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
              Find my candidates
            </Text>
            {changingAddress ? (
              <View style={{ gap: 16 }}>
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
                <Text style={candidateText.strong}>Updating candidates…</Text>
                <Text style={candidateText.body}>
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
                  {state.outcome.kind === 'ambiguous'
                    ? 'Choose your address'
                    : state.outcome.kind === 'outside-minnesota'
                      ? 'This search covers Minnesota addresses'
                      : state.outcome.kind === 'rate-limited'
                        ? 'Too many searches: try again shortly'
                        : 'We couldn’t match that address: check the street address, city, and ZIP code'}
                </Text>
                <Text style={candidateText.body}>
                  Showing results for {candidateElectionLabel(displayed.election)} ·{' '}
                  {candidateDate(displayed.election.date)}
                </Text>
                <CandidateButton kind="text" label="Change address" onPress={beginAddressEdit} />
              </CandidateNotice>
            ) : null}
            {isDesktop &&
            !(changingAddress && selected === displayed.election.id) &&
            (state.status === 'updating' ||
              state.status === 'error' ||
              selected !== displayed.election.id) ? (
              <Text style={styles.resultElection}>
                Showing results for {candidateElectionLabel(displayed.election)} ·{' '}
                {candidateDate(displayed.election.date)}
              </Text>
            ) : null}
            <View style={{ gap: 40 }}>
              <CandidateRaceGroups
                races={displayed.results.races}
                election={displayed.election}
                busy={busy}
                openGroups={state.openGroups}
                onGroupOpen={flow.setGroupOpen}
                onOpenProfile={onOpenProfile}
              />
              {!noElection ? <CandidateCoverage gaps={displayed.results.coverage} /> : null}
            </View>
          </View>
        </View>
      ) : (
        <View
          style={[
            styles.entryLayout,
            !isMobile && { flexDirection: 'row', gap: isDesktop ? 64 : 40 },
          ]}
        >
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
                Find my candidates
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
                : 'See who’s running where you live in Minnesota, with candidate profiles linked to official records'}
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
                width: isMobile ? 160 : isDesktop ? 300 : 200,
                height: isMobile ? 176 : isDesktop ? 330 : 220,
                marginTop: isMobile ? 40 : isDesktop ? 6 : 10,
                ...(isMobile ? { alignSelf: 'center' } : {}),
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
  entryLayout: { maxWidth: 1168, width: '100%', alignSelf: 'center', alignItems: 'flex-start' },
  entryWords: { flex: 1, minWidth: 0, width: '100%' },
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
  races: { flex: 1, minWidth: 0, width: '100%', gap: 18 },
  resultElection: { ...candidateText.strong, fontSize: 15, lineHeight: 23 },
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
