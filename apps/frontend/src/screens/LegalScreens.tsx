import { NavigationProp, useNavigation } from '@react-navigation/native';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useResponsive } from '../hooks/useResponsive';
import { RootStackParamList } from '../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../theme/primitives';
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
  meta: 'Effective date: August 15, 2026 · Last updated: August 15, 2026',
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
          text: 'When you sign in with Google, we receive basic profile information from your Google Account, limited to what you authorize. We also keep what you do in the Service. Here is the whole list:',
        },
        {
          kind: 'list',
          items: [
            'Account information — your name, email address, and profile picture.',
            'A display name we make for you — you never type it. We take the part of your email address before the “@” and use that as your display name.',
            'Authentication data — identifiers used to create and maintain your secure session.',
            'Bills you follow — which bills you chose to follow, and any note you write on one.',
            'Alert settings — a saved switch for whether a bill you follow should alert you. We are not sending those alerts yet.',
            'Questions and messages you type in a conversation about a bill — your questions, and the answers we gave, kept with your account.',
            'Questions you type into the Ask box — we do not save these to your account, but we do send them to the AI providers named below to answer them, and they appear in the page address.',
            'Anonymous page-use totals — Vercel Web Analytics receives the page path after anything following “?” or “#” is removed. It counts page loads and makes a daily anonymous visitor estimate. It uses no analytics cookies, and we do not send your name, email address, or account identifier with a page load.',
            'Anonymous action totals — Alethical stores only a fixed action name and time when a bill or legislator search returns results, Find My Legislator returns a match, or an official Minnesota source link is opened. These records contain no search words, page paths, addresses, districts, account identifiers, referrers, or person-level activity. New bill-watch totals come from the existing watch records.',
            'Anonymous page-speed measurements — Cloudflare Web Analytics receives the page path without the question text after “?”, timing measurements, the page element or resource tied to some speed measurements, the referring website, and broad place, device, and browser facts. It uses no cookies, local storage, or fingerprinting, and Alethical publishes only sitewide speed totals after at least 50 measured visits.',
            'Contact messages — the name and phone number you choose to provide, your email address, subject, and message.',
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
            'Receive and reply to messages you send through Contact us, and send you a copy.',
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
          text: 'We request only the minimum permissions needed to sign you in and identify your account. Separately, a read-only machine account reads sitewide click and appearance totals from Google Search Console. That machine account is not connected to your Google sign-in, and Alethical does not publish search phrases, page addresses, devices, countries, or personal records from it. We do not sell Google user data or use it for advertising.',
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
            'Service providers who help us operate the Service under contractual confidentiality obligations — including Supabase (authentication and database) and Google (sign-in and sitewide Search Console totals).',
            'Vercel, which hosts our website. Its hosting request logs record the address of every page you open, including anything carried inside that address. Separately, Vercel Web Analytics receives a cleaned page path with anything following “?” or “#” removed, then counts the page load without an analytics cookie or a name.',
            'Cloudflare, which sits in front of the data service and passes those requests through. Cloudflare Web Analytics also measures page speed on the website as described above. Alethical publishes only sitewide 30-day speed scores and sample counts.',
            'Bing Webmaster Tools, which gives Alethical sitewide totals for how often pages appeared in Bing results and how many visits those results sent. Alethical does not publish search phrases, page addresses, devices, countries, or personal records from it.',
            'Checkly, which opens 3 public Alethical addresses from North Virginia every 2 minutes to confirm the website, this Site metrics page, and the data service are available. Checkly receives only those public Alethical addresses, not reader data.',
            'Railway, which runs the part of the Service that answers those requests. Its logs record the paths requested. We strip email addresses and anything carried inside a web address out of every line we write.',
            'Sentry, which alerts us when the Service or a data import fails. It receives the error type, the place in our code that failed, the software release, a route pattern with real identifiers removed, and public operating labels such as a bill number or provider name. We do not send Sentry request bodies, questions, messages, account details, log lines, or the error sentence itself.',
            'AI providers who generate answers and summaries — Anthropic and OpenAI. When you ask a question, the question text and the bill passages it is answered from are sent to them. We do not send your name, email address, or account identifier with it.',
            'The United States Census Bureau, when you look up your legislators by address. The address you type is sent to its public geocoding service to find your district. We do not store it.',
            'The Minnesota Geospatial Information Office, while we show Minnesota address suggestions and when the Census Bureau cannot match a Minnesota address. We send only the house number and street name entered so far to its public address list, not the city or ZIP. We do not store it.',
            'Resend, when you use Contact us. It receives the form fields to deliver 1 copy to Alethical’s Google Workspace inbox and 1 copy to you. The Alethical app does not store the form in its database.',
            'Legal authorities when required by law, regulation, or valid legal process.',
            'A successor entity in connection with a merger, acquisition, or sale of assets, subject to this Policy.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'One thing worth knowing about questions: when you ask one, the question is carried inside the address of the answer page, so the answer has a link you can share (for example, /ask?q=your question). That means your question can be saved in your browser history, and it can appear in the request logs of the companies that host the site. We chose the shareable link on purpose, and we would rather you read that here than discover it later.',
        },
      ],
    },
    {
      number: '05',
      title: 'Data Retention',
      blocks: [
        {
          kind: 'paragraph',
          text: 'How long we keep something depends on what it is.',
        },
        {
          kind: 'list',
          items: [
            'Your account, your name and email address, the bills you follow, the notes on them, and your alert settings — as long as your account exists.',
            'Conversations about a bill, and every message in them — no longer than 24 months after the last message in that conversation, whether or not your account is still active. Text you typed is the most sensitive thing we hold, so it does not simply live forever alongside the account.',
            'Alerts we have sent you — 90 days after we send them. An alert waiting to go out stays until it is sent.',
            'Contact us messages — we do not save them in our database at all. Copies stay in our email inbox and with the company that delivers our email, under their own terms.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'We delete or anonymize information when it is no longer required, unless a longer retention period is required by law. When we delete something, it can still sit inside our database provider’s automatic backups for a while, and it ages out on their backup schedule.',
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
          text: 'Two things you can do yourself, right now: stop following any bill, using the same Track button you used to follow it, and take away Alethical’s access to your Google Account from your Google Account permissions page.',
        },
        {
          kind: 'paragraph',
          text: 'Everything else is done by hand, and we would rather say so than pretend otherwise. There is no button yet for deleting your account, deleting a single conversation, or downloading a copy of your information. Email us at ask@alethical.com and a person will do it for you. Depending on where you live, you may also have the right to see or correct your personal information, or to withdraw consent; ask at the same address and we will handle it the same way.',
        },
      ],
    },
    {
      number: '08',
      title: 'Cookies',
      blocks: [
        {
          kind: 'paragraph',
          text: 'We use cookies and similar technologies that are necessary to keep you signed in and to operate the Service. Vercel Web Analytics uses no cookies. Cloudflare Web Analytics uses no cookies, local storage, or fingerprinting. Before Vercel analytics starts for a signed-in visit, Alethical asks its own server whether that account is on a private team list; the account identifier is not sent to Vercel. When the private team list is configured, Alethical does not start Vercel analytics for those team accounts, discards their fixed action records before storage, and leaves them out of reader and bill-watch totals. The same team list does not apply to Cloudflare page-speed measurements. You can control cookies through your browser settings, though some features may not function without them.',
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
          text: 'Questions about this Policy or your data? Contact us at ask@alethical.com.',
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
          text: 'Questions about these Terms? Contact us at ask@alethical.com.',
        },
      ],
    },
  ],
};

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
