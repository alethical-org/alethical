import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import { useResponsive } from '../../hooks/useResponsive';
import { eventIndexBySlug } from '../../lib/eventsIndex';

import {
  HOME_PUBLIC_BILLS_HEADING,
  HOME_PUBLIC_BILLS_BODY,
  HOME_PUBLIC_SERVICES_HEADING,
  HOME_PUBLIC_SERVICES_BODY,
  HOME_PUBLIC_SERVICES_CTA,
} from '../../lib/homepage';
import { linkProps, routePath } from '../../navigation/links';
import { theme as t, prefersReducedMotion } from '../../theme/tokens';
import { LinkArrow } from '../LinkArrow';
import { isWeb, useFineHover } from '../billDetail/interactions';

const event = eventIndexBySlug('forward-debate-2026');
const replayPath = event ? `/blog/events/${event.slug}` : '';

function Action({
  label,
  phone,
  hovered,
  paid = false,
  play = false,
}: {
  label: string;
  phone: boolean;
  hovered: boolean;
  paid?: boolean;
  play?: boolean;
}) {
  return (
    <View
      style={[
        s.button,
        phone && s.buttonPhone,
        phone &&
          (play
            ? { paddingLeft: 9, paddingRight: 12 }
            : paid
              ? { paddingHorizontal: 6 }
              : { paddingLeft: 16, paddingRight: 13 }),
        paid && s.paid,
        hovered && (paid ? s.paidHover : s.buttonHover),
      ]}
    >
      {play && (
        <Svg width={phone ? 17 : 16} height={phone ? 17 : 16} viewBox="0 0 24 24" aria-hidden>
          <Path d="M7 4.5v15l12.5-7.5z" fill="#0f7a45" />
        </Svg>
      )}
      <Text style={[s.buttonLabel, phone && { fontSize: 19 }, paid && { color: '#fff' }]}>
        {label}
      </Text>
      {!play &&
        (paid ? (
          <Text aria-hidden style={{ color: '#fff', fontSize: phone ? 19 : 17 }}>
            →
          </Text>
        ) : (
          <LinkArrow color="#0f7a45" />
        ))}
    </View>
  );
}

function BillLink({ legislators = false, phone }: { legislators?: boolean; phone: boolean }) {
  const navigation = useNavigation<any>();
  const [hovered, hover] = useFineHover();
  return (
    <Pressable
      {...linkProps(legislators ? routePath.legislators() : routePath.bills(), () =>
        navigation.navigate(legislators ? 'Legislators' : 'Bills'),
      )}
      {...hover}
      style={phone ? { alignSelf: 'stretch', width: '100%' } : { alignSelf: 'flex-start' }}
    >
      <Action
        label={legislators ? 'Search legislators' : 'Search bills'}
        phone={phone}
        hovered={!phone && hovered}
      />
    </Pressable>
  );
}

/** Source order changes with the approved reading order; grid placement never changes Tab order. */
export function HomeFeatureCards({ servicesReady }: { servicesReady: boolean }) {
  const navigation = useNavigation<any>();
  const { isMobile: phone, isTablet: tablet, isDesktop: desktop } = useResponsive();
  const [debateHovered, debateHover] = useFineHover();
  const [servicesHovered, servicesHover] = useFineHover();
  const card = [s.card, phone ? s.phone : tablet ? s.tablet : undefined];
  const heading = [
    s.heading,
    { fontSize: phone ? 28 : tablet ? 26 : 30, lineHeight: phone ? 31 : tablet ? 30 : 34 },
  ];
  const body = [s.body, phone && { fontSize: 21, lineHeight: 31.5 }];
  const interactive = (hovered: boolean) => [
    isWeb && !prefersReducedMotion()
      ? ({
          transitionProperty: 'border-color, box-shadow, transform',
          transitionDuration: '0.16s',
          transitionTimingFunction: 'ease',
        } as object)
      : {},
    !phone && hovered && s.cardHover,
    !phone && hovered && !prefersReducedMotion() && { transform: [{ translateY: -3 }] },
  ];
  const legislature = (
    <View
      key="legislature"
      testID="home-legislature"
      style={[...card, desktop && ({ gridColumn: 1, gridRow: 1 } as object)]}
    >
      <Text accessibilityRole="header" aria-level={2} style={heading}>
        {HOME_PUBLIC_BILLS_HEADING}
      </Text>
      <Text style={body}>{HOME_PUBLIC_BILLS_BODY}</Text>
      <View
        style={[
          s.billActions,
          phone && { flexDirection: 'column', alignItems: 'stretch', paddingTop: 24 },
        ]}
      >
        <BillLink phone={phone} />
        <BillLink phone={phone} legislators />
      </View>
    </View>
  );
  const photo = event && (
    <View style={[s.photo, desktop ? s.photoDesktop : tablet ? s.photoTablet : s.photoPhone]}>
      {desktop ? (
        <View style={s.desktopCrop}>
          <img src={event.homePhotos.desktop} alt="" style={imageStyle} />
        </View>
      ) : (
        <img
          src={event.homePhotos.narrow}
          alt=""
          style={{ ...imageStyle, top: '50%', marginTop: '-48.28%' }}
        />
      )}
    </View>
  );
  const details = event && (
    <Text style={[s.details, phone && { fontSize: 21, lineHeight: 31.5 }]}>
      <Text style={desktop ? ({ display: 'inline-block', maxWidth: '100%' } as object) : undefined}>
        {event.district}
        {desktop ? ' ·' : ''}
      </Text>
      {desktop ? ' ' : '\n'}
      {!desktop && (
        <Text style={{ display: 'inline-block', maxWidth: '100%' } as object}>
          Hosted by Alethical ·
        </Text>
      )}
      {!desktop && ' '}
      <Text style={{ display: 'inline-block', maxWidth: '100%' } as object}>
        {event.dateLabel.replace(/^\w+, /, '')}
      </Text>
    </Text>
  );
  const watch = (
    <View style={[s.action, phone && { paddingTop: 24 }]}>
      <Action label="Watch the debate" phone={phone} hovered={!phone && debateHovered} play />
    </View>
  );
  const title = event && (
    <Text
      accessibilityRole="header"
      aria-level={2}
      style={[heading, desktop && ({ display: 'inline-block', maxWidth: '100%' } as object)]}
    >
      {event.title}
    </Text>
  );
  const debate = event ? (
    <Pressable
      key="debate"
      testID="home-debate"
      {...linkProps(replayPath, () => navigation.navigate('Event', { slug: event.slug }))}
      {...debateHover}
      style={[
        ...card,
        ...interactive(debateHovered),
        desktop && ({ gridColumn: 2, gridRow: '1 / span 2' } as object),
        tablet && ({ gridColumn: '1 / -1', flexDirection: 'row', gap: 28 } as object),
      ]}
    >
      {tablet ? (
        <>
          <View style={{ flex: 48, minWidth: 0 }}>
            {title}
            {details}
            {watch}
          </View>
          {photo}
        </>
      ) : (
        <>
          <View style={s.titleRow}>
            {title}
            {desktop && <Text style={s.host}>Hosted by Alethical</Text>}
          </View>
          {photo}
          {details}
          {watch}
        </>
      )}
    </Pressable>
  ) : null;
  const services = servicesReady ? (
    <Pressable
      key="services"
      testID="home-services"
      {...linkProps(routePath.services(), () => navigation.navigate('Services'))}
      {...servicesHover}
      style={[
        ...card,
        ...interactive(servicesHovered),
        desktop && ({ gridColumn: 1, gridRow: 2 } as object),
      ]}
    >
      <Text accessibilityRole="header" aria-level={2} style={heading}>
        {HOME_PUBLIC_SERVICES_HEADING}
      </Text>
      <Text style={body}>{HOME_PUBLIC_SERVICES_BODY}</Text>
      <View style={[s.action, phone && { paddingTop: 24 }]}>
        <Action
          label={HOME_PUBLIC_SERVICES_CTA}
          phone={phone}
          hovered={!phone && servicesHovered}
          paid
        />
      </View>
    </Pressable>
  ) : null;
  return (
    <View
      testID="home-feature-cards"
      style={[
        s.grid,
        desktop && ({ gridTemplateColumns: 'minmax(0,48fr) minmax(0,52fr)' } as object),
        tablet && ({ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' } as object),
        phone && { display: 'flex', flexDirection: 'column' },
      ]}
    >
      {desktop
        ? [legislature, debate, services]
        : phone
          ? [debate, services, legislature]
          : [debate, legislature, services]}
    </View>
  );
}

const imageStyle = {
  position: 'absolute',
  left: '-41.38%',
  top: 0,
  display: 'block',
  width: '182.9%',
  maxWidth: 'none',
  height: 'auto',
} as const;
const s = StyleSheet.create({
  grid: { display: 'grid', gap: 24 } as object,
  card: {
    minWidth: 0,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.08)',
    borderRadius: 20,
    paddingTop: 34,
    paddingHorizontal: 32,
    paddingBottom: 32,
    boxShadow: '0 18px 44px rgba(17,21,15,0.08)',
  },
  tablet: { paddingTop: 30, paddingHorizontal: 28, paddingBottom: 28 },
  phone: {
    paddingTop: 26,
    paddingHorizontal: 24,
    paddingBottom: 28,
    borderColor: 'rgba(17,21,15,0.10)',
    boxShadow: '0 10px 28px rgba(17,21,15,0.07)',
  },
  heading: {
    fontFamily: t.typography.title,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: '#11150f',
  },
  body: {
    marginTop: 14,
    fontFamily: t.typography.body,
    fontSize: 18,
    lineHeight: 28,
    color: '#4f5651',
    maxWidth: 680,
    ...({ textWrap: 'pretty' } as object),
  },
  billActions: {
    marginTop: 'auto',
    paddingTop: 28,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    columnGap: 16,
    rowGap: 12,
  },
  action: { marginTop: 'auto', paddingTop: 28 },
  cardHover: { borderColor: 'rgba(45,212,126,0.85)', boxShadow: '0 22px 46px rgba(17,21,15,0.14)' },
  button: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.16)',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  buttonPhone: {
    alignSelf: 'stretch',
    minHeight: 56,
    paddingVertical: 15,
    paddingHorizontal: 20,
    width: '100%',
    borderRadius: 14,
  },
  buttonLabel: {
    fontFamily: t.typography.ui,
    fontSize: 17,
    fontWeight: '700',
    color: '#11150f',
  },
  paid: { backgroundColor: '#11150f', borderColor: '#11150f' },
  buttonHover: { backgroundColor: '#f7f8fa', borderColor: 'rgba(17,21,15,0.3)' },
  paidHover: { backgroundColor: '#3a423b', borderColor: '#3a423b' },
  titleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 14,
    rowGap: 6,
    alignItems: 'baseline',
  },
  host: {
    fontFamily: t.typography.body,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    color: '#4f5651',
  },
  details: {
    marginTop: 16,
    fontFamily: t.typography.body,
    fontSize: 18,
    lineHeight: 28,
    color: '#4f5651',
    fontVariant: ['tabular-nums'],
  },
  photo: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: '#dfe3e0',
    minWidth: 0,
  },
  photoDesktop: { marginTop: 20, flex: 1, minHeight: 281 },
  desktopCrop: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: '100%',
    height: 0,
    minHeight: '100%',
    paddingTop: '68.15%',
    boxSizing: 'border-box',
  } as object,
  photoTablet: { flex: 52, aspectRatio: '16 / 9' as any, alignSelf: 'stretch' },
  photoPhone: { marginTop: 20, aspectRatio: 3 / 2 },
});
