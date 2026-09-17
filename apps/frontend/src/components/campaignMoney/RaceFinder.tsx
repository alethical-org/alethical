import { useEffect, useId, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import type { RaceContest } from '../../data/types';
import { contestSeatLabel, contestCountLabel, matchingRaceContests } from '../../lib/moneyByRace';
import { fieldFocusRing, fieldOutlineReset } from '../../theme/fieldFocus';
import { theme as t } from '../../theme/tokens';

/** A jump to an existing whole group, never a filter on its committees. */
export function RaceFinder({
  contests,
  isMobile,
  onChoose,
  query,
  onQueryChange,
}: {
  contests: readonly RaceContest[];
  isMobile: boolean;
  onChoose: (anchor: string) => void;
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const id = useId();
  const input = useRef<TextInput>(null);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
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
    setActive(-1);
    setOpen(false);
    onChoose(contest.anchor);
  };

  return (
    <View nativeID={id} style={styles.card}>
      <Text nativeID={`${id}-label`} style={styles.label}>
        Find an office, district or court seat
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
              accessibilityLabel="Find an office, district or court seat"
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
              placeholder="Try House 12A or Governor"
              placeholderTextColor={t.colors.text.secondary}
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
              onChangeText={(value) => {
                onQueryChange(value);
                setActive(-1);
                setOpen(true);
              }}
              onFocus={() => {
                setFocused(true);
                setOpen(true);
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
                  setActive(-1);
                }
              }}
              onSubmitEditing={() =>
                choose(selected ?? (matches.length === 1 ? matches[0] : undefined))
              }
              blurOnSubmit={false}
              returnKeyType="go"
              style={[styles.input, fieldOutlineReset]}
            />
            {query ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                onPress={() => {
                  onQueryChange('');
                  setActive(-1);
                  setOpen(false);
                  input.current?.focus();
                }}
                style={styles.clear}
              >
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden>
                  <Path
                    d="M6 6 L18 18 M18 6 L6 18"
                    stroke={t.colors.text.primary}
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                </Svg>
              </Pressable>
            ) : null}
          </View>
          {expanded ? (
            matches.length ? (
              <View
                nativeID={`${id}-list`}
                role={'listbox' as never}
                aria-label="Matching offices, districts and court seats"
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
                    <Text style={styles.body}>{contestCountLabel(contest.committeeCount)}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <View role="status" style={styles.noMatch}>
                <Text style={styles.body}>
                  No matching office, district or court seat in our records
                </Text>
                <Text style={styles.body}>
                  Try another name or clear your search. These records do not confirm who is on the
                  ballot.
                </Text>
              </View>
            )
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => choose(selected ?? (matches.length === 1 ? matches[0] : undefined))}
          onHoverIn={() => setHovered(true)}
          onHoverOut={() => setHovered(false)}
          style={[styles.button, hovered && styles.buttonHover, isMobile && styles.mobileButton]}
        >
          <Text style={styles.buttonLabel}>View committees</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 24, zIndex: 10 },
  clear: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -12,
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
  fieldAndMatches: { flex: 1, minWidth: 0, maxWidth: 760, width: '100%', zIndex: 1 },
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
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    backgroundColor: t.colors.surfaces.base,
    zIndex: 20,
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
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    backgroundColor: t.colors.surfaces.base,
    zIndex: 20,
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
