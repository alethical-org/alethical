import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import {
  getPersonResearch,
  type PersonResearchPage,
  type PersonResearchRecord,
} from '../../data/personRecords';
import {
  PERSON_RECORD_COPY,
  researchContextLabel,
  researchTypeLabel,
} from '../../lib/personRecords';
import {
  CandidateButton,
  CandidateLink,
  CandidateNotice,
  candidateDate,
  candidateText,
} from './CandidateControls';

export function ResearchItem({ item, inset }: { item: PersonResearchRecord; inset: number }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const status = {
    available: '',
    corrected: 'Source corrected',
    withdrawn: 'Withdrawn by the publisher',
    unavailable: 'No longer available at the source',
  }[item.status];
  return (
    <View style={{ paddingHorizontal: inset, paddingTop: 16, paddingBottom: 10, gap: 4 }}>
      <View
        style={[
          {
            alignSelf: 'flex-start',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 7,
            paddingVertical: 4,
            paddingLeft: 8,
            paddingRight: 10,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: item.type === 'official-record' ? '#bfeacf' : 'rgba(17,21,15,0.12)',
            backgroundColor: item.type === 'official-record' ? '#e4f8ee' : '#f1f1f4',
          },
        ]}
      >
        {item.type === 'official-record' ? (
          <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" aria-hidden>
            <Path
              d="M3.5 9.5L12 4.5L20.5 9.5M5.5 10V18M10 10V18M14 10V18M18.5 10V18M3.5 20H20.5"
              stroke="#149d5b"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        ) : null}
        <Text
          style={[
            candidateText.strong,
            {
              fontSize: 13.5,
              lineHeight: 20,
              color: item.type === 'official-record' ? '#0b4f2c' : '#11150f',
            },
          ]}
        >
          {researchTypeLabel(item.type)}
        </Text>
      </View>
      <Text
        accessibilityRole="header"
        aria-level={3}
        style={[candidateText.strong, { fontSize: 17, lineHeight: 23, marginTop: 6 }]}
      >
        {item.title}
      </Text>
      <Text style={[candidateText.body, { fontSize: 15.5 }]}>{item.publisher}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16 }}>
        {item.eventDate ? (
          <Text style={[candidateText.body, { fontSize: 15 }]}>
            Event date {candidateDate(item.eventDate)}
          </Text>
        ) : null}
        {item.publishedDate ? (
          <Text style={[candidateText.body, { fontSize: 15 }]}>
            Published {candidateDate(item.publishedDate)}
          </Text>
        ) : null}
      </View>
      <Text style={[candidateText.body, { fontSize: 15 }]}>{researchContextLabel(item)}</Text>
      {status ? (
        <View
          style={{
            marginTop: 6,
            padding: 12,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: 'rgba(17,21,15,0.08)',
            backgroundColor: '#f7f8fa',
            gap: 2,
          }}
        >
          <Text style={candidateText.strong}>
            {status}
            {item.correctionDate ? ` · ${candidateDate(item.correctionDate)}` : ''}
          </Text>
          {item.correctionNote ? (
            <Text style={candidateText.body}>{item.correctionNote}</Text>
          ) : null}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 22, alignItems: 'center' }}>
        {item.status !== 'unavailable' ? (
          <CandidateLink
            label="View source"
            url={item.source.url}
            accessibilityLabel={`View source, ${item.title} (opens in a new tab)`}
          />
        ) : null}
        <Pressable
          accessibilityRole="button"
          aria-expanded={open}
          aria-controls={`research-source-${item.id}`}
          onPress={() => setOpen(!open)}
          onHoverIn={() => setHover(true)}
          onHoverOut={() => setHover(false)}
          style={{ minHeight: 44, flexDirection: 'row', gap: 6, alignItems: 'center' }}
        >
          <Text
            style={[
              candidateText.strong,
              { fontSize: 15.5 },
              hover && { textDecorationLine: 'underline' },
            ]}
          >
            Source details
          </Text>
          <Svg
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
            style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
          >
            <Path
              d="M6 9L12 15L18 9"
              stroke="#11150f"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Pressable>
      </View>
      {open ? (
        <View
          nativeID={`research-source-${item.id}`}
          style={{
            paddingVertical: 10,
            paddingHorizontal: 14,
            backgroundColor: '#f7f8fa',
            borderRadius: 10,
          }}
        >
          <Text style={[candidateText.body, { fontSize: 14.5 }]}>
            Checked {candidateDate(item.source.checkedDate)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
export function PersonResearch({
  personId,
  initial,
  inset,
}: {
  personId: string;
  initial: PersonResearchPage;
  inset: number;
}) {
  const [page, setPage] = useState(initial);
  const [state, setState] = useState<'ready' | 'updating' | 'failed'>('ready');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const more = () => {
    if (!page.nextCursor || state === 'updating') return;
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setState('updating');
    void getPersonResearch(personId, active.signal, page.nextCursor).then(
      (next) => {
        if (active.signal.aborted) return;
        setPage((old) => ({
          items: [
            ...old.items,
            ...next.items.filter((item) => !old.items.some((existing) => existing.id === item.id)),
          ],
          nextCursor: next.nextCursor,
        }));
        setState('ready');
      },
      () => {
        if (!active.signal.aborted) setState('failed');
      },
    );
  };
  return (
    <View style={{ marginTop: 14, gap: 12 }}>
      {state === 'updating' ? (
        <Text accessibilityLiveRegion="polite" style={candidateText.strong}>
          {PERSON_RECORD_COPY.researchUpdating}
        </Text>
      ) : null}
      {state === 'failed' ? (
        <CandidateNotice error>
          <Text style={candidateText.strong}>{PERSON_RECORD_COPY.researchUnavailable}</Text>
          <CandidateButton label="Try again" kind="outline" icon="none" onPress={more} />
        </CandidateNotice>
      ) : null}
      {page.items.length ? (
        <View
          aria-busy={state === 'updating'}
          style={{
            borderWidth: 1,
            borderColor: 'rgba(17,21,15,0.1)',
            borderRadius: 14,
            backgroundColor: '#fff',
          }}
        >
          {page.items.map((item, index) => (
            <View
              key={item.id}
              style={
                index ? { borderTopWidth: 1, borderTopColor: 'rgba(17,21,15,0.08)' } : undefined
              }
            >
              <ResearchItem item={item} inset={inset} />
            </View>
          ))}
        </View>
      ) : (
        <Text style={candidateText.body}>{PERSON_RECORD_COPY.noResearch}</Text>
      )}
      {page.nextCursor ? (
        <CandidateButton
          label="Show more records"
          busyLabel="Loading records…"
          busy={state === 'updating'}
          kind="text"
          icon="none"
          style={{ minWidth: 185, marginLeft: 14 }}
          onPress={more}
        />
      ) : null}
    </View>
  );
}
