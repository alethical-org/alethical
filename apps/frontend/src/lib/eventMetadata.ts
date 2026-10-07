import { EVENTS_PATH, eventPath, eventHasEnded, type PublishedEvent } from './events';
import { pageMetadata, publicPageUrl, titleFor, type PageMetadata } from './share';

export function eventsPageMetadata(): PageMetadata {
  return pageMetadata({
    title: titleFor('Events'),
    socialTitle: 'Alethical Events',
    description:
      'Public discussions and events hosted by Alethical. Find dates, locations and registration links.',
    canonicalPath: EVENTS_PATH,
  });
}

/** One source supplies both the visible announcement and its search details. */
export function eventPageMetadata(event: PublishedEvent, now = Date.now()): PageMetadata {
  const imageUrl = publicPageUrl(event.image);
  return pageMetadata({
    title: titleFor(event.title),
    socialTitle: event.title,
    description: event.description,
    canonicalPath: eventPath(event),
    article: { publishedOn: event.publishedOn },
    preloadImages: [imageUrl],
    socialImage: {
      url: imageUrl,
      alt: event.imageAlt,
      width: event.imageWidth,
      height: event.imageHeight,
    },
    structuredData: [
      {
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: event.name,
        url: publicPageUrl(eventPath(event)),
        startDate: event.startDate,
        endDate: event.endDate,
        description: event.description,
        image: [imageUrl],
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        isAccessibleForFree: true,
        location: {
          '@type': 'Place',
          name: event.locationName,
          address: {
            '@type': 'PostalAddress',
            streetAddress: event.streetAddress,
            addressLocality: event.city,
            addressRegion: event.region,
            postalCode: event.postalCode,
            addressCountry: 'US',
          },
        },
        organizer: { '@type': 'Organization', name: 'Alethical', url: publicPageUrl('/') },
        // Keep past event details discoverable without advertising an active offer.
        ...(!eventHasEnded(event, now)
          ? {
              eventStatus: 'https://schema.org/EventScheduled',
              offers: {
                '@type': 'Offer',
                url: event.signupUrl,
                price: 0,
                priceCurrency: 'USD',
              },
            }
          : {}),
      },
    ],
  });
}
