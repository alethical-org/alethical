import { Platform, Text, type TextProps, type TextStyle } from 'react-native';
import { useResponsive } from '../hooks/useResponsive';
import { theme } from '../theme/tokens';
import { PageContextLabel } from './PageContextLabel';

/** One readable profile name, with a source identifier that stays together. */
export function ProfileContextLabel({
  children,
  identifier,
  style,
  ...props
}: TextProps & { identifier?: string }) {
  const { isMobile } = useResponsive();
  const size = isMobile ? 12 : 13;
  return (
    <PageContextLabel
      {...props}
      style={[
        {
          marginTop: isMobile ? 6 : 14,
          color: '#0f7a45',
          fontFamily: theme.typography.body,
          fontSize: size,
          fontWeight: '700',
          letterSpacing: 2.4,
          ...(identifier ? { lineHeight: size * 1.5, fontVariant: ['tabular-nums'] as const } : {}),
        },
        style,
      ]}
    >
      {children}
      {identifier ? (
        <>
          {'\u00a0· '}
          <Text style={Platform.OS === 'web' ? ({ whiteSpace: 'nowrap' } as TextStyle) : undefined}>
            {identifier}
          </Text>
        </>
      ) : null}
    </PageContextLabel>
  );
}
