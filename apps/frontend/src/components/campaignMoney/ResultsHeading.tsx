import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { ShareContent } from '../../lib/share';
import { SharePopover } from '../billDetail/SharePopover';

/** Keep the page's heading and its one Share control together at every width. */
export function ResultsHeading({
  children,
  content,
  isMobile,
}: {
  children: ReactNode;
  content: ShareContent | null;
  isMobile: boolean;
}) {
  return (
    <View style={[styles.row, isMobile && styles.stacked]}>
      <View style={[styles.heading, !isMobile && styles.wideHeading]}>{children}</View>
      {content ? <SharePopover content={content} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  stacked: { flexDirection: 'column', alignItems: 'flex-start', gap: 12 },
  heading: { minWidth: 0, flexShrink: 1 },
  wideHeading: { flex: 1 },
});
