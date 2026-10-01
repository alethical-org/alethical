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
import { CandidateCoverage, CandidateRaceGroups } from './CandidateResultsContent';
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
  const busy = state.status === 'loading' || state.status === 'updating';
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
    if (
      state.status === 'success' &&
      !state.outcome &&
      displayed &&
      displayed.request.address.trim() === address.trim()
    )
      setChangingAddress(false);
  }, [state.status, state.outcome, displayed, address]);
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
        outcome={state.outcome}
        focus={changingAddress}
        compact={Boolean(displayed)}
        onCancel={changingAddress ? () => setChangingAddress(false) : undefined}
      />
    );
  const unavailable = electionLoad === 'error' || state.status === 'error';
  const errorNotice = unavailable ? (
    <CandidateNotice error>
      <Text style={candidateText.strong}>
        {displayed ? 'We couldn’t update the results' : 'Candidate results are unavailable'}
      </Text>
      {displayed ? (
        <>
          <Text style={candidateText.body}>Showing the previous results</Text>
          <Text style={candidateText.body}>{displayed.results.matchedAddress}</Text>
          <Text style={candidateText.body}>
            {displayed.election.label} · {candidateDate(displayed.election.date)}
          </Text>
        </>
      ) : null}
      <CandidateButton
        label="Try again"
        kind="outline"
        onPress={() =>
          electionLoad === 'error' ? setReload((value) => value + 1) : void flow.retry()
        }
        style={{ marginTop: 12 }}
      />
    </CandidateNotice>
  ) : null;
  const noElectionNotice = noElection ? (
    <CandidateNotice>
      <Text style={candidateText.strong}>Candidate records are not available on Alethical yet</Text>
      <CandidateLink label="Minnesota sample ballot information" url={sampleBallotUrl} />
    </CandidateNotice>
  ) : null;
  return (
    <View
      style={[
        styles.page,
        { paddingHorizontal: isMobile ? 20 : isDesktop ? 56 : 32, paddingTop: isMobile ? 32 : 48 },
      ]}
    >
      {displayed ? (
        <View style={[styles.resultsLayout, isDesktop && styles.desktopResults]}>
          <View style={[styles.sidebar, isDesktop && { width: 360 }]}>
            <Text
              accessibilityRole="header"
              aria-level={1}
              style={[
                candidateText.title,
                { fontSize: isMobile ? 28 : isDesktop ? 34 : 32, lineHeight: 40 },
              ]}
            >
              Find My Candidates
            </Text>
            {changingAddress ? (
              form
            ) : (
              <View style={{ gap: 2 }}>
                <Text style={candidateText.body}>{displayed.results.matchedAddress}</Text>
                <CandidateButton kind="text" label="Change address" onPress={beginAddressEdit} />
              </View>
            )}
            {elections.length && selected ? (
              <ElectionMenu elections={elections} selectedId={selected} onChange={selectElection} />
            ) : null}
            <CandidateCoverage gaps={displayed.results.coverage} />
          </View>
          <View style={styles.races}>
            {errorNotice}
            {noElectionNotice}
            {state.status === 'updating' ? (
              <CandidateNotice>
                <Text style={candidateText.strong}>Updating candidates…</Text>
                <Text style={candidateText.body}>Showing the previous results</Text>
                <Text style={candidateText.body}>
                  {displayed.election.label} · {candidateDate(displayed.election.date)}
                </Text>
              </CandidateNotice>
            ) : null}
            {state.outcome && !changingAddress && state.outcome.kind !== 'no-elections' ? (
              <CandidateNotice error>
                <Text style={candidateText.strong}>
                  {state.outcome.kind === 'ambiguous'
                    ? 'Choose your address'
                    : state.outcome.kind === 'outside-minnesota'
                      ? 'This search covers Minnesota addresses'
                      : state.outcome.kind === 'rate-limited'
                        ? 'Too many searches. Try again shortly'
                        : 'We couldn’t match that address. Check the street address, city, and ZIP code'}
                </Text>
                <Text style={candidateText.body}>Showing the previous results</Text>
                <Text style={candidateText.body}>
                  {displayed.election.label} · {candidateDate(displayed.election.date)}
                </Text>
                <CandidateButton kind="text" label="Change address" onPress={beginAddressEdit} />
              </CandidateNotice>
            ) : null}
            <Text style={styles.resultElection}>
              {displayed.election.label} · {candidateDate(displayed.election.date)}
            </Text>
            {changingAddress ? (
              <Text style={candidateText.body}>{displayed.results.matchedAddress}</Text>
            ) : null}
            <CandidateRaceGroups
              races={displayed.results.races}
              election={displayed.election}
              busy={busy}
              onOpenProfile={onOpenProfile}
            />
          </View>
        </View>
      ) : (
        <View
          style={[
            styles.entryLayout,
            !isMobile && { flexDirection: 'row', gap: isDesktop ? 80 : 40 },
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
                Find My Candidates
              </Text>
              {isMobile && imageSource ? (
                <Image
                  source={imageSource}
                  aria-hidden
                  accessible={false}
                  resizeMode="contain"
                  style={{ width: 56, height: 62 }}
                />
              ) : null}
            </View>
            <Text
              style={[
                candidateText.body,
                { marginTop: 14, fontSize: isMobile ? 17 : 20, lineHeight: isMobile ? 26 : 30 },
              ]}
            >
              {noElection
                ? 'Candidates for Minnesota state and local offices'
                : 'Enter your Minnesota street address to see who is running for office in your area'}
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
            {electionLoad === 'loading' && !busy ? (
              <Text aria-live="polite" style={[candidateText.body, { marginTop: 16 }]}>
                Finding candidates…
              </Text>
            ) : null}
            <View style={{ marginTop: 16, gap: 12 }}>
              {errorNotice}
              {noElectionNotice}
            </View>
            {!noElection && (
              <View style={styles.privacy}>
                <Text style={[candidateText.body, { fontSize: 14, lineHeight: 21 }]}>
                  {privacyDisclosure ??
                    'Address lookup uses U.S. Census Bureau and Minnesota mapping services'}
                </Text>
                {!privacyDisclosure ? (
                  <Text style={[candidateText.body, { fontSize: 12, lineHeight: 19 }]}>
                    This product uses the Census Bureau Data API but is not endorsed or certified by
                    the Census Bureau.
                  </Text>
                ) : null}
              </View>
            )}
          </View>
          {!isMobile && imageSource ? (
            <Image
              source={imageSource}
              aria-hidden
              accessible={false}
              resizeMode="contain"
              style={{ width: isDesktop ? 300 : 200, height: isDesktop ? 330 : 220, marginTop: 30 }}
            />
          ) : null}
        </View>
      )}
    </View>
  );
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
  const [open, setOpen] = useState(false);
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
      <Text style={candidateText.strong}>{selected?.label}</Text>
      <Text style={[candidateText.body, { fontSize: 14.5, lineHeight: 22 }]}>
        {selected ? candidateDate(selected.date) : ''}
      </Text>
    </View>
  );
  return (
    <View ref={wrap} style={{ gap: 8, position: 'relative', zIndex: 3 }}>
      <Text nativeID={`${id}-label`} style={candidateText.strong}>
        Election
      </Text>
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
          onMouseEnter={() => setHovered(true)}
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
              {selected?.label}
            </span>
            <span style={{ fontSize: 14.5, lineHeight: '22px', color: '#4f5651' }}>
              {selected ? candidateDate(selected.date) : ''}
            </span>
          </span>
          <span aria-hidden="true" style={{ fontSize: 20, color: '#11150f' }}>
            ⌄
          </span>
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
              onHoverIn={() => setActive(index)}
              style={[styles.electionOption, active === index && { backgroundColor: '#e9f7ef' }]}
            >
              <Text style={candidateText.strong}>
                {election.label} · {candidateDate(election.date)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { width: '100%', paddingBottom: 64 },
  entryLayout: { maxWidth: 1080, width: '100%', alignSelf: 'center', alignItems: 'flex-start' },
  entryWords: { flex: 1, minWidth: 0, maxWidth: 700, width: '100%' },
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
  desktopResults: { flexDirection: 'row', alignItems: 'flex-start', gap: 40 },
  sidebar: { gap: 22, width: '100%' },
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
    marginTop: 8,
    padding: 6,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.14)',
    borderRadius: 12,
  },
  electionOption: {
    minHeight: 52,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    justifyContent: 'center',
  },
});
