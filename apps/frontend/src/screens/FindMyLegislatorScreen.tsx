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
import { MapPin, Navigation } from 'lucide-react-native';

import { MapPinPicker } from '../components/MapPinPicker';
import { RepresentativeCard, VacantSeatCard } from '../components/find/RepresentativeCard';
import { ApiError } from '../data/api';
import { isCoordinateInMinnesota } from '../data/minnesotaBoundary';
import type { RepresentativeAddressChoice, RepresentativeLookupCoordinates } from '../data/types';
import { useResponsive } from '../hooks/useResponsive';
import { useRepresentativeLookup } from '../hooks/useAppQueries';
import {
  addressChoiceKey,
  districtMapVisible,
  legislatureLabel,
  prepareAddressLookup,
  shouldFocusFindMyLegislator,
  viewStateForLookup,
} from '../lib/findMyLegislator';
import type { IaItem, MenuKey } from '../navigation/ia';
import type { RootStackParamList } from '../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../theme/primitives';
import { theme as t } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'FindMyLegislator'>;
const EXAMPLE_ADDRESS = '350 S 5th St, Minneapolis, MN 55415';
const ADDRESS_ERROR_ID = 'find-legislator-address-error';

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
  const requestedAddress =
    typeof route.params?.address === 'string' ? route.params.address : undefined;
  const requestedCoordinate = route.params?.coordinate;
  const [address, setAddress] = useState(requestedAddress ?? '');
  const [locationError, setLocationError] = useState(Boolean(route.params?.locationFailure));
  const [mapExpanded, setMapExpanded] = useState(false);
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [choiceIndex, setChoiceIndex] = useState(0);
  const [choiceClosed, setChoiceClosed] = useState(false);
  const lookup = useRepresentativeLookup();
  const autoRanFor = useRef<string | null>(null);
  const addressInput = useRef<TextInput>(null);
  const focusOnFirstRender = useRef(
    shouldFocusFindMyLegislator({
      address: requestedAddress,
      coordinate: requestedCoordinate,
      focusAddress: route.params?.focusAddress,
      locationFailure: route.params?.locationFailure,
    }),
  ).current;
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
      focusAddress: undefined,
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
      focusAddress: undefined,
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
      focusAddress: undefined,
      lookupAddress: undefined,
      locationFailure: undefined,
    });
  }, [route.params?.locationFailure]);

  useEffect(() => {
    if (!focusOnFirstRender) return;
    addressInput.current?.focus();
  }, [focusOnFirstRender]);

  useEffect(() => {
    if (!route.params?.focusAddress) return;
    setAddress('');
    setLocationError(false);
    setChoiceClosed(false);
    setChoiceIndex(0);
    lookup.reset();
    addressInput.current?.focus();
    navigation.setParams({ focusAddress: undefined });
  }, [route.params?.focusAddress]);

  const useLocation = () => {
    if (!geolocation) {
      setLocationError(true);
      return;
    }
    setLocationError(false);
    geolocation.getCurrentPosition(
      (position) =>
        runCoordinate({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => setLocationError(true),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
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

  return (
    <PageBackground>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <TopNav
          variant="page"
          openMenu={openMenu}
          onOpenMenuChange={setOpenMenu}
          onNavigate={navigateFromMenu}
          onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
          onAsk={() => navigation.navigate('Ask', {})}
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
            <View style={[styles.inputShell, activeError && styles.inputShellError]}>
              <TextInput
                ref={addressInput}
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
                onSubmitEditing={() => runAddress(address)}
                style={styles.input}
                {...({ name: 'street-address' } as object)}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Find legislators"
                onPress={() => runAddress(address)}
                disabled={!address.trim() || lookup.isPending}
                style={({ pressed }) => [
                  styles.findButton,
                  (!address.trim() || lookup.isPending) && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.findButtonText}>Find</Text>
              </Pressable>
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
            <Pressable
              accessibilityRole="button"
              onPress={useLocation}
              disabled={lookup.isPending}
              style={({ pressed }) => [styles.locationButton, pressed && styles.pressed]}
            >
              <Navigation size={17} color={t.colors.brand.deep} />
              <Text style={styles.locationText}>Use my location</Text>
            </Pressable>
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
                <View style={styles.foundHeader}>
                  <Text accessibilityRole="header" aria-level={2} style={styles.answerTitle}>
                    Your Minnesota legislators
                  </Text>
                  {result.sessionName ? (
                    <Text style={styles.sessionLabel}>{legislatureLabel(result.sessionName)}</Text>
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
              Minnesota district shapes are provided by Minnesota GIS.
            </Text>
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
  addressArea: { marginTop: 34, maxWidth: 900, gap: 8 },
  inputShell: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: t.colors.alpha.ink14,
    paddingLeft: 18,
    paddingRight: 6,
    ...(t.shadows.card as object),
  },
  inputShellError: { borderColor: t.colors.ink },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    fontFamily: t.typography.body,
    fontSize: 16,
    color: t.colors.ink,
  },
  findButton: {
    minWidth: 86,
    minHeight: 48,
    borderRadius: 11,
    backgroundColor: t.colors.brand.deep,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  findButtonText: { fontFamily: t.typography.ui, fontSize: 15, fontWeight: '700', color: 'white' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.72 },
  fieldError: {
    fontFamily: t.typography.body,
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.ink,
  },
  locationButton: {
    minHeight: 44,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
  },
  locationText: {
    fontFamily: t.typography.ui,
    fontSize: 14,
    fontWeight: '700',
    color: t.colors.brand.deep,
    textDecorationLine: 'underline',
  },
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
    backgroundColor: t.colors.tint.t100,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    borderRadius: 18,
    padding: 24,
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
