import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useResponsive } from '../../hooks/useResponsive';
import {
  SERVICES_AUDIENCES,
  SERVICES_CANDIDATE_NAMES,
  SERVICES_COALITION_URL,
  SERVICES_CONTACT_EMAIL,
  SERVICES_CONTACT_HREF,
  SERVICES_DELIVERY_INTRO,
  SERVICES_EARLY_HEADING,
  SERVICES_EARLY_INTRO,
  SERVICES_GROUPS,
  SERVICES_PARTNER_GROUPS,
  SERVICES_PARTNER_INTRO,
  SERVICES_PRICING,
  SERVICES_SUBTITLE,
  SERVICES_TOOL_INTRO,
  SERVICES_TOOLS,
} from '../../lib/services';
import type { IaItem, MenuKey } from '../../navigation/ia';
import { externalLinkProps } from '../../navigation/links';
import { navigateTopNavItem } from '../../navigation/topNavRoutes';
import type { RootScreenProps } from '../../navigation/types';
import { TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';

const web = Platform.OS === 'web';
const mark = require('../../../assets/services/alethical-mark.webp');
const coalitionLogo = require('../../../assets/services/minnesota-forward-together.webp');
const clamp = (min: number, value: number, max: number) => Math.max(min, Math.min(value, max));
const webStyle = (value: object) => (web ? value : {}) as ViewStyle;
const webProps = (value: object) => (web ? value : {});

function Heading({
  children,
  level = 2,
  style,
  id,
  tabIndex,
}: {
  children: ReactNode;
  level?: number;
  style?: TextStyle;
  id?: string;
  tabIndex?: number;
}) {
  return (
    <Text
      nativeID={id}
      {...webProps({ tabIndex })}
      accessibilityRole="header"
      aria-level={level}
      style={[styles.heading, style]}
    >
      {children}
    </Text>
  );
}
function NumberLabel({ children }: { children: string }) {
  return <Text style={styles.number}>{children}</Text>;
}
function Bullets({ items }: { items: readonly string[] }) {
  return (
    <View {...webProps({ role: 'list' })} style={styles.list}>
      {items.map((item) => (
        <View key={item} {...webProps({ role: 'listitem' })} style={styles.bulletRow}>
          <View aria-hidden style={styles.bullet} />
          <Text style={styles.listText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}
function GreenButton({
  children,
  onPress,
  href,
  draft = false,
}: {
  children: string;
  onPress?: () => void;
  href?: string;
  draft?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      {...(href ? externalLinkProps(href) : { accessibilityRole: 'button' as const, onPress })}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.button,
        draft && styles.draftButton,
        hovered && styles.buttonHover,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.buttonText, draft && { fontSize: 16 }]}>{children}</Text>
    </Pressable>
  );
}
function ContactPanel({ close, mobile }: { close: () => void; mobile: boolean }) {
  const panel = useRef<View>(null);
  const [closeHovered, setCloseHovered] = useState(false);
  useEffect(() => {
    if (!web) return;
    const opener = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() =>
      document.getElementById('services-contact-heading')?.focus(),
    );
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const root = panel.current as unknown as HTMLElement | null;
      const nodes = Array.from(
        root?.querySelectorAll<HTMLElement>('a[href],button,[role="button"]') ?? [],
      );
      if (!nodes.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement?.id === 'services-contact-heading')
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', key, true);
      opener?.focus();
    };
  }, [close]);
  return (
    <Modal visible transparent animationType="none" onRequestClose={close}>
      <View style={styles.modalBackdrop}>
        <Pressable
          accessibilityLabel="Close contact panel"
          onPress={close}
          style={StyleSheet.absoluteFill}
          {...webProps({ tabIndex: -1, 'aria-hidden': true })}
        />
        <View
          ref={panel}
          nativeID="services-contact-panel"
          style={styles.modalPanel}
          {...webProps({
            role: 'dialog',
            'aria-modal': true,
            'aria-labelledby': 'services-contact-heading',
            'aria-describedby': 'services-contact-description',
          })}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={close}
            onHoverIn={() => setCloseHovered(true)}
            onHoverOut={() => setCloseHovered(false)}
            style={[
              styles.close,
              { top: mobile ? 22 : 20, right: mobile ? 22 : 20 },
              closeHovered && styles.closeHover,
            ]}
          >
            <Svg width={18} height={18} viewBox="0 0 18 18" aria-hidden>
              <Path d="M1 1L17 17M17 1L1 17" stroke="#ECECEC" strokeWidth={2} />
            </Svg>
          </Pressable>
          <ScrollView
            contentContainerStyle={{
              paddingTop: 28,
              paddingHorizontal: mobile ? 22 : 32,
              paddingBottom: mobile ? 22 : 32,
            }}
          >
            <Heading
              id="services-contact-heading"
              style={styles.modalTitle}
              {...webProps({ tabIndex: -1 })}
            >
              Contact Us
            </Heading>
            <Text
              nativeID="services-contact-description"
              style={[styles.body, { color: '#c4c4c4', marginTop: 18 }]}
            >
              Tell Alethical about your organization or campaign and the support you’re looking for
            </Text>
            <View style={styles.contactAddress}>
              <Text style={styles.contactLabel}>CONTACT</Text>
              <Text style={styles.email}>{SERVICES_CONTACT_EMAIL}</Text>
            </View>
            <View style={{ alignItems: 'flex-start', marginTop: 24 }}>
              <GreenButton draft href={SERVICES_CONTACT_HREF}>
                Open email draft
              </GreenButton>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function ServicesScreen({ navigation }: RootScreenProps<'Services'>) {
  const { width, isMobile, isDesktop } = useResponsive();
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [audience, setAudience] = useState(0);
  const [hoveredAudience, setHoveredAudience] = useState<number | null>(null);
  const [dialog, setDialog] = useState(false);
  const closeDialog = useRef(() => setDialog(false)).current;
  const [coalitionHovered, setCoalitionHovered] = useState(false);
  const [logoHovered, setLogoHovered] = useState(false);
  const [hoveredSection, setHoveredSection] = useState<string | null>(null);
  const selectedAudience = SERVICES_AUDIENCES[audience];
  const horizontal = clamp(16, width * 0.04, 48);
  const inner = Math.min(width, 1240) - horizontal * 2;
  const gap = isDesktop ? 64 : 36;
  const leftWidth = isDesktop ? ((inner - 64) * 5) / 12 : inner;
  const markWidth = isDesktop ? 232 : 156;
  const heroGap = isDesktop ? 96 : 48;
  const heroTextWidth = isMobile ? inner : inner - markWidth - heroGap;
  const sideWidth: ViewStyle = { width: leftWidth };
  const contentsWidth: ViewStyle = { width: isDesktop ? ((inner - 64) * 7) / 12 : inner };
  const sectionPad = clamp(64, width * 0.09, 120);
  const container: ViewStyle = {
    width: '100%',
    maxWidth: 1240,
    alignSelf: 'center',
    paddingHorizontal: horizontal,
    paddingVertical: sectionPad,
  };
  const split: ViewStyle = { flexDirection: isDesktop ? 'row' : 'column', gap };
  const sticky = webStyle(isDesktop ? { position: 'sticky', top: 92 } : {});
  const headingSize = clamp(30, width * 0.036, 46);
  const hStyle: TextStyle = {
    fontSize: headingSize,
    lineHeight: headingSize * 1.1,
    letterSpacing: headingSize * -0.03,
  };
  const jump = (id: string) => {
    if (web)
      document.getElementById(id)?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
  };
  useEffect(() => {
    if (!web) return;
    const style = document.createElement('style');
    style.textContent =
      '#services-page :focus-visible,#services-contact-panel :focus-visible{outline:2px solid #7C5CFF;outline-offset:2px} #services-page :focus:not(:focus-visible),#services-contact-panel :focus:not(:focus-visible){outline:none} #services-page ::selection{background:#35C46B;color:#06231a}';
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
  const handleNavigate = (item: IaItem) => {
    if (navigateTopNavItem(navigation, item)) setOpenMenu(null);
  };
  return (
    <View style={styles.root}>
      <View style={{ backgroundColor: t.colors.surfaces.s200, zIndex: 60 }}>
        <TopNav
          openMenu={openMenu}
          onOpenMenuChange={setOpenMenu}
          onNavigate={handleNavigate}
          onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
        />
      </View>
      <ScrollView nativeID="services-page" style={styles.root} stickyHeaderIndices={[0]}>
        <View style={styles.sectionNav}>
          <View
            style={[
              styles.sectionNavInner,
              { paddingHorizontal: horizontal, gap: isMobile ? 0 : 30 },
              isMobile && { flexDirection: 'column', alignItems: 'stretch', paddingVertical: 0 },
            ]}
          >
            {isMobile && (
              <View style={{ minHeight: 64, alignItems: 'flex-end', justifyContent: 'center' }}>
                <GreenButton onPress={() => setDialog(true)}>Contact Us</GreenButton>
              </View>
            )}
            <View
              style={{
                flexDirection: 'row',
                gap: isMobile ? 16 : 30,
                flexWrap: 'wrap',
                flex: isMobile ? undefined : 1,
              }}
              {...webProps({ role: 'navigation', 'aria-label': 'Services sections' })}
            >
              {[
                ['services-offering', 'Services'],
                ['partners', 'Partners'],
                ['early-work', 'Early work'],
              ].map(([id, label]) => (
                <Pressable
                  key={id}
                  {...webProps({ href: `#${id}` })}
                  accessibilityRole="link"
                  onPress={(event) => {
                    event.preventDefault();
                    jump(id);
                  }}
                  onHoverIn={() => setHoveredSection(id)}
                  onHoverOut={() => setHoveredSection(null)}
                  style={{ minHeight: 44, justifyContent: 'center' }}
                >
                  <Text
                    style={[
                      styles.sectionLink,
                      hoveredSection === id && { color: '#fff', textDecorationLine: 'underline' },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {!isMobile && <GreenButton onPress={() => setDialog(true)}>Contact Us</GreenButton>}
          </View>
        </View>
        <View {...webProps({ role: 'main' })}>
          <View
            style={[
              container,
              {
                paddingTop: clamp(48, width * 0.08, 112),
                paddingBottom: clamp(48, width * 0.052, 72),
                flexDirection: isMobile ? 'column' : 'row',
                gap: heroGap,
                alignItems: 'center',
              },
            ]}
          >
            <View style={{ width: heroTextWidth }}>
              {isMobile && (
                <Image
                  source={mark}
                  accessibilityIgnoresInvertColors
                  aria-hidden
                  style={{ width: 52, height: 53, marginBottom: 24 }}
                />
              )}
              <Text style={styles.eyebrow}>FOR ORGANIZATIONS AND CAMPAIGNS</Text>
              <Heading
                level={1}
                style={{
                  fontSize: clamp(40, heroTextWidth * 0.083, 84),
                  lineHeight: clamp(40, heroTextWidth * 0.083, 84) * 0.98,
                  letterSpacing: clamp(40, heroTextWidth * 0.083, 84) * -0.045,
                  fontWeight: '300',
                  marginTop: 22,
                }}
              >
                {'Political intelligence.\n'}
                <Text style={{ color: '#35C46B' }}>Practical campaign support.</Text>
              </Heading>
              <Text
                style={[
                  styles.heroBody,
                  {
                    fontSize: clamp(21, width * 0.023, 28),
                    lineHeight: clamp(21, width * 0.023, 28) * 1.35,
                  },
                ]}
              >
                {SERVICES_SUBTITLE}
              </Text>
              <Text
                style={[
                  styles.body,
                  { marginTop: 18, ...webStyle({ maxWidth: '56ch', textWrap: 'pretty' }) },
                ]}
              >
                {SERVICES_PARTNER_INTRO}
              </Text>
            </View>
            {!isMobile && (
              <Image
                source={mark}
                aria-hidden
                style={{ width: markWidth, height: markWidth * 1.02 }}
              />
            )}
          </View>
          <View style={styles.section}>
            <View style={[container, split]}>
              <View style={sideWidth}>
                <View style={sticky}>
                  <Heading style={hStyle}>
                    Support for an organization. A starting point for a campaign.
                  </Heading>
                </View>
              </View>
              <View style={contentsWidth}>
                <View
                  {...webProps({
                    role: 'tablist',
                    'aria-label': 'Who the support is for',
                    onKeyDown: (event: KeyboardEvent) => {
                      let index: number | null = null;
                      if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key))
                        index = 1 - audience;
                      else if (event.key === 'Home') index = 0;
                      else if (event.key === 'End') index = 1;
                      if (index === null) return;
                      event.preventDefault();
                      setAudience(index);
                      document.getElementById(`services-audience-${index}`)?.focus();
                    },
                  })}
                  style={{ flexDirection: isMobile ? 'column' : 'row', gap: 12 }}
                >
                  {SERVICES_AUDIENCES.map((item, index) => (
                    <Pressable
                      key={item.title}
                      nativeID={`services-audience-${index}`}
                      accessibilityRole="tab"
                      {...webProps({
                        tabIndex: audience === index ? 0 : -1,
                        'aria-controls': 'services-audience-panel',
                        'aria-selected': audience === index,
                      })}
                      onPress={() => setAudience(index)}
                      onHoverIn={() => setHoveredAudience(index)}
                      onHoverOut={() => setHoveredAudience(null)}
                      style={[
                        styles.audience,
                        { flex: isMobile ? undefined : 1 },
                        audience === index && styles.audienceSelected,
                        hoveredAudience === index &&
                          (audience === index
                            ? styles.audienceSelectedHover
                            : styles.audienceHover),
                      ]}
                    >
                      <Text style={styles.audienceTitle}>{item.title}</Text>
                      <Text style={styles.audienceBody}>{item.text}</Text>
                    </Pressable>
                  ))}
                </View>
                <View
                  nativeID="services-audience-panel"
                  {...webProps({
                    role: 'tabpanel',
                    'aria-labelledby': `services-audience-${audience}`,
                  })}
                  style={{ marginTop: 36, borderBottomWidth: 1, borderColor: '#262626' }}
                >
                  {selectedAudience.examples.map((item) => (
                    <Text
                      key={item}
                      style={[styles.example, { fontSize: clamp(20, width * 0.02, 24) }]}
                    >
                      {item}
                    </Text>
                  ))}
                </View>
              </View>
            </View>
          </View>
          <View
            nativeID="services-offering"
            style={[styles.section, webStyle({ scrollMarginTop: isMobile ? 124 : 92 })]}
          >
            <View style={[container, split]}>
              <View style={sideWidth}>
                <View style={sticky}>
                  <NumberLabel>01</NumberLabel>
                  <Heading style={hStyle}>From research to practical support.</Heading>
                </View>
              </View>
              <View style={[contentsWidth, styles.bottomRule]}>
                {SERVICES_GROUPS.map((group) => (
                  <View
                    key={group.title}
                    style={[styles.serviceRow, { flexDirection: isMobile ? 'column' : 'row' }]}
                  >
                    <View style={{ flex: isMobile ? undefined : 1 }}>
                      <Heading level={3} style={styles.serviceTitle}>
                        {group.title}
                      </Heading>
                      <Text style={[styles.body, { marginTop: 10, lineHeight: 25.5 }]}>
                        {group.line}
                      </Text>
                    </View>
                    <View style={{ flex: isMobile ? undefined : 1, paddingTop: 6 }}>
                      <Bullets items={group.examples} />
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </View>
          <View style={styles.section}>
            <View style={container}>
              <NumberLabel>02</NumberLabel>
              <View
                style={[
                  styles.development,
                  {
                    padding: isDesktop ? 52 : isMobile ? 22 : 40,
                    paddingHorizontal: isDesktop ? 56 : isMobile ? 22 : 40,
                  },
                ]}
              >
                <View
                  style={{
                    flexDirection: isDesktop ? 'row' : 'column',
                    gap: isDesktop ? 64 : 24,
                    alignItems: isDesktop ? 'flex-end' : 'stretch',
                  }}
                >
                  <View style={{ flex: isDesktop ? 7 : undefined }}>
                    <View style={styles.developmentPill}>
                      <View aria-hidden style={styles.statusDot} />
                      <Text style={styles.developmentLabel}>IN DEVELOPMENT</Text>
                    </View>
                    <Heading style={{ ...hStyle, marginTop: 22 }}>
                      Tools built around the way your team works.
                    </Heading>
                  </View>
                  <Text style={[styles.body, { flex: isDesktop ? 5 : undefined }]}>
                    {SERVICES_TOOL_INTRO}
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    columnGap: 32,
                    rowGap: 24,
                    marginTop: 52,
                  }}
                >
                  {SERVICES_TOOLS.map((item) => (
                    <View
                      key={item.title}
                      style={[
                        styles.tool,
                        {
                          width: isMobile
                            ? '100%'
                            : isDesktop
                              ? (inner - 114 - 96) / 4
                              : (inner - 82 - 32) / 2,
                        },
                      ]}
                    >
                      <Heading level={3} style={styles.toolTitle}>
                        {item.title}
                      </Heading>
                      <Text style={[styles.body, { marginTop: 8, fontSize: 15.5, lineHeight: 24 }]}>
                        {item.text}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          </View>
          <View
            nativeID="partners"
            style={[styles.section, webStyle({ scrollMarginTop: isMobile ? 124 : 92 })]}
          >
            <View style={[container, split]}>
              <View style={sideWidth}>
                <View style={sticky}>
                  <NumberLabel>03</NumberLabel>
                  <Heading style={hStyle}>Specialist support, connected to your campaign.</Heading>
                  <Text style={[styles.body, { marginTop: 20, maxWidth: 420 }]}>
                    Explore a broader range of campaign services through Alethical’s partner
                    marketplace.
                  </Text>
                </View>
              </View>
              <View style={[contentsWidth, styles.bottomRule]}>
                {SERVICES_PARTNER_GROUPS.map((group) => (
                  <View key={group.name} style={styles.partnerRow}>
                    <Heading level={3} style={styles.serviceTitle}>
                      {group.name}
                    </Heading>
                    <View style={{ marginTop: 20 }}>
                      <Bullets items={group.items} />
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </View>
          <View
            nativeID="early-work"
            style={[styles.section, webStyle({ scrollMarginTop: isMobile ? 124 : 92 })]}
          >
            <View style={[container, split]}>
              <View style={sideWidth}>
                <View style={sticky}>
                  <NumberLabel>04</NumberLabel>
                  <Heading style={hStyle}>{SERVICES_EARLY_HEADING}</Heading>
                  <Text style={[styles.body, { marginTop: 20, maxWidth: 420 }]}>
                    {SERVICES_EARLY_INTRO}
                  </Text>
                </View>
              </View>
              <View style={[contentsWidth, styles.work]}>
                <Text
                  style={[
                    styles.workText,
                    {
                      fontSize: clamp(22, width * 0.023, 30),
                      lineHeight: clamp(22, width * 0.023, 30) * 1.4,
                    },
                  ]}
                >
                  {'We’ve supported '}
                  <Text
                    {...externalLinkProps(SERVICES_COALITION_URL)}
                    onPress={undefined}
                    {...webProps({
                      onMouseEnter: () => setCoalitionHovered(true),
                      onMouseLeave: () => setCoalitionHovered(false),
                    })}
                    style={[styles.coalitionLink, coalitionHovered && { color: '#35C46B' }]}
                  >
                    Minnesota Forward Coalition
                  </Text>
                  {' candidates including '}
                  {SERVICES_CANDIDATE_NAMES.map((name, index) => (
                    <Text key={name}>
                      <Text style={{ color: '#ECECEC' }}>{name}</Text>
                      {index < SERVICES_CANDIDATE_NAMES.length - 2
                        ? ', '
                        : index === SERVICES_CANDIDATE_NAMES.length - 2
                          ? ', and '
                          : ''}
                    </Text>
                  ))}
                </Text>
                <Pressable
                  {...externalLinkProps(SERVICES_COALITION_URL)}
                  accessibilityLabel="Minnesota Forward Coalition candidates"
                  onHoverIn={() => setLogoHovered(true)}
                  onHoverOut={() => setLogoHovered(false)}
                  style={[styles.coalitionTile, logoHovered && styles.coalitionTileHover]}
                >
                  <Image
                    source={coalitionLogo}
                    aria-hidden
                    style={{ width: 200, height: 61 }}
                    resizeMode="contain"
                  />
                </Pressable>
              </View>
            </View>
          </View>
          <View style={[styles.section, { backgroundColor: '#0d1510' }]}>
            <View
              style={[
                container,
                {
                  paddingVertical: clamp(72, width * 0.1, 136),
                  flexDirection: isMobile ? 'column' : 'row',
                  gap: isMobile ? 40 : 64,
                  alignItems: 'center',
                },
              ]}
            >
              <View style={{ width: isMobile ? inner : inner - (isDesktop ? 300 : 200) - 64 }}>
                <NumberLabel>05</NumberLabel>
                <Heading
                  style={{
                    fontSize: clamp(
                      30,
                      (isMobile ? inner : inner - (isDesktop ? 300 : 200) - 64) * 0.11,
                      84,
                    ),
                    fontWeight: '400',
                    lineHeight: clamp(
                      30,
                      (isMobile ? inner : inner - (isDesktop ? 300 : 200) - 64) * 0.11,
                      84,
                    ),
                    letterSpacing: -1.2,
                    ...webStyle({ whiteSpace: 'nowrap' }),
                  }}
                >
                  Delivery and pricing
                </Heading>
                <Text
                  style={[
                    styles.body,
                    {
                      fontSize: clamp(18, width * 0.017, 21),
                      lineHeight: clamp(18, width * 0.017, 21) * 1.55,
                      color: '#d4d4d4',
                      marginTop: 28,
                    },
                  ]}
                >
                  {SERVICES_DELIVERY_INTRO}
                </Text>
                <Text style={styles.pricing}>{SERVICES_PRICING}</Text>
              </View>
              {!isMobile && (
                <View style={{ width: isDesktop ? 300 : 200, alignItems: 'flex-end' }}>
                  <Image
                    source={mark}
                    aria-hidden
                    style={{ width: markWidth, height: markWidth * 1.02 }}
                  />
                </View>
              )}
            </View>
          </View>
        </View>
      </ScrollView>
      {dialog && <ContactPanel close={closeDialog} mobile={isMobile} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A0A' },
  sectionNav: {
    backgroundColor: '#0A0A0A',
    borderBottomWidth: 1,
    borderColor: '#1c1c1c',
    zIndex: 5,
  },
  sectionNavInner: {
    width: '100%',
    maxWidth: 1240,
    alignSelf: 'center',
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  sectionLink: { color: '#c4c4c4', fontFamily: t.typography.ui, fontSize: 15, fontWeight: '500' },
  heading: { fontFamily: t.typography.title, color: '#ECECEC', fontWeight: '500' },
  body: { fontFamily: t.typography.body, color: '#b3b3b3', fontSize: 17, lineHeight: 28 },
  heroBody: {
    fontFamily: t.typography.body,
    color: '#ECECEC',
    marginTop: 40,
    ...webStyle({ maxWidth: '34ch', textWrap: 'pretty' }),
    letterSpacing: -0.28,
  },
  eyebrow: {
    fontFamily: t.typography.mono,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 2.16,
    color: '#35C46B',
    lineHeight: 19.2,
  },
  section: { borderTopWidth: 1, borderColor: '#1f1f1f' },
  number: {
    fontFamily: t.typography.ui,
    color: '#35C46B',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 20,
    ...webStyle({ fontVariantNumeric: 'tabular-nums' }),
  },
  audience: {
    backgroundColor: '#101010',
    paddingVertical: 24,
    paddingHorizontal: 26,
    paddingBottom: 26,
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 14,
    gap: 10,
    ...webStyle({ boxShadow: 'inset 0 3px 0 transparent' }),
  },
  audienceSelected: {
    backgroundColor: 'rgba(53,196,107,0.08)',
    borderColor: 'rgba(53,196,107,0.55)',
    ...webStyle({ boxShadow: 'inset 0 3px 0 #35C46B' }),
  },
  audienceHover: { backgroundColor: '#161616', borderColor: 'rgba(53,196,107,0.6)' },
  audienceSelectedHover: { backgroundColor: 'rgba(53,196,107,0.13)' },
  audienceTitle: {
    fontFamily: t.typography.ui,
    fontSize: 20,
    fontWeight: '700',
    color: '#ECECEC',
    letterSpacing: -0.2,
  },
  audienceBody: { fontFamily: t.typography.body, fontSize: 16, lineHeight: 24.8, color: '#b3b3b3' },
  example: {
    fontFamily: t.typography.body,
    color: '#ECECEC',
    paddingVertical: 20,
    borderTopWidth: 1,
    borderColor: '#262626',
    lineHeight: 31,
  },
  bottomRule: { borderBottomWidth: 1, borderColor: '#262626' },
  serviceRow: {
    borderTopWidth: 1,
    borderColor: '#262626',
    paddingTop: 32,
    paddingBottom: 34,
    gap: 40,
  },
  serviceTitle: { fontSize: 27, fontWeight: '600', letterSpacing: -0.4, lineHeight: 32.4 },
  list: { gap: 12 },
  bulletRow: { flexDirection: 'row', gap: 14, alignItems: 'baseline' },
  bullet: { width: 6, height: 6, backgroundColor: '#35C46B', flexShrink: 0 },
  listText: {
    fontFamily: t.typography.body,
    color: '#ECECEC',
    fontSize: 16,
    lineHeight: 23.2,
    flex: 1,
  },
  development: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    borderStyle: 'dashed',
    borderRadius: 20,
    backgroundColor: '#0e0e0e',
  },
  developmentPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(53,196,107,0.7)',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 13,
  },
  statusDot: { height: 7, width: 7, borderRadius: 4, backgroundColor: '#35C46B' },
  developmentLabel: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.54,
    color: '#35C46B',
  },
  tool: {
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.24)',
    paddingTop: 22,
    paddingBottom: 8,
  },
  toolTitle: { fontSize: 19, fontWeight: '700', letterSpacing: -0.19 },
  partnerRow: { borderTopWidth: 1, borderColor: '#262626', paddingTop: 32, paddingBottom: 34 },
  work: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#262626',
    paddingTop: 32,
    paddingBottom: 34,
  },
  workText: {
    fontFamily: t.typography.body,
    color: '#b3b3b3',
    maxWidth: 550,
    fontWeight: '400',
    letterSpacing: -0.45,
  },
  coalitionLink: {
    color: '#ECECEC',
    textDecorationLine: 'underline',
    ...webStyle({ textUnderlineOffset: '.18em' }),
  },
  coalitionTile: {
    marginTop: 28,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#fff',
    borderRadius: 12,
    backgroundColor: '#fff',
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  coalitionTileHover: {
    borderColor: '#35C46B',
    ...webStyle({ boxShadow: '0 0 0 2px rgba(53,196,107,0.6)' }),
  },
  pricing: {
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 26.35,
    color: '#a3a3a3',
    marginTop: 22,
    paddingTop: 20,
    borderTopWidth: 1,
    borderColor: 'rgba(53,196,107,0.3)',
  },
  button: {
    minHeight: 44,
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#35C46B',
    backgroundColor: '#35C46B',
  },
  draftButton: { minHeight: 52, paddingHorizontal: 24, borderRadius: 12 },
  buttonHover: { backgroundColor: '#2fb05f', borderColor: '#2fb05f' },
  buttonPressed: { backgroundColor: '#29a055', borderColor: '#29a055' },
  buttonText: { fontFamily: t.typography.ui, fontWeight: '700', fontSize: 15, color: '#06231a' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.74)',
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalPanel: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '100%',
    flexGrow: 0,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#2c2c2c',
    borderRadius: 18,
    ...webStyle({ boxShadow: '0 30px 80px rgba(0,0,0,0.6)' }),
  },
  modalTitle: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.56,
    lineHeight: 33.6,
    paddingRight: 64,
  },
  close: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'transparent',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  closeHover: { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.5)' },
  contactAddress: { marginTop: 24, borderTopWidth: 1, borderColor: '#262626', paddingTop: 20 },
  contactLabel: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 1.76,
    color: '#a3a3a3',
  },
  email: {
    fontFamily: t.typography.ui,
    fontSize: 20,
    fontWeight: '600',
    color: '#ECECEC',
    marginTop: 8,
  },
});
