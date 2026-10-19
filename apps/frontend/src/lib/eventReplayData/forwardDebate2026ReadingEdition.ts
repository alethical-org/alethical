/** Accepted whole-turn omissions from the website reading edition.
 * The supplied transcript JSON, recording and captions remain unchanged.
 * Unrecoverable text is not a claim that the corresponding audio lacks meaning.
 */
export const forwardDebateReadingOmissions = [
  { start: 269.96, reason: 'Standalone handoff and thanks' },
  { start: 1370.7, reason: 'Standalone moderator thanks' },
  { start: 1943.24, reason: 'Incomplete fragment with no recoverable statement in supplied text' },
  { start: 2048.76, reason: 'Unclear-only turn with no recoverable statement in supplied text' },
  {
    start: 3989.62,
    reason: 'Routine acknowledgment after clarification; question, clarification and answer remain',
  },
  { start: 4941.38, reason: 'Procedural offer of a rebuttal' },
  { start: 4943.26, reason: 'Unclear-only turn with no recoverable statement in supplied text' },
  { start: 4954.62, reason: 'Unclear-only turn with no recoverable statement in supplied text' },
  {
    start: 5749.32,
    reason: 'Schedule and audience-question instructions before the retained housing question',
  },
  { start: 6252.32, reason: 'Procedural transition to audience questions' },
  { start: 6512.66, reason: 'Procedural audience turn selection' },
  { start: 6892.56, reason: 'Schedule and transition to retained closing statements' },
] as const;
