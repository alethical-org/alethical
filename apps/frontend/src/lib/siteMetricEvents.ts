import { recordSiteMetricEventFromApi } from '../data/api';
import type { SiteMetricEventName } from './traffic';
import { isPrivateMetricLocation } from './siteMetricPrivacy';

let accessToken: string | null = null;
let sessionReady = false;
let awaitingInitialSession = true;
const MAX_STARTUP_EVENTS = 20;
const startupEvents: SiteMetricEventName[] = [];

const OFFICIAL_SOURCE_HOSTS = new Set([
  'house.mn.gov',
  'www.house.mn.gov',
  'senate.mn',
  'www.senate.mn',
  'revisor.mn.gov',
  'www.revisor.mn.gov',
  'gis.lcc.mn.gov',
  'www.gis.lcc.mn.gov',
  'cfb.mn.gov',
  'www.cfb.mn.gov',
  'leg.mn.gov',
  'www.leg.mn.gov',
]);

function send(event: SiteMetricEventName) {
  if (isPrivateMetricLocation()) return;
  void recordSiteMetricEventFromApi(event, accessToken).catch(() => undefined);
}

export function setSiteMetricSession(value: string | null, ready: boolean) {
  accessToken = value;
  sessionReady = ready;
  if (!ready) {
    // Once an account is known, unresolved actions must never inherit a later
    // account or become anonymous. Cleanup does not reopen startup buffering.
    if (value !== null) {
      awaitingInitialSession = false;
      startupEvents.length = 0;
    }
    return;
  }
  awaitingInitialSession = false;
  startupEvents.splice(0).forEach(send);
}

export function recordSiteMetricEvent(event: SiteMetricEventName) {
  if (isPrivateMetricLocation()) return;
  if (!sessionReady) {
    if (awaitingInitialSession && startupEvents.length < MAX_STARTUP_EVENTS) {
      startupEvents.push(event);
    }
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
