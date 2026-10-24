/** Scoring eras are deliberate gameplay decisions, independent of ordinary software releases.
 * Add compatible technical versions to an existing era explicitly; introduce a new era only for meaningful scoring changes.
 * This map controls public boards/labels only. It never grants replay compatibility.
 */
export const SCORING_ERAS = Object.freeze({
  '1.0.0': 'V1',
  '1.1.0': 'V2',
  '1.2.0': 'V3',
  '1.3.0': 'V4',
} as const);

export type ScoringEra = (typeof SCORING_ERAS)[keyof typeof SCORING_ERAS];

export function scoringEra(rulesVersion: string | undefined): ScoringEra | null {
  return rulesVersion && Object.hasOwn(SCORING_ERAS, rulesVersion)
    ? SCORING_ERAS[rulesVersion as keyof typeof SCORING_ERAS]
    : null;
}

export function scoringEraLabel(rulesVersion: string | undefined): string {
  return scoringEra(rulesVersion) ?? 'VERSION UNKNOWN';
}

export function rulesInScoringEra(rulesVersion: string): string[] {
  const era = scoringEra(rulesVersion);
  return era ? Object.keys(SCORING_ERAS).filter((version) => scoringEra(version) === era) : [];
}
