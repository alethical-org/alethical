import { loadOnDemand } from '../../lib/loadOnDemand';

// Public money pages do not download the private record reader on first load.
export const TVAdConnectionCard = loadOnDemand(
  () => import('./Connected').then((module) => ({ default: module.TVAdConnectionCard })),
  { kind: 'optional' },
);
export const TVAdSearchGroup = loadOnDemand(
  () => import('./Connected').then((module) => ({ default: module.TVAdSearchGroup })),
  { kind: 'optional' },
);
