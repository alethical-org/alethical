import type { ResearchBlock, ResearchInline, ResearchPiece } from './research';
import { TOPICS } from './researchIndex';
import {
  calculateChart,
  chartDescription,
  isISODate,
  type ChartInput,
  type ChartResult,
  type ReportingPeriod,
} from './shortPostCalculations';

export const SHORT_POST_AI_NOTE =
  'AI helped prepare this article. Alethical checked its claims against the cited records before publication, but errors may remain. The records may be incomplete or later corrected.';
export const CONTRIBUTION_NOTE =
  'A contribution alone does not establish why someone gave, whether it influenced a decision, or whether wrongdoing occurred.';

export interface ShortPostEvidence {
  id: string;
  title: string;
  url: string;
  kind: 'held-records' | 'official-source';
  /** End of the source's covered reporting period, not extraction day. */
  period: ReportingPeriod;
  method: string;
  limitations: string;
  /** A durable source copy or release identifier, without a temporary poster path. */
  version: string;
}

export interface ShortPostClaimCheck {
  id: string;
  claim: string;
  evidenceIds: readonly string[];
  checkedScope: string;
  method: string;
  finding: string;
  status: 'supported' | 'qualified' | 'unresolved';
  qualification?: string;
  checkedBy: string;
  checkedAt: string;
}

export interface ShortPostGraphic {
  id: string;
  claimIds: readonly string[];
  input: ChartInput;
  altDescription: string;
}

export interface ShortPostHistory {
  kind: 'newer-records' | 'source-amendment' | 'our-correction';
  datedOn: string;
  explanation: string;
}

export interface ShortPostEditorial {
  origin: 'social-adaptation';
  evidence: readonly ShortPostEvidence[];
  claims: readonly ShortPostClaimCheck[];
  graphics: readonly ShortPostGraphic[];
  limitations: string;
  coverageNote: string;
  disclosures: readonly string[];
  history: readonly ShortPostHistory[];
  review: {
    editorialApprovedBy: string;
    editorialApprovedAt: string;
    /** Fingerprint of the complete piece, checks, and graphic inputs Eugene saw. */
    eugeneApprovedFingerprint: string;
    eugeneReviewedAt: string;
    /** Each article needs its own explicit instruction, after the complete review. */
    publicationInstructionAt: string;
  };
}

type CalculatedRun = Extract<ResearchInline, { kind: 'calculated' }>;

function graphicNumber(result: ChartResult, run: CalculatedRun): number {
  if (result.kind === 'parts') {
    if (run.metric === 'total') return result.total.value;
    if (run.metric === 'remainder-value') return result.remainder.value;
    if (run.metric === 'remainder-percent') return result.remainder.percent;
    if (run.metric === 'part-value' || run.metric === 'part-percent') {
      const part = result.parts.find((entry) => entry.label === run.partLabel);
      if (!part) throw new Error(`unknown part: ${run.partLabel ?? ''}`);
      return run.metric === 'part-value' ? part.value : part.percent;
    }
  }
  if (result.kind === 'comparison') {
    if (run.metric === 'difference') return result.difference;
    if (run.metric === 'percent-change' && result.percentChange !== undefined) {
      return result.percentChange;
    }
  }
  if (result.kind === 'overlap') {
    if (run.metric === 'left-only') return result.leftOnly;
    if (run.metric === 'right-only') return result.rightOnly;
    if (run.metric === 'both') return result.both;
    if (run.metric === 'union') return result.union;
    if (run.metric === 'neither' && result.neither !== undefined) return result.neither;
  }
  throw new Error(`metric ${run.metric} does not belong to ${result.kind}`);
}

/** Author a number once from chart inputs; use the returned run in the article body. */
export function calculatedRun(
  graphic: ShortPostGraphic,
  metric: CalculatedRun['metric'],
  display: CalculatedRun['display'],
  partLabel?: string,
): CalculatedRun {
  const result = calculateChart(graphic.input);
  const run: CalculatedRun = {
    kind: 'calculated',
    chartId: graphic.id,
    metric,
    display,
    ...(partLabel ? { partLabel } : {}),
    text: '',
  };
  const value = graphicNumber(result, run);
  const options: Intl.NumberFormatOptions =
    display === 'usd'
      ? { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }
      : { maximumFractionDigits: display === 'integer' ? 0 : 4 };
  if (display === 'integer' && !Number.isInteger(value)) {
    throw new Error('integer display would hide a fractional value');
  }
  run.text = `${new Intl.NumberFormat('en-US', options).format(value)}${display === 'percent' ? '%' : ''}`;
  return run;
}

function contentRuns(piece: ResearchPiece): ResearchInline[] {
  const blocks: ResearchBlock[] = [
    ...piece.shortVersion,
    ...(piece.intro ?? []),
    ...piece.sections.flatMap((section) => section.blocks),
  ];
  return blocks.flatMap((block) =>
    block.kind === 'paragraph' ? block.runs : block.kind === 'bullets' ? block.items.flat() : [],
  );
}

/** Accidental edits after review invalidate approval. This is a content check, not a security signature. */
export function shortPostFingerprint(piece: ResearchPiece): string {
  const editorial = piece.shortPost;
  if (!editorial) throw new Error('Short post editorial record is missing');
  const { shortPost: _shortPost, ...article } = piece;
  const { review: _review, ...checkedMaterial } = editorial;
  const material = JSON.stringify({
    article,
    checkedMaterial,
  });
  let hash = 2166136261;
  for (let index = 0; index < material.length; index += 1) {
    hash ^= material.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const nonempty = (value: string | undefined): boolean => Boolean(value?.trim());
const validDate = isISODate;
const validInstant = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  validDate(value.slice(0, 10)) &&
  !Number.isNaN(Date.parse(value));

/** Only social-derived Short posts receive this new gate. Older signed pieces keep their policy. */
export function shortPostPublicationErrors(piece: ResearchPiece): string[] {
  if (piece.format !== 'short-post') return [];
  const errors: string[] = [];
  const editorial = piece.shortPost;
  if (!editorial || editorial.origin !== 'social-adaptation') {
    return ['social-derived Short post needs its editorial record'];
  }
  if (!nonempty(piece.articleId)) errors.push('stable article identity is missing');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(piece.slug)) errors.push('stable slug is invalid');
  if (!piece.traits.research && !piece.traits.guide)
    errors.push('Research or Guide trait is required');
  if (piece.set) errors.push('Short posts cannot join reading sets in v1');
  if (!piece.indexed) errors.push('Short posts must be visible to search on publication');
  if (!validDate(piece.publishedOn) || !validInstant(piece.publishedAt ?? '')) {
    errors.push('publication date and full timestamp are required');
  } else if (piece.publishedAt!.slice(0, 10) !== piece.publishedOn) {
    errors.push('publication date differs from its timestamp');
  }
  if (
    !piece.topics?.length ||
    new Set(piece.topics).size !== piece.topics.length ||
    piece.topics.some((topic) => !TOPICS.some((entry) => entry.slug === topic))
  ) {
    errors.push('at least 1 distinct controlled topic is required');
  }
  if (!nonempty(piece.title) || !nonempty(piece.dek) || !contentRuns(piece).length) {
    errors.push('complete article text is required');
  }
  if (!nonempty(piece.searchDescription))
    errors.push('subject-only search description is required');
  if (!editorial.evidence.length) errors.push('evidence is missing');
  if (!editorial.claims.length) errors.push('claim checks are missing');
  if (!nonempty(editorial.limitations) || !nonempty(editorial.coverageNote)) {
    errors.push('limitations and source coverage are required');
  }
  if (!editorial.disclosures.includes(SHORT_POST_AI_NOTE))
    errors.push('checked AI note is missing');
  if (
    piece.topics?.includes('campaign-finance') &&
    !editorial.disclosures.includes(CONTRIBUTION_NOTE)
  ) {
    errors.push('campaign-finance contribution note is missing');
  }
  const evidenceIds = new Set<string>();
  const sourceUrls = new Set(
    (piece.sourceRuns ?? []).flatMap((line) =>
      line.filter((run) => run.kind === 'externalLink').map((run) => run.href),
    ),
  );
  if (!sourceUrls.size) errors.push('linked article sources are missing');
  for (const evidence of editorial.evidence) {
    if (!nonempty(evidence.id) || evidenceIds.has(evidence.id))
      errors.push('evidence IDs must be distinct');
    evidenceIds.add(evidence.id);
    if (
      !nonempty(evidence.title) ||
      !/^https:\/\//.test(evidence.url) ||
      !sourceUrls.has(evidence.url)
    ) {
      errors.push(`evidence ${evidence.id} needs a linked official or held source`);
    }
    if (
      !validDate(evidence.period.from) ||
      !validDate(evidence.period.through) ||
      evidence.period.from > evidence.period.through ||
      !nonempty(evidence.period.label)
    ) {
      errors.push(`evidence ${evidence.id} needs its covered reporting period`);
    }
    if (
      !nonempty(evidence.method) ||
      !nonempty(evidence.limitations) ||
      !nonempty(evidence.version)
    ) {
      errors.push(`evidence ${evidence.id} needs method, limits, and version`);
    }
  }
  if (
    !validDate(piece.recordsThrough) ||
    !editorial.evidence.some((evidence) => evidence.period.through === piece.recordsThrough)
  ) {
    errors.push('records-through must name a covered reporting-period end');
  }
  const coverageEnds = new Set(editorial.evidence.map((evidence) => evidence.period.through));
  if (
    coverageEnds.size > 1 &&
    [...coverageEnds].some((end) => !editorial.coverageNote.includes(end))
  ) {
    errors.push('different source coverage ends must be explicit');
  }
  const claimIds = new Set<string>();
  let latestCheck = 0;
  for (const claim of editorial.claims) {
    if (!nonempty(claim.id) || claimIds.has(claim.id)) errors.push('claim IDs must be distinct');
    claimIds.add(claim.id);
    if (
      !nonempty(claim.claim) ||
      !nonempty(claim.checkedScope) ||
      !nonempty(claim.method) ||
      !nonempty(claim.finding) ||
      !nonempty(claim.checkedBy) ||
      !validInstant(claim.checkedAt)
    ) {
      errors.push(`claim ${claim.id} needs an evidenced check and reviewer`);
    }
    if (!claim.evidenceIds.length || claim.evidenceIds.some((id) => !evidenceIds.has(id))) {
      errors.push(`claim ${claim.id} lacks cited evidence`);
    }
    if (
      claim.status === 'unresolved' ||
      (claim.status === 'qualified' && !nonempty(claim.qualification))
    ) {
      errors.push(`claim ${claim.id} is unresolved or lacks its specific qualification`);
    }
    latestCheck = Math.max(latestCheck, Date.parse(claim.checkedAt) || 0);
  }
  const graphicIds = new Set<string>();
  for (const graphic of editorial.graphics) {
    if (!nonempty(graphic.id) || graphicIds.has(graphic.id))
      errors.push('graphic IDs must be distinct');
    graphicIds.add(graphic.id);
    if (!graphic.claimIds.length || graphic.claimIds.some((id) => !claimIds.has(id))) {
      errors.push(`graphic ${graphic.id} lacks checked claims`);
    }
    const linkedEvidence = editorial.claims
      .filter((claim) => graphic.claimIds.includes(claim.id))
      .flatMap((claim) =>
        editorial.evidence.filter((evidence) => claim.evidenceIds.includes(evidence.id)),
      );
    const periods =
      graphic.input.kind === 'parts'
        ? [graphic.input.total.period]
        : graphic.input.kind === 'comparison'
          ? [graphic.input.baseline.period, graphic.input.compared.period]
          : [graphic.input.left.period];
    if (
      periods.some(
        (period) =>
          !linkedEvidence.some(
            (evidence) =>
              evidence.period.from <= period.from && evidence.period.through >= period.through,
          ),
      )
    ) {
      errors.push(`graphic ${graphic.id} has no evidence covering its reporting period`);
    }
    try {
      if (graphic.altDescription !== chartDescription(graphic.input)) {
        errors.push(`graphic ${graphic.id} description differs from its numbers`);
      }
    } catch (error) {
      errors.push(`graphic ${graphic.id}: ${(error as Error).message}`);
    }
  }
  const usedGraphics = new Set<string>();
  for (const run of contentRuns(piece)) {
    if (run.kind !== 'calculated') continue;
    const graphic = editorial.graphics.find((entry) => entry.id === run.chartId);
    if (!graphic) {
      errors.push(`body number points at missing graphic ${run.chartId}`);
      continue;
    }
    usedGraphics.add(graphic.id);
    try {
      if (run.text !== calculatedRun(graphic, run.metric, run.display, run.partLabel).text) {
        errors.push(`body number differs from graphic ${graphic.id}`);
      }
    } catch (error) {
      errors.push(`body number: ${(error as Error).message}`);
    }
  }
  for (const graphic of editorial.graphics) {
    if (!usedGraphics.has(graphic.id)) errors.push(`graphic ${graphic.id} has no body number`);
  }
  for (const event of editorial.history) {
    if (!validDate(event.datedOn) || !nonempty(event.explanation)) {
      errors.push('update and correction history needs a date and explanation');
    }
  }
  const review = editorial.review;
  if (
    !nonempty(review.editorialApprovedBy) ||
    !validInstant(review.editorialApprovedAt) ||
    Date.parse(review.editorialApprovedAt) < latestCheck
  ) {
    errors.push('editorial approval after completed checks is missing');
  }
  if (
    !validInstant(review.eugeneReviewedAt) ||
    Date.parse(review.eugeneReviewedAt) < Date.parse(review.editorialApprovedAt)
  ) {
    errors.push('Eugene review after editorial approval is missing');
  }
  if (review.eugeneApprovedFingerprint !== shortPostFingerprint(piece)) {
    errors.push('article or graphic inputs changed after Eugene review');
  }
  if (
    !validInstant(review.publicationInstructionAt) ||
    Date.parse(review.publicationInstructionAt) < Date.parse(review.eugeneReviewedAt) ||
    (validInstant(piece.publishedAt ?? '') &&
      Date.parse(review.publicationInstructionAt) > Date.parse(piece.publishedAt!))
  ) {
    errors.push('article-specific publication instruction is missing');
  }
  return errors;
}

/** Called by the live writing registry, so an unready Short post fails before it can post. */
export function assertPublishedShortPosts<T extends ResearchPiece>(pieces: T[]): T[] {
  const identities = new Set<string>();
  const slugs = new Set<string>();
  for (const piece of pieces) {
    if (slugs.has(piece.slug)) throw new Error(`Published slug repeats: ${piece.slug}`);
    slugs.add(piece.slug);
    if (piece.articleId && identities.has(piece.articleId)) {
      throw new Error(`Published article identity repeats: ${piece.articleId}`);
    }
    if (piece.articleId) identities.add(piece.articleId);
    if (piece.shortPost && piece.format !== 'short-post') {
      throw new Error(`Cannot publish ${piece.slug}: Short post format is missing`);
    }
    if (piece.format !== 'short-post') continue;
    const errors = shortPostPublicationErrors(piece);
    if (errors.length) throw new Error(`Cannot publish ${piece.slug}: ${errors.join('; ')}`);
  }
  return pieces;
}
