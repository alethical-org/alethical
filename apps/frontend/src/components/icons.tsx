import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import Svg, { Circle, Path, Polygon } from 'react-native-svg';

type SvgIconProps = ComponentProps<typeof Svg> & {
  absoluteStrokeWidth?: boolean;
  size?: number | string;
};

const defaultSize = 24;
const defaultStrokeWidth = 2;

function createIcon(children: ReactNode) {
  return forwardRef<Svg, SvgIconProps>(
    ({ absoluteStrokeWidth, color, size, strokeWidth, testID, ...props }, ref) => {
      const iconSize = size ?? defaultSize;
      const iconStrokeWidth = absoluteStrokeWidth
        ? (Number(strokeWidth ?? defaultStrokeWidth) * defaultSize) / Number(iconSize)
        : (strokeWidth ?? defaultStrokeWidth);

      return (
        <Svg
          ref={ref}
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color ?? 'currentColor'}
          strokeWidth={iconStrokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          data-testid={testID}
          {...props}
        >
          {children}
        </Svg>
      );
    },
  );
}

export type Icon = ReturnType<typeof createIcon>;

export const ArrowLeft = createIcon(
  <>
    <Path d="m12 19-7-7 7-7" />
    <Path d="M19 12H5" />
  </>,
);
export const BookmarkCheck = createIcon(
  <>
    <Path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z" />
    <Path d="m9 10 2 2 4-4" />
  </>,
);
export const MessageSquareText = createIcon(
  <>
    <Path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
    <Path d="M7 11h10" />
    <Path d="M7 15h6" />
    <Path d="M7 7h8" />
  </>,
);
export const Home = createIcon(
  <>
    <Path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
    <Path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </>,
);
export const MapPin = createIcon(
  <>
    <Path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
    <Circle cx="12" cy="10" r="3" />
  </>,
);
export const UserCircle = createIcon(
  <>
    <Path d="M17.925 20.056a6 6 0 0 0-11.851.001" />
    <Circle cx="12" cy="11" r="4" />
    <Circle cx="12" cy="12" r="10" />
  </>,
);
export const ChevronDown = createIcon(<Path d="m6 9 6 6 6-6" />);
export const ChevronUp = createIcon(<Path d="m18 15-6-6-6 6" />);
export const Menu = createIcon(
  <>
    <Path d="M4 5h16" />
    <Path d="M4 12h16" />
    <Path d="M4 19h16" />
  </>,
);
export const X = createIcon(
  <>
    <Path d="M18 6 6 18" />
    <Path d="m6 6 12 12" />
  </>,
);
export const ChevronLeft = createIcon(<Path d="m15 18-6-6 6-6" />);
export const ChevronRight = createIcon(<Path d="m9 18 6-6-6-6" />);
export const Search = createIcon(
  <>
    <Path d="m21 21-4.34-4.34" />
    <Circle cx="11" cy="11" r="8" />
  </>,
);
export const Check = createIcon(<Path d="M20 6 9 17l-5-5" />);
export const Plus = createIcon(
  <>
    <Path d="M5 12h14" />
    <Path d="M12 5v14" />
  </>,
);
export const RefreshCw = createIcon(
  <>
    <Path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <Path d="M21 3v5h-5" />
    <Path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <Path d="M8 16H3v5" />
  </>,
);
export const Navigation = createIcon(<Polygon points="3 11 22 2 13 21 11 13 3 11" />);
export const Crosshair = createIcon(
  <>
    <Circle cx="12" cy="12" r="3.4" />
    <Circle cx="12" cy="12" r="8.5" />
    <Path d="M12 2v3M12 19v3M22 12h-3M5 12H2" />
  </>,
);

export const usedIconNames = [
  'ArrowLeft',
  'BookmarkCheck',
  'MessageSquareText',
  'Home',
  'MapPin',
  'UserCircle',
  'ChevronDown',
  'ChevronUp',
  'Menu',
  'X',
  'ChevronLeft',
  'ChevronRight',
  'Search',
  'Check',
  'Plus',
  'RefreshCw',
  'Navigation',
  'Crosshair',
] as const;
