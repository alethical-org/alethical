import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme as t } from '../../theme/tokens';
import { LoadingButton } from './LoadingButton';

export type ResendStatus = 'ready' | 'sending' | 'sent' | 'waiting';

function waitSentence(seconds: number) {
  return `You can resend in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`;
}

export function ResendControl({
  status,
  sentMessage,
  onResend,
  secondsRemaining = 0,
  actionLabel = 'Resend email',
  sendingLabel = 'Resending…',
}: {
  status: ResendStatus;
  sentMessage: string;
  onResend: () => void | Promise<void>;
  secondsRemaining?: number;
  actionLabel?: string;
  sendingLabel?: string;
}) {
  const previousStatus = useRef(status);
  const [announceReady, setAnnounceReady] = useState(false);

  useEffect(() => {
    const justBecameReady = previousStatus.current === 'waiting' && status === 'ready';
    previousStatus.current = status;
    setAnnounceReady(justBecameReady);
  }, [status]);

  if (status === 'ready' || status === 'sending') {
    return (
      <View style={styles.wrap}>
        <LoadingButton
          tone="secondary"
          label={actionLabel}
          busyLabel={sendingLabel}
          busy={status === 'sending'}
          onPress={onResend}
        />
        {announceReady ? (
          <Text accessibilityLiveRegion="polite" style={styles.screenReaderOnly}>
            You can resend now.
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View
        {...({ role: 'status' } as object)}
        accessibilityLiveRegion="polite"
        style={styles.notice}
      >
        <Text style={styles.noticeText}>{sentMessage}</Text>
      </View>
      {status === 'waiting' ? (
        <Text {...({ 'aria-live': 'off' } as object)} style={styles.waitText}>
          {waitSentence(Math.max(0, Math.ceil(secondsRemaining)))}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', gap: 10 },
  notice: {
    backgroundColor: t.colors.surfaces.s200,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.1)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  noticeText: {
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 21,
    color: t.colors.text.secondary,
  },
  waitText: {
    minHeight: 44,
    paddingVertical: 11,
    fontFamily: t.typography.body,
    fontSize: t.fontSizes.small,
    lineHeight: 22,
    color: '#6f756f',
    textAlign: 'center',
  },
  screenReaderOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    margin: -1,
    overflow: 'hidden',
    opacity: 0,
  },
});
