import { describe, expect, it } from 'vitest';

import {
  trackButtonAppearance,
  trackButtonSize,
  trackButtonToggleProps,
} from '../billTrackButtonAppearance';

describe('Track button appearance', () => {
  it('keeps the untracked colours that already ship', () => {
    expect(trackButtonAppearance(false, false)).toEqual({
      backgroundColor: '#11150f',
      borderColor: '#11150f',
      textColor: '#ffffff',
      glyphColor: '#ffffff',
    });
    expect(trackButtonAppearance(false, true)).toEqual({
      backgroundColor: '#2c322c',
      borderColor: '#2c322c',
      textColor: '#ffffff',
      glyphColor: '#ffffff',
    });
  });

  it('gives tracked bills their mint completed-state colours', () => {
    expect(trackButtonAppearance(true, false)).toEqual({
      backgroundColor: '#cdeedd',
      borderColor: '#8ed3ae',
      textColor: '#06231a',
      glyphColor: '#0f7a45',
    });
    expect(trackButtonAppearance(true, true)).toEqual({
      backgroundColor: '#b9e6cd',
      borderColor: '#6cc596',
      textColor: '#06231a',
      glyphColor: '#0f7a45',
    });
  });

  it('uses the handoff size tokens without locking either label to a fixed width', () => {
    expect(trackButtonSize('web')).toEqual({
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
    });
    expect(trackButtonSize('mobile')).toEqual({
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
    });
    expect(trackButtonSize('card')).toEqual({
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
    });
  });

  it('announces both halves as one pressed or unpressed toggle', () => {
    expect(trackButtonToggleProps(false)).toEqual({
      'aria-pressed': false,
      accessibilityLabel: 'Track this bill',
    });
    expect(trackButtonToggleProps(true)).toEqual({
      'aria-pressed': true,
      accessibilityLabel: 'Track this bill',
    });
  });
});
