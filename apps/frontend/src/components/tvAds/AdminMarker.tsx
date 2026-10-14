import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { theme as t } from '../../theme/tokens';

export const ADMIN_MARKER_LABEL = 'Admins only';

/**
 * The one "Admins only" marker for every TV entrance and page. It centres its own
 * text and never takes line height or alignment from its host, so a lane card, a
 * connection card and a TV page all draw the same chip. Hosts own placement only, via
 * `style` (React Native hosts) or a wrapping element (TV pages).
 */
export function AdminMarkerChip({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.chip, style]} testID="tv-admin-marker">
      <Text style={styles.label}>{ADMIN_MARKER_LABEL}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 26,
    paddingHorizontal: 10,
    // Libre Franklin's line box sits its ink low by 0 to 2px depending on the browser's
    // text engine (Safari, Chrome on Mac, Chrome on Linux and Android differ); a 1px lift
    // keeps the clear space above and below the text within 1px on all of them.
    paddingBottom: 1,
    borderWidth: 1,
    borderColor: '#11150f',
    borderRadius: 7,
    backgroundColor: '#ffffff',
  },
  label: {
    color: '#11150f',
    fontFamily: t.typography.body,
    fontSize: 12.5,
    fontWeight: '700',
    lineHeight: 12.5,
    // No wrapping and no clipping, so the tail of the "y" is never cut off.
    ...({ whiteSpace: 'nowrap' } as object),
  },
});
