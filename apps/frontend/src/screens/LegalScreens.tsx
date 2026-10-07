import { NavigationProp, useNavigation } from '@react-navigation/native';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useResponsive } from '../hooks/useResponsive';
import { RootStackParamList } from '../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../theme/primitives';
import { theme } from '../theme/tokens';

import {
  privacyContent,
  termsContent,
  type LegalBlock,
  type LegalDocumentContent,
} from '../lib/legalContent';

function LegalDocument({ content }: { content: LegalDocumentContent }) {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { isMobile } = useResponsive();

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />

        <Container style={[styles.main, isMobile && styles.mainMobile]}>
          <View style={styles.document}>
            <Text style={styles.eyebrow}>Legal</Text>
            <Text
              accessibilityRole="header"
              aria-level={1}
              style={[styles.title, isMobile && styles.titleMobile]}
            >
              {content.title}
            </Text>
            <Text style={styles.meta}>{content.meta}</Text>

            {content.sections.map((section, sectionIndex) => (
              <View key={`${section.title ?? 'intro'}-${sectionIndex}`} style={styles.section}>
                {section.title ? (
                  <View style={styles.sectionHeading}>
                    {section.number ? (
                      <Text style={styles.sectionNumber}>{section.number}</Text>
                    ) : null}
                    <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
                      {section.title}
                    </Text>
                  </View>
                ) : null}
                {section.blocks.map((block, blockIndex) => (
                  <LegalBlockView key={`${block.kind}-${blockIndex}`} block={block} />
                ))}
              </View>
            ))}
          </View>
        </Container>

        <Footer
          onPrivacy={() => navigation.navigate('Privacy')}
          onTerms={() => navigation.navigate('Terms')}
        />
      </ScrollView>
    </PageBackground>
  );
}

function LegalBlockView({ block }: { block: LegalBlock }) {
  if (block.kind === 'list') {
    return (
      <View style={styles.list}>
        {block.items.map((item) => (
          <View key={item} style={styles.listItem}>
            <Text style={styles.bullet}>{'\u2022'}</Text>
            <Text style={styles.paragraph}>{item}</Text>
          </View>
        ))}
      </View>
    );
  }

  if (block.kind === 'callout') {
    return (
      <Text style={[styles.paragraph, styles.callout]}>
        {block.text}
        {block.linkText ? <Text style={styles.inlineLink}>{block.linkText}</Text> : null}
        {block.trailingText}
      </Text>
    );
  }

  return <Text style={styles.paragraph}>{block.text}</Text>;
}

export function PrivacyScreen() {
  return <LegalDocument content={privacyContent} />;
}

export function TermsScreen() {
  return <LegalDocument content={termsContent} />;
}

const styles = StyleSheet.create({
  page: {
    flexGrow: 1,
    backgroundColor: theme.colors.surface,
  },
  main: {
    alignSelf: 'center',
    paddingTop: 64,
    paddingBottom: 72,
  },
  mainMobile: {
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 20,
  },
  document: {
    width: '100%',
    maxWidth: 860,
    alignSelf: 'center',
    gap: theme.spacing.md,
  },
  eyebrow: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2.4,
    textTransform: 'uppercase',
  },
  title: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 52,
    lineHeight: 58,
  },
  titleMobile: {
    fontSize: 40,
    lineHeight: 46,
  },
  meta: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 24,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingBottom: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  section: {
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: theme.spacing.sm,
  },
  sectionNumber: {
    minWidth: 26,
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  sectionTitle: {
    flex: 1,
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 26,
    lineHeight: 32,
  },
  paragraph: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 16,
    lineHeight: 26,
  },
  callout: {
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
    padding: theme.spacing.md,
  },
  inlineLink: {
    color: theme.colors.ink,
    textDecorationLine: 'underline',
  },
  list: {
    gap: theme.spacing.xs,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  bullet: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 16,
    lineHeight: 26,
  },
});
