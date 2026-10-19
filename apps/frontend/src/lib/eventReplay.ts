import { eventPath, type PublishedEvent } from './events';
import { eventPageMetadata } from './eventMetadata';
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
  searchTitle?: string;
  introduction: string;
  /** Publication of this replay edition, separate from its original announcement. */
  publishedOn?: string;
  communityDebateInvitation?: boolean;
  /** Identity and timing of the final edit; required whenever timed assets exist. */
  exportId?: string;
  duration?: number;
  video?: { id: string; exportId: string; publishedAt?: string };
  captions?: { exportId: string; uploaded: boolean };
  transcript?: { exportId: string; turns: ReplayTurn[] };
  chapters?: { exportId: string; items: ReplayChapter[] };
  thumbnail?: { url: string; alt: string; width: number; height: number };
}

export const TRANSCRIPT_DISCLOSURE = 'Uncertain words and speakers are marked.';
const nonempty = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0;
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const httpsUrl = (s: unknown): boolean => {
  try {
    const u = new URL(String(s));
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
};

/** Each supplied section is validated; absent sections are omitted, never advertised. */
export function parseEventReplay(value: unknown): EventReplay {
  if (!value || typeof value !== 'object') throw new Error('Replay content must be an object');
  const r = value as EventReplay;
  if (
    !nonempty(r.title) ||
    !nonempty(r.introduction) ||
    (r.searchTitle !== undefined && !nonempty(r.searchTitle))
  )
    throw new Error('Replay needs a title and introduction');
  if (
    r.publishedOn !== undefined &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(r.publishedOn) ||
      !Number.isFinite(Date.parse(r.publishedOn)) ||
      new Date(r.publishedOn).toISOString().slice(0, 10) !== r.publishedOn)
  )
    throw new Error('Replay publication needs a valid date');
  if (r.communityDebateInvitation !== undefined && typeof r.communityDebateInvitation !== 'boolean')
    throw new Error('Replay invitation must be a boolean');
  const assets = [r.video, r.captions, r.transcript, r.chapters];
  if (
    assets.some((a) => a !== undefined) &&
    (!nonempty(r.exportId) || !positive(r.duration) || r.duration > 43200)
  )
    throw new Error('Timed assets need a final export ID and running time');
  if (assets.some((a) => a !== undefined && (!a || a.exportId !== r.exportId)))
    throw new Error('Timed assets must match the final video export');
  if (r.video && !/^[\w-]{11}$/.test(r.video.id)) throw new Error('Invalid YouTube ID');
  if (r.captions && typeof r.captions.uploaded !== 'boolean')
    throw new Error('Caption-upload status is required');
  if (
    r.thumbnail !== undefined &&
    (!httpsUrl(r.thumbnail?.url) ||
      !nonempty(r.thumbnail?.alt) ||
      !Number.isSafeInteger(r.thumbnail?.width) ||
      !positive(r.thumbnail?.width) ||
      !Number.isSafeInteger(r.thumbnail?.height) ||
      !positive(r.thumbnail?.height))
  )
    throw new Error('Replay needs an HTTPS preview image, description and dimensions');
  const inVideo = (n: unknown) =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < r.duration!;
  if (
    r.transcript &&
    (!Array.isArray(r.transcript.turns) ||
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
      ))
  )
    throw new Error(
      'Transcript needs speaker names, paragraphs and increasing timestamps within the video',
    );
  if (
    r.chapters &&
    (!Array.isArray(r.chapters.items) ||
      r.chapters.items.length < 3 ||
      r.chapters.items[0]?.start !== 0 ||
      !r.chapters.items.every(
        (c, i, all) =>
          c &&
          nonempty(c.title) &&
          inVideo(c.start) &&
          Number.isInteger(c.start) &&
          (all[i + 1]?.start ?? r.duration!) - c.start >= 10,
      ))
  )
    throw new Error('Use at least 3 chapters, starting at 0, each at least 10 seconds long');
  if (
    r.video?.publishedAt !== undefined &&
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

/** Search details require actual publication facts, independently of transcript availability. */
export function hasVideoMetadata(replay: EventReplay, now = Date.now()): boolean {
  return Boolean(
    replay.video?.publishedAt && replay.thumbnail && Date.parse(replay.video.publishedAt) <= now,
  );
}

export function assertReplayReady(replay: EventReplay, now = Date.now()): void {
  parseEventReplay(replay);
  if (!hasVideoMetadata(replay, now))
    throw new Error('Publication needs the actual video publication time and thumbnail');
}

export function replayPageMetadata(event: PublishedEvent, replay: EventReplay, now = Date.now()) {
  parseEventReplay(replay);
  const base = eventPageMetadata(event, now);
  const url = publicPageUrl(eventPath(event));
  return pageMetadata({
    ...base,
    title: titleFor(replay.searchTitle ?? replay.title),
    socialTitle: replay.title,
    description: replay.introduction,
    canonicalPath: eventPath(event),
    article: { publishedOn: replay.publishedOn ?? event.publishedOn },
    socialImage: replay.thumbnail ?? base.socialImage,
    preloadImages: [],
    structuredData: [
      ...(base.structuredData ?? []),
      ...(hasVideoMetadata(replay, now)
        ? [
            {
              '@context': 'https://schema.org',
              '@type': 'VideoObject',
              name: replay.title,
              description: replay.introduction,
              thumbnailUrl: [replay.thumbnail!.url],
              uploadDate: replay.video!.publishedAt,
              duration: `PT${replay.duration}S`,
              embedUrl: replayEmbedUrl(replay.video!.id),
              url,
              ...(replay.chapters
                ? {
                    hasPart: replay.chapters.items.map((c, i, all) => ({
                      '@type': 'Clip',
                      name: c.title,
                      startOffset: c.start,
                      endOffset: all[i + 1]?.start ?? replay.duration,
                      url: `${url}?t=${c.start}`,
                    })),
                  }
                : {}),
            },
          ]
        : []),
    ],
  });
}

export function replayVideoSitemapEntry(event: PublishedEvent, replay: EventReplay): string {
  assertReplayReady(replay);
  const x = escapeHtml;
  return `<url><loc>${x(publicPageUrl(eventPath(event)))}</loc><video:video><video:thumbnail_loc>${x(replay.thumbnail!.url)}</video:thumbnail_loc><video:title>${x(replay.title)}</video:title><video:description>${x(replay.introduction)}</video:description><video:player_loc>${x(replayEmbedUrl(replay.video!.id))}</video:player_loc><video:duration>${Math.floor(replay.duration!)}</video:duration><video:publication_date>${x(replay.video!.publishedAt!)}</video:publication_date></video:video></url>`;
}
export function replayVideoSitemap(event: PublishedEvent, replay: EventReplay): string {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">${replayVideoSitemapEntry(event, replay)}</urlset>`;
}
