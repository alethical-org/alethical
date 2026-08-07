import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { AlertCircle, Crosshair, Search } from '../components/icons';

import { MINNESOTA_MAP_VIEWPORT, MapPinPicker, type MapViewport } from '../components/MapPinPicker';
import { RepresentativeCard, VacantSeatCard } from '../components/find/RepresentativeCard';
import { ApiError } from '../data/api';
import { isCoordinateInMinnesota } from '../data/minnesotaBoundary';
import type {
  RepresentativeAddressChoice,
  RepresentativeLookupCoordinates,
  RepresentativeLookupResult,
} from '../data/types';
import { useResponsive } from '../hooks/useResponsive';
import { useHistoryScrollRestoration } from '../hooks/useHistoryScrollRestoration';
import { useRepresentativeLookup } from '../hooks/useAppQueries';
import {
  addressChoiceKey,
  confirmedAddressForLookup,
  districtMapVisible,
  legislatureLabel,
  prepareAddressLookup,
  viewStateForLookup,
} from '../lib/findMyLegislator';
import type { IaItem, MenuKey } from '../navigation/ia';
import type { RootStackParamList } from '../navigation/types';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../theme/fieldFocus';
import { Container, Footer, PageBackground, TopNav } from '../theme/primitives';
import { theme as t } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'FindMyLegislator'>;
const EXAMPLE_ADDRESS = '350 S 5th St, Minneapolis, MN 55415';
const ADDRESS_ERROR_ID = 'find-legislator-address-error';
const LOCATION_ERROR_ID = 'find-legislator-location-error';
const ADDRESS_CHOICES_ID = 'find-legislator-address-choices';
const MAP_EXPANDED_KEY = 'alethical-find-legislator-map-expanded';
const isWeb = Platform.OS === 'web';
// Chrome otherwise anchors to the map when lookup content appears above it,
// moving the reader down the page. Results should load without moving the page.
const preserveLookupScrollStyle = isWeb ? ({ overflowAnchor: 'none' } as object) : undefined;
const alignedCardsStyle = isWeb
  ? ({
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gridAutoRows: 'auto',
      columnGap: 18,
      rowGap: 16,
      alignItems: 'stretch',
    } as object)
  : undefined;

type ClientError = 'location' | 'outside-minnesota' | null;

function initialMapExpanded() {
  if (!isWeb || typeof sessionStorage === 'undefined') return false;
  return sessionStorage.getItem(MAP_EXPANDED_KEY) === 'true';
}

function LoadingCard({ animate }: { animate: boolean }) {
  const motion = useRef(new Animated.Value(0)).current;
  const reduceMotion = reducedMotion();

  useEffect(() => {
    if (!animate || reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(motion, { toValue: 1, duration: 1050, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, motion, reduceMotion]);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.skeletonCard}
    >
      <View style={styles.skeletonIdentity} />
      <View style={styles.skeletonLineWide} />
      <View style={styles.skeletonLine} />
      <View style={styles.skeletonBlock} />
      {animate && !reduceMotion ? (
        <Animated.View
          style={[
            styles.shimmer,
            {
              transform: [
                {
                  translateX: motion.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-320, 520],
                  }),
                },
              ],
            },
          ]}
        />
      ) : null}
    </View>
  );
}

function browserGeolocation(): Geolocation | null {
  if (Platform.OS !== 'web') return null;
  return typeof navigator !== 'undefined' && navigator.geolocation ? navigator.geolocation : null;
}

function reducedMotion() {
  return Platform.OS === 'web' && typeof matchMedia !== 'undefined'
    ? matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

function errorKind(error: unknown) {
  if (!(error instanceof ApiError)) return 'service-down' as const;
  if (error.problem === 'representative-lookup-outside-minnesota')
    return 'outside-minnesota' as const;
  if (error.status === 404) return 'not-found' as const;
  return 'service-down' as const;
}

function errorCopy(state: 'not-found' | 'outside-minnesota' | 'location-error' | 'service-down') {
  if (state === 'not-found')
    return {
      field: 'No match for that address',
      answer: 'Enter a house number and street name, like 350 S 5th St, Minneapolis, MN 55415',
    };
  if (state === 'outside-minnesota')
    return {
      field: 'That address is outside Minnesota',
      answer: 'Alethical only covers Minnesota. Enter a complete address in the state.',
    };
  if (state === 'location-error')
    return {
      field: 'We couldn’t use your location',
      answer:
        'Your browser may have blocked location access, or the location may be outside Minnesota. Enter a complete address in the state instead.',
    };
  return {
    field: 'Lookup unavailable right now',
    answer: 'Your address is fine — a public lookup service isn’t responding. Try again later.',
  };
}

function DistrictChips({
  houseDistrict,
  senateDistrict,
  mobile,
}: {
  houseDistrict: string;
  senateDistrict: string;
  mobile: boolean;
}) {
  return (
    <View style={[styles.districtChips, mobile && styles.districtChipsMobile]}>
      <Text
        style={[
          styles.districtChip,
          styles.senateDistrictChip,
          mobile && styles.districtChipMobile,
        ]}
      >
        SENATE {senateDistrict}
      </Text>
      <Text aria-hidden style={[styles.districtArrow, mobile && styles.districtArrowMobile]}>
        ▸
      </Text>
      <Text
        style={[styles.districtChip, styles.houseDistrictChip, mobile && styles.districtChipMobile]}
      >
        HOUSE {houseDistrict}
      </Text>
    </View>
  );
}

export function FindMyLegislatorScreen({ navigation, route }: Props) {
  const { isMobile } = useResponsive();
  const historyScrollProps = useHistoryScrollRestoration();
  const requestedAddress =
    typeof route.params?.address === 'string' ? route.params.address : undefined;
  const requestedCoordinate = route.params?.coordinate;
  const [address, setAddress] = useState(requestedAddress ?? '');
  const [clientError, setClientError] = useState<ClientError>(
    route.params?.locationFailure ? 'location' : null,
  );
  const [selectedCoordinate, setSelectedCoordinate] = useState<
    RepresentativeLookupCoordinates | undefined
  >(requestedCoordinate);
  const [preserveMapViewport, setPreserveMapViewport] = useState(false);
  const [mapViewport, setMapViewport] = useState<MapViewport>(MINNESOTA_MAP_VIEWPORT);
  const [mapExpanded, setMapExpanded] = useState(initialMapExpanded);
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [choiceIndex, setChoiceIndex] = useState(0);
  const [choiceClosed, setChoiceClosed] = useState(false);
  const [findingLocation, setFindingLocation] = useState(false);
  const [shimmerEnabled, setShimmerEnabled] = useState(false);
  const [findHovered, setFindHovered] = useState(false);
  const [locationHovered, setLocationHovered] = useState(false);
  const { focused: addressFocused, focusProps: addressFocusProps } = useFieldFocus();
  const lookup = useRepresentativeLookup();
  const autoRanFor = useRef<string | null>(null);
  const addressInputRef = useRef<TextInput | null>(null);
  const lastFoundResult = useRef<RepresentativeLookupResult | undefined>(undefined);
  const geolocation = browserGeolocation();
  const result = lookup.data ?? undefined;
  const settledResult = lookup.isPending ? undefined : result;
  const retainLastFoundResult =
    preserveMapViewport && (lookup.isPending || Boolean(lookup.error) || Boolean(clientError));
  const retainedMapResult = retainLastFoundResult ? lastFoundResult.current : undefined;
  const displayedResult = retainedMapResult ?? settledResult;
  const alignRepresentativeSections = Boolean(
    !isMobile &&
      displayedResult?.status === 'found' &&
      displayedResult.senateLegislator &&
      displayedResult.houseLegislator,
  );
  const choices =
    settledResult?.status === 'address-choice' && !choiceClosed
      ? (settledResult.choices ?? []).slice(0, 5)
      : [];
  const found = settledResult?.status === 'found';
  const hasVacancy = Boolean(
    found && (!settledResult.houseLegislator || !settledResult.senateLegislator),
  );
  const state = viewStateForLookup({
    pending: lookup.isPending,
    found,
    choices: choices.length,
    vacant: hasVacancy,
    error: clientError ?? (lookup.error ? errorKind(lookup.error) : undefined),
  });
  const activeError =
    state === 'not-found' ||
    state === 'outside-minnesota' ||
    state === 'location-error' ||
    state === 'service-down'
      ? errorCopy(state)
      : null;
  const addressError =
    activeError && state !== 'location-error' && !retainedMapResult ? activeError : null;
  const locationButtonError = state === 'location-error' ? activeError : null;
  const mapUpdateLabel = lookup.isPending ? 'Updating districts' : 'Couldn’t update districts';

  useEffect(() => {
    if (settledResult?.status === 'found') {
      lastFoundResult.current = settledResult;
    }
  }, [settledResult]);

  useEffect(() => {
    if (!lookup.isPending) {
      setShimmerEnabled(false);
      return;
    }
    const timer = setTimeout(() => setShimmerEnabled(true), 250);
    return () => clearTimeout(timer);
  }, [lookup.isPending]);

  useEffect(() => {
    if (
      address.trim() &&
      (state === 'not-found' || state === 'outside-minnesota' || state === 'service-down')
    ) {
      addressInputRef.current?.focus();
    }
  }, [address, state]);

  useEffect(() => {
    if (!settledResult?.coordinate) return;
    setSelectedCoordinate(settledResult.coordinate);
  }, [settledResult?.coordinate]);

  useEffect(() => {
    const confirmedAddress = confirmedAddressForLookup(lookup.variables, settledResult, address);
    if (!confirmedAddress) return;
    setAddress(confirmedAddress);
    autoRanFor.current = confirmedAddress;
    navigation.setParams({
      address: confirmedAddress,
      coordinate: undefined,
      lookupAddress: undefined,
      locationFailure: undefined,
    });
  }, [address, lookup.variables, navigation, settledResult]);

  const runAddress = (value: string) => {
    const { serviceAddress } = prepareAddressLookup(value);
    if (!serviceAddress) return;
    setAddress(value);
    setClientError(null);
    setPreserveMapViewport(false);
    setSelectedCoordinate(undefined);
    setChoiceClosed(false);
    setChoiceIndex(0);
    autoRanFor.current = serviceAddress;
    navigation.setParams({
      address: value,
      coordinate: undefined,
      lookupAddress: undefined,
      locationFailure: undefined,
    });
    lookup.mutate(serviceAddress);
  };
  const runCoordinate = (
    coordinate: RepresentativeLookupCoordinates,
    source: 'choice' | 'location' | 'map' = 'map',
  ) => {
    setClientError(null);
    setChoiceClosed(true);
    if (!isCoordinateInMinnesota(coordinate)) {
      lookup.reset();
      setSelectedCoordinate(undefined);
      setClientError(source === 'location' ? 'location' : 'outside-minnesota');
      return;
    }
    setSelectedCoordinate(source === 'choice' ? undefined : coordinate);
    lookup.mutate(coordinate);
  };

  useEffect(() => {
    if (route.params?.lookupAddress) return;
    const serviceAddress = requestedAddress
      ? prepareAddressLookup(requestedAddress).serviceAddress
      : undefined;
    if (!serviceAddress || autoRanFor.current === serviceAddress) return;
    autoRanFor.current = serviceAddress;
    lookup.mutate(serviceAddress);
  }, [lookup.mutate, requestedAddress, route.params?.lookupAddress]);

  useEffect(() => {
    if (!route.params?.lookupAddress || !requestedAddress) return;
    runAddress(requestedAddress);
  }, [requestedAddress, route.params?.lookupAddress]);

  useEffect(() => {
    if (!requestedCoordinate) return;
    setAddress('');
    setPreserveMapViewport(false);
    navigation.setParams({
      address: undefined,
      coordinate: undefined,
      lookupAddress: undefined,
      locationFailure: undefined,
    });
    runCoordinate(requestedCoordinate, 'map');
  }, [requestedCoordinate]);

  useEffect(() => {
    if (!route.params?.locationFailure) return;
    setAddress('');
    lookup.reset();
    setChoiceClosed(false);
    setChoiceIndex(0);
    setClientError('location');
    setSelectedCoordinate(undefined);
    navigation.setParams({
      address: undefined,
      coordinate: undefined,
      lookupAddress: undefined,
      locationFailure: undefined,
    });
  }, [route.params?.locationFailure]);

  const useLocation = () => {
    if (findingLocation || lookup.isPending) return;
    setAddress('');
    lookup.reset();
    setPreserveMapViewport(false);
    setSelectedCoordinate(undefined);
    setClientError(null);
    if (!geolocation) {
      setClientError('location');
      return;
    }
    setFindingLocation(true);
    geolocation.getCurrentPosition(
      (position) => {
        setFindingLocation(false);
        runCoordinate(
          { latitude: position.coords.latitude, longitude: position.coords.longitude },
          'location',
        );
      },
      () => {
        setFindingLocation(false);
        setClientError('location');
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };
  const findAddress = () => {
    if (lookup.isPending) return;
    if (!address.trim()) {
      addressInputRef.current?.focus();
      return;
    }
    runAddress(address);
  };
  const chooseAddress = (choice: RepresentativeAddressChoice) => {
    const { serviceAddress } = prepareAddressLookup(choice.matchedAddress);
    setAddress(choice.matchedAddress);
    setChoiceClosed(true);
    setPreserveMapViewport(false);
    autoRanFor.current = serviceAddress || null;
    navigation.setParams({
      address: choice.matchedAddress,
      coordinate: undefined,
      lookupAddress: undefined,
      locationFailure: undefined,
    });
    runCoordinate({ latitude: choice.latitude, longitude: choice.longitude }, 'choice');
  };
  const onChoiceKey = (event: { nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
    const action = addressChoiceKey(event.nativeEvent?.key ?? '', choiceIndex, choices.length);
    if (!action) return;
    event.preventDefault?.();
    setChoiceIndex(action.index);
    if (action.action === 'choose') chooseAddress(choices[action.index]);
    if (action.action === 'close') {
      setChoiceClosed(true);
      addressInputRef.current?.focus();
    }
  };
  const onChoiceListKey = (event: {
    nativeEvent?: { key?: string };
    preventDefault?: () => void;
  }) => {
    if (event.nativeEvent?.key === 'Enter') return;
    onChoiceKey(event);
  };
  const navigateFromMenu = (item: IaItem) => {
    if (item.id === 'search-bills') navigation.navigate('Bills');
    if (item.id === 'search-legislators') navigation.navigate('Legislators');
    if (item.id === 'search-find-my-legislator') navigation.navigate('FindMyLegislator');
    if (item.id === 'track-bills') navigation.navigate('Tabs', { screen: 'Tracked' });
  };
  const mapResult = displayedResult?.status === 'found' ? displayedResult : undefined;
  const mapCoordinate = state === 'looking' ? selectedCoordinate : mapResult?.coordinate;
  const map = (
    <MapPinPicker
      coordinate={mapCoordinate}
      houseGeometry={mapResult?.houseGeometry}
      senateGeometry={mapResult?.senateGeometry}
      houseDistrict={mapResult?.houseDistrict}
      senateDistrict={mapResult?.senateDistrict}
      preserveViewport={preserveMapViewport}
      initialViewport={mapViewport}
      onViewportChange={setMapViewport}
      mobile={isMobile}
      onCoordinateChange={(coordinate) => {
        setPreserveMapViewport(true);
        runCoordinate(coordinate, 'map');
      }}
      onOutsideMinnesota={() => {
        lookup.reset();
        setPreserveMapViewport(true);
        setSelectedCoordinate(undefined);
        setClientError('outside-minnesota');
      }}
    />
  );
  const locationLabel = findingLocation ? 'Finding your location…' : 'Use my location';
  const locationBusy = findingLocation || lookup.isPending;
  const toggleMap = () => {
    setMapExpanded((value) => {
      const next = !value;
      if (isWeb && typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(MAP_EXPANDED_KEY, String(next));
      }
      return next;
    });
  };
  const foundHeaderGradient: object = isWeb
    ? { backgroundImage: 'linear-gradient(180deg,#f2f9f5 0%,#ffffff 100%)' }
    : { backgroundColor: '#f2f9f5' };
  const renderFindButton = (mobile: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Find legislators"
      accessibilityState={{ busy: lookup.isPending, disabled: lookup.isPending }}
      onHoverIn={() => setFindHovered(true)}
      onHoverOut={() => setFindHovered(false)}
      onPress={findAddress}
      style={({ pressed }) => [
        styles.findButton,
        mobile && styles.fullWidthButton,
        findHovered && styles.findButtonHovered,
        pressed && styles.pressed,
      ]}
    >
      <Search size={17} color="#06231a" aria-hidden />
      <Text style={[styles.findButtonText, mobile && styles.findButtonTextMobile]}>
        {mobile ? 'Find my legislator' : 'Find'}
      </Text>
    </Pressable>
  );
  const renderLocationButton = (mobile: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={locationLabel}
      accessibilityState={{ busy: locationBusy, disabled: locationBusy }}
      aria-describedby={locationButtonError ? LOCATION_ERROR_ID : undefined}
      onHoverIn={() => setLocationHovered(true)}
      onHoverOut={() => setLocationHovered(false)}
      onPress={useLocation}
      style={({ pressed }) => [
        styles.locationButton,
        mobile && styles.locationButtonMobile,
        locationHovered && styles.locationButtonHovered,
        pressed && styles.pressed,
      ]}
    >
      <Crosshair
        size={mobile ? 18 : 19}
        color={locationHovered ? '#0f7a45' : '#11150f'}
        aria-hidden
      />
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.locationText, locationHovered && styles.locationTextHovered]}
      >
        {locationLabel}
      </Text>
    </Pressable>
  );
  const renderMapSection = () =>
    isMobile ? (
      <View style={styles.mapSection}>
        <Pressable
          accessibilityRole="button"
          aria-expanded={mapExpanded}
          aria-controls="district-map-panel"
          onPress={toggleMap}
          style={styles.mapToggle}
        >
          <Text style={styles.mapToggleText}>
            {mapExpanded ? 'Hide district map' : 'Show district map'}
          </Text>
        </Pressable>
        {districtMapVisible(isMobile, mapExpanded) ? (
          <View nativeID="district-map-panel">{map}</View>
        ) : null}
      </View>
    ) : (
      <View style={styles.mapSection}>{map}</View>
    );

  return (
    <PageBackground>
      <ScrollView
        {...historyScrollProps}
        style={[styles.scroll, preserveLookupScrollStyle]}
        contentContainerStyle={styles.scrollContent}
      >
        <TopNav
          openMenu={openMenu}
          onOpenMenuChange={setOpenMenu}
          onNavigate={navigateFromMenu}
          onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
        />
        <Container style={[styles.main, isMobile && styles.mainMobile]}>
          <View style={styles.intro}>
            <Text accessibilityRole="header" style={[styles.title, isMobile && styles.titleMobile]}>
              Find my legislator
            </Text>
            <Text style={styles.explainer}>
              Enter a full street address. Minnesota’s districts split cities, so a city or ZIP
              alone can’t tell us who represents you.
            </Text>
          </View>
          <View style={styles.addressArea}>
            <View style={[styles.controlRow, isMobile && styles.controlRowMobile]}>
              <View
                {...(isWeb ? ({ onKeyDownCapture: onChoiceKey } as object) : null)}
                style={[
                  styles.inputShell,
                  isMobile && styles.inputShellMobile,
                  addressError && styles.inputShellError,
                  ...fieldFocusRing(addressFocused),
                ]}
              >
                <TextInput
                  ref={addressInputRef}
                  accessibilityLabel="Full Minnesota street address"
                  aria-describedby={addressError ? ADDRESS_ERROR_ID : undefined}
                  aria-invalid={addressError ? true : undefined}
                  {...(!isWeb ? ({ onKeyPress: onChoiceKey } as object) : null)}
                  {...({
                    role: 'combobox',
                    'aria-expanded': choices.length > 0,
                    'aria-controls': choices.length > 0 ? ADDRESS_CHOICES_ID : undefined,
                    'aria-activedescendant':
                      choices.length > 0 ? `find-legislator-choice-${choiceIndex}` : undefined,
                  } as object)}
                  autoComplete="street-address"
                  placeholder={EXAMPLE_ADDRESS}
                  placeholderTextColor={t.colors.text.faint}
                  value={address}
                  onChangeText={(value) => {
                    setAddress(value);
                    lookup.reset();
                    setClientError(null);
                    setSelectedCoordinate(undefined);
                    setChoiceClosed(false);
                  }}
                  onSubmitEditing={findAddress}
                  style={[styles.input, isMobile && styles.inputMobile, fieldOutlineReset]}
                  {...addressFocusProps}
                  {...({ name: 'street-address' } as object)}
                />
                {!isMobile ? renderFindButton(false) : null}
              </View>
              {!isMobile ? renderLocationButton(false) : null}
            </View>
            {addressError ? (
              <View nativeID={ADDRESS_ERROR_ID} style={styles.fieldErrorRow}>
                <AlertCircle size={14} color="#a36215" aria-hidden />
                <Text style={styles.fieldError} accessibilityLiveRegion="polite">
                  {addressError.field}
                </Text>
              </View>
            ) : null}
            {locationButtonError ? (
              <View nativeID={LOCATION_ERROR_ID} style={styles.fieldErrorRow}>
                <AlertCircle size={14} color="#a36215" aria-hidden />
                <Text style={styles.fieldError} accessibilityLiveRegion="polite">
                  {locationButtonError.field}
                </Text>
              </View>
            ) : null}
            {choices.length ? (
              <View style={styles.choiceWrap}>
                <Text style={styles.choiceTitle}>Choose your address</Text>
                <View
                  nativeID={ADDRESS_CHOICES_ID}
                  {...({ role: 'listbox' } as object)}
                  accessibilityLabel="Matching Minnesota addresses"
                  {...(isWeb ? ({ onKeyDownCapture: onChoiceListKey } as object) : null)}
                  style={styles.choiceList}
                >
                  {choices.map((choice, index) => (
                    <Pressable
                      key={`${choice.matchedAddress}-${choice.latitude}-${choice.longitude}`}
                      nativeID={`find-legislator-choice-${index}`}
                      {...({ role: 'option' } as object)}
                      aria-selected={index === choiceIndex}
                      onFocus={() => setChoiceIndex(index)}
                      onHoverIn={() => setChoiceIndex(index)}
                      onPress={() => chooseAddress(choice)}
                      style={[styles.choiceRow, index === choiceIndex && styles.choiceRowActive]}
                    >
                      <Text style={styles.choiceText}>{choice.matchedAddress}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.choiceHelp}>
                  Use <Text style={styles.choiceKey}>↑</Text> and{' '}
                  <Text style={styles.choiceKey}>↓</Text> to move,{' '}
                  <Text style={styles.choiceKey}>Enter</Text> to choose,{' '}
                  <Text style={styles.choiceKey}>Esc</Text> to close
                </Text>
              </View>
            ) : null}
            {isMobile ? renderFindButton(true) : null}
            {isMobile ? renderLocationButton(true) : null}
          </View>

          {state === 'empty' ? renderMapSection() : null}
          <View
            style={state === 'empty' ? undefined : styles.answer}
            accessibilityLiveRegion="polite"
          >
            {state === 'looking' && !retainedMapResult ? (
              <View accessible accessibilityLabel="Looking up your districts">
                <View style={styles.looking}>
                  {reducedMotion() ? (
                    <View style={styles.staticSpinner} />
                  ) : (
                    <ActivityIndicator color="#6f756f" />
                  )}
                  <Text style={[styles.lookingTitle, isMobile && styles.lookingTitleMobile]}>
                    Looking up your districts
                  </Text>
                </View>
                <View style={[styles.skeletonCards, isMobile && styles.skeletonCardsMobile]}>
                  <LoadingCard animate={shimmerEnabled} />
                  <LoadingCard animate={shimmerEnabled} />
                </View>
              </View>
            ) : null}
            {activeError && !retainedMapResult ? (
              <View accessibilityRole="alert" style={styles.errorAlert}>
                <Text style={styles.errorText}>{activeError.answer}</Text>
              </View>
            ) : null}
            {displayedResult?.status === 'found' ? (
              <View
                style={styles.foundWrap}
                accessibilityState={{ busy: Boolean(retainedMapResult) }}
              >
                <View style={[styles.foundHeader, foundHeaderGradient]}>
                  {!isMobile ? (
                    <View aria-hidden style={styles.foundHeaderPin}>
                      <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                        <Path
                          d="M12 21 C 12 21 5 14.5 5 9.5 A7 7 0 0 1 19 9.5 C 19 14.5 12 21 12 21 Z"
                          stroke="#149d5b"
                          strokeWidth={2}
                          strokeLinejoin="round"
                        />
                        <Circle cx={12} cy={9.5} r={2.6} stroke="#149d5b" strokeWidth={2} />
                      </Svg>
                    </View>
                  ) : null}
                  <View style={styles.foundHeaderText}>
                    <Text accessibilityRole="header" aria-level={2} style={styles.answerTitle}>
                      Your Minnesota legislators
                    </Text>
                    {isMobile && displayedResult.houseDistrict && displayedResult.senateDistrict ? (
                      <DistrictChips
                        houseDistrict={displayedResult.houseDistrict}
                        senateDistrict={displayedResult.senateDistrict}
                        mobile
                      />
                    ) : null}
                    {displayedResult.houseDistrict && displayedResult.senateDistrict ? (
                      <Text style={styles.nesting}>
                        House District {displayedResult.houseDistrict} is one of two House districts
                        inside Senate District {displayedResult.senateDistrict}
                      </Text>
                    ) : null}
                    {displayedResult.congressionalDistrict ? (
                      <Text style={styles.congressional}>
                        Congressional district {displayedResult.congressionalDistrict}
                      </Text>
                    ) : null}
                  </View>
                  {!isMobile && displayedResult.houseDistrict && displayedResult.senateDistrict ? (
                    <DistrictChips
                      houseDistrict={displayedResult.houseDistrict}
                      senateDistrict={displayedResult.senateDistrict}
                      mobile={false}
                    />
                  ) : null}
                </View>
                <View
                  style={[
                    styles.cards,
                    alignRepresentativeSections && alignedCardsStyle,
                    isMobile && styles.cardsMobile,
                  ]}
                >
                  {displayedResult.senateLegislator ? (
                    <RepresentativeCard
                      legislator={displayedResult.senateLegislator}
                      mobile={isMobile}
                      alignSections={alignRepresentativeSections}
                      legislatureLabel={
                        displayedResult.session
                          ? legislatureLabel(displayedResult.session)
                          : undefined
                      }
                      onProfile={() =>
                        navigation.navigate('LegislatorProfile', {
                          legislatorId:
                            displayedResult.senateLegislator?.slug ??
                            displayedResult.senateLegislator!.id,
                        })
                      }
                    />
                  ) : (
                    <VacantSeatCard
                      mobile={isMobile}
                      districtLabel={
                        displayedResult.senateDistrict
                          ? `SENATE DISTRICT ${displayedResult.senateDistrict}`
                          : undefined
                      }
                    />
                  )}
                  {displayedResult.houseLegislator ? (
                    <RepresentativeCard
                      legislator={displayedResult.houseLegislator}
                      mobile={isMobile}
                      alignSections={alignRepresentativeSections}
                      legislatureLabel={
                        displayedResult.session
                          ? legislatureLabel(displayedResult.session)
                          : undefined
                      }
                      onProfile={() =>
                        navigation.navigate('LegislatorProfile', {
                          legislatorId:
                            displayedResult.houseLegislator?.slug ??
                            displayedResult.houseLegislator!.id,
                        })
                      }
                    />
                  ) : (
                    <VacantSeatCard
                      mobile={isMobile}
                      districtLabel={
                        displayedResult.houseDistrict
                          ? `HOUSE DISTRICT ${displayedResult.houseDistrict}`
                          : undefined
                      }
                    />
                  )}
                </View>
                {retainedMapResult ? (
                  <View
                    accessible
                    accessibilityLabel={mapUpdateLabel}
                    accessibilityLiveRegion="polite"
                    style={styles.mapUpdatingOverlay}
                  >
                    <View style={styles.mapUpdatingBadge}>
                      {!lookup.isPending ? (
                        <AlertCircle size={18} color="#a36215" aria-hidden />
                      ) : reducedMotion() ? (
                        <View style={styles.staticSpinner} />
                      ) : (
                        <ActivityIndicator color="#2d7a52" />
                      )}
                      <Text style={styles.mapUpdatingText}>{mapUpdateLabel}</Text>
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          {state !== 'empty' ? renderMapSection() : null}
        </Container>
        <Footer
          onPrivacy={() => navigation.navigate('Privacy')}
          onTerms={() => navigation.navigate('Terms')}
        />
      </ScrollView>
    </PageBackground>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { minHeight: '100%' },
  main: { maxWidth: 1180, alignSelf: 'center', paddingTop: 74, paddingBottom: 88 },
  mainMobile: { paddingTop: 44, paddingBottom: 64 },
  intro: { maxWidth: 780, gap: 16 },
  title: {
    fontFamily: t.typography.title,
    fontSize: 52,
    lineHeight: 58,
    fontWeight: '800',
    color: t.colors.ink,
  },
  titleMobile: { fontSize: 38, lineHeight: 43 },
  explainer: {
    fontFamily: t.typography.body,
    fontSize: 18,
    lineHeight: 29,
    color: t.colors.text.secondary,
  },
  addressArea: { marginTop: 34, maxWidth: 900, width: '100%', gap: 8 },
  controlRow: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  controlRowMobile: { flexDirection: 'column' },
  inputShell: {
    flex: 1,
    minWidth: 0,
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.16)',
    paddingVertical: 4,
    paddingLeft: 20,
    paddingRight: 8,
  },
  inputShellMobile: { width: '100%' },
  inputShellError: { borderColor: '#a3421a' },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    fontFamily: t.typography.body,
    fontSize: 18,
    color: t.colors.ink,
  },
  inputMobile: { fontSize: 16 },
  findButton: {
    minHeight: 44,
    flexDirection: 'row',
    gap: 9,
    borderRadius: 12,
    backgroundColor: '#2ed47e',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 13,
    paddingRight: 26,
    paddingBottom: 13,
    paddingLeft: 23,
  },
  findButtonHovered: { backgroundColor: '#28bf71' },
  fullWidthButton: {
    width: '100%',
    minHeight: 48,
  },
  findButtonText: {
    fontFamily: t.typography.ui,
    fontSize: 17,
    fontWeight: '700',
    color: '#06231a',
  },
  findButtonTextMobile: { fontSize: 16 },
  pressed: { opacity: 0.72 },
  fieldErrorRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 7 },
  fieldError: {
    fontFamily: t.typography.body,
    fontSize: 14,
    fontWeight: '600',
    color: '#a36215',
  },
  locationButton: {
    height: 62,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 22,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.16)',
    borderRadius: 14,
  },
  locationButtonMobile: { width: '100%', minHeight: 48, height: 48, borderRadius: 12 },
  locationButtonHovered: { borderColor: '#2ed47e' },
  locationText: {
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: '700',
    color: '#11150f',
  },
  locationTextHovered: { color: '#0f7a45' },
  answer: { marginTop: 22 },
  looking: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  staticSpinner: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: '#6f756f',
  },
  lookingTitle: {
    fontFamily: t.typography.body,
    fontSize: 17,
    fontWeight: '700',
    color: t.colors.ink,
  },
  lookingTitleMobile: { fontSize: 15 },
  skeletonCards: { marginTop: 20, flexDirection: 'row', alignItems: 'flex-start', gap: 18 },
  skeletonCardsMobile: { flexDirection: 'column' },
  skeletonCard: {
    flex: 1,
    width: '100%',
    minHeight: 330,
    overflow: 'hidden',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    backgroundColor: '#f1f3f2',
    padding: 24,
    gap: 16,
  },
  skeletonIdentity: { width: '62%', height: 74, borderRadius: 12, backgroundColor: '#e2e5e4' },
  skeletonLineWide: { width: '88%', height: 18, borderRadius: 6, backgroundColor: '#e2e5e4' },
  skeletonLine: { width: '68%', height: 14, borderRadius: 6, backgroundColor: '#e2e5e4' },
  skeletonBlock: { width: '100%', height: 112, borderRadius: 12, backgroundColor: '#e2e5e4' },
  shimmer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 140,
    backgroundColor: 'rgba(255,255,255,0.42)',
    transform: [{ rotate: '12deg' }],
  },
  choiceWrap: {
    backgroundColor: 'white',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    overflow: 'hidden',
  },
  choiceTitle: {
    paddingHorizontal: 14,
    paddingTop: 13,
    fontFamily: t.typography.body,
    fontSize: 15,
    fontWeight: '700',
    color: t.colors.ink,
  },
  choiceHelp: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: t.typography.body,
    fontSize: 14,
    color: '#6f756f',
  },
  choiceKey: { fontWeight: '700' },
  choiceList: { marginTop: 8, borderTopWidth: 1, borderColor: t.colors.alpha.ink08 },
  choiceRow: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.alpha.ink08,
  },
  choiceRowActive: { backgroundColor: t.colors.tint.t100 },
  choiceText: { fontFamily: t.typography.body, fontSize: 15, color: t.colors.ink },
  errorAlert: {
    maxWidth: 720,
  },
  errorText: {
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 26,
    color: '#4f5651',
  },
  foundWrap: { gap: 20, position: 'relative' },
  mapUpdatingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(247,248,247,0.58)',
  },
  mapUpdatingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink14,
    backgroundColor: 'white',
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  mapUpdatingText: {
    fontFamily: t.typography.body,
    fontSize: 16,
    fontWeight: '700',
    color: t.colors.ink,
  },
  foundHeader: {
    backgroundColor: '#f2f9f5',
    borderWidth: 1,
    borderColor: '#cbeed6',
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 20,
  },
  foundHeaderPin: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#e4f8ee',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
  },
  foundHeaderText: {
    flex: 1,
    minWidth: 260,
    gap: 7,
  },
  answerTitle: {
    fontFamily: t.typography.title,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    color: t.colors.ink,
  },
  districtChips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
  },
  districtChipsMobile: { flexWrap: 'wrap', gap: 7 },
  districtChip: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontFamily: t.typography.mono,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.52,
    ...(isWeb ? ({ whiteSpace: 'nowrap' } as object) : null),
  },
  districtChipMobile: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 11,
    letterSpacing: 0.44,
  },
  senateDistrictChip: { borderColor: '#d8c9f7', color: '#5b30d6' },
  houseDistrictChip: { borderColor: '#bfeacf', color: '#0f7a45' },
  districtArrow: { fontFamily: t.typography.mono, fontSize: 13, color: '#adb4ae' },
  districtArrowMobile: { fontSize: 11 },
  nesting: {
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 23,
    color: t.colors.text.secondary,
  },
  congressional: { fontFamily: t.typography.body, fontSize: 14, color: t.colors.text.muted },
  cards: { flexDirection: 'row', gap: 18, alignItems: 'flex-start' },
  cardsMobile: { flexDirection: 'column', alignItems: 'stretch', gap: 12 },
  mapSection: { marginTop: 28 },
  mapToggle: {
    minHeight: 44,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: t.colors.brand.deep,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  mapToggleText: {
    fontFamily: t.typography.ui,
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.brand.deep,
  },
});
