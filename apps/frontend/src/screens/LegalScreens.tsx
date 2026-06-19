import { StyleSheet, Text, View } from 'react-native';

import { ScreenView } from '../components/ScreenView';
import { theme } from '../theme/tokens';

type LegalBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'callout'; text: string; linkText?: string; trailingText?: string }
  | { kind: 'list'; items: string[] };

type LegalSection = {
  number?: string;
  title?: string;
  blocks: LegalBlock[];
};

type LegalDocumentContent = {
  title: string;
  meta: string;
  sections: LegalSection[];
};

const privacyContent: LegalDocumentContent = {
  title: 'Privacy Policy',
  meta: 'Effective date: June 16, 2026 · Last updated: June 16, 2026',
  sections: [
    {
      blocks: [
        {
          kind: 'paragraph',
          text: 'This Privacy Policy explains how Alethical, LLC (“Alethical,” “we,” “us,” or “our”) collects, uses, and protects information when you use our website and application (the “Service”). By using the Service, you agree to the practices described here.',
        },
      ],
    },
    {
      number: '01',
      title: 'Information We Collect',
      blocks: [
        {
          kind: 'paragraph',
          text: 'When you sign in with Google, we receive basic profile information from your Google Account, limited to what you authorize:',
        },
        {
          kind: 'list',
          items: [
            'Account information — your name, email address, and profile picture.',
            'Authentication data — identifiers used to create and maintain your secure session.',
            'Usage data — information about how you interact with the Service, such as features used and general device and log information.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'We do not request access to your Gmail, Google Drive, contacts, or any other sensitive or restricted Google data.',
        },
      ],
    },
    {
      number: '02',
      title: 'How We Use Information',
      blocks: [
        {
          kind: 'paragraph',
          text: 'We use the information we collect to:',
        },
        {
          kind: 'list',
          items: [
            'Authenticate you and provide secure access to your account.',
            'Operate, maintain, and improve the Service.',
            'Communicate with you about your account, security, and updates.',
            'Protect against fraud, abuse, and unauthorized access.',
          ],
        },
      ],
    },
    {
      number: '03',
      title: 'Google API Services — Limited Use',
      blocks: [
        {
          kind: 'callout',
          text: 'Alethical’s use and transfer to any other app of information received from Google APIs will adhere to the ',
          linkText: 'Google API Services User Data Policy',
          trailingText: ', including the Limited Use requirements.',
        },
        {
          kind: 'paragraph',
          text: 'We only request the minimum scopes needed to sign you in and identify your account. We do not sell Google user data, and we do not use it for advertising or any purpose unrelated to providing the Service.',
        },
      ],
    },
    {
      number: '04',
      title: 'How We Share Information',
      blocks: [
        {
          kind: 'paragraph',
          text: 'We do not sell your personal information. We share it only with:',
        },
        {
          kind: 'list',
          items: [
            'Service providers who help us operate the Service under contractual confidentiality obligations — including Supabase (authentication and database) and Google (sign-in).',
            'Legal authorities when required by law, regulation, or valid legal process.',
            'A successor entity in connection with a merger, acquisition, or sale of assets, subject to this Policy.',
          ],
        },
      ],
    },
    {
      number: '05',
      title: 'Data Retention',
      blocks: [
        {
          kind: 'paragraph',
          text: 'We retain your information for as long as your account is active or as needed to provide the Service. We delete or anonymize it when it is no longer required, unless a longer retention period is required by law.',
        },
      ],
    },
    {
      number: '06',
      title: 'Security',
      blocks: [
        {
          kind: 'paragraph',
          text: 'We use industry-standard safeguards to protect your information, including encryption in transit and access controls. No method of transmission or storage is fully secure, so we cannot guarantee absolute security.',
        },
      ],
    },
    {
      number: '07',
      title: 'Your Rights',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Depending on your location, you may have the right to access, correct, export, or delete your personal information, and to withdraw consent. To exercise these rights, contact us at the address below. You can also revoke Alethical’s access at any time from your Google Account permissions page.',
        },
      ],
    },
    {
      number: '08',
      title: 'Cookies',
      blocks: [
        {
          kind: 'paragraph',
          text: 'We use cookies and similar technologies that are necessary to keep you signed in and to operate the Service. You can control cookies through your browser settings, though some features may not function without them.',
        },
      ],
    },
    {
      number: '09',
      title: 'Children’s Privacy',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The Service is not directed to children under 13 (or the minimum age required in your jurisdiction). We do not knowingly collect information from children. If you believe a child has provided us information, contact us and we will delete it.',
        },
      ],
    },
    {
      number: '10',
      title: 'Changes to This Policy',
      blocks: [
        {
          kind: 'paragraph',
          text: 'We may update this Policy from time to time. Material changes will be posted on this page with a revised effective date. Your continued use of the Service after changes take effect constitutes acceptance.',
        },
      ],
    },
    {
      number: '11',
      title: 'Contact Us',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Questions about this Policy or your data? Contact us at alethicaldev@gmail.com.',
        },
        {
          kind: 'paragraph',
          text: 'Alethical, LLC — a Minnesota limited liability company. 29308 Crow Cir, Breezy Point, MN 56472, USA.',
        },
      ],
    },
  ],
};

const termsContent: LegalDocumentContent = {
  title: 'Terms of Service',
  meta: 'Effective date: June 16, 2026 · Last updated: June 16, 2026',
  sections: [
    {
      blocks: [
        {
          kind: 'paragraph',
          text: 'These Terms of Service (“Terms”) govern your access to and use of the website and application provided by Alethical, LLC (“Alethical,” “we,” “us,” or “our”) (the “Service”). By accessing or using the Service, you agree to be bound by these Terms. If you do not agree, do not use the Service.',
        },
      ],
    },
    {
      number: '01',
      title: 'Eligibility',
      blocks: [
        {
          kind: 'paragraph',
          text: 'You must be at least 13 years old (or the minimum age of digital consent in your jurisdiction) and able to form a binding contract to use the Service. By using it, you represent that you meet these requirements.',
        },
      ],
    },
    {
      number: '02',
      title: 'Accounts',
      blocks: [
        {
          kind: 'paragraph',
          text: 'You access the Service by signing in with your Google Account. You are responsible for the activity that occurs under your account and for maintaining the security of the credentials you use to sign in. Notify us promptly of any unauthorized use.',
        },
      ],
    },
    {
      number: '03',
      title: 'Acceptable Use',
      blocks: [
        {
          kind: 'paragraph',
          text: 'You agree not to:',
        },
        {
          kind: 'list',
          items: [
            'Use the Service for any unlawful, harmful, or fraudulent purpose.',
            'Attempt to gain unauthorized access to the Service, other accounts, or our systems.',
            'Interfere with or disrupt the integrity or performance of the Service.',
            'Reverse engineer, copy, or resell any part of the Service except as permitted by law.',
          ],
        },
      ],
    },
    {
      number: '04',
      title: 'Intellectual Property',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The Service, including its software, design, and content, is owned by Alethical and protected by intellectual property laws. We grant you a limited, non-exclusive, non-transferable license to use the Service for its intended purpose. All rights not expressly granted are reserved.',
        },
      ],
    },
    {
      number: '05',
      title: 'Third-Party Services',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The Service relies on third-party providers, including Google and Supabase. Your use of those services is also subject to their respective terms and privacy policies. We are not responsible for third-party services.',
        },
      ],
    },
    {
      number: '06',
      title: 'Disclaimer of Warranties',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The Service is provided “as is” and “as available” without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the Service will be uninterrupted, secure, or error-free.',
        },
      ],
    },
    {
      number: '07',
      title: 'Limitation of Liability',
      blocks: [
        {
          kind: 'paragraph',
          text: 'To the maximum extent permitted by law, Alethical will not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of data, use, or profits, arising from your use of the Service. Our total liability for any claim will not exceed the amount you paid us, if any, in the twelve months preceding the claim.',
        },
      ],
    },
    {
      number: '08',
      title: 'Indemnification',
      blocks: [
        {
          kind: 'paragraph',
          text: 'You agree to indemnify and hold Alethical harmless from any claims, losses, or expenses arising from your use of the Service or your violation of these Terms.',
        },
      ],
    },
    {
      number: '09',
      title: 'Termination',
      blocks: [
        {
          kind: 'paragraph',
          text: 'We may suspend or terminate your access to the Service at any time if you violate these Terms or for any other reason at our discretion. You may stop using the Service at any time. Provisions that by their nature should survive termination will survive.',
        },
      ],
    },
    {
      number: '10',
      title: 'Governing Law',
      blocks: [
        {
          kind: 'paragraph',
          text: 'These Terms are governed by the laws of the State of Minnesota, without regard to its conflict-of-laws rules. Any disputes will be resolved exclusively in the state or federal courts located in Minnesota.',
        },
      ],
    },
    {
      number: '11',
      title: 'Changes to These Terms',
      blocks: [
        {
          kind: 'paragraph',
          text: 'We may update these Terms from time to time. Material changes will be posted on this page with a revised effective date. Your continued use of the Service after changes take effect constitutes acceptance.',
        },
      ],
    },
    {
      number: '12',
      title: 'Contact Us',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Questions about these Terms? Contact us at alethicaldev@gmail.com.',
        },
      ],
    },
  ],
};

function LegalDocument({ content }: { content: LegalDocumentContent }) {
  return (
    <ScreenView hideHeader>
      <View style={styles.document}>
        <Text style={styles.eyebrow}>Legal</Text>
        <Text style={styles.title}>{content.title}</Text>
        <Text style={styles.meta}>{content.meta}</Text>

        {content.sections.map((section, sectionIndex) => (
          <View key={`${section.title ?? 'intro'}-${sectionIndex}`} style={styles.section}>
            {section.title ? (
              <View style={styles.sectionHeading}>
                {section.number ? <Text style={styles.sectionNumber}>{section.number}</Text> : null}
                <Text style={styles.sectionTitle}>{section.title}</Text>
              </View>
            ) : null}
            {section.blocks.map((block, blockIndex) => (
              <LegalBlockView key={`${block.kind}-${blockIndex}`} block={block} />
            ))}
          </View>
        ))}

        <Text style={styles.footer}>© Alethical. All rights reserved.</Text>
      </View>
    </ScreenView>
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
  document: {
    maxWidth: 860,
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
  footer: {
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.body,
    fontSize: 14,
    lineHeight: 22,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.lg,
  },
});
