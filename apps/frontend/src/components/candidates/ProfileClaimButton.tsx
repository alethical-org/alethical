import { useEffect, type CSSProperties } from 'react';
import { Platform } from 'react-native';
import { CandidateButton, candidateText } from './CandidateControls';

/** Both labels size the same box, including wrapped phone labels. */
export function ProfileClaimButton({
  label,
  busyLabel,
  busy = false,
  disabled = false,
  kind = 'outline',
  onPress,
  width,
  describedBy,
  accessibilityLabel,
  selected,
}: {
  label: string;
  busyLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  kind?: 'green' | 'outline' | 'danger';
  onPress(): void;
  width?: CSSProperties['width'];
  describedBy?: string;
  accessibilityLabel?: string;
  selected?: boolean;
}) {
  useEffect(() => {
    if (typeof document === 'undefined' || document.getElementById('profile-claim-buttons')) return;
    const sheet = document.createElement('style');
    sheet.id = 'profile-claim-buttons';
    sheet.textContent = `.profile-claim-button:focus-visible,.profile-claim-input:focus-visible{outline:2px solid #7c5cff;outline-offset:2px}.profile-claim-button[aria-disabled=true]{cursor:default}.profile-claim-button[aria-busy=true]{cursor:progress}@media(hover:hover) and (pointer:fine){.profile-claim-button:not([aria-disabled=true]):hover{background:#f7f8fa!important;border-color:rgba(17,21,15,.3)!important}.profile-claim-button.green:not([aria-disabled=true]):hover{background:#28bf71!important;border-color:#28bf71!important}.profile-claim-button.danger:not([aria-disabled=true]):hover{background:#fdf3ee!important;border-color:#c98a6d!important}}.profile-claim-button:not([aria-disabled=true]):active{background:#eceff1!important}.profile-claim-button.green:not([aria-disabled=true]):active{background:#23ad66!important}.profile-claim-button.danger:not([aria-disabled=true]):active{background:#f9e6dc!important}@keyframes profile-claim-spin{to{transform:rotate(360deg)}}.profile-claim-spinner{animation:profile-claim-spin .8s linear infinite}@media(prefers-reduced-motion:reduce){.profile-claim-spinner{animation:none}}`;
    document.head.append(sheet);
  }, []);
  if (Platform.OS !== 'web')
    return (
      <CandidateButton
        label={label}
        busyLabel={busyLabel}
        busy={busy}
        disabled={disabled}
        icon="none"
        kind={kind === 'green' ? 'green' : 'outline'}
        onPress={onPress}
      />
    );
  const off = disabled || busy;
  const contentStyle: CSSProperties = {
    gridArea: '1 / 1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    minWidth: 0,
  };
  return (
    <>
      <button
        type="button"
        className={`profile-claim-button ${kind}`}
        aria-label={accessibilityLabel ?? (busy ? (busyLabel ?? label) : label)}
        aria-describedby={describedBy}
        aria-pressed={selected}
        aria-disabled={off || undefined}
        aria-busy={busy || undefined}
        onClick={() => {
          if (!off) onPress();
        }}
        style={{
          display: 'grid',
          boxSizing: 'border-box',
          minHeight: 48,
          padding: '10px 20px',
          width,
          maxWidth: '100%',
          alignSelf: 'flex-start',
          borderRadius: 12,
          border: `1px solid ${selected !== undefined ? (selected ? 'rgba(17,21,15,.16)' : 'transparent') : kind === 'green' ? '#2ed47e' : kind === 'danger' ? '#d9a58c' : 'rgba(17,21,15,.2)'}`,
          background:
            disabled && !busy
              ? '#eceff1'
              : selected === false
                ? 'transparent'
                : kind === 'green'
                  ? '#2ed47e'
                  : '#fff',
          color:
            disabled && !busy
              ? '#6f756f'
              : kind === 'green'
                ? '#06231a'
                : kind === 'danger'
                  ? '#a3421a'
                  : '#11150f',
          fontFamily: candidateText.body.fontFamily,
          fontSize: 16,
          fontWeight: 700,
          lineHeight: 1.3,
          cursor: off ? (busy ? 'progress' : 'default') : 'pointer',
          opacity: 1,
        }}
      >
        <span
          style={{ ...contentStyle, visibility: busy ? 'hidden' : 'visible' }}
          aria-hidden={busy || undefined}
        >
          {label}
        </span>
        {busyLabel ? (
          <span
            style={{ ...contentStyle, visibility: busy ? 'visible' : 'hidden' }}
            aria-hidden={!busy || undefined}
          >
            <span
              className="profile-claim-spinner"
              aria-hidden
              style={{
                display: 'inline-block',
                flexShrink: 0,
                width: 15,
                height: 15,
                border: '2px solid currentColor',
                borderRightColor: 'transparent',
                borderRadius: '50%',
              }}
            />
            {busyLabel}
          </span>
        ) : null}
      </button>
      <span
        role="status"
        aria-live="polite"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {busy ? (busyLabel ?? label) : ''}
      </span>
    </>
  );
}
