// Risk engine (spec §16). Pure: signals + config in, score and severity out.
//
//   rawScore = Σ signal points                     (stored)
//   score    = min(100, rawScore)                  (clamp)
//   multi-signal gate: CRITICAL needs contributions from at least
//     minCategoriesForCritical categories; otherwise the score is capped just below the
//     critical band (79 with the default bands) and the reason is recorded
//   canary floor: a canary touch makes severity at least SUSPICIOUS
//   severity from the configured bands

import { round1 } from './rules.engine.js';

export const SEVERITIES = Object.freeze(['SAFE', 'SUSPICIOUS', 'HIGH', 'CRITICAL']);

export function severityRank(severity) {
  return SEVERITIES.indexOf(severity);
}

export function severityFor(score, bands) {
  if (score >= bands.critical) return 'CRITICAL';
  if (score >= bands.high) return 'HIGH';
  if (score >= bands.suspicious) return 'SUSPICIOUS';
  return 'SAFE';
}

export function computeRisk(signals, config) {
  const bands = config.severityBands;
  const contributing = signals.filter((signal) => signal.points > 0);
  const rawScore = round1(contributing.reduce((sum, signal) => sum + signal.points, 0));
  const categories = [...new Set(contributing.map((signal) => signal.category))];
  const reasons = [];

  let score = Math.min(100, rawScore);
  if (rawScore > 100) reasons.push(`Score clamped to 100 (sum of signals ${rawScore}).`);

  let capApplied = false;
  if (score >= bands.critical && categories.length < config.minCategoriesForCritical) {
    score = bands.critical - 1;
    capApplied = true;
    reasons.push(
      `Single-category cap applied: only ${categories.length} signal categor${categories.length === 1 ? 'y' : 'ies'} `
      + `contributed and CRITICAL needs ${config.minCategoriesForCritical}. Score capped at ${score}.`,
    );
  }

  let severity = severityFor(score, bands);
  if (severity === 'SAFE' && contributing.some((signal) => signal.category === 'DECEPTION')) {
    severity = 'SUSPICIOUS';
    reasons.push('Canary floor: a canary file was touched, so severity is at least SUSPICIOUS.');
  }

  return { rawScore, score, severity, categories, capApplied, reasons };
}
