import { eventPath, type PublishedEvent } from './events';
import { escapeHtml, pageMetadata, publicPageUrl, titleFor } from './share';

export interface ReplayChapter {
  title: string;
  start: number;
}
export interface ReplayTurn {
  speaker: string;
  start: number;
  paragraphs: string[];
}
export interface EventReplay {
  title: string;
  introduction: string;
  video: { id: string; exportId: string; duration: number; publishedAt?: string };
  captions: { exportId: string; checked: boolean; uploaded: boolean };
  transcript: { exportId: string; checked: boolean; turns: ReplayTurn[] };
  chapters: { exportId: string; items: ReplayChapter[] };
  thumbnail: { url: string; alt: string; width: number; height: number };
}

const nonempty = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0;
const positive = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) > 0;
const httpsUrl = (s: unknown): boolean => {
  try {
    const u = new URL(String(s));
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
};

/** Validate external editorial input before rendering, including private previews. */
export function parseEventReplay(value: unknown): EventReplay {
  if (!value || typeof value !== 'object') throw new Error('Replay content must be an object');
  const r = value as EventReplay;
  if (
    !nonempty(r.title) ||
    !nonempty(r.introduction) ||
    !nonempty(r.video?.id) ||
    !/^[\w-]{11}$/.test(r.video.id) ||
    !nonempty(r.video?.exportId) ||
    !positive(r.video?.duration) ||
    r.video.duration > 43200
  ) {
    throw new Error('Replay needs a title, introduction, YouTube ID, export ID and running time');
  }
  if (
    !httpsUrl(r.thumbnail?.url) ||
    !nonempty(r.thumbnail?.alt) ||
    !positive(r.thumbnail?.width) ||
    !positive(r.thumbnail?.height)
  ) {
    throw new Error('Replay needs an HTTPS preview image, description and dimensions');
  }
  if (
    ![r.captions?.exportId, r.transcript?.exportId, r.chapters?.exportId].every(
      (id) => id === r.video.exportId,
    )
  ) {
    throw new Error('Captions, transcript and chapters must match the final video export');
  }
  if (
    typeof r.captions?.checked !== 'boolean' ||
    typeof r.captions?.uploaded !== 'boolean' ||
    typeof r.transcript?.checked !== 'boolean'
  )
    throw new Error('Review and caption-upload status are required');
  const inVideo = (n: unknown) =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < r.video.duration;
  if (
    !Array.isArray(r.transcript.turns) ||
    !r.transcript.turns.length ||
    !r.transcript.turns.every(
      (t, i, all) =>
        t &&
        nonempty(t.speaker) &&
        inVideo(t.start) &&
        (i === 0 || t.start >= all[i - 1].start) &&
        Array.isArray(t.paragraphs) &&
        t.paragraphs.length > 0 &&
        t.paragraphs.every(nonempty),
    )
  ) {
    throw new Error(
      'Transcript needs speaker names, paragraphs and increasing timestamps within the video',
    );
  }
  if (
    !Array.isArray(r.chapters.items) ||
    r.chapters.items.length < 3 ||
    r.chapters.items[0]?.start !== 0 ||
    !r.chapters.items.every(
      (c, i, all) =>
        c &&
        nonempty(c.title) &&
        inVideo(c.start) &&
        Number.isInteger(c.start) &&
        (all[i + 1]?.start ?? r.video.duration) - c.start >= 10,
    )
  ) {
    throw new Error('Use at least 3 chapters, starting at 0, each at least 10 seconds long');
  }
  if (
    r.video.publishedAt !== undefined &&
    (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(r.video.publishedAt) ||
      !Number.isFinite(Date.parse(r.video.publishedAt)))
  )
    throw new Error('Use the actual video publication time with a timezone');
  return r;
}

export function replayTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(s / 60);
  return `${s >= 3600 ? `${Math.floor(s / 3600)}:` : ''}${s >= 3600 ? String(minutes % 60).padStart(2, '0') : minutes}:${String(s % 60).padStart(2, '0')}`;
}

export function replayStart(search: string, duration: number): number {
  const raw = new URLSearchParams(search).get('t');
  return raw &&
    /^\d+(?:\.\d+)?$/.test(raw) &&
    Number.isFinite(Number(raw)) &&
    Number(raw) < duration
    ? Number(raw)
    : 0;
}

export function replayEmbedUrl(id: string, start = 0, origin?: string): string {
  if (!/^[\w-]{11}$/.test(id)) throw new Error('Invalid YouTube ID');
  const params = new URLSearchParams({
    playsinline: '1',
    rel: '0',
    enablejsapi: '1',
    start: String(Math.max(0, Math.floor(start))),
  });
  if (origin) params.set('origin', new URL(origin).origin);
  return `https://www.youtube-nocookie.com/embed/${id}?${params}`;
}

export function assertReplayReady(replay: EventReplay, now = Date.now()): void {
  parseEventReplay(replay);
  if (
    !replay.captions.checked ||
    !replay.captions.uploaded ||
    !replay.transcript.checked ||
    !replay.video.publishedAt ||
    Date.parse(replay.video.publishedAt) > now
  ) {
    throw new Error(
      'Publication needs checked text, uploaded captions and the actual video publication time',
    );
  }
}

/** Prepared for final integration; no production route imports or publishes this yet. */
export function replayPageMetadata(event: PublishedEvent, replay: EventReplay) {
  assertReplayReady(replay);
  const url = publicPageUrl(eventPath(event));
  return pageMetadata({
    title: titleFor(replay.title),
    socialTitle: replay.title,
    description: replay.introduction,
    canonicalPath: eventPath(event),
    article: { publishedOn: event.publishedOn },
    socialImage: replay.thumbnail,
    structuredData: [
      {
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: replay.title,
        description: replay.introduction,
        thumbnailUrl: [replay.thumbnail.url],
        uploadDate: replay.video.publishedAt,
        duration: `PT${replay.video.duration}S`,
        embedUrl: replayEmbedUrl(replay.video.id),
        url,
        hasPart: replay.chapters.items.map((c, i, all) => ({
          '@type': 'Clip',
          name: c.title,
          startOffset: c.start,
          endOffset: all[i + 1]?.start ?? replay.video.duration,
          url: `${url}?t=${c.start}`,
        })),
      },
    ],
  });
}

export function replayVideoSitemap(event: PublishedEvent, replay: EventReplay): string {
  assertReplayReady(replay);
  const x = escapeHtml;
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"><url><loc>${x(publicPageUrl(eventPath(event)))}</loc><video:video><video:thumbnail_loc>${x(replay.thumbnail.url)}</video:thumbnail_loc><video:title>${x(replay.title)}</video:title><video:description>${x(replay.introduction)}</video:description><video:player_loc>${x(replayEmbedUrl(replay.video.id))}</video:player_loc><video:duration>${replay.video.duration}</video:duration><video:publication_date>${x(replay.video.publishedAt!)}</video:publication_date></video:video></url></urlset>`;
}
