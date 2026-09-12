import { theme } from '../theme/tokens';

/** Final solid palette: shared by the donut, both legends and every history year. */
export const CAMPAIGN_MONEY_COLORS = {
  individuals: '#149d5b',
  lobbyists: '#1f8fe6',
  committees: '#7c3aed',
  partyUnits: '#e56b12',
  expenditures: '#6b716b',
  other: '#d6336c',
  unnamed: '#899087',
  text: '#11150f',
  secondary: '#4f5651',
  muted: '#6b716b',
  link: '#0f7a45',
  hoverBorder: '#28bf71',
  focus: '#7c5cff',
  fieldFocusBorder: '#5b30d6',
  fieldFocusRing: 'rgba(91,48,214,0.22)',
  background: '#ffffff',
  border: theme.colors.alpha.ink12,
  tile: '#f5f6f4',
  shadow: 'rgba(17,21,15,0.08)',
} as const;
