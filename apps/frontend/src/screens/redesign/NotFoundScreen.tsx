import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useResponsive } from '../../hooks/useResponsive';
import { NOT_FOUND_DESCRIPTION, NOT_FOUND_HEADING } from '../../lib/share';
import { linkProps, routePath } from '../../navigation/links';
import type { RootScreenProps } from '../../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';

function WayOut({ label, href, onPress }: { label: string; href: string; onPress: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      {...linkProps(href, onPress)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.wayOut,
        (hovered || focused) && styles.wayOutActive,
        pressed && styles.wayOutPressed,
      ]}
    >
      <Text style={styles.wayOutText}>{label}</Text>
    </Pressable>
  );
}

export function NotFoundScreen({ navigation, route }: RootScreenProps<'NotFound'>) {
  const { isMobile } = useResponsive();

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />

        <Container style={[styles.main, isMobile && styles.mainMobile]}>
          <View style={[styles.card, isMobile && styles.cardMobile]}>
            <Text style={styles.code}>404</Text>
            <Text
              accessibilityRole="header"
              aria-level={1}
              style={[styles.heading, isMobile && styles.headingMobile]}
            >
              {NOT_FOUND_HEADING}
            </Text>
            <Text style={styles.body}>{NOT_FOUND_DESCRIPTION}</Text>
            <Text selectable style={styles.path}>
              {route.params.path}
            </Text>
            <View style={[styles.actions, isMobile && styles.actionsMobile]}>
              <WayOut
                label="Home"
                href={routePath.home()}
                onPress={() => navigation.navigate('Tabs', { screen: 'Home' })}
              />
              <WayOut
                label="Browse bills"
                href={routePath.bills()}
                onPress={() => navigation.navigate('Bills')}
              />
              <WayOut
                label="Find legislators"
                href={routePath.legislators()}
                onPress={() => navigation.navigate('Legislators')}
              />
            </View>
          </View>
        </Container>

        <Footer
          onContact={() => navigation.navigate('ContactUs')}
          onPrivacy={() => navigation.navigate('Privacy')}
          onTerms={() => navigation.navigate('Terms')}
        />
      </ScrollView>
    </PageBackground>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: t.colors.surfaces.base },
  main: {
    flex: 1,
    width: '100%',
    maxWidth: 920,
    alignSelf: 'center',
    justifyContent: 'center',
    paddingVertical: 88,
  },
  mainMobile: { paddingVertical: 48, paddingHorizontal: 20 },
  card: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: 20,
    backgroundColor: t.colors.surfaces.base,
    paddingVertical: 68,
    paddingHorizontal: 56,
  },
  cardMobile: { paddingVertical: 44, paddingHorizontal: 22 },
  code: {
    color: t.colors.text.green,
    fontFamily: t.typography.mono,
    fontSize: 14,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.6,
  },
  heading: {
    marginTop: 14,
    color: t.colors.text.primary,
    fontFamily: t.typography.title,
    fontSize: 46,
    lineHeight: 52,
    fontWeight: t.fontWeights.bold,
    textAlign: 'center',
  },
  headingMobile: { fontSize: 34, lineHeight: 40 },
  body: {
    marginTop: 16,
    maxWidth: 560,
    color: t.colors.text.muted,
    fontFamily: t.typography.body,
    fontSize: 18,
    lineHeight: 28,
    textAlign: 'center',
  },
  path: {
    marginTop: 18,
    maxWidth: '100%',
    color: t.colors.text.secondary,
    fontFamily: t.typography.mono,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  actions: {
    marginTop: 32,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
  },
  actionsMobile: { width: '100%', flexDirection: 'column' },
  wayOut: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.colors.brand.base,
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  wayOutActive: { backgroundColor: t.colors.tint.t100 },
  wayOutPressed: { opacity: 0.76 },
  wayOutText: {
    color: t.colors.text.green,
    fontFamily: t.typography.ui,
    fontSize: 15,
    fontWeight: t.fontWeights.bold,
  },
});
