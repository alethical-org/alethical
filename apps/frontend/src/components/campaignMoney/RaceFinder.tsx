import { useEffect, useId, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import type { RaceContest } from '../../data/types';
import { contestSeatLabel, matchingRaceContests } from '../../lib/moneyByRace';
import { fieldFocusRing, fieldOutlineReset } from '../../theme/fieldFocus';
import { theme as t } from '../../theme/tokens';

/** A jump to an existing whole group, never a filter on its committees. */
export function RaceFinder({
  contests,
  isMobile,
  onChoose,
}: {
  contests: readonly RaceContest[];
  isMobile: boolean;
  onChoose: (anchor: string) => void;
}) {
  const id = useId();
  const input = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const matches = matchingRaceContests(contests, query);
  const expanded = open && query.trim().length > 0;
  const selected = matches[active];

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const closeOutside = (event: Event) => {
      const root = document.getElementById(id);
      if (event.target instanceof Node && !root?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
    };
  }, [id]);

  useEffect(() => {
    if (expanded && selected && Platform.OS === 'web') {
      document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [active, expanded, id, selected]);

  const choose = (contest: RaceContest | undefined) => {
    if (!contest) {
      setOpen(true);
      input.current?.focus();
      return;
    }
    setQuery(contestSeatLabel(contest));
    setActive(0);
    setOpen(false);
    onChoose(contest.anchor);
  };

  return (
    <View nativeID={id} style={styles.card}>
      <Text nativeID={`${id}-label`} style={styles.label}>
        Find a district or court seat
      </Text>
      <View style={[styles.row, isMobile && styles.stacked]}>
        <View style={[styles.fieldAndMatches, isMobile && styles.mobileField]}>
          <View style={[styles.field, ...fieldFocusRing(focused)]}>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
              <Circle cx={10.5} cy={10.5} r={6.5} stroke={t.colors.text.primary} strokeWidth={2} />
              <Path
                d="M16 16 L21 21"
                stroke={t.colors.text.primary}
                strokeWidth={2}
                strokeLinecap="round"
              />
            </Svg>
            <TextInput
              ref={input}
              value={query}
              accessibilityRole="combobox"
              accessibilityLabel="Find a district or court seat"
              aria-labelledby={`${id}-label`}
              aria-expanded={expanded}
              {...(Platform.OS === 'web'
                ? {
                    'aria-controls': expanded && matches.length > 0 ? `${id}-list` : undefined,
                    'aria-autocomplete': 'list',
                    'aria-activedescendant':
                      expanded && selected ? `${id}-option-${active}` : undefined,
                  }
                : {})}
              placeholder="Enter a district or seat"
              placeholderTextColor={t.colors.text.faint}
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
              onChangeText={(value) => {
                setQuery(value);
                setActive(0);
                setOpen(true);
              }}
              onFocus={() => {
                setFocused(true);
              }}
              onBlur={() => setFocused(false)}
              onKeyPress={(event) => {
                const key = event.nativeEvent.key;
                if (key === 'ArrowDown' || key === 'ArrowUp') {
                  event.preventDefault();
                  setOpen(true);
                  setActive((index) =>
                    !expanded
                      ? 0
                      : Math.max(
                          0,
                          Math.min(matches.length - 1, index + (key === 'ArrowDown' ? 1 : -1)),
                        ),
                  );
                } else if (key === 'Escape') {
                  event.preventDefault();
                  setOpen(false);
                }
              }}
              onSubmitEditing={() => choose(selected)}
              returnKeyType="go"
              style={[styles.input, fieldOutlineReset]}
            />
          </View>
          {expanded ? (
            matches.length ? (
              <View
                nativeID={`${id}-list`}
                role={'listbox' as never}
                aria-label="Matching districts and court seats"
                style={styles.list}
              >
                {matches.map((contest, index) => (
                  <Pressable
                    key={contest.anchor}
                    nativeID={`${id}-option-${index}`}
                    role="option"
                    aria-selected={index === active}
                    tabIndex={-1}
                    onPress={() => choose(contest)}
                    style={[styles.option, index === active && styles.activeOption]}
                  >
                    <Text style={styles.optionLabel}>{contestSeatLabel(contest)}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <View role="status" style={styles.noMatch}>
                <Text style={styles.body}>No matching district or court seat in our records</Text>
                <Text style={styles.body}>
                  This means we hold no group with that name. It does not mean the district has no
                  candidates.
                </Text>
              </View>
            )
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => choose(selected)}
          onHoverIn={() => setHovered(true)}
          onHoverOut={() => setHovered(false)}
          style={[styles.button, hovered && styles.buttonHover, isMobile && styles.mobileButton]}
        >
          <Text style={styles.buttonLabel}>Go to district or seat</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 20,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    backgroundColor: t.colors.surfaces.base,
    borderRadius: 16,
    padding: 20,
  },
  label: {
    fontFamily: t.typography.body,
    fontWeight: '700',
    fontSize: 15,
    lineHeight: 22,
    color: t.colors.text.primary,
    marginBottom: 8,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stacked: { flexDirection: 'column' },
  fieldAndMatches: { flex: 1, minWidth: 0, maxWidth: 580, width: '100%' },
  mobileField: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
  field: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: t.colors.text.primary,
    borderRadius: 14,
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    paddingVertical: 0,
    fontFamily: t.typography.body,
    fontSize: 16,
    color: t.colors.text.primary,
    fontVariant: ['tabular-nums'],
  },
  list: {
    marginTop: 10,
    maxHeight: 288,
    overflow: 'scroll',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 12,
  },
  option: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: t.colors.alpha.ink08,
  },
  activeOption: { backgroundColor: '#eef6f1' },
  optionLabel: {
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '700',
    color: t.colors.text.primary,
    fontVariant: ['tabular-nums'],
  },
  noMatch: {
    marginTop: 10,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink10,
    borderRadius: 12,
  },
  body: {
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 24,
    color: t.colors.text.secondary,
  },
  button: {
    minHeight: 52,
    paddingHorizontal: 18,
    borderRadius: 14,
    justifyContent: 'center',
    backgroundColor: t.colors.text.primary,
  },
  mobileButton: { width: '100%', alignItems: 'center' },
  buttonHover: { opacity: 0.9 },
  buttonLabel: {
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    color: t.colors.surfaces.base,
  },
});
