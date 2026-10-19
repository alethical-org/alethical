import { eventCss } from './eventMarkup';
import { eventPath, type PublishedEvent } from './events';
import { escapeHtml as e, publicPageUrl } from './share';
import {
  parseEventReplay,
  replayEmbedUrl,
  replayStart,
  replayTimestamp,
  type EventReplay,
} from './eventReplay';

const replayCss = `
.replay-content{overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.replay-content iframe{display:block;border:0;width:100%;aspect-ratio:16/9;min-height:200px;background:#11150f;border-radius:16px}
.replay-topics{padding-left:24px}.replay-topics a,.replay-time{display:inline-flex;align-items:center;min-height:44px;gap:12px}
.replay-time{font-size:16px}.replay-turn{margin:24px 0}.replay-turn p{margin:8px 0 16px;white-space:pre-line}
.replay-speaker{font-weight:700;margin-right:12px}.replay-controls{display:flex;align-items:center;flex-wrap:wrap;gap:8px 20px}
.replay-copy{font:inherit;color:#0f7a45;text-decoration:underline;text-underline-offset:4px;background:transparent;border:0;border-radius:4px;min-height:44px;padding:8px 4px;cursor:pointer}
.replay-copy:focus-visible{outline:2px solid #7c5cff;outline-offset:4px}
@media(hover:hover){.replay-copy:hover{color:#11832b}}
.replay-status{min-height:1.65em;font-size:16px!important;margin:0 0 12px!important}
.replay-content summary{cursor:pointer;min-height:44px;display:list-item;padding:12px 0;font-weight:700}
.replay-content summary:focus-visible{outline:2px solid #7c5cff;outline-offset:4px}
.replay-content [tabindex="-1"]:focus-visible{outline:2px solid #7c5cff;outline-offset:4px}
.replay-content nav a{font-size:17px}.replay-content .event-published{margin-bottom:16px}
`;

/** Complete transcript is present in HTML, with no expand/load-more dependency. */
export function renderEventReplay(
  event: PublishedEvent,
  input?: EventReplay,
  options: { origin?: string; search?: string; example?: boolean; privatePreview?: boolean } = {},
): string {
  const r = input ? parseEventReplay(input) : undefined;
  const start = r ? replayStart(options.search ?? '', r.video.duration) : 0;
  const jump = (time: number, label: string) =>
    `<a data-replay-seek="${time}" href="?t=${time}#watch">${e(label)}</a>`;
  const transcript = r?.chapters.items
    .map(
      (c, i, all) =>
        `<section aria-labelledby="topic-${c.start}"><h3 id="topic-${c.start}">${e(c.title)}</h3>${r.transcript.turns
          .filter((t) => t.start >= c.start && t.start < (all[i + 1]?.start ?? r.video.duration))
          .map(
            (t, turnIndex) =>
              `<div class="replay-turn" id="turn-${c.start}-${turnIndex}"><div class="replay-controls"><span><span class="replay-speaker">${e(t.speaker)}</span><span class="replay-time">${jump(t.start, replayTimestamp(t.start))}</span></span><button class="replay-copy" type="button" data-replay-copy="${t.start}" aria-label="Copy link to ${e(t.speaker)} at ${replayTimestamp(t.start)}" hidden>Copy link</button></div>${t.paragraphs.map((p) => `<p>${e(p)}</p>`).join('')}</div>`,
          )
          .join('')}</section>`,
    )
    .join('');
  return `<article class="event-content event-article replay-content" ${r ? `data-replay-duration="${r.video.duration}"` : ''}><style>${eventCss}${replayCss}</style>
<div class="event-return"><a class="event-back" href="${publicPageUrl('/blog/events')}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 5 L8 12 L15 19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path></svg><span>Back to Events</span></a></div>
${options.example ? '<p><strong>Example content for testing</strong></p><p>This uses YouTube’s player demonstration and sample text. It is not the debate recording or transcript.</p>' : ''}
<h1>${e(r?.title ?? `${event.name}: recording and transcript`)}</h1>
<p>${e(r?.introduction ?? 'The recording and transcript of the October 15, 2026 event at Riverside Terrace in Sauk Rapids are being prepared.')}</p>
<p class="event-published">Event held <time datetime="${e(event.startDate)}">${e(event.dateLabel)}</time></p>
<section aria-labelledby="watch"><h2 id="watch" tabindex="-1">Watch the full ${options.example ? 'example' : 'debate'}</h2>
${r ? `<iframe id="replay-player" title="${e(r.title)}" src="${e(replayEmbedUrl(r.video.id, start, options.origin))}" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe><p><a data-replay-youtube href="https://www.youtube.com/watch?v=${r.video.id}&amp;t=${start}s">Watch on YouTube</a> · ${replayTimestamp(r.video.duration)}</p>` : '<p>The final video is not ready yet</p>'}
${r ? '<p class="replay-status" data-replay-status role="status" aria-live="polite"></p>' : ''}</section>
<nav aria-labelledby="topics"><h2 id="topics">Topics</h2>${r ? `<ol class="replay-topics">${r.chapters.items.map((c) => `<li>${jump(c.start, `${replayTimestamp(c.start)} ${c.title}`)}</li>`).join('')}</ol>` : '<p>Topic links will appear when the final video timings are ready</p>'}</nav>
<section aria-labelledby="transcript"><h2 id="transcript">Full transcript</h2>${r ? `${!r.transcript.checked ? '<p><strong>Not checked</strong></p>' : ''}<p class="replay-status" data-replay-copy-status role="status" aria-live="polite"></p>${transcript}` : '<p>The transcript is being prepared</p>'}</section>
<section aria-labelledby="materials"><h2 id="materials">Debate materials</h2><ul class="event-downloads">${event.downloads.map((f) => `<li><a href="${e(publicPageUrl(f.href))}">${e(f.title)} (PDF)</a></li>`).join('')}</ul></section>
<details><summary>Original announcement and flyer</summary><p>${e(event.tagline)}</p><p>${e(event.introduction)}</p><ul>${event.candidates.map((c) => `<li>${e(c.name)}, ${e(c.status)}</li>`).join('')}</ul>${event.paragraphs.map((p) => `<p>${e(p)}</p>`).join('')}<a href="${e(publicPageUrl(event.image))}"><img class="event-flyer" src="${e(publicPageUrl(event.image))}" width="${event.imageWidth}" height="${event.imageHeight}" alt="${e(event.imageAlt)}" loading="lazy"></a>${options.privatePreview ? `<p><a href="${e(publicPageUrl(eventPath(event)))}">Open the published announcement</a></p>` : ''}</details>
</article>`;
}
