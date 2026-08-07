import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Crosshair, MapPin, Search } from '../components/icons';

import { MapPinPicker } from '../components/MapPinPicker';
import { RepresentativeCard, VacantSeatCard } from '../components/find/RepresentativeCard';
import { ApiError } from '../data/api';
import { isCoordinateInMinnesota } from '../data/minnesotaBoundary';
import type { RepresentativeAddressChoice, RepresentativeLookupCoordinates } from '../data/types';
import { useResponsive } from '../hooks/useResponsive';
import { useHistoryScrollRestoration } from '../hooks/useHistoryScrollRestoration';
import { useRepresentativeLookup } from '../hooks/useAppQueries';
import {
  addressChoiceKey,
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
const isWeb = Platform.OS === 'web';

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
      answer:
        'Check the house number and street name, then try again. If there’s more than one match, choose your address.',
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

function formatSourceDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
        date,
      );
}

export function FindMyLegislatorScreen({ navigation, route }: Props) {
  const { isMobile } = useResponsive();
  const historyScrollProps = useHistoryScrollRestoration();
  const requestedAddress =
    typeof route.params?.address === 'string' ? route.params.address : undefined;
  const requestedCoordinate = route.params?.coordinate;
  const [address, setAddress] = useState(requestedAddress ?? '');
  const [locationError, setLocationError] = useState(Boolean(route.params?.locationFailure));
  const [mapExpanded, setMapExpanded] = useState(false);
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [choiceIndex, setChoiceIndex] = useState(0);
  const [choiceClosed, setChoiceClosed] = useState(false);
  const [findingLocation, setFindingLocation] = useState(false);
  const [findHovered, setFindHovered] = useState(false);
  const [locationHovered, setLocationHovered] = useState(false);
  const { focused: addressFocused, focusProps: addressFocusProps } = useFieldFocus();
  const lookup = useRepresentativeLookup();
  const autoRanFor = useRef<string | null>(null);
  const addressInputRef = useRef<TextInput | null>(null);
  const geolocation = browserGeolocation();
  const result = lookup.data ?? undefined;
  const choices =
    result?.status === 'address-choice' && !choiceClosed ? (result.choices ?? []) : [];
  const found = result?.status === 'found';
  const hasVacancy = Boolean(found && (!result.houseLegislator || !result.senateLegislator));
  const state = viewStateForLookup({
    pending: lookup.isPending,
    found,
    choices: choices.length,
    vacant: hasVacancy,
    error: locationError ? 'location' : lookup.error ? errorKind(lookup.error) : undefined,
  });
  const activeError =
    state === 'not-found' ||
    state === 'outside-minnesota' ||
    state === 'location-error' ||
    state === 'service-down'
      ? errorCopy(state)
      : null;

  const runAddress = (value: string) => {
    const { serviceAddress } = prepareAddressLookup(value);
    if (!serviceAddress) return;
    setAddress(value);
    setLocationError(false);
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
  const runCoordinate = (coordinate: RepresentativeLookupCoordinates) => {
    setLocationError(false);
    setChoiceClosed(false);
    if (!isCoordinateInMinnesota(coordinate)) {
      setLocationError(true);
      return;
    }
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
    navigation.setParams({
      address: undefined,
      coordinate: undefined,
      lookupAddress: undefined,
      locationFailure: undefined,
    });
    runCoordinate(requestedCoordinate);
  }, [requestedCoordinate]);

  useEffect(() => {
    if (!route.params?.locationFailure) return;
    setAddress('');
    lookup.reset();
    setChoiceClosed(false);
    setChoiceIndex(0);
    setLocationError(true);
    navigation.setParams({
      address: undefined,
      coordinate: undefined,
      lookupAddress: undefined,
      locationFailure: undefined,
    });
  }, [route.params?.locationFailure]);

  const useLocation = () => {
    if (findingLocation || lookup.isPending) return;
    if (!geolocation) {
      setLocationError(true);
      return;
    }
    setLocationError(false);
    setFindingLocation(true);
    geolocation.getCurrentPosition(
      (position) => {
        setFindingLocation(false);
        runCoordinate({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      },
      () => {
        setFindingLocation(false);
        setLocationError(true);
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
    setChoiceClosed(true);
    runCoordinate({ latitude: choice.latitude, longitude: choice.longitude });
  };
  const onChoiceKey = (event: { nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
    const action = addressChoiceKey(event.nativeEvent?.key ?? '', choiceIndex, choices.length);
    if (!action) return;
    event.preventDefault?.();
    setChoiceIndex(action.index);
    if (action.action === 'choose') chooseAddress(choices[action.index]);
    if (action.action === 'close') setChoiceClosed(true);
  };
  const navigateFromMenu = (item: IaItem) => {
    if (item.id === 'search-bills') navigation.navigate('Bills');
    if (item.id === 'search-legislators') navigation.navigate('Legislators');
    if (item.id === 'search-find-my-legislator') navigation.navigate('FindMyLegislator');
    if (item.id === 'track-bills') navigation.navigate('Tabs', { screen: 'Tracked' });
  };
  const map = (
    <MapPinPicker
      coordinate={result?.coordinate}
      houseGeometry={result?.houseGeometry}
      senateGeometry={result?.senateGeometry}
      houseDistrict={result?.houseDistrict}
      senateDistrict={result?.senateDistrict}
      otherHouseDistrict={result?.otherHouseDistrict}
      mobile={isMobile}
      onCoordinateChange={runCoordinate}
    />
  );
  const sourceDate = formatSourceDate(result?.sourceUpdatedAt);
  const locationLabel = findingLocation ? 'Finding your location…' : 'Use my location';
  const locationBusy = findingLocation || lookup.isPending;
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
      <Text style={[styles.findButtonText, mobile && styles.findButtonTextMobile]}>Find</Text>
    </Pressable>
  );
  const renderLocationButton = (mobile: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={locationLabel}
      accessibilityState={{ busy: locationBusy, disabled: locationBusy }}
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

  return (
    <PageBackground>
      <ScrollView
        {...historyScrollProps}
        style={styles.scroll}
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
              Enter your full street address. Minnesota districts can divide a city, so a city,
              neighborhood, or ZIP alone cannot identify your legislators.
            </Text>
          </View>
          <View style={styles.addressArea}>
            <View style={[styles.controlRow, isMobile && styles.controlRowMobile]}>
              <View
                style={[
                  styles.inputShell,
                  activeError && styles.inputShellError,
                  ...fieldFocusRing(addressFocused),
                ]}
              >
                <TextInput
                  ref={addressInputRef}
                  accessibilityLabel="Full Minnesota street address"
                  aria-describedby={activeError ? ADDRESS_ERROR_ID : undefined}
                  aria-invalid={activeError ? true : undefined}
                  autoComplete="street-address"
                  placeholder={EXAMPLE_ADDRESS}
                  placeholderTextColor={t.colors.text.faint}
                  value={address}
                  onChangeText={(value) => {
                    setAddress(value);
                    lookup.reset();
                    setLocationError(false);
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
            {activeError ? (
              <Text
                nativeID={ADDRESS_ERROR_ID}
                style={styles.fieldError}
                accessibilityLiveRegion="polite"
              >
                {activeError.field}
              </Text>
            ) : null}
            {isMobile ? renderFindButton(true) : null}
            {isMobile ? renderLocationButton(true) : null}
          </View>

          <View style={styles.answer} accessibilityLiveRegion="polite">
            {state === 'empty' ? (
              <View style={styles.emptyAnswer}>
                <MapPin size={21} color={t.colors.brand.deep} />
                <Text style={styles.emptyText}>Your Minnesota legislators will appear here.</Text>
              </View>
            ) : null}
            {state === 'looking' ? (
              <View style={styles.looking} accessible accessibilityLabel="Looking up your address">
                {reducedMotion() ? (
                  <View style={styles.staticSpinner} />
                ) : (
                  <ActivityIndicator color={t.colors.brand.deep} />
                )}
                <View>
                  <Text style={styles.lookingTitle}>Looking up your address</Text>
                  <Text style={styles.lookingText}>Matching it to Minnesota districts…</Text>
                </View>
              </View>
            ) : null}
            {state === 'choice' ? (
              <View style={styles.choiceCard}>
                <Text style={styles.choiceTitle}>Choose your address</Text>
                <Text style={styles.choiceHelp}>More than 1 Minnesota address matched.</Text>
                <View
                  {...({ role: 'listbox' } as object)}
                  accessibilityLabel="Matching Minnesota addresses"
                  {...({ onKeyDown: onChoiceKey } as object)}
                  style={styles.choiceList}
                >
                  {choices.map((choice, index) => (
                    <Pressable
                      key={`${choice.matchedAddress}-${choice.latitude}-${choice.longitude}`}
                      {...({ role: 'option' } as object)}
                      aria-selected={index === choiceIndex}
                      onFocus={() => setChoiceIndex(index)}
                      onPress={() => chooseAddress(choice)}
                      style={[styles.choiceRow, index === choiceIndex && styles.choiceRowActive]}
                    >
                      <Text style={styles.choiceText}>{choice.matchedAddress}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
            {activeError ? (
              <View accessibilityRole="alert" style={styles.errorAlert}>
                <Text style={styles.errorText}>{activeError.answer}</Text>
              </View>
            ) : null}
            {(state === 'found' || state === 'vacant') && result ? (
              <View style={styles.foundWrap}>
                <View style={[styles.foundHeader, foundHeaderGradient]}>
                  <Text accessibilityRole="header" aria-level={2} style={styles.answerTitle}>
                    Your Minnesota legislators
                  </Text>
                  {result.session ? (
                    <Text style={styles.sessionLabel}>{legislatureLabel(result.session)}</Text>
                  ) : null}
                  {result.houseDistrict && result.senateDistrict ? (
                    <Text style={styles.nesting}>
                      House District {result.houseDistrict} is one of two House districts inside
                      Senate District {result.senateDistrict}
                    </Text>
                  ) : null}
                  {result.congressionalDistrict ? (
                    <Text style={styles.congressional}>
                      Congressional district {result.congressionalDistrict}
                    </Text>
                  ) : null}
                </View>
                <View style={[styles.cards, isMobile && styles.cardsMobile]}>
                  {result.senateLegislator ? (
                    <RepresentativeCard
                      legislator={result.senateLegislator}
                      onProfile={() =>
                        navigation.navigate('LegislatorProfile', {
                          legislatorId:
                            result.senateLegislator?.slug ?? result.senateLegislator!.id,
                        })
                      }
                    />
                  ) : (
                    <VacantSeatCard />
                  )}
                  {result.houseLegislator ? (
                    <RepresentativeCard
                      legislator={result.houseLegislator}
                      onProfile={() =>
                        navigation.navigate('LegislatorProfile', {
                          legislatorId: result.houseLegislator?.slug ?? result.houseLegislator!.id,
                        })
                      }
                    />
                  ) : (
                    <VacantSeatCard />
                  )}
                </View>
                {sourceDate ? (
                  <Text style={styles.source}>
                    Source: Minnesota Legislature · revisor.mn.gov · Updated {sourceDate}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>

          {isMobile ? (
            <View style={styles.mapSection}>
              <Pressable
                accessibilityRole="button"
                aria-expanded={mapExpanded}
                aria-controls="district-map-panel"
                onPress={() => setMapExpanded((value) => !value)}
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
          )}
          <View style={styles.notices}>
            <Text style={styles.notice}>
              This product uses the Census Bureau Data API but is not endorsed or certified by the
              Census Bureau.
            </Text>
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
  inputShellError: { borderColor: t.colors.ink },
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
  fieldError: {
    fontFamily: t.typography.body,
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.ink,
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
  emptyAnswer: {
    minHeight: 110,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.62)',
    borderWidth: 1,
    borderColor: t.colors.alpha.ink08,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  emptyText: { fontFamily: t.typography.body, fontSize: 16, color: t.colors.text.muted },
  looking: {
    minHeight: 110,
    borderRadius: 18,
    backgroundColor: 'white',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 24,
    ...(t.shadows.card as object),
  },
  staticSpinner: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: t.colors.brand.deep,
  },
  lookingTitle: {
    fontFamily: t.typography.title,
    fontSize: 19,
    fontWeight: '800',
    color: t.colors.ink,
  },
  lookingText: {
    fontFamily: t.typography.body,
    fontSize: 14,
    marginTop: 3,
    color: t.colors.text.muted,
  },
  choiceCard: {
    backgroundColor: 'white',
    borderRadius: 18,
    padding: 22,
    gap: 7,
    ...(t.shadows.card as object),
  },
  choiceTitle: {
    fontFamily: t.typography.title,
    fontSize: 22,
    fontWeight: '800',
    color: t.colors.ink,
  },
  choiceHelp: { fontFamily: t.typography.body, fontSize: 14, color: t.colors.text.muted },
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
    minHeight: 100,
    borderRadius: 18,
    backgroundColor: 'white',
    borderLeftWidth: 4,
    borderLeftColor: t.colors.brand.base,
    padding: 24,
    justifyContent: 'center',
    ...(t.shadows.card as object),
  },
  errorText: { fontFamily: t.typography.body, fontSize: 17, lineHeight: 26, color: t.colors.ink },
  foundWrap: { gap: 20 },
  foundHeader: {
    backgroundColor: '#f2f9f5',
    borderWidth: 1,
    borderColor: '#cbeed6',
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 24,
    gap: 7,
  },
  answerTitle: {
    fontFamily: t.typography.title,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    color: t.colors.ink,
  },
  sessionLabel: {
    fontFamily: t.typography.mono,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: t.colors.brand.deep,
  },
  nesting: {
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 23,
    color: t.colors.text.secondary,
  },
  congressional: { fontFamily: t.typography.body, fontSize: 14, color: t.colors.text.muted },
  cards: { flexDirection: 'row', gap: 18, alignItems: 'stretch' },
  cardsMobile: { flexDirection: 'column' },
  source: { fontFamily: t.typography.body, fontSize: 12, color: t.colors.text.faint },
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
  notices: { marginTop: 26, gap: 7 },
  notice: {
    fontFamily: t.typography.body,
    fontSize: 12,
    lineHeight: 18,
    color: t.colors.text.faint,
  },
});
