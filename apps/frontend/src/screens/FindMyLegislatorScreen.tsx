import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { AlertCircle, Crosshair, Search } from '../components/icons';

import { MINNESOTA_MAP_VIEWPORT, MapPinPicker, type MapViewport } from '../components/MapPinPicker';
import { RepresentativeCard, VacantSeatCard } from '../components/find/RepresentativeCard';
import {
  AddressSuggestionField,
  type AddressFieldHandle,
} from '../components/address/AddressSuggestionField';
import {
  ApiError,
  lookupRepresentativeFromApi,
  suggestRepresentativeAddressesFromApi,
} from '../data/api';
import { readerIsSavingData } from '../lib/dataSaving';
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
  legislatureLabel,
  prepareAddressLookup,
  retryWaitSeconds,
  viewStateForLookup,
} from '../lib/findMyLegislator';
import { recordSiteMetricEvent } from '../lib/siteMetricEvents';
import type { IaItem, MenuKey } from '../navigation/ia';
import type { RootStackParamList } from '../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../theme/primitives';
import { theme as t } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'FindMyLegislator'>;
const ADDRESS_ERROR_ID = 'find-legislator-address-error';
const ADDRESS_HELP_ID = 'find-legislator-address-help';
const ADDRESS_HELP = 'A city or ZIP code alone cannot identify your legislators';
const LOCATION_ERROR_ID = 'find-legislator-location-error';
const ADDRESS_CHOICES_ID = 'find-legislator-address-choices';
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

/** The checked request for a marked choice: the exact text the reader picked. */
function selectedChoiceInput(choice: RepresentativeAddressChoice, shown: string) {
  return { latitude: choice.latitude, longitude: choice.longitude, selectedAddress: shown };
}

function errorKind(error: unknown) {
  if (!(error instanceof ApiError)) return 'service-down' as const;
  if (error.problem === 'representative-lookup-outside-minnesota')
    return 'outside-minnesota' as const;
  if (error.status === 429) return 'rate-limited' as const;
  if (error.status === 404) return 'not-found' as const;
  return 'service-down' as const;
}

function errorCopy(
  state: 'not-found' | 'outside-minnesota' | 'location-error' | 'rate-limited' | 'service-down',
) {
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
  if (state === 'rate-limited')
    return {
      field: 'Too many lookups',
      answer: 'Try again in up to 60 seconds',
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
  const { isMobile, isDesktop } = useResponsive();
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
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [choiceIndex, setChoiceIndex] = useState(0);
  const [choiceClosed, setChoiceClosed] = useState(false);
  const [findingLocation, setFindingLocation] = useState(false);
  const [rateLimitSeconds, setRateLimitSeconds] = useState(0);
  const [shimmerEnabled, setShimmerEnabled] = useState(false);
  const [findHovered, setFindHovered] = useState(false);
  const [locationHovered, setLocationHovered] = useState(false);
  const [retainedServiceError, setRetainedServiceError] = useState<unknown>(null);
  const locationGeneration = useRef(0);
  useEffect(
    () => () => {
      locationGeneration.current += 1;
    },
    [],
  );
  const lookup = useRepresentativeLookup();
  const lookupError = lookup.error ?? retainedServiceError;
  const autoRanFor = useRef<string | null>(null);
  const addressInputRef = useRef<AddressFieldHandle>(null);
  const suggest = useCallback(
    async (value: string, signal: AbortSignal) =>
      (await suggestRepresentativeAddressesFromApi(value, signal)).map((choice) => ({
        id: `${choice.matchedAddress}-${choice.latitude}-${choice.longitude}`,
        address: choice.matchedAddress,
        value: choice,
      })),
    [],
  );
  // Start the current-records check for at most 2 rows per typed address, so
  // pointing at a row hides most of its wait without spending the lookup limit.
  // It is optional, so a reader saving data or on a slow connection skips it;
  // a deliberate pick still runs the same check.
  const preparedChoices = useRef<{ address: string; keys: Set<string> }>({
    address: '',
    keys: new Set(),
  });
  const prepareChoice = (choice: RepresentativeAddressChoice, shown: string) => {
    if (!choice.requiresLocationCheck || rateLimitSeconds > 0 || lookup.isPending) return;
    if (readerIsSavingData()) return;
    const typed = addressInputRef.current?.value() ?? address;
    if (preparedChoices.current.address !== typed)
      preparedChoices.current = { address: typed, keys: new Set() };
    const { keys } = preparedChoices.current;
    if (keys.has(shown) || keys.size >= 2) return;
    keys.add(shown);
    // Shared with the pick through the lookup's in-flight and 60-second reuse,
    // which match because both send the shown text, apartment and ZIP+4 included.
    lookupRepresentativeFromApi(selectedChoiceInput(choice, shown)).catch(() => undefined);
  };
  const choicesRef = useRef<View>(null);
  const confirmedChoice = useRef<
    { coordinate: RepresentativeLookupCoordinates; address: string } | undefined
  >(undefined);
  const lastFoundAddress = useRef<string | undefined>(undefined);
  const lastFoundResult = useRef<RepresentativeLookupResult | undefined>(undefined);
  const recordedFoundResult = useRef<RepresentativeLookupResult | undefined>(undefined);
  const geolocation = browserGeolocation();
  const result = lookup.data ?? undefined;
  const settledResult = lookup.isPending ? undefined : result;
  const retainLastFoundResult =
    lookup.isPending ||
    Boolean(lookupError) ||
    Boolean(clientError) ||
    settledResult?.status !== 'found';
  const retainedMapResult = retainLastFoundResult ? lastFoundResult.current : undefined;
  const displayedResult = retainedMapResult ?? settledResult;
  const resultAddress = settledResult?.address;
  const settledAddress =
    confirmedChoice.current && lookup.variables === confirmedChoice.current.coordinate
      ? confirmedChoice.current.address
      : resultAddress && !/^-?[\d.]+\s*,\s*-?[\d.]+$/.test(resultAddress)
        ? resultAddress
        : undefined;
  const displayedAddress = retainedMapResult ? lastFoundAddress.current : settledAddress;
  const alignRepresentativeSections = Boolean(
    !isMobile &&
    displayedResult?.status === 'found' &&
    displayedResult.senateLegislator &&
    displayedResult.houseLegislator,
  );
  const lookupChoices =
    settledResult?.status === 'address-choice' && !choiceClosed
      ? (settledResult.choices ?? []).slice(0, 5)
      : [];
  const choices = lookupChoices;
  useEffect(() => {
    if (settledResult?.status === 'address-choice' && !choiceClosed) {
      (choicesRef.current as unknown as HTMLElement | null)?.focus?.();
    }
  }, [settledResult, choiceClosed]);
  const found = settledResult?.status === 'found';
  const hasVacancy = Boolean(
    found && (!settledResult.houseLegislator || !settledResult.senateLegislator),
  );
  const state = viewStateForLookup({
    pending: lookup.isPending,
    found,
    choices: lookupChoices.length,
    vacant: hasVacancy,
    error: clientError ?? (lookupError ? errorKind(lookupError) : undefined),
  });
  const activeError =
    state === 'not-found' ||
    state === 'outside-minnesota' ||
    state === 'location-error' ||
    state === 'rate-limited' ||
    state === 'service-down'
      ? errorCopy(state)
      : null;
  const addressError = activeError && state !== 'location-error' ? activeError : null;
  const addressInvalid = state === 'not-found' || state === 'outside-minnesota';
  const locationButtonError = state === 'location-error' ? activeError : null;
  const mapUpdateLabel = lookup.isPending
    ? 'Updating legislators: showing the previous results'
    : 'Couldn’t update legislators: showing the previous results';

  useEffect(() => {
    if (!(lookup.error instanceof ApiError) || lookup.error.status !== 429) return;
    setRateLimitSeconds(retryWaitSeconds(lookup.error.retryAfterSeconds));
  }, [lookup.error]);

  useEffect(() => {
    if (rateLimitSeconds <= 0) return;
    const timer = setTimeout(
      () => setRateLimitSeconds((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [rateLimitSeconds]);

  useEffect(() => {
    if (settledResult?.status === 'found') {
      lastFoundResult.current = settledResult;
      lastFoundAddress.current = settledAddress;
      if (recordedFoundResult.current !== settledResult) {
        recordedFoundResult.current = settledResult;
        recordSiteMetricEvent('find_my_legislator_with_results');
      }
    }
  }, [settledResult, settledAddress]);

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
    if (rateLimitSeconds > 0) return;
    const { serviceAddress } = prepareAddressLookup(value);
    if (!serviceAddress) return;
    locationGeneration.current += 1;
    setFindingLocation(false);
    setRetainedServiceError(null);
    setAddress(value);
    setClientError(null);
    setPreserveMapViewport(false);
    setSelectedCoordinate(undefined);
    setChoiceClosed(false);
    addressInputRef.current?.dismiss();
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
    if (rateLimitSeconds > 0) return;
    locationGeneration.current += 1;
    setFindingLocation(false);
    setRetainedServiceError(null);
    setClientError(null);
    setChoiceClosed(true);
    addressInputRef.current?.dismiss();
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
    if (findingLocation || lookup.isPending || rateLimitSeconds > 0) return;
    setAddress('');
    addressInputRef.current?.dismiss();
    lookup.reset();
    setPreserveMapViewport(false);
    setSelectedCoordinate(undefined);
    setClientError(null);
    setRetainedServiceError(null);
    if (!geolocation) {
      setClientError('location');
      return;
    }
    setFindingLocation(true);
    const request = ++locationGeneration.current;
    geolocation.getCurrentPosition(
      (position) => {
        if (request !== locationGeneration.current) return;
        setFindingLocation(false);
        runCoordinate(
          { latitude: position.coords.latitude, longitude: position.coords.longitude },
          'location',
        );
      },
      () => {
        if (request !== locationGeneration.current) return;
        setFindingLocation(false);
        setClientError('location');
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };
  const editAddress = (value: string) => {
    setAddress(value);
    // Reset detaches this screen from unfinished mutation replies. Keep an
    // already-reported service failure, which clearing text cannot repair.
    if (lookupError && ['service-down', 'rate-limited'].includes(errorKind(lookupError)))
      setRetainedServiceError(lookupError);
    lookup.reset();
    setClientError(null);
    setSelectedCoordinate(undefined);
    setChoiceClosed(false);
    setChoiceIndex(0);
  };
  const clearAddress = () => {
    locationGeneration.current += 1;
    setFindingLocation(false);
    setChoiceClosed(true);
    confirmedChoice.current = undefined;
    navigation.setParams({
      address: undefined,
      coordinate: undefined,
      lookupAddress: undefined,
      locationFailure: undefined,
    });
  };
  const findAddress = () => {
    if (lookup.isPending || rateLimitSeconds > 0) return;
    const value = addressInputRef.current?.value() ?? address;
    if (!value.trim()) {
      setAddress(value);
      addressInputRef.current?.focus();
      return;
    }
    runAddress(value);
  };
  const chooseAddress = (choice: RepresentativeAddressChoice, selectedAddress?: string) => {
    if (lookup.isPending || rateLimitSeconds > 0) return;
    const value = addressInputRef.current?.value() ?? address;
    if (selectedAddress === undefined && value !== address) {
      setChoiceClosed(true);
      addressInputRef.current?.dismiss();
      findAddress();
      return;
    }
    const matchedAddress = selectedAddress ?? choice.matchedAddress;
    const { serviceAddress } = prepareAddressLookup(matchedAddress);
    setAddress(matchedAddress);
    setChoiceClosed(true);
    addressInputRef.current?.dismiss();
    setPreserveMapViewport(false);
    autoRanFor.current = serviceAddress || null;
    navigation.setParams({
      address: matchedAddress,
      coordinate: undefined,
      lookupAddress: undefined,
      locationFailure: undefined,
    });
    // A copied or conflicting point is only a hint: the server checks the printed
    // address against current official records before choosing districts.
    const coordinate = choice.requiresLocationCheck
      ? selectedChoiceInput(choice, matchedAddress)
      : { latitude: choice.latitude, longitude: choice.longitude };
    confirmedChoice.current = { coordinate, address: matchedAddress };
    runCoordinate(coordinate, 'choice');
  };
  const onChoiceKey = (event: { nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
    const action = addressChoiceKey(event.nativeEvent?.key ?? '', choiceIndex, choices.length);
    if (!action) return;
    event.preventDefault?.();
    setChoiceIndex(action.index);
    if (action.action === 'choose') chooseAddress(choices[action.index]);
    if (action.action === 'close') {
      setChoiceClosed(true);
      addressInputRef.current?.dismiss();
      addressInputRef.current?.focus();
    }
  };
  const onChoiceListKey = (event: {
    nativeEvent?: { key?: string };
    preventDefault?: () => void;
    target?: unknown;
    currentTarget?: unknown;
  }) => {
    if (event.nativeEvent?.key === 'Enter' && event.target !== event.currentTarget) return;
    onChoiceKey(event);
  };
  const navigateFromMenu = (item: IaItem) => {
    if (item.id === 'search-bills') navigation.navigate('Bills');
    if (item.id === 'search-legislators') navigation.navigate('Legislators');
    if (item.id === 'search-find-my-legislator') navigation.navigate('FindMyLegislator');
    if (item.id === 'track-bills') navigation.navigate('Tabs', { screen: 'Tracked' });
  };
  const mapResult = displayedResult?.status === 'found' ? displayedResult : undefined;
  const mapCoordinate =
    state === 'looking' ? (selectedCoordinate ?? mapResult?.coordinate) : mapResult?.coordinate;
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
      // Printed once, opening the notes at the foot; the address field still names it.
      leadNote={{ id: ADDRESS_HELP_ID, text: ADDRESS_HELP }}
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
  const lookupDisabled = lookup.isPending || rateLimitSeconds > 0;
  const locationDisabled = locationBusy || rateLimitSeconds > 0;
  const foundHeaderGradient: object = isWeb
    ? { backgroundImage: 'linear-gradient(180deg,#f2f9f5 0%,#ffffff 100%)' }
    : { backgroundColor: '#f2f9f5' };
  const renderFindButton = (mobile: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        rateLimitSeconds > 0 ? `Try again in ${rateLimitSeconds}s` : 'Find legislators'
      }
      accessibilityState={{ busy: lookup.isPending, disabled: lookupDisabled }}
      disabled={lookupDisabled}
      onHoverIn={() => setFindHovered(true)}
      onHoverOut={() => setFindHovered(false)}
      onPress={findAddress}
      style={({ pressed }) => [
        styles.findButton,
        mobile && styles.fullWidthButton,
        findHovered && !lookupDisabled && styles.findButtonHovered,
        rateLimitSeconds > 0 && styles.disabledButton,
        pressed && !lookupDisabled && styles.pressed,
      ]}
    >
      {lookup.isPending ? (
        <ActivityIndicator size="small" color="#06231a" />
      ) : (
        <Search size={17} color="#06231a" aria-hidden />
      )}
      <Text style={[styles.findButtonText, mobile && styles.findButtonTextMobile]}>
        {rateLimitSeconds > 0
          ? `Try again in ${rateLimitSeconds}s`
          : lookup.isPending
            ? 'Finding…'
            : 'Find'}
      </Text>
    </Pressable>
  );
  const renderLocationButton = (mobile: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={locationLabel}
      accessibilityState={{ busy: locationBusy, disabled: locationDisabled }}
      disabled={locationDisabled}
      aria-describedby={locationButtonError ? LOCATION_ERROR_ID : undefined}
      onHoverIn={() => setLocationHovered(true)}
      onHoverOut={() => setLocationHovered(false)}
      onPress={useLocation}
      style={({ pressed }) => [
        styles.locationButton,
        mobile && styles.locationButtonMobile,
        locationHovered && !locationDisabled && styles.locationButtonHovered,
        locationDisabled && styles.disabledButton,
        pressed && !locationDisabled && styles.pressed,
      ]}
    >
      <Crosshair size={mobile ? 18 : 19} color="#11150f" aria-hidden />
      <Text accessibilityLiveRegion="polite" style={styles.locationText}>
        {locationLabel}
      </Text>
    </Pressable>
  );
  const renderMapSection = () => <View style={styles.mapSection}>{map}</View>;

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
            <Text
              accessibilityRole="header"
              aria-level={1}
              style={[styles.title, isMobile && styles.titleMobile]}
            >
              Find my legislators
            </Text>
            <Text
              style={[
                styles.description,
                {
                  fontSize: isMobile ? 16.5 : isDesktop ? 19 : 18,
                  lineHeight: isMobile ? 25 : isDesktop ? 28.5 : 27,
                },
              ]}
            >
              See who represents you in the Minnesota House and Senate
            </Text>
          </View>
          <View style={styles.addressArea}>
            <Text nativeID="find-legislator-address-label" style={styles.addressLabel}>
              Full street address
            </Text>
            <View style={[styles.controlRow, isMobile && styles.controlRowMobile]}>
              <View
                style={{
                  flex: isMobile ? undefined : 1,
                  minWidth: isMobile ? 0 : 260,
                  width: isMobile ? '100%' : undefined,
                  zIndex: 2,
                }}
              >
                <AddressSuggestionField
                  fieldRef={addressInputRef}
                  address={address}
                  onAddress={editAddress}
                  onClear={clearAddress}
                  suggestionsEnabled={!choices.length && rateLimitSeconds === 0}
                  suggest={suggest}
                  onPrepare={prepareChoice}
                  onSubmit={(value, choice) =>
                    choice ? chooseAddress(choice, value) : runAddress(value)
                  }
                  labelId="find-legislator-address-label"
                  describedBy={
                    addressError ? `${ADDRESS_HELP_ID} ${ADDRESS_ERROR_ID}` : ADDRESS_HELP_ID
                  }
                  invalid={addressInvalid}
                  busy={lookup.isPending}
                  mobile={isMobile}
                />
              </View>
              {renderFindButton(isMobile)}
              {renderLocationButton(isMobile)}
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
                  ref={choicesRef}
                  tabIndex={0}
                  aria-activedescendant={`find-legislator-choice-${choiceIndex}`}
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
                {choices.length > 1 ? (
                  <Text style={styles.choiceHelp}>
                    Use <Text style={styles.choiceKey}>↑</Text> and{' '}
                    <Text style={styles.choiceKey}>↓</Text> to move,{' '}
                    <Text style={styles.choiceKey}>Enter</Text> to choose
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>

          {state === 'empty' && !displayedResult ? renderMapSection() : null}
          <View
            style={state === 'empty' && !displayedResult ? undefined : styles.answer}
            accessibilityLiveRegion="polite"
          >
            {state === 'looking' && !retainedMapResult ? (
              <View accessible accessibilityLabel="Looking up districts">
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
              <View style={styles.foundWrap} accessibilityState={{ busy: lookup.isPending }}>
                {retainedMapResult && (lookup.isPending || activeError) ? (
                  <View
                    accessible
                    accessibilityLabel={mapUpdateLabel}
                    accessibilityLiveRegion="polite"
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
                    {displayedAddress ? (
                      <Text style={styles.addressHint}>{displayedAddress}</Text>
                    ) : null}
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
              </View>
            ) : null}
          </View>

          {state !== 'empty' || displayedResult ? renderMapSection() : null}
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
  intro: { maxWidth: 780, gap: 14 },
  description: { fontFamily: t.typography.body, color: '#4f5651' },
  title: {
    fontFamily: t.typography.title,
    fontSize: 52,
    lineHeight: 58,
    fontWeight: '800',
    color: t.colors.ink,
  },
  titleMobile: { fontSize: 38, lineHeight: 43 },
  addressArea: { marginTop: 34, maxWidth: 900, width: '100%', gap: 8, zIndex: 2 },
  addressLabel: {
    fontFamily: t.typography.body,
    fontSize: 16,
    fontWeight: '700',
    color: '#11150f',
  },
  addressHint: {
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 22,
    color: '#4f5651',
    marginBottom: 4,
  },
  controlRow: {
    zIndex: 1,
    flexWrap: 'wrap',
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  controlRowMobile: { flexDirection: 'column', alignItems: 'stretch' },
  findButton: {
    minHeight: 60,
    width: 150,
    flexDirection: 'row',
    gap: 9,
    borderRadius: 12,
    backgroundColor: '#2ed47e',
    alignItems: 'center',
    justifyContent: 'center',
    // The magnifier carries less weight than the word: centre the pair 3px left.
    paddingTop: 6,
    paddingRight: 23,
    paddingBottom: 6,
    paddingLeft: 17,
  },
  findButtonHovered: { backgroundColor: '#28bf71' },
  disabledButton: { opacity: 0.55 },
  fullWidthButton: {
    width: '100%',
    minHeight: 60,
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
    height: 60,
    alignSelf: 'center',
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
  locationButtonMobile: { width: '100%', minHeight: 60, height: 60, borderRadius: 14 },
  locationButtonHovered: { borderColor: '#2ed47e' },
  locationText: {
    fontFamily: t.typography.ui,
    fontSize: 16,
    fontWeight: '700',
    color: '#11150f',
  },
  answer: { marginTop: 22 },
  staticSpinner: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: '#6f756f',
  },
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
  choiceList: {
    marginTop: 8,
    maxHeight: 300,
    borderTopWidth: 1,
    borderColor: t.colors.alpha.ink08,
    ...(isWeb
      ? ({ overflowY: 'auto', overflowX: 'hidden' } as object)
      : { overflow: 'scroll' as const }),
  },
  choiceRow: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 10,
  },
  choiceRowActive: {
    borderColor: t.colors.brand.base,
  },
  choiceText: {
    minWidth: 0,
    fontFamily: t.typography.body,
    fontSize: 16,
    fontWeight: '500',
    color: t.colors.ink,
  },
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
});
