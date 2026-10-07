import { escapeHtml as e } from './share';
import {
  COALITION_CANDIDATES_URL,
  EVENTS_PATH,
  eventHasEnded,
  eventPath,
  orderedEvents,
  type PublishedEvent,
} from './events';

// Shared by the browser and the first server response: search engines and readers
// get the same announcement, including when an event has ended.
export const eventCss = `
.event-content{font-family:'Libre Franklin',sans-serif;color:#11150f;line-height:1.65}
.event-article{max-width:760px;margin:0 auto;padding:40px 24px 80px}
.event-content h1{font-size:36px;line-height:1.18;letter-spacing:-.6px;margin:32px 0 16px;font-weight:800}
.event-content h2{font-size:24px;line-height:1.3;margin:32px 0 16px;font-weight:700}
.event-content p,.event-content li{font-size:18px}
.event-content p{margin:0 0 20px}.event-content ul{padding-left:24px}
.event-content a{color:#0f7a45;text-underline-offset:4px}
.event-content a:focus-visible{outline:2px solid #7c5cff;outline-offset:4px}
@media(hover:hover){.event-content a:hover{color:#11832b}}
.event-back{display:inline-flex;align-items:center;min-height:44px;margin-bottom:24px;font-size:16px;font-weight:600}
.event-flyer{display:block;width:100%;max-width:540px;height:auto;margin:0 auto;border-radius:16px}
.event-image-link{text-align:center;margin:16px 0!important}.event-image-link a{display:inline-flex;min-height:44px;align-items:center}
.event-published{color:#5f655b;font-size:14px!important}
.event-tagline{font-size:21px!important;color:#5f655b}
.event-facts{background:#fff;border:1px solid rgba(17,21,15,.08);border-radius:16px;padding:24px;margin:28px 0}
.event-facts p{margin:0 0 8px}.event-facts p:last-child{margin:0}
.event-brands{display:flex;align-items:center;gap:32px;flex-wrap:wrap;margin-top:40px;padding-top:24px;border-top:1px solid rgba(17,21,15,.1)}
.event-brands a{display:inline-flex;align-items:center;min-height:44px;gap:12px;font-weight:700}
.event-brand-icon{width:40px;height:auto}.event-coalition-logo{width:190px;height:auto}
.event-list{list-style:none;margin:18px 0 0;padding:12px 36px 28px;background:#fff;border:1px solid rgba(17,21,15,.08);border-radius:16px}
.event-list li{padding:22px 0 8px}.event-list li+li{border-top:1px solid rgba(17,21,15,.07)}
.event-list h3,.event-list h2{font-size:20px;line-height:1.3;margin:6px 0 8px}
.event-list h3 a,.event-list h2 a{font-weight:700;text-decoration:none}
@media(hover:hover){.event-list h3 a:hover,.event-list h2 a:hover{text-decoration:underline}}
.event-list p{font-size:16px;margin:0 0 8px}.event-list .event-list-meta{font-size:13px;font-weight:600;color:#5f655b}
.event-collection{max-width:1000px;margin:auto;padding:40px 24px 80px}
@media(max-width:767px){.event-article,.event-collection{padding:24px 20px 56px}.event-content h1{font-size:28px}.event-content p,.event-content li{font-size:17px}.event-list{padding:8px 20px 20px;margin-top:14px}.event-list h3,.event-list h2{font-size:18px}}
`;

export function renderEventList(now = Date.now(), preview = false): string {
  const heading = preview ? 'h3' : 'h2';
  return `<style>${eventCss}</style><div class="event-content"><ul class="event-list">${orderedEvents(
    now,
  )
    .slice(0, preview ? 3 : undefined)
    .map(
      (event) =>
        `<li><p class="event-list-meta">${eventHasEnded(event, now) ? 'Past event · ' : ''}${e(event.dateLabel)} · ${e(event.timeLabel)}</p><${heading}><a href="${e(eventPath(event))}">${e(event.name)}</a></${heading}><p>${e(event.tagline)}</p><p>${e(event.locationName)} · ${e(event.city)} · Free admission</p></li>`,
    )
    .join('')}</ul></div>`;
}

export function renderEventsCollection(now = Date.now()): string {
  return `<section class="event-content event-collection"><style>${eventCss}</style><a class="event-back" href="/blog">‹ Back to Blog</a><h1>Events</h1>${renderEventList(now)}</section>`;
}

export function renderEventArticle(event: PublishedEvent, now = Date.now()): string {
  const ended = eventHasEnded(event, now);
  const publishedLabel = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${event.publishedOn}T12:00:00Z`));
  return `<article class="event-content event-article"><style>${eventCss}</style>
<a class="event-back" href="${EVENTS_PATH}">‹ All events</a>
<a href="${e(event.image)}" aria-label="Open the full-size ${e(event.name)} flyer"><img class="event-flyer" src="${e(event.image)}" width="${event.imageWidth}" height="${event.imageHeight}" alt="${e(event.imageAlt)}" fetchpriority="high" decoding="async"></a>
<p class="event-image-link"><a href="${e(event.image)}">Open full-size flyer to zoom in</a></p>
<h1>${e(event.title)}</h1>
<p class="event-published">Published <time datetime="${event.publishedOn}">${e(publishedLabel)}</time></p>
<p class="event-tagline">${e(event.tagline)}</p>
${ended ? '<p><strong>This event has ended</strong></p>' : ''}
<p>${e(event.introduction)}</p>
<ul>${event.candidates.map((candidate) => `<li><strong>${e(candidate.name)}</strong>, ${e(candidate.status)}</li>`).join('')}</ul>
${event.paragraphs.map((paragraph) => `<p>${e(paragraph)}</p>`).join('')}
<section class="event-facts" aria-label="Event details">
<p><strong><time datetime="${e(event.startDate)}">${e(event.dateLabel)}</time> · ${e(event.timeLabel)}</strong></p>
<p>${e(event.locationName)}<br>${e(event.streetAddress)}, ${e(event.city)}, ${e(event.region)} ${e(event.postalCode)}</p>
<p>Free admission</p>
<p>Hosted by Alethical · Moderated by Angel Zierden, <a href="https://www.alethical.com">alethical.com</a></p>
</section>
${ended ? `<p><a href="${e(event.signupUrl)}">View the event on Luma</a></p>` : `<h2>Join us in Sauk Rapids</h2><p>${e(event.invitation)}</p><p><a href="${e(event.signupUrl)}"><strong>RSVP for free on Luma →</strong></a></p>`}
<div class="event-brands"><a href="/" aria-label="Alethical home"><img class="event-brand-icon" src="/services-print-mark.png" width="40" height="40" alt="">Alethical</a><a href="${COALITION_CANDIDATES_URL}" aria-label="Meet the Forward Coalition candidates"><img class="event-coalition-logo" src="/services-coalition.webp" alt="Minnesota Forward Together" width="600" height="205" loading="lazy"></a></div>
</article>`;
}
