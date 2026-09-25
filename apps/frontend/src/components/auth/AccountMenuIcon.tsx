import Svg, { Path, Rect } from 'react-native-svg';

// Menu-only paths: the password dialog's larger lock and success check stay separate.
export function AccountMenuIcon({
  name,
  busy = false,
}: {
  name: 'bookmark' | 'password' | 'email' | 'sign-out';
  busy?: boolean;
}) {
  const line = {
    stroke: busy ? '#8a908a' : '#4b524b',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden>
      {name === 'bookmark' ? (
        <Path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z" {...line} />
      ) : name === 'password' ? (
        <>
          <Rect x={5} y={11} width={14} height={9} rx={2} {...line} />
          <Path d="M8 11V8a4 4 0 0 1 8 0v3" {...line} />
        </>
      ) : name === 'email' ? (
        <>
          <Rect x={3.5} y={5.5} width={17} height={13} rx={2} {...line} />
          <Path d="M4.5 7.5 L12 13 L19.5 7.5" {...line} />
        </>
      ) : (
        <>
          <Path
            d="M14 8V6a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-2"
            {...line}
          />
          <Path d="M10 12h10M17 9l3 3-3 3" {...line} />
        </>
      )}
    </Svg>
  );
}
