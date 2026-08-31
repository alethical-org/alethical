import { useEffect, useReducer, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Crosshair, MapPin } from '../icons';

import {
  homeAddressDestination,
  homeFinderRequestState,
  homeLocationDestination,
  homeLocationFailureDestination,
  locationFailureFromBrowserError,
} from '../../lib/homeLegislatorFinder';
import type { HomeFinderDestination, HomeFinderLayout } from '../../lib/homeLegislatorFinder';
import { browserFillTextInputProps } from '../../theme/browserFill';
import { fieldFocusRing, fieldOutlineReset } from '../../theme/fieldFocus';
import { prefersReducedMotion, theme as t } from '../../theme/tokens';

export const HOME_FINDER_HELP_ID = 'home-finder-address-help';
export const HOME_FINDER_EXAMPLE = '350 S 5th St, Minneapolis, MN 55415';
export const HOME_FINDER_HELP =
  "Enter a full street address — a city or ZIP code alone can't identify your legislators";

type BrowserGeolocation = Pick<Geolocation, 'getCurrentPosition'>;

function browserGeolocation(): BrowserGeolocation | null {
  if (Platform.OS !== 'web') return null;
  return typeof navigator !== 'undefined' && navigator.geolocation ? navigator.geolocation : null;
}

function LocationSpinner({ reduceMotion, size }: { reduceMotion: boolean; size: 18 | 19 }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 800,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== 'web',
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, spin]);

  const glyph = (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <Circle cx={12} cy={12} r={9} stroke="#d7dbd9" strokeWidth={2.4} />
      <Path
        d="M21 12 a9 9 0 0 0 -9 -9"
        stroke={t.colors.text.secondary}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
    </Svg>
  );
  const iconStyle = [styles.locationIcon, size === 19 && styles.locationIconDesktop];
  if (reduceMotion) return <View style={iconStyle}>{glyph}</View>;
  return (
    <Animated.View
      style={[
        ...iconStyle,
        {
          transform: [
            { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
          ],
        },
      ]}
    >
      {glyph}
    </Animated.View>
  );
}

type FormProps = {
  value: string;
  focused: boolean;
  findingLocation: boolean;
  layout: HomeFinderLayout;
  reduceMotion: boolean;
  inputRef?: RefObject<TextInput | null>;
  onValueChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onFind: () => void;
  onUseLocation: () => void;
};

export function HomeLegislatorFinderForm({
  value,
  focused,
  findingLocation,
  layout,
  reduceMotion,
  inputRef,
  onValueChange,
  onFocus,
  onBlur,
  onFind,
  onUseLocation,
}: FormProps) {
  const desktop = layout === 'desktop';
  const tablet = layout === 'tablet';
  const [locationHovered, setLocationHovered] = useState(false);
  const locationLabel = findingLocation ? 'Finding your location…' : 'Use my location';
  const findButton = (
    <Pressable
      accessibilityRole="button"
      onPress={onFind}
      style={({ pressed }) => [
        styles.findButton,
        desktop && styles.findButtonDesktop,
        !desktop && styles.actionButtonNarrow,
        tablet && styles.actionButtonTablet,
        pressed && !findingLocation && styles.findButtonPressed,
      ]}
    >
      <Text style={[styles.findButtonText, !desktop && styles.findButtonTextNarrow]}>
        {desktop ? 'Find' : 'Find my legislator'}
      </Text>
    </Pressable>
  );
  const locationButton = (
    <Pressable
      accessibilityRole="button"
      aria-busy={findingLocation || undefined}
      onHoverIn={() => setLocationHovered(true)}
      onHoverOut={() => setLocationHovered(false)}
      onPress={onUseLocation}
      style={({ pressed }) => [
        styles.locationButton,
        desktop && styles.locationButtonDesktop,
        !desktop && styles.actionButtonNarrow,
        tablet && styles.actionButtonTablet,
        findingLocation && styles.locationButtonWaiting,
        locationHovered && !findingLocation && styles.locationButtonHovered,
        pressed && !findingLocation && styles.locationButtonPressed,
      ]}
    >
      {findingLocation ? (
        <LocationSpinner reduceMotion={reduceMotion} size={desktop ? 19 : 18} />
      ) : (
        <Crosshair
          size={desktop ? 19 : 18}
          color={locationHovered ? '#0f7a45' : '#11150f'}
          aria-hidden
        />
      )}
      <Text
        style={[
          styles.locationText,
          locationHovered && !findingLocation && styles.locationTextHovered,
          findingLocation && styles.locationTextWaiting,
        ]}
      >
        {locationLabel}
      </Text>
    </Pressable>
  );

  return (
    <View style={[styles.form, desktop && styles.formDesktop]}>
      <View style={[styles.primaryRow, desktop && styles.primaryRowDesktop]}>
        <View
          style={[
            styles.fieldShell,
            desktop && styles.fieldShellDesktop,
            ...fieldFocusRing(focused),
          ]}
        >
          <MapPin size={22} color={t.colors.text.faint} strokeWidth={2} aria-hidden />
          <TextInput
            ref={inputRef}
            {...browserFillTextInputProps}
            accessibilityLabel="Full street address"
            aria-describedby={HOME_FINDER_HELP_ID}
            autoComplete="street-address"
            autoCapitalize="words"
            enterKeyHint="search"
            onBlur={onBlur}
            onChangeText={onValueChange}
            onFocus={onFocus}
            onSubmitEditing={onFind}
            placeholder={HOME_FINDER_EXAMPLE}
            placeholderTextColor={t.colors.text.faint}
            returnKeyType="search"
            style={[styles.input, desktop && styles.inputDesktop, fieldOutlineReset]}
            value={value}
          />
          {desktop ? findButton : null}
        </View>
        {desktop ? locationButton : null}
      </View>
      {!desktop ? (
        <View style={[styles.actions, tablet && styles.actionsTablet]}>
          {findButton}
          {locationButton}
        </View>
      ) : null}
      <Text nativeID={HOME_FINDER_HELP_ID} style={styles.help}>
        {HOME_FINDER_HELP}
      </Text>
      <Text accessibilityLiveRegion="polite" style={styles.liveStatus}>
        {findingLocation ? locationLabel : ''}
      </Text>
    </View>
  );
}

export function HomeLegislatorFinder({
  layout,
  onNavigate,
}: {
  layout: HomeFinderLayout;
  onNavigate: (destination: HomeFinderDestination) => void;
}) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [requestState, dispatchRequest] = useReducer(homeFinderRequestState, 'idle');
  const requestInFlight = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const findingLocation = requestState === 'waiting-location';

  const find = () => {
    if (requestInFlight.current) return;
    onNavigate(homeAddressDestination(value));
  };

  const finishLocation = (destination: HomeFinderDestination) => {
    if (!requestInFlight.current) return;
    requestInFlight.current = false;
    dispatchRequest('settle-location');
    onNavigate(destination);
  };

  const useLocation = () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    dispatchRequest('start-location');
    const geolocation = browserGeolocation();
    if (!geolocation) {
      finishLocation(homeLocationFailureDestination('unsupported'));
      return;
    }
    try {
      geolocation.getCurrentPosition(
        (position) =>
          finishLocation(
            homeLocationDestination({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            }),
          ),
        (error) =>
          finishLocation(homeLocationFailureDestination(locationFailureFromBrowserError(error))),
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
      );
    } catch {
      finishLocation(homeLocationFailureDestination('unknown'));
    }
  };

  return (
    <HomeLegislatorFinderForm
      value={value}
      focused={focused}
      findingLocation={findingLocation}
      layout={layout}
      reduceMotion={prefersReducedMotion()}
      inputRef={inputRef}
      onValueChange={setValue}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onFind={find}
      onUseLocation={useLocation}
    />
  );
}

const webOnly = Platform.OS === 'web';
const styles = StyleSheet.create({
  form: { marginTop: 22, width: '100%' },
  formDesktop: { marginTop: 38, maxWidth: 830 },
  primaryRow: { width: '100%' },
  primaryRowDesktop: {
    flexDirection: 'row',
    alignItems: 'stretch',
    flexWrap: 'wrap',
    gap: 12,
  },
  fieldShell: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
    paddingHorizontal: 20,
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    borderRadius: 14,
  },
  fieldShellDesktop: { flex: 1, minWidth: 360, paddingRight: 6, paddingLeft: 24 },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 15,
    paddingHorizontal: 6,
    fontFamily: t.typography.body,
    fontSize: 16,
    color: t.colors.text.primary,
    ...(webOnly ? ({ outlineStyle: 'none' } as object) : null),
  },
  inputDesktop: { fontSize: 18, paddingVertical: 16 },
  findButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.brand.base,
    borderRadius: 12,
  },
  findButtonDesktop: { flexShrink: 0, paddingVertical: 16, paddingHorizontal: 34 },
  findButtonPressed: { backgroundColor: t.colors.brand.forest },
  findButtonText: {
    fontFamily: t.typography.ui,
    fontSize: 18,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.onGreen,
  },
  findButtonTextNarrow: { fontSize: 19 },
  actions: { marginTop: 10, width: '100%', gap: 10 },
  actionsTablet: { flexDirection: 'row' },
  actionButtonNarrow: { width: '100%', minHeight: 48 },
  actionButtonTablet: { flex: 1, width: 'auto' },
  locationButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 22,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.16)',
    borderRadius: 12,
  },
  locationButtonDesktop: { height: 62, borderRadius: 14 },
  locationButtonWaiting: {
    backgroundColor: t.colors.surfaces.s300,
    borderColor: t.colors.alpha.ink14,
  },
  locationButtonHovered: { borderColor: '#2ed47e' },
  locationButtonPressed: { borderColor: t.colors.brand.base },
  locationIcon: { width: 18, height: 18 },
  locationIconDesktop: { width: 19, height: 19 },
  locationText: {
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: '700',
    color: '#11150f',
  },
  locationTextHovered: { color: '#0f7a45' },
  locationTextWaiting: { color: t.colors.text.secondary },
  help: {
    marginTop: 12,
    maxWidth: 640,
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 22,
    color: '#4f5651',
    ...(webOnly ? ({ textWrap: 'pretty' } as object) : null),
  },
  liveStatus: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
  },
});
