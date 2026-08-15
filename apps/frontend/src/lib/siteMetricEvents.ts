import { recordSiteMetricEventFromApi } from '../data/api';
import type { SiteMetricEventName } from './traffic';

let accessToken: string | null = null;
let sessionReady = false;
const pendingEvents: SiteMetricEventName[] = [];

const OFFICIAL_SOURCE_HOSTS = new Set([
  'house.mn.gov',
  'www.house.mn.gov',
  'senate.mn',
  'www.senate.mn',
  'revisor.mn.gov',
  'www.revisor.mn.gov',
  'gis.lcc.mn.gov',
  'www.gis.lcc.mn.gov',
]);

function send(event: SiteMetricEventName) {
  void recordSiteMetricEventFromApi(event, accessToken).catch(() => undefined);
}

export function setSiteMetricSession(value: string | null, ready: boolean) {
  accessToken = value;
  sessionReady = ready;
  if (!ready) return;
  pendingEvents.splice(0).forEach(send);
}

export function recordSiteMetricEvent(event: SiteMetricEventName) {
  if (!sessionReady) {
    pendingEvents.push(event);
    return;
  }
  send(event);
}

export function recordOfficialSourceOpen(url: string) {
  try {
    if (OFFICIAL_SOURCE_HOSTS.has(new URL(url).hostname.toLowerCase())) {
      recordSiteMetricEvent('official_source_opened');
    }
  } catch {
    // An invalid address cannot be an opened official source.
  }
}
