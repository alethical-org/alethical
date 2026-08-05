import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme as t } from '../../theme/tokens';
import { isWeb, useHover } from './interactions';

// Section index for the Bill Text tab — a sticky rail listing every section so a
// 20-section bill is navigable. Rows hang off a 1px rule; the section currently
// in view carries a 2px ink border and a bold label.
//
// Rows are grouped by article because section numbers RESTART inside each
// article: SF 4214 has two articles and therefore two sections numbered 1, which
// would otherwise appear as two identical "1" rows.

export interface SectionIndexItem {
  /** The HTML id of the section this row jumps to — `ft-<sectionId>-<position>`.
   *  Keyed on the anchor rather than the section id because a version can repeat
   *  one id across several sections, which made two rows share a React key and
   *  the rail light the wrong one (#854). */
  anchorId: string;
  /** "SEC. 4" — the number alone. */
  number: string | null;
  /** Section title, first subdivision headnote, or amendment clause. Empty when
   *  the source names none of those, leaving the number to stand alone. */
  label: string;
  articleHeading: string | null;
}

export function SectionIndexRail({
  items,
  activeAnchorId,
  onSelect,
}: {
  items: SectionIndexItem[];
  activeAnchorId: string | null;
  onSelect: (anchorId: string) => void;
}) {
  // Preserve source order while collecting each article's rows.
  const groups: Array<{ article: string | null; items: SectionIndexItem[] }> = [];
  for (const item of items) {
    const article = item.articleHeading?.trim() || null;
    const last = groups[groups.length - 1];
    if (last && last.article === article) last.items.push(item);
    else groups.push({ article, items: [item] });
  }
  const showArticles = groups.length > 1 || !!groups[0]?.article;

  return (
    <View
      accessibilityRole={isWeb ? ('navigation' as 'none') : undefined}
      accessibilityLabel="Sections in this bill"
    >
      <Text style={styles.eyebrow}>SECTIONS</Text>
      {groups.map((group, groupIndex) => (
        <View key={`${group.article ?? 'ungrouped'}-${groupIndex}`} style={styles.group}>
          {showArticles && group.article ? (
            <Text style={styles.articleLabel}>{group.article}</Text>
          ) : null}
          <View style={styles.rows}>
            {group.items.map((item) => (
              <IndexRow
                key={item.anchorId}
                item={item}
                active={item.anchorId === activeAnchorId}
                onSelect={onSelect}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function IndexRow({
  item,
  active,
  onSelect,
}: {
  item: SectionIndexItem;
  active: boolean;
  onSelect: (anchorId: string) => void;
}) {
  const [hovered, hoverProps] = useHover();
  const [focused, setFocused] = useState(false);
  const lit = active || hovered || focused;

  return (
    <Pressable
      {...hoverProps}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => onSelect(item.anchorId)}
      accessibilityRole="link"
      accessibilityLabel={[item.number ?? 'Section', item.label].filter(Boolean).join(': ')}
      aria-current={active ? 'location' : undefined}
      style={[styles.row, lit && styles.rowLit, active && styles.rowActive]}
    >
      {item.number ? <Text style={styles.rowNumber}>{item.number}</Text> : null}
      {item.label ? (
        <Text
          numberOfLines={2}
          style={[styles.rowLabel, active && styles.rowLabelActive, lit && styles.rowLabelLit]}
        >
          {item.label}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.9,
    color: t.colors.text.muted,
    marginBottom: 12,
  },
  group: { marginBottom: 18 },
  articleLabel: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.6,
    color: t.colors.text.faint,
    marginBottom: 8,
  },
  // The 1px rule every row hangs off.
  rows: { borderLeftWidth: 1, borderLeftColor: t.colors.alpha.ink08 },
  row: {
    // Pulled left by the rule's width so an active row's 2px border covers it
    // rather than sitting beside it.
    marginLeft: -1,
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
    paddingLeft: 12,
    paddingVertical: 7,
    gap: 2,
  },
  rowLit: { borderLeftColor: t.colors.alpha.ink08 },
  rowActive: { borderLeftColor: t.colors.text.primary },
  rowNumber: {
    fontFamily: t.typography.mono,
    fontSize: t.fontSizes.caption,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 0.4,
    color: t.colors.text.faint,
  },
  rowLabel: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 19,
    color: t.colors.text.secondary,
  },
  rowLabelLit: { color: t.colors.text.primary },
  rowLabelActive: { fontWeight: t.fontWeights.bold },
});
