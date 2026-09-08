import { createElement, useEffect, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { GoBackLink } from '../../components/GoBackLink';
import { SocialIconLink } from '../../components/SocialIconLink';
import { sendContactMessageFromApi } from '../../data/api';
import { useResponsive } from '../../hooks/useResponsive';
import {
  CONTACT_FIELD_ORDER,
  CONTACT_EMAIL,
  CONTACT_PAGE_HEADING,
  CONTACT_PAGE_SUBTITLE,
  CONTACT_SOCIALS,
  ContactField,
  contactFormReducer,
  initialContactFormState,
  validateContactForm,
} from '../../lib/contactUs';
import { IaItem, MenuKey } from '../../navigation/ia';
import { routePath } from '../../navigation/links';
import { navigateTopNavItem } from '../../navigation/topNavRoutes';
import { RootScreenProps } from '../../navigation/types';
import { browserFillInputProps } from '../../theme/browserFill';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { prefersReducedMotion, theme as t } from '../../theme/tokens';

const FIELD_LABELS: Record<ContactField, { label: string; optional?: boolean }> = {
  name: { label: 'YOUR NAME', optional: true },
  email: { label: 'EMAIL ADDRESS' },
  phone: { label: 'PHONE', optional: true },
  subject: { label: 'SUBJECT' },
  message: { label: 'MESSAGE' },
};

function requestId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function ContactEmailLink() {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      accessibilityRole="link"
      {...(Platform.OS === 'web' ? ({ href: `mailto:${CONTACT_EMAIL}` } as any) : {})}
      onPress={
        Platform.OS === 'web' ? undefined : () => void Linking.openURL(`mailto:${CONTACT_EMAIL}`)
      }
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={styles.emailLink}
    >
      {({ pressed }) => (
        <Text
          style={[
            styles.emailLinkText,
            (hovered || focused || pressed) && styles.emailLinkTextActive,
          ]}
        >
          {CONTACT_EMAIL}
        </Text>
      )}
    </Pressable>
  );
}

function FailureEmailLink() {
  const [active, setActive] = useState(false);
  const mailto = `mailto:${CONTACT_EMAIL}`;

  if (Platform.OS === 'web') {
    return createElement(
      'a',
      {
        href: mailto,
        onBlur: () => setActive(false),
        onFocus: () => setActive(true),
        onMouseEnter: () => setActive(true),
        onMouseLeave: () => setActive(false),
        style: StyleSheet.flatten([styles.failureLink, active && styles.failureLinkActive]) as any,
      },
      CONTACT_EMAIL,
    );
  }

  return (
    <Text
      accessibilityRole="link"
      onPress={() => void Linking.openURL(mailto)}
      style={styles.failureLink}
    >
      {CONTACT_EMAIL}
    </Text>
  );
}

function ContactFieldInput({
  field,
  value,
  error,
  disabled,
  onChange,
  rows,
  inputRef,
}: {
  field: ContactField;
  value: string;
  error?: string;
  disabled: boolean;
  onChange: (value: string) => void;
  rows?: number;
  inputRef: (node: any) => void;
}) {
  const { focused, focusProps } = useFieldFocus();
  const descriptionId = error ? `${field}-error` : undefined;
  const multiline = field === 'message';
  const receivesBrowserFill = field === 'name' || field === 'email' || field === 'phone';
  const inputShellStyle = [
    styles.inputShell,
    error && styles.inputError,
    disabled && styles.inputDisabled,
    ...fieldFocusRing(focused),
  ];
  const inputStyle = [styles.input, multiline && styles.messageInput, fieldOutlineReset];

  const input =
    Platform.OS === 'web' ? (
      createElement(multiline ? 'textarea' : 'input', {
        ...(receivesBrowserFill ? browserFillInputProps : {}),
        'aria-describedby': descriptionId,
        'aria-invalid': Boolean(error),
        'aria-labelledby': `${field}-label`,
        autoCapitalize: field === 'email' ? 'none' : 'sentences',
        autoComplete:
          field === 'name'
            ? 'name'
            : field === 'email'
              ? 'email'
              : field === 'phone'
                ? 'tel'
                : 'off',
        disabled,
        inputMode: field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text',
        maxLength:
          field === 'message' ? 5000 : field === 'subject' ? 200 : field === 'name' ? 120 : 40,
        id: `contact-${field}`,
        name: field,
        onBlur: focusProps.onBlur,
        onChange: (event: { currentTarget: { value: string } }) =>
          onChange(event.currentTarget.value),
        onFocus: focusProps.onFocus,
        rows,
        ref: inputRef,
        spellCheck: field === 'email' ? false : undefined,
        style: StyleSheet.flatten(inputStyle) as any,
        value,
      })
    ) : (
      <TextInput
        ref={inputRef}
        accessibilityLabel={FIELD_LABELS[field].label}
        aria-labelledby={`${field}-label`}
        aria-describedby={descriptionId}
        aria-invalid={Boolean(error)}
        autoCapitalize={field === 'email' ? 'none' : 'sentences'}
        autoComplete={
          field === 'name'
            ? 'name'
            : field === 'email'
              ? 'email'
              : field === 'phone'
                ? 'tel'
                : 'off'
        }
        editable={!disabled}
        inputMode={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'}
        maxLength={
          field === 'message' ? 5000 : field === 'subject' ? 200 : field === 'name' ? 120 : 40
        }
        multiline={multiline}
        numberOfLines={rows}
        spellCheck={field === 'email' ? false : undefined}
        value={value}
        onChangeText={onChange}
        {...focusProps}
        style={inputStyle}
      />
    );

  const label =
    Platform.OS === 'web' ? (
      createElement(
        'label',
        {
          htmlFor: `contact-${field}`,
          id: `${field}-label`,
          style: {
            ...StyleSheet.flatten(styles.fieldLabel),
            ...StyleSheet.flatten(styles.webFieldLabel),
          } as any,
        },
        FIELD_LABELS[field].label,
        FIELD_LABELS[field].optional
          ? createElement(
              'span',
              { style: StyleSheet.flatten(styles.optional) as any },
              ' (OPTIONAL)',
            )
          : null,
      )
    ) : (
      <Text nativeID={`${field}-label`} style={styles.fieldLabel}>
        {FIELD_LABELS[field].label}
        {FIELD_LABELS[field].optional ? <Text style={styles.optional}> (OPTIONAL)</Text> : null}
      </Text>
    );

  return (
    <View style={styles.fieldGroup}>
      {label}
      <View style={inputShellStyle}>{input}</View>
      {error ? (
        <Text nativeID={descriptionId} accessibilityRole="alert" style={styles.fieldError}>
          ⚠ {error}
        </Text>
      ) : null}
    </View>
  );
}

export function ContactUsScreen({ navigation }: RootScreenProps<'ContactUs'>) {
  const { isMobile } = useResponsive();
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [state, dispatch] = useReducer(contactFormReducer, initialContactFormState);
  const requestIdRef = useRef<string | null>(null);
  const fieldRefs = useRef<Partial<Record<ContactField, any>>>({});
  const hasDraft = CONTACT_FIELD_ORDER.some((field) => state.values[field].length > 0);

  useEffect(() => {
    if (Platform.OS !== 'web' || !hasDraft || state.status === 'sent') return;
    const keepDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', keepDraft);
    return () => window.removeEventListener('beforeunload', keepDraft);
  }, [hasDraft, state.status]);

  const handleNavigate = (item: IaItem) => {
    if (!navigateTopNavItem(navigation, item)) return;
    setOpenMenu(null);
  };

  const changeField = (field: ContactField, value: string) => {
    requestIdRef.current = null;
    dispatch({ type: 'change', field, value });
  };

  const submit = async () => {
    const errors = validateContactForm(state.values);
    if (Object.keys(errors).length > 0) {
      dispatch({ type: 'validate', errors });
      const firstError = CONTACT_FIELD_ORDER.find((field) => errors[field]);
      if (firstError) {
        setTimeout(() => fieldRefs.current[firstError]?.focus?.(), 0);
      }
      return;
    }
    dispatch({ type: 'submit' });
    requestIdRef.current ??= requestId();
    try {
      await sendContactMessageFromApi({ requestId: requestIdRef.current, ...state.values });
      dispatch({ type: 'sent' });
    } catch {
      dispatch({ type: 'failed' });
    }
  };

  const reset = () => {
    requestIdRef.current = null;
    dispatch({ type: 'reset' });
  };

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <TopNav
          openMenu={openMenu}
          onOpenMenuChange={setOpenMenu}
          onNavigate={handleNavigate}
          onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
        />
        <Container style={[styles.main, isMobile && styles.mainMobile]}>
          <GoBackLink
            href={routePath.home()}
            onPress={() => navigation.navigate('Tabs', { screen: 'Home' })}
            mobile={isMobile}
          />
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={[styles.title, isMobile && styles.titleMobile]}
          >
            {CONTACT_PAGE_HEADING}
          </Text>
          <Text style={[styles.subtitle, isMobile && styles.subtitleMobile]}>
            {CONTACT_PAGE_SUBTITLE}
          </Text>

          <View style={[styles.columns, isMobile && styles.columnsMobile]}>
            <View style={styles.formColumn}>
              {state.status === 'sent' ? (
                <View
                  accessibilityLiveRegion="polite"
                  {...(Platform.OS === 'web' ? ({ role: 'status' } as any) : {})}
                  style={[styles.sentPanel, isMobile && styles.sentPanelMobile]}
                >
                  <View style={[styles.sentMark, isMobile && styles.sentMarkMobile]}>
                    <Svg
                      width={isMobile ? 24 : 26}
                      height={isMobile ? 24 : 26}
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden
                    >
                      <Path
                        d="M5 12.5 L10 17.5 L19 7"
                        stroke="#0f7a45"
                        strokeWidth={2.4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                  </View>
                  <Text style={[styles.sentTitle, isMobile && styles.sentTitleMobile]}>
                    Message sent
                  </Text>
                  <Text style={[styles.sentText, isMobile && styles.sentTextMobile]}>
                    On its way to {CONTACT_EMAIL}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={reset}
                    style={[styles.secondaryButton, isMobile && styles.secondaryButtonMobile]}
                  >
                    <Text style={styles.secondaryButtonText}>Send another message</Text>
                  </Pressable>
                </View>
              ) : (
                <View>
                  {CONTACT_FIELD_ORDER.map((field) => (
                    <ContactFieldInput
                      key={field}
                      field={field}
                      value={state.values[field]}
                      error={state.errors[field]}
                      disabled={state.status === 'sending'}
                      onChange={(value) => changeField(field, value)}
                      rows={field === 'message' ? (isMobile ? 9 : 11) : undefined}
                      inputRef={(node) => {
                        fieldRefs.current[field] = node;
                      }}
                    />
                  ))}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled: state.status === 'sending',
                      busy: state.status === 'sending',
                    }}
                    disabled={state.status === 'sending'}
                    onPress={() => void submit()}
                    style={({ pressed }) => [
                      styles.submitButton,
                      isMobile && styles.submitButtonMobile,
                      pressed && styles.submitButtonPressed,
                      state.status === 'sending' && styles.submitButtonDisabled,
                    ]}
                  >
                    {state.status === 'sending' && !prefersReducedMotion() ? (
                      <ActivityIndicator color={t.colors.brand.darkest} size="small" />
                    ) : null}
                    <Text style={styles.submitButtonText}>
                      {state.status === 'sending' ? 'Sending…' : 'Send message'}
                    </Text>
                  </Pressable>
                  {state.sendFailed ? (
                    <View
                      accessibilityRole="alert"
                      style={[styles.failureRow, isMobile && styles.failureRowMobile]}
                    >
                      <Svg
                        width={18}
                        height={18}
                        viewBox="0 0 24 24"
                        fill="none"
                        style={styles.failureIcon}
                        aria-hidden
                      >
                        <Path
                          d="M12 8 V13 M12 16.5 V16.6 M4 20 H20 L13.7 5 A2 2 0 0 0 10.3 5 Z"
                          stroke="#a76a1a"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </Svg>
                      <Text style={[styles.failureText, isMobile && styles.failureTextMobile]}>
                        <Text style={styles.failureTitle}>Couldn&apos;t send.</Text>
                        {' Try again, or email '}
                        <FailureEmailLink />
                      </Text>
                    </View>
                  ) : null}
                </View>
              )}
            </View>

            <View style={styles.sideColumn}>
              <View style={[styles.infoCard, isMobile && styles.infoCardMobile]}>
                <Text style={styles.cardEyebrow}>EMAIL US</Text>
                <ContactEmailLink />
              </View>
              {!isMobile ? (
                <View style={styles.infoCard}>
                  <Text style={styles.cardEyebrow}>FOLLOW ALETHICAL</Text>
                  <View style={styles.socialRow}>
                    {CONTACT_SOCIALS.map((social) => (
                      <SocialIconLink key={social.platform} social={social} surface="contact" />
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
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
  page: { flexGrow: 1 },
  main: { paddingTop: 34, paddingBottom: 104, maxWidth: 1248, alignSelf: 'center' },
  mainMobile: { paddingTop: 18, paddingBottom: 52, paddingHorizontal: 20 },
  title: {
    color: t.colors.ink,
    fontFamily: t.typography.title,
    fontSize: 44,
    lineHeight: 48,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -1.1,
  },
  titleMobile: { fontSize: 30, lineHeight: 33, letterSpacing: -0.6, marginTop: 8 },
  subtitle: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 18,
    lineHeight: 28,
    maxWidth: 720,
    marginTop: 14,
  },
  subtitleMobile: { fontSize: 15, lineHeight: 23, marginTop: 11 },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: 44, marginTop: 32 },
  columnsMobile: { flexDirection: 'column', gap: 0, marginTop: 20 },
  formColumn: {
    flex: 1,
    width: '100%',
  },
  fieldGroup: { marginBottom: 18 },
  fieldLabel: {
    color: t.colors.text.primary,
    fontFamily: t.typography.mono,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.32,
    marginBottom: 8,
  },
  webFieldLabel: { lineHeight: '17px' } as any,
  optional: { color: t.colors.text.muted, fontWeight: t.fontWeights.regular },
  inputShell: {
    width: '100%',
    minHeight: 52,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.18)',
    borderRadius: 12,
    backgroundColor: t.colors.surfaces.base,
  },
  input: {
    width: '100%',
    minHeight: 50,
    borderWidth: 0,
    borderRadius: 12,
    backgroundColor: 'transparent',
    color: t.colors.text.primary,
    fontFamily: t.typography.body,
    fontSize: 17,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  messageInput: {
    minHeight: 320,
    maxHeight: 520,
    textAlignVertical: 'top',
    ...(Platform.OS === 'web' ? ({ resize: 'vertical' } as object) : null),
  },
  inputError: { borderColor: '#a76a1a' },
  inputDisabled: { opacity: 0.7 },
  fieldError: {
    color: '#765000',
    fontFamily: t.typography.body,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 7,
  },
  failureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 18,
  },
  failureRowMobile: { gap: 9, marginTop: 16 },
  failureIcon: { flexShrink: 0, marginTop: 1 },
  failureTitle: {
    color: '#11150f',
    fontWeight: t.fontWeights.bold,
  },
  failureText: {
    flex: 1,
    color: '#4f5651',
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 22.5,
  },
  failureTextMobile: { fontSize: 14.5, lineHeight: 21.75 },
  failureLink: {
    color: '#0f7a45',
    fontFamily: t.typography.body,
    fontWeight: t.fontWeights.semibold,
    textDecorationLine: 'none',
  },
  failureLinkActive: { textDecorationLine: 'underline' },
  submitButton: {
    minHeight: 52,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: t.colors.brand.base,
    paddingHorizontal: 30,
    alignSelf: 'flex-start',
  },
  submitButtonMobile: { width: '100%', minHeight: 48 },
  submitButtonPressed: { backgroundColor: t.colors.brand.hover },
  submitButtonDisabled: { opacity: 0.65 },
  submitButtonText: {
    color: t.colors.text.onGreen,
    fontFamily: t.typography.ui,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: t.fontWeights.bold,
  },
  sentPanel: {
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    backgroundColor: t.colors.tint.t50,
    borderRadius: 16,
    paddingVertical: 25,
    paddingHorizontal: 26,
    alignItems: 'flex-start',
  },
  sentPanelMobile: { borderRadius: 14, paddingVertical: 22, paddingHorizontal: 18 },
  sentMark: {
    width: 52,
    height: 52,
    borderRadius: 13,
    backgroundColor: t.colors.tint.t150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sentMarkMobile: { width: 46, height: 46, borderRadius: 12 },
  sentTitle: {
    color: t.colors.ink,
    fontFamily: t.typography.title,
    fontSize: 26,
    lineHeight: 34,
    fontWeight: t.fontWeights.heavy,
    letterSpacing: -0.26,
    marginTop: 18,
  },
  sentTitleMobile: { fontSize: 21, lineHeight: 27, letterSpacing: -0.21, marginTop: 14 },
  sentText: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.body,
    fontSize: 17,
    lineHeight: 26.35,
    marginTop: 10,
    maxWidth: 500,
  },
  sentTextMobile: { fontSize: 15, lineHeight: 23.25, marginTop: 8 },
  secondaryButton: {
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: t.colors.surfaces.base,
    borderWidth: 1,
    borderColor: t.colors.alpha.ink20,
    borderRadius: 11,
    paddingHorizontal: 22,
    paddingVertical: 13,
    marginTop: 20,
  },
  secondaryButtonMobile: { width: '100%', minHeight: 48, borderRadius: 12, marginTop: 16 },
  secondaryButtonText: {
    color: t.colors.ink,
    fontFamily: t.typography.ui,
    fontSize: 15,
    fontWeight: t.fontWeights.bold,
  },
  sideColumn: { width: 372, maxWidth: '100%', gap: 14 },
  infoCard: {
    width: '100%',
    backgroundColor: t.colors.surfaces.s100,
    borderWidth: 1,
    borderColor: t.colors.borders.base,
    borderRadius: 16,
    padding: 24,
  },
  infoCardMobile: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderTopWidth: 1,
    borderTopColor: t.colors.alpha.ink10,
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingTop: 20,
    paddingBottom: 2,
    marginTop: 20,
  },
  cardEyebrow: {
    color: t.colors.text.secondary,
    fontFamily: t.typography.mono,
    fontSize: 10.5,
    lineHeight: 17,
    fontWeight: t.fontWeights.bold,
    letterSpacing: 1.26,
  },
  emailLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  emailLinkText: {
    color: t.colors.brand.deep,
    fontFamily: t.typography.body,
    fontSize: 16,
    fontWeight: t.fontWeights.semibold,
  },
  emailLinkTextActive: { textDecorationLine: 'underline' },
  socialRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
});
