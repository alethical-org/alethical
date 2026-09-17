import { describe, expect, it } from 'vitest';
import {
  LOBBYING_DIRECTORY_COPY as copy,
  MONEY_LANE_LOBBYING,
  lobbyistLaneCount,
  moneyLandingLobbyistCount,
  principalLaneCount,
  lobbyingHeldYearsNote,
  lobbyingLobbyistDirectoryDate,
  lobbyingPrincipalDirectoryScope,
  lobbyingPrincipalCount,
  lobbyingNoSpendingRows,
  lobbyingShowingLine,
} from '../lobbyingDirectoryCopy';

describe('lobbying directory wording', () => {
  it('uses filed counts and years, not illustrative drawing figures', () => {
    expect(lobbyistLaneCount(1665)).toBe('1,665 LOBBYISTS LISTED');
    expect(principalLaneCount(1748, 2025)).toBe('1,748 ORGANISATIONS REPORTED SPENDING FOR 2025');
    expect(principalLaneCount(0, 2025)).toBe('0 ORGANISATIONS REPORTED SPENDING FOR 2025');
    expect(lobbyistLaneCount(null)).toBeNull();
    expect(principalLaneCount(1748, null)).toBeNull();
    expect(lobbyingHeldYearsNote(2014)).toBe('The spending records shown here begin in 2014.');
    expect(lobbyingHeldYearsNote(null)).toBeNull();
  });
  it('names registered lobbyists on /money without implying the count is from today', () => {
    expect(moneyLandingLobbyistCount(1665)).toBe('1,665 REGISTERED LOBBYISTS');
    expect(moneyLandingLobbyistCount(0)).toBe('0 REGISTERED LOBBYISTS');
    expect(moneyLandingLobbyistCount(null)).toBeNull();
    expect(moneyLandingLobbyistCount(undefined)).toBeNull();
    expect(lobbyistLaneCount(1665)).toBe('1,665 LOBBYISTS LISTED');
  });
  it('keeps full counts beside the page interval', () => {
    expect(lobbyingShowingLine('lobbyists', 2, 50, 1665)).toBe(
      'Showing 51–100 of 1,665 registered lobbyists',
    );
    expect(lobbyingShowingLine('principals', 2, 50, 3443)).toBe(
      'Showing 51–100 of 3,443 principals',
    );
    expect(lobbyingShowingLine('principals', 1, 1, 1)).toBe('1 principal');
    expect(lobbyingPrincipalCount(1)).toBe('1 client listed');
    expect(lobbyingPrincipalCount(86)).toBe('86 clients listed');
  });
  it('dates the copied registration list and separates it from yearly spending', () => {
    const dateLabel = () => 'Sep 13, 2026';
    expect(lobbyingLobbyistDirectoryDate('2026-09-13T00:00:00Z', dateLabel)).toBe(
      'Registrations shown as listed in records copied Sep 13, 2026.',
    );
    expect(lobbyingPrincipalDirectoryScope(2025, '2026-09-13T00:00:00Z', dateLabel)).toBe(
      'This directory includes organisations from different reporting years and the lobbyist list copied Sep 13, 2026. The Lobbying page’s spending count covers 2025 only.',
    );
  });
  it('does not turn a deadline into a claim about an actual filing date', () => {
    expect(copy.annual).toBe('Spending is reported by calendar year.');
    expect(copy.principals.intro).toBe(
      'Browse organisations named in lobbying registrations or spending reports.',
    );
    expect(copy.principals.empty).toBe("No principal matches that spelling in the Board's files");
  });
  it('states why an unresolved principal has no link with the file’s year', () => {
    expect(lobbyingNoSpendingRows(2025)).toBe(
      "No spending rows in the Board's file through 2025, so no page to open",
    );
    expect(lobbyingNoSpendingRows(null)).not.toContain('null');
  });
  it('keeps the sixth lane copy bare', () => {
    expect(MONEY_LANE_LOBBYING.title).toBe('Lobbying');
    expect(MONEY_LANE_LOBBYING.body).toBe(
      'Who is registered to lobby, who they represent, and what is reported spent',
    );
    expect(MONEY_LANE_LOBBYING.body.endsWith('.')).toBe(false);
  });
});
