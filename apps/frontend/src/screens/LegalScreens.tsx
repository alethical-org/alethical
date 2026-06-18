import { StyleSheet, Text, View } from 'react-native';

import { ScreenView } from '../components/ScreenView';
import { theme } from '../theme/tokens';

const effectiveDate = 'June 18, 2026';

type LegalSection = {
  title: string;
  paragraphs: string[];
};

const privacySections: LegalSection[] = [
  {
    title: 'Overview',
    paragraphs: [
      'Alethical helps people search, understand, track, and ask questions about public legislative information. This Privacy Policy explains what we collect, how we use it, and the choices you have when using Alethical.',
      'This draft is intended to make our current practices clear while our legal review is in progress. We will update it as the product and legal guidance evolve.',
    ],
  },
  {
    title: 'Information we collect',
    paragraphs: [
      'If you use Alethical without signing in, you can browse public content such as bills, legislators, votes, and related summaries. We may collect basic technical information such as browser type, device information, pages visited, and approximate usage activity to keep the service reliable.',
      'If you sign in with Google, we receive the account information needed to create and maintain your Alethical account, such as your name, email address, and Google account identifier. If you choose to track bills, save places, or use chat, we store the content and settings needed to provide those features.',
    ],
  },
  {
    title: 'How we use information',
    paragraphs: [
      'We use information to operate Alethical, provide account features, maintain your tracked bills and chat history, improve product reliability, prevent abuse, and communicate service-related updates.',
      'We do not sell personal information. We do not use Google sign-in data for advertising. We use Google sign-in only to authenticate you and connect your account to Alethical features.',
    ],
  },
  {
    title: 'Service providers',
    paragraphs: [
      'Alethical relies on service providers for hosting, authentication, database storage, analytics, and related infrastructure. These providers process information only as needed to help us operate the service.',
      'Public legislative source material may come from government or public data sources. Those sources are separate from Alethical and have their own practices.',
    ],
  },
  {
    title: 'Data retention and deletion',
    paragraphs: [
      'We keep account information and saved product data for as long as needed to provide the service, comply with legal obligations, resolve disputes, and maintain security.',
      'You may request deletion of your Alethical account or associated personal information by contacting us. Some records may be retained where required for security, legal, or operational reasons.',
    ],
  },
  {
    title: 'Your choices',
    paragraphs: [
      'You can use public search and representative lookup without signing in. You can choose whether to sign in with Google for account-backed features such as tracking, saved history, and chat.',
      'You can stop using Alethical at any time. If you no longer want Alethical to access your Google account for sign-in, you can remove access from your Google account settings.',
    ],
  },
  {
    title: 'Contact',
    paragraphs: [
      'For privacy questions, account deletion requests, or other privacy-related requests, contact the Alethical team at the support channel listed on our website or product communications.',
    ],
  },
];

const termsSections: LegalSection[] = [
  {
    title: 'Agreement to these terms',
    paragraphs: [
      'These Terms of Service govern your use of Alethical. By accessing or using Alethical, you agree to these terms. If you do not agree, do not use the service.',
      'These draft terms are provided while legal review is in progress and may be updated as the product develops.',
    ],
  },
  {
    title: 'What Alethical provides',
    paragraphs: [
      'Alethical provides tools for searching, tracking, and asking questions about public legislative information. The service may include summaries, classifications, links, saved activity, and generated responses grounded in available source material.',
      'Alethical is not a law firm, lobbying service, government agency, or source of legal advice. Information in the service is for general informational and civic research purposes only.',
    ],
  },
  {
    title: 'Accounts and sign-in',
    paragraphs: [
      'Some features require signing in with Google. You are responsible for keeping your Google account secure and for activity that occurs through your Alethical account.',
      'You agree to provide accurate account information and to use Alethical only in compliance with applicable laws and these terms.',
    ],
  },
  {
    title: 'Acceptable use',
    paragraphs: [
      'You may not misuse Alethical, interfere with the service, attempt unauthorized access, scrape the service in a way that harms reliability, upload malicious content, or use the service to harass, deceive, or violate the rights of others.',
      'We may suspend or restrict access if we believe use of the service creates risk, violates these terms, or may harm Alethical, other users, or third parties.',
    ],
  },
  {
    title: 'Public information and generated output',
    paragraphs: [
      'Alethical works with public legislative information and related source material. We aim for accuracy, but legislative data, summaries, generated responses, and third-party source material may be incomplete, delayed, or incorrect.',
      'You should verify important information against official government records or other authoritative sources before relying on it.',
    ],
  },
  {
    title: 'Ownership',
    paragraphs: [
      'Alethical and its software, design, branding, and product experience are owned by Alethical or its licensors. These terms do not grant you ownership of Alethical or its underlying technology.',
      'Public legislative records remain subject to the rights and terms that apply to their original sources.',
    ],
  },
  {
    title: 'Disclaimers and limitation of liability',
    paragraphs: [
      'Alethical is provided on an as-is and as-available basis. We do not promise that the service will be uninterrupted, error-free, or always current.',
      'To the fullest extent allowed by law, Alethical will not be liable for indirect, incidental, special, consequential, or punitive damages arising from your use of the service.',
    ],
  },
  {
    title: 'Changes',
    paragraphs: [
      'We may update these terms from time to time. Updated terms will be posted on this page with a new effective date. Continued use of Alethical after updates means you accept the updated terms.',
    ],
  },
  {
    title: 'Contact',
    paragraphs: [
      'For questions about these terms, contact the Alethical team through the support channel listed on our website or product communications.',
    ],
  },
];

function LegalDocument({
  title,
  subtitle,
  sections,
}: {
  title: string;
  subtitle: string;
  sections: LegalSection[];
}) {
  return (
    <ScreenView title={title} subtitle={subtitle}>
      <View style={styles.document}>
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            Draft policy text. This page is intended to satisfy product launch and OAuth review requirements while formal legal review is pending.
          </Text>
          <Text style={styles.effectiveDate}>Effective date: {effectiveDate}</Text>
        </View>

        {sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.paragraphs.map((paragraph) => (
              <Text key={paragraph} style={styles.paragraph}>
                {paragraph}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScreenView>
  );
}

export function PrivacyScreen() {
  return (
    <LegalDocument
      title="Privacy Policy"
      subtitle="How Alethical handles account, product, and usage information."
      sections={privacySections}
    />
  );
}

export function TermsScreen() {
  return (
    <LegalDocument
      title="Terms of Service"
      subtitle="The basic terms for using Alethical."
      sections={termsSections}
    />
  );
}

const styles = StyleSheet.create({
  document: {
    maxWidth: 860,
    gap: theme.spacing.lg,
  },
  notice: {
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
    padding: theme.spacing.md,
  },
  noticeText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 15,
    lineHeight: 23,
  },
  effectiveDate: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  section: {
    gap: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.md,
  },
  sectionTitle: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 28,
    lineHeight: 34,
  },
  paragraph: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 16,
    lineHeight: 26,
  },
});
