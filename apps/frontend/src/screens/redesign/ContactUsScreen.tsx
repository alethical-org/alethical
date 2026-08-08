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
import { sendContactMessageFromApi } from '../../data/api';
import { useResponsive } from '../../hooks/useResponsive';
import {
  CONTACT_FIELD_ORDER,
  ContactField,
  contactFormReducer,
  initialContactFormState,
  validateContactForm,
} from '../../lib/contactUs';
import { IaItem, MenuKey } from '../../navigation/ia';
import { externalLinkProps, routePath } from '../../navigation/links';
import { navigateTopNavItem } from '../../navigation/topNavRoutes';
import { RootScreenProps } from '../../navigation/types';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../../theme/fieldFocus';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { prefersReducedMotion, theme as t } from '../../theme/tokens';

const SOCIALS = [
  {
    label: 'Facebook',
    url: 'https://www.facebook.com/people/Alethical/61588261592240/',
  },
  {
    label: 'LinkedIn',
    url: 'https://www.linkedin.com/company/alethical',
  },
  { label: 'X', url: 'https://x.com/alethical' },
] as const;

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
      {...(Platform.OS === 'web' ? ({ href: 'mailto:ask@alethical.com' } as any) : {})}
      onPress={
        Platform.OS === 'web' ? undefined : () => void Linking.openURL('mailto:ask@alethical.com')
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
          ask@alethical.com
        </Text>
      )}
    </Pressable>
  );
}

function FailureEmailLink() {
  const [active, setActive] = useState(false);
  const mailto = 'mailto:ask@alethical.com';

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
      'ask@alethical.com',
    );
  }

  return (
    <Text
      accessibilityRole="link"
      onPress={() => void Linking.openURL(mailto)}
      style={styles.failureLink}
    >
      ask@alethical.com
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
  const inputStyle = [
    styles.input,
    multiline && styles.messageInput,
    error && styles.inputError,
    disabled && styles.inputDisabled,
    ...fieldFocusRing(focused),
    fieldOutlineReset,
  ];

  const input =
    Platform.OS === 'web' ? (
      createElement(multiline ? 'textarea' : 'input', {
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
      {input}
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
          <Text accessibilityRole="header" style={[styles.title, isMobile && styles.titleMobile]}>
            Contact us
          </Text>
          <Text style={[styles.subtitle, isMobile && styles.subtitleMobile]}>
            Questions about a bill, corrections to something we&apos;ve published, or anything else
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
                    On its way to ask@alethical.com
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
              <View style={[styles.infoCard, isMobile && styles.infoCardMobile]}>
                <Text style={styles.cardEyebrow}>FOLLOW ALETHICAL</Text>
                <View style={styles.socialRow}>
                  {SOCIALS.map((social) => (
                    <Pressable
                      key={social.label}
                      {...externalLinkProps(social.url, () => void Linking.openURL(social.url))}
                      accessibilityLabel={`Alethical on ${social.label} (opens in a new tab)`}
                      style={({ pressed }) => [styles.socialLink, pressed && styles.socialPressed]}
                    >
                      {social.label === 'Facebook' ? (
                        <Svg
                          width={24}
                          height={24}
                          viewBox="0 0 24 24"
                          fill={t.colors.ink}
                          aria-hidden
                        >
                          <Path d="M15.12 5.32H17V2.14A26.11 26.11 0 0 0 14.26 2c-2.72 0-4.58 1.66-4.58 4.7v2.6H6.61v3.56h3.07V22h3.68v-9.14h3.06l.46-3.56h-3.52V7.05c0-1.03.28-1.73 1.76-1.73z" />
                        </Svg>
                      ) : social.label === 'LinkedIn' ? (
                        <Svg
                          width={22}
                          height={22}
                          viewBox="0.87 2.87 22 22"
                          fill={t.colors.ink}
                          aria-hidden
                        >
                          <Path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45z" />
                        </Svg>
                      ) : (
                        <Svg
                          width={21}
                          height={21}
                          viewBox="0 0 24 24"
                          fill={t.colors.ink}
                          aria-hidden
                        >
                          <Path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                        </Svg>
                      )}
                    </Pressable>
                  ))}
                </View>
              </View>
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
  input: {
    width: '100%',
    minHeight: 52,
    borderWidth: 1,
    borderColor: t.colors.borders.strong,
    borderRadius: 12,
    backgroundColor: t.colors.surfaces.base,
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
  inputError: { borderColor: '#9a6a00' },
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
  socialRow: { flexDirection: 'row', gap: 12, marginTop: 18 },
  socialLink: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: t.colors.surfaces.s400,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialPressed: { opacity: 0.72 },
});
