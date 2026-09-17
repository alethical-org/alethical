import { useRef } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { useResponsive } from '../../hooks/useResponsive';
import { type ShareContent } from '../../lib/share';
import { theme as t } from '../../theme/tokens';
import { SharePanelContent } from './SharePanelContent';

export function MobileShareSheet({
  visible,
  onClose,
  content,
}: {
  visible: boolean;
  onClose: () => void;
  content: ShareContent;
}) {
  const { isTablet } = useResponsive();
  const closeButtonRef = useRef<View>(null);
  return (
    <Modal
      aria-label={`Share this ${content.subject}`}
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      onShow={() => {
        if (Platform.OS === 'web')
          (closeButtonRef.current as unknown as HTMLElement | null)?.focus?.();
      }}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Close share"
          tabIndex={-1}
        />
        <View
          style={styles.sheet}
          accessibilityViewIsModal
          aria-label={`Share this ${content.subject}`}
        >
          {visible ? (
            <SharePanelContent
              content={content}
              variant={isTablet ? 'tablet' : 'phone'}
              onClose={onClose}
              closeButtonRef={closeButtonRef}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(10,14,12,0.55)' },
  sheet: {
    width: '100%',
    maxHeight: '92%',
    backgroundColor: t.colors.surfaces.base,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? { boxShadow: '0 -20px 60px rgba(10,14,12,0.4)' } : {}),
  },
});
