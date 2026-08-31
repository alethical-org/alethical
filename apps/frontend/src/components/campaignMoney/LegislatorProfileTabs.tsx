/**
 * The two-tab bar on a legislator's profile: Overview and Campaign money (#1329).
 *
 * Modelled on the bill page's tab bar (`components/billDetail/BillHeader.tsx`), which
 * readers already meet on every bill, so a record page behaves the same way twice
 * rather than two ways.
 *
 * Each tab is a real link with its own web address, because everything linked to on
 * this product has to be reachable by URL (`.claude/rules/grounded-answers.md` rule
 * 5). That is also what lets the money keep its own freshness date: the money comes
 * from a different body on a different schedule than the rest of the profile, and one
 * page carrying two "as of" dates is the thing `docs/design/ui-copy-guide.md` ("One
 * date per page") exists to stop.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { linkProps, routePath } from '../../navigation/links';
import { theme as t } from '../../theme/tokens';

export type ProfileTab = 'overview' | 'money';

const TABS: { key: ProfileTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'money', label: 'Campaign money' },
];

export function LegislatorProfileTabs({
  legislatorId,
  active,
  year,
  onSelect,
}: {
  legislatorId: string;
  active: ProfileTab;
  /** Carried into the money tab's address so switching tabs keeps the year. */
  year?: string;
  onSelect: (tab: ProfileTab) => void;
}) {
  return (
    <View style={styles.bar}>
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        const href =
          tab.key === 'money'
            ? routePath.legislator(legislatorId, { tab: 'money', year })
            : routePath.legislator(legislatorId);
        return (
          <Pressable
            key={tab.key}
            {...linkProps(href, () => onSelect(tab.key))}
            // aria-current, not accessibilityState: these render as real anchors on
            // web, and "the page you are on" is what a screen reader announces for a
            // link in a set of links.
            aria-current={isActive ? 'page' : undefined}
            style={[styles.tab, isActive && styles.tabActive]}
          >
            <Text style={[styles.label, isActive && styles.labelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    gap: 24,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.alpha.ink08,
  },
  tab: {
    paddingVertical: 12,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: t.colors.brand.base },
  label: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.bodyLg,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.secondary,
  },
  labelActive: { color: t.colors.text.primary },
});
