import { escapeHtml as e, publicPageUrl } from './share';
import {
  LINK_ARROW_SIZE,
  LINK_ARROW_VIEW_BOX,
  LINK_ARROW_PATH,
  LINK_ARROW_STROKE_WIDTH,
} from './linkArrowGeometry';
import {
  COALITION_CANDIDATES_URL,
  EVENTS_PATH,
  eventHasEnded,
  eventPath,
  eventSummaryDate,
  eventSummaryShowsLogistics,
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
@media(hover:hover){.event-content a:not(.event-back):hover{color:#11832b}}
.event-return{display:flex;margin-bottom:20px}
.event-content .event-back{display:inline-flex;align-items:flex-start;gap:9px;padding:11px 0;box-sizing:border-box;line-height:22px;min-height:44px;border-radius:4px;font-size:16px;font-weight:600;color:#4b524b;text-decoration:none}
.event-back svg{flex:none;margin-top:2px}.event-back span{min-width:0}
.event-content .event-back:active{color:#11150f}.event-back:active span{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}
.event-content .event-back:focus-visible{outline:2px solid #7c5cff;outline-offset:2px}
@media(min-width:768px) and (hover:hover) and (pointer:fine){.event-content .event-back:hover{color:#11150f}.event-back:hover span{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}}
.event-content .event-action{display:inline-flex;align-items:center;gap:6px;min-height:44px;text-decoration:none}
.event-action span{text-decoration:underline;text-underline-offset:4px}.event-action svg{flex:none;pointer-events:none}
.event-keep{display:inline-block;max-width:100%}
.event-collection .event-return{margin-bottom:14px}.event-content.event-collection h1{margin-top:0}
.event-flyer{display:block;width:100%;max-width:540px;height:auto;margin:0 auto;border-radius:16px}
.event-image-link{text-align:center;margin:16px 0!important}.event-image-link a{display:inline-flex;min-height:44px;align-items:center}
.event-downloads a{display:inline-flex;align-items:center;min-height:44px}
.event-meta{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:4px 16px;margin:8px 0 20px}
.event-content h1:has(+.event-meta){margin-bottom:0}
.event-content .event-meta .event-published{margin:0;font-size:15px!important;line-height:1.5}
.event-share-slot{flex:none;display:flex}
.event-share-fallback{display:inline-flex;align-items:center;gap:9px;min-height:44px;box-sizing:border-box;background:#fff;border:1px solid rgba(17,21,15,.16);border-radius:11px;padding:10px 18px 10px 15px;font:700 15px/1.3 'Libre Franklin',sans-serif;color:#2c322c;cursor:pointer}
.event-share-fallback svg{flex:none}
.event-published{color:#5f655b;font-size:14px!important}
.event-tagline{font-size:21px!important;color:#5f655b}
.event-facts{background:#fff;border:1px solid rgba(17,21,15,.08);border-radius:16px;padding:24px;margin:28px 0}
.event-facts p{margin:0 0 8px}.event-facts p:last-child{margin:0}
.event-coalition-logo{display:block;width:190px;max-width:100%;height:auto}
.event-heading-brand{display:inline-flex;max-width:100%;min-height:44px;margin-bottom:20px}
.event-content .event-heading-brand+h1{margin-top:0}
.event-content .event-list{list-style:none;margin:18px 0 0;padding:0;display:grid;gap:20px}
.event-list>li{position:relative;padding:34px 36px 36px;background:#fff;border:1px solid rgba(17,21,15,.08);border-radius:16px;transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease}
.event-list h3 a::after,.event-list h2 a::after{content:'';position:absolute;inset:0;border-radius:16px}
.event-list h3 a:focus-visible,.event-list h2 a:focus-visible{outline:none!important}
.event-list>li:has(a:focus-visible){outline:2px solid #7c5cff;outline-offset:2px}
@media(min-width:768px) and (hover:hover) and (pointer:fine){.event-list>li:hover{border-color:rgba(45,212,126,.85);box-shadow:0 22px 46px rgba(17,21,15,.14);transform:translateY(-3px)}}
@media(prefers-reduced-motion:reduce){.event-list>li{transition:none}.event-list>li:hover{transform:none}}
.event-list h3,.event-list h2{font-size:20px;line-height:1.3;margin:6px 0 8px}
.event-list h3 a,.event-list h2 a{font-weight:700;text-decoration:none}
@media(hover:hover){.event-list h3 a:hover,.event-list h2 a:hover{text-decoration:underline}}
.event-list p{font-size:16px;margin:0 0 8px}.event-list .event-list-meta{font-size:13px;font-weight:600;color:#5f655b}
.event-collection{max-width:1000px;margin:auto;padding:40px 24px 80px}
@media(max-width:767px){.event-content .event-back{font-size:15px}.event-collection .event-return{margin-bottom:10px}.event-article,.event-collection{padding:24px 20px 56px}.event-content h1{font-size:28px}.event-content p,.event-content li{font-size:17px}.event-content .event-list{margin-top:14px;gap:16px}.event-list>li{padding:30px 20px 28px}.event-list h3,.event-list h2{font-size:18px}}
.event-list>li.event-replay-preview{padding:32px 36px}
.event-replay-card{display:flex;align-items:stretch;gap:32px;color:#11150f;text-decoration:none}
.event-replay-card:hover,.event-replay-card:visited{color:#11150f}.event-replay-card::after{content:'';position:absolute;inset:0;border-radius:16px}
.event-list>li .event-replay-card:focus-visible{outline:none!important}
.event-preview-copy{display:flex;flex-direction:column;flex:1;min-width:0}
.event-preview-title{display:flex;align-items:baseline;flex-wrap:wrap;gap:8px 12px}
.event-list .event-preview-title h2,.event-list .event-preview-title h3{font-size:32px;line-height:1.2;margin:0;font-weight:800}
.event-preview-title>span{font-size:15px;font-weight:600;color:#5f655b}
.event-list .event-replay-preview .event-list-meta{font-size:18px;font-weight:400;line-height:1.5;margin:14px 0 24px;color:#5f655b}
.event-preview-photo-frame{display:block;position:relative;overflow:hidden;width:40%;max-width:380px;aspect-ratio:1.467;border-radius:12px;align-self:center}.event-preview-photo{display:block;position:absolute;left:-41.38%;top:0;width:182.9%;max-width:none;height:auto}
.event-watch-action{display:inline-flex;align-items:center;justify-content:center;gap:10px;align-self:flex-start;min-height:52px;box-sizing:border-box;margin-top:auto;padding:10px 20px;border:1px solid #d4d8d3;border-radius:10px;font-size:16px;line-height:1.5;font-weight:700}
@media(hover:hover) and (pointer:fine){.event-replay-preview:hover .event-watch-action{border-color:#0f7a45;background:#f0faf4}}
@media(max-width:767px){.event-list>li.event-replay-preview{padding:20px}.event-replay-card{flex-direction:column;gap:20px}.event-preview-photo-frame{order:-1;width:100%;max-width:none}.event-list .event-preview-title h2,.event-list .event-preview-title h3{font-size:25px}.event-list .event-replay-preview .event-list-meta{font-size:17px}.event-watch-action{width:100%}}

`;

/** Initial HTML for the shared control mounted without replacing the article. */
export function renderEventShareSlot(): string {
  return `<span class="event-share-slot" data-event-share><button class="event-share-fallback" type="button" aria-label="Share this post" aria-haspopup="dialog" aria-expanded="false"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="18" cy="5" r="2.8" stroke="currentColor" stroke-width="2"/><circle cx="6" cy="12" r="2.8" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="19" r="2.8" stroke="currentColor" stroke-width="2"/><path d="M8.5 10.8 L15.5 6.4 M8.5 13.2 L15.5 17.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Share</span></button></span>`;
}

/** Shared near-title branding for Forward Coalition event posts. */
export function renderForwardCoalitionBrand(): string {
  return `<a class="event-heading-brand" href="${COALITION_CANDIDATES_URL}" aria-label="Meet the Forward Coalition candidates"><img class="event-coalition-logo" src="${publicPageUrl('/services-coalition.webp')}" alt="Minnesota Forward Together" width="600" height="205" decoding="async"></a>`;
}

function renderEventReturn(href: string, label: string): string {
  return `<div class="event-return"><a class="event-back" href="${e(href)}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M15 5 L8 12 L15 19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path></svg><span>${e(label)}</span></a></div>`;
}

// Inline-block keeps short related words together when they fit, but permits
// internal wrapping when enlarged text makes a group wider than its container.
function keepTogether(text: string): string {
  return `<span class="event-keep">${e(text)}</span>`;
}

function eventDate(label: string): string {
  const comma = label.indexOf(',');
  return comma < 0
    ? keepTogether(`${label} ·`)
    : `${e(label.slice(0, comma + 1))} ${keepTogether(`${label.slice(comma + 2)} ·`)}`;
}

function renderSignupAction(href: string): string {
  return `<a class="event-action" href="${e(href)}"><span><strong>RSVP for free on Luma</strong></span><svg width="${LINK_ARROW_SIZE}" height="${LINK_ARROW_SIZE}" viewBox="${LINK_ARROW_VIEW_BOX}" fill="none" aria-hidden="true" focusable="false"><path d="${LINK_ARROW_PATH}" stroke="#0f7a45" stroke-width="${LINK_ARROW_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"></path></svg></a>`;
}

/** The existing public replay is one card link; the watch treatment is decorative. */
function renderReplayPreview(event: PublishedEvent, heading: 'h2' | 'h3'): string {
  return `<li class="event-replay-preview"><a class="event-replay-card" href="${e(eventPath(event))}"><div class="event-preview-copy"><div class="event-preview-title"><${heading}>${e(event.name)}</${heading}><span>Hosted by Alethical</span></div><p class="event-list-meta">${e(event.district)} · ${e(eventSummaryDate(event))}</p><span class="event-watch-action"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" fill="#0f7a45"/></svg>Watch the debate</span></div><span class="event-preview-photo-frame"><img class="event-preview-photo" src="${e(event.homePhotos.desktop)}" alt="" loading="lazy"></span></a></li>`;
}

export function renderEventList(now = Date.now(), preview = false): string {
  const heading = preview ? 'h3' : 'h2';
  return `<style>${eventCss}</style><div class="event-content"><ul class="event-list">${orderedEvents(
    now,
  )
    .slice(0, preview ? 3 : undefined)
    .map((event) =>
      event.slug === 'forward-debate-2026' && eventHasEnded(event, now)
        ? renderReplayPreview(event, heading)
        : `<li><p class="event-list-meta">${e(eventSummaryDate(event))}</p><${heading}><a href="${e(eventPath(event))}">${e(event.name)}</a></${heading}><p>${e(event.tagline)}</p>${eventSummaryShowsLogistics(event, now) ? `<p>${keepTogether(event.locationName)} · ${keepTogether(event.city)} · ${keepTogether('Free admission')}</p>` : ''}</li>`,
    )
    .join('')}</ul></div>`;
}

export function renderEventsCollection(now = Date.now()): string {
  return `<section class="event-content event-collection"><style>${eventCss}</style>${renderEventReturn('/blog', 'Back to Media')}<h1>Debates and recordings</h1>${renderEventList(now)}</section>`;
}

export function renderEventArticle(event: PublishedEvent, now = Date.now()): string {
  const ended = eventHasEnded(event, now);
  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const publishedLabel = dateFormatter.format(new Date(`${event.publishedOn}T12:00:00Z`));
  const updatedLabel = dateFormatter.format(new Date(`${event.updatedOn}T12:00:00Z`));
  return `<article class="event-content event-article"><style>${eventCss}</style>
${renderEventReturn(EVENTS_PATH, 'Back to Debates and recordings')}
<a href="${e(event.image)}" aria-label="Open the full-size ${e(event.name)} flyer"><img class="event-flyer" src="${e(event.image)}" width="${event.imageWidth}" height="${event.imageHeight}" alt="${e(event.imageAlt)}" fetchpriority="high" decoding="async"></a>
<p class="event-image-link"><a href="${e(event.image)}">Open full-size flyer to zoom in</a></p>
${renderForwardCoalitionBrand()}
<h1>${e(event.title)}</h1>
<div class="event-meta"><p class="event-published"><span class="event-keep">Published <time datetime="${event.publishedOn}">${e(publishedLabel)}</time> ·</span> <span class="event-keep">Updated <time datetime="${event.updatedOn}">${e(updatedLabel)}</time></span></p>${renderEventShareSlot()}</div>
<section aria-label="Debate downloads"><h2>Download the debate materials</h2>
<ul class="event-downloads">${event.downloads.map((file) => `<li><a href="${e(file.href)}" download="${e(file.filename)}">Download ${e(file.title)} (PDF)</a></li>`).join('')}</ul></section>
<p class="event-tagline">${e(event.tagline)}</p>
${ended ? '<p><strong>This event has ended</strong></p>' : ''}
<p>${e(event.introduction)}</p>
<ul>${event.candidates.map((candidate) => `<li><strong>${e(candidate.name)}</strong>, ${e(candidate.status)}</li>`).join('')}</ul>
${event.paragraphs.map((paragraph) => `<p>${e(paragraph)}</p>`).join('')}
<section class="event-facts" aria-label="Event details">
<p><strong><time datetime="${e(event.startDate)}">${eventDate(event.dateLabel)}</time> ${keepTogether(event.timeLabel)}</strong></p>
<p>${e(event.locationName)}<br>${e(event.streetAddress)}, ${keepTogether(`${event.city}, ${event.region} ${event.postalCode}`)}</p>
<p>${keepTogether('Free admission')}</p>
<p>Hosted by Alethical · Moderated by Angel Zierden, <a href="https://www.alethical.com">Alethical.com</a></p>
</section>
${ended ? `<p><a href="${e(event.signupUrl)}">View the event on Luma</a></p>` : `<h2>Join us in Sauk Rapids</h2><p>${e(event.invitation)}</p><p>${renderSignupAction(event.signupUrl)}</p>`}
</article>`;
}
