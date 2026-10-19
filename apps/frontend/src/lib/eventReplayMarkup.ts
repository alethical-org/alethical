import { eventCss, renderForwardCoalitionBrand } from './eventMarkup';
import type { PublishedEvent } from './events';
import { escapeHtml as e, publicPageUrl } from './share';
import {
  TRANSCRIPT_DISCLOSURE,
  parseEventReplay,
  replayEmbedUrl,
  replayStart,
  replayTimestamp,
  type EventReplay,
} from './eventReplay';

const replayCss = `
.replay-content{overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.replay-content iframe{display:block;border:0;width:100%;aspect-ratio:16/9;min-height:200px;background:#11150f;border-radius:16px}
.replay-with-invitation [data-replay-status]:empty{display:none}
.replay-invitation{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:24px;background:#11150f;border-radius:16px;padding:20px 24px;margin:32px 0 40px}
.event-content .replay-invitation h2{display:flex;align-items:center;gap:14px;color:#fff;font-size:20px;font-weight:700;line-height:1.3;hyphens:auto;hyphenate-limit-chars:7 4 3;-webkit-hyphenate-limit-before:4;-webkit-hyphenate-limit-after:3;margin:0;flex:1 1 auto;width:max-content;max-width:100%;min-width:0}
.replay-invitation img{display:block;width:30px;height:auto;flex:none}
.event-content .replay-invitation a.replay-contact{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;max-width:100%;min-height:48px;padding:10px 22px;border:1px solid #2ed47e;border-radius:12px;background:#2ed47e;color:#06231a;font-size:16px;font-weight:700;line-height:1.5;text-align:center;text-decoration:none}
.event-content .replay-invitation a.replay-contact:focus-visible{outline:2px solid #7c5cff;outline-offset:2px}
@media(min-width:768px) and (hover:hover) and (pointer:fine){.event-content .replay-invitation a.replay-contact:hover{background:#28bf71;border-color:#28bf71;color:#06231a}}
.event-content .replay-invitation a.replay-contact:active{background:#23ad66;border-color:#23ad66;color:#06231a}
@media(max-width:767px){.replay-invitation{flex-direction:column;align-items:stretch;padding:20px}.event-content .replay-invitation h2{font-size:19px;flex:auto;width:auto}.replay-invitation img{width:26px}.event-content .replay-invitation a.replay-contact{width:100%}}
.replay-topics{list-style:none;padding-left:24px}.replay-topics a,.replay-time{display:inline-flex;align-items:center;min-height:44px;gap:12px}
.replay-time{font-size:16px}.replay-turn{margin:24px 0}.replay-turn p{margin:8px 0 16px;white-space:pre-line}
.replay-speaker{font-weight:700;margin-right:12px}.replay-controls{display:flex;align-items:center;flex-wrap:wrap;gap:8px 20px}
.replay-copy{font:inherit;color:#0f7a45;text-decoration:underline;text-underline-offset:4px;background:transparent;border:0;border-radius:4px;min-height:44px;padding:8px 4px;cursor:pointer}
.replay-copy:focus-visible{outline:2px solid #7c5cff;outline-offset:4px}
@media(hover:hover){.replay-copy:hover{color:#11832b}}
.replay-status{min-height:1.65em;font-size:16px!important;margin:0 0 12px!important}
.replay-content summary{cursor:pointer;min-height:44px;display:list-item;padding:12px 0;font-weight:700}
.replay-content summary:focus-visible{outline:2px solid #7c5cff;outline-offset:4px}
.replay-content [tabindex="-1"]:focus-visible{outline:2px solid #7c5cff;outline-offset:4px}
.replay-content [tabindex="-1"]{scroll-margin-top:12px}
.replay-content nav a{font-size:17px}.replay-content .event-published{margin-bottom:16px}
`;

/** Complete accepted reading edition is present in HTML, without an expand/load-more gate. */
export function renderEventReplay(
  event: PublishedEvent,
  input: EventReplay,
  options: { origin?: string; search?: string; example?: boolean } = {},
): string {
  const r = parseEventReplay(input);
  const start = replayStart(options.search ?? '', r.duration ?? 0);
  const jump = (time: number, label: string) =>
    r.video ? `<a data-replay-seek="${time}" href="?t=${time}#watch">${e(label)}</a>` : e(label);
  const turns = (from: number, to: number) =>
    (r.transcript?.turns ?? [])
      .map((t, i) => ({ ...t, index: i }))
      .filter((t) => t.start >= from && t.start < to)
      .map(
        (t) =>
          `<div class="replay-turn" id="turn-${t.index}"><div class="replay-controls"><span><span class="replay-speaker">${e(t.speaker)}</span><span class="replay-time">${jump(t.start, replayTimestamp(t.start))}</span></span>${r.video ? `<button class="replay-copy" type="button" data-replay-copy="${t.start}" aria-label="Copy link to ${e(t.speaker)} at ${replayTimestamp(t.start)}" hidden>Copy link</button>` : ''}</div>${t.paragraphs.map((p) => `<p>${e(p)}</p>`).join('')}</div>`,
      )
      .join('');
  const transcript = r.chapters
    ? r.chapters.items
        .map(
          (c, i, all) =>
            `<section aria-labelledby="topic-${c.start}"><h3 id="topic-${c.start}" tabindex="-1">${e(c.title)}</h3>${turns(c.start, all[i + 1]?.start ?? r.duration!)}</section>`,
        )
        .join('')
    : turns(0, r.duration ?? 0);
  const date = (value: string) =>
    new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  // The invitation uses Design's unchanged flat mark-green-transparent.png,
  // saved as alethical-mark-green.png; the gradient print mark has separate uses.
  const invitation = r.communityDebateInvitation && !options.example;
  const dateLine = r.publishedOn
    ? `<span class="event-keep">Published <time datetime="${e(r.publishedOn)}">${date(r.publishedOn)}</time></span>${event.updatedOn > r.publishedOn ? ` · <span class="event-keep">Updated <time datetime="${e(event.updatedOn)}">${date(event.updatedOn)}</time></span>` : ''}`
    : `<span class="event-keep">Debate held <time datetime="${e(event.startDate)}">${e(date(event.startDate.slice(0, 10)))}</time> ·</span> <span class="event-keep">Updated <time datetime="${event.updatedOn}">${date(event.updatedOn)}</time></span>`;
  return `<article class="event-content event-article replay-content${invitation ? ' replay-with-invitation' : ''}" ${r.video ? `data-replay-duration="${r.duration}"` : ''}><style>${eventCss}${replayCss}</style>
<div class="event-return"><a class="event-back" href="${publicPageUrl('/blog/events')}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 5 L8 12 L15 19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path></svg><span>Back to Events</span></a></div>
${options.example ? '<p><strong>Example content for testing</strong></p><p>This uses YouTube’s player demonstration and sample text. It is not the debate recording or transcript.</p>' : ''}
${renderForwardCoalitionBrand()}
<h1>${e(r.title)}</h1>
<p class="event-published">${dateLine}</p>
<p>${e(r.introduction)}</p>
${r.video ? `<section aria-labelledby="watch"><h2 id="watch" tabindex="-1">Watch the full ${options.example ? 'example' : 'debate'}</h2><iframe id="replay-player" title="${e(r.title)}" src="${e(replayEmbedUrl(r.video.id, start, options.origin))}" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe><p><a data-replay-youtube href="https://www.youtube.com/watch?v=${r.video.id}&amp;t=${Math.floor(start)}s">Watch on YouTube</a> · ${replayTimestamp(r.duration!)}</p><p class="replay-status" data-replay-status role="status" aria-live="polite"></p></section>` : ''}
${invitation ? `<aside class="replay-invitation" aria-labelledby="community-debate"><h2 id="community-debate"><img src="/alethical-mark-green.png" alt="" width="30"><span>Want a debate in your community?</span></h2><a class="replay-contact" href="${e(publicPageUrl('/about/contact?purpose=host-debate'))}">Contact Alethical</a></aside>` : ''}
${r.chapters ? `<nav aria-labelledby="topics"><h2 id="topics">Topics</h2><ol class="replay-topics" role="list">${r.chapters.items.map((c) => `<li>${r.video ? jump(c.start, `${replayTimestamp(c.start)} ${c.title}`) : r.transcript ? `<a href="#topic-${c.start}">${e(c.title)}</a>` : `${e(replayTimestamp(c.start))} ${e(c.title)}`}</li>`).join('')}</ol></nav>` : ''}
${r.transcript ? `<section aria-labelledby="transcript"><h2 id="transcript">${r.transcript.edition === 'edited' ? 'Edited transcript' : 'Full transcript'}</h2><p>${e(TRANSCRIPT_DISCLOSURE)}</p>${r.video ? '<p class="replay-status" data-replay-copy-status role="status" aria-live="polite"></p>' : ''}${transcript}</section>` : ''}
<section aria-labelledby="materials"><h2 id="materials">Debate materials</h2><ul class="event-downloads">${event.downloads.map((f) => `<li><a href="${e(publicPageUrl(f.href))}">${e(f.title)} (PDF)</a></li>`).join('')}</ul></section>
<details><summary>Original announcement and flyer</summary><h2>Alethical hosts its first debate: Minnesota Senate District 13</h2><p>${e(event.tagline)}</p><p>${e(event.introduction)}</p><ul>${event.candidates.map((c) => `<li>${e(c.name)}, ${e(c.status)}</li>`).join('')}</ul>${event.paragraphs.map((p) => `<p>${e(p)}</p>`).join('')}<p>${e(event.dateLabel)} · ${e(event.timeLabel)}<br>${e(event.locationName)}, ${e(event.streetAddress)}, ${e(event.city)}, ${e(event.region)} ${e(event.postalCode)}<br>Free admission</p><p><a href="${e(event.signupUrl)}">View the event on Luma</a></p><a href="${e(publicPageUrl(event.image))}"><img class="event-flyer" src="${e(publicPageUrl(event.image))}" width="${event.imageWidth}" height="${event.imageHeight}" alt="${e(event.imageAlt)}" loading="lazy"></a><p class="event-image-link"><a href="${e(publicPageUrl(event.image))}">Open full-size flyer to zoom in</a></p></details>
</article>`;
}
