export type BillTrackButtonSize = 'web' | 'mobile' | 'card';

const SIZE_TOKENS = {
  web: {
    gap: 10,
    borderRadius: 12,
    paddingTop: 13,
    paddingRight: 22,
    paddingBottom: 13,
    paddingLeft: 19,
    minHeight: 44,
    fontSize: 16,
    fontWeight: '600',
    glyphSize: 17,
  },
  mobile: {
    gap: 7,
    borderRadius: 10,
    paddingTop: 12,
    paddingRight: 19,
    paddingBottom: 12,
    paddingLeft: 16,
    minHeight: 44,
    fontSize: 15,
    fontWeight: '600',
    glyphSize: 16,
  },
  card: {
    gap: 8,
    borderRadius: 10,
    paddingTop: 11,
    paddingRight: 17,
    paddingBottom: 11,
    paddingLeft: 14,
    minHeight: 44,
    fontSize: 14,
    fontWeight: '700',
    glyphSize: 15,
  },
} as const;

const UNTRACKED = {
  backgroundColor: '#11150f',
  borderColor: '#11150f',
  textColor: '#ffffff',
  glyphColor: '#ffffff',
} as const;

const UNTRACKED_HOVER = {
  ...UNTRACKED,
  backgroundColor: '#2c322c',
  borderColor: '#2c322c',
} as const;

const TRACKED = {
  backgroundColor: '#cdeedd',
  borderColor: '#8ed3ae',
  textColor: '#06231a',
  glyphColor: '#0f7a45',
} as const;

const TRACKED_HOVER = {
  ...TRACKED,
  backgroundColor: '#b9e6cd',
  borderColor: '#6cc596',
} as const;

export function trackButtonAppearance(tracked: boolean, hovered: boolean) {
  if (tracked) return hovered ? TRACKED_HOVER : TRACKED;
  return hovered ? UNTRACKED_HOVER : UNTRACKED;
}

export function trackButtonSize(size: BillTrackButtonSize) {
  return SIZE_TOKENS[size];
}

export function trackButtonToggleProps(tracked: boolean) {
  return {
    'aria-pressed': tracked,
    accessibilityLabel: 'Track this bill',
  } as const;
}
