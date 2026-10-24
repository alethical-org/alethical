import { Platform } from 'react-native';

export function ClearAddressButton({
  onClear,
  visible,
  top = 8,
  right = 8,
}: {
  onClear(): void;
  visible: boolean;
  top?: number;
  right?: number;
}) {
  if (Platform.OS !== 'web') return null;
  return (
    <>
      <style>{`[data-clear-address]{background:transparent;outline:none}[data-clear-address]:focus-visible{outline:2px solid #7c5cff;outline-offset:2px}@media(hover:hover) and (pointer:fine){[data-clear-address]:hover{background:#f1f1f4}}[data-clear-address]:active{background:#e6e8e7}@media(forced-colors:active){[data-clear-address]:focus-visible{outline-color:Highlight}}`}</style>
      <button
        type="button"
        data-clear-address
        aria-label="Clear address"
        tabIndex={visible ? 0 : -1}
        aria-hidden={!visible || undefined}
        onPointerDown={(event) => event.preventDefault()}
        onClick={onClear}
        style={{
          position: 'absolute',
          top,
          right,
          width: 44,
          height: 44,
          padding: 0,
          border: 0,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          visibility: visible ? 'visible' : 'hidden',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 6 L18 18 M18 6 L6 18"
            stroke="#4f5651"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </>
  );
}
