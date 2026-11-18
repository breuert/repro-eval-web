/*! Ported from repro_eval (https://github.com/irgroup/repro_eval) on 2026-11-18.
 * MIT License. Copyright (c) 2020 Timo Breuer, Nicola Ferro, Maria Maistro, Philipp Schaer.
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 * and associated documentation files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions: The above copyright
 * notice and this permission notice shall be included in all copies or substantial portions of
 * the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */

/**
 * The reproducibility measures of repro_eval
 * (Breuer et al., "How to Measure the Reproducibility of System-oriented IR
 * Experiments", SIGIR 2020, https://doi.org/10.1145/3397271.3401036).
 *
 * Module layout follows the Python package:
 *   repro_eval.util                    → breakTies, prepareRun, arp
 *   repro_eval.measure.document_order  → ktu, rbo
 *   repro_eval.measure.effectiveness   → rmse, nrmse
 *   repro_eval.measure.overall_effects → effectRatio, deltaRelativeImprovement
 *   repro_eval.measure.statistics      → ttest
 *
 * Where the Python code raises (topics present in only one run, rankings of
 * different length for KTU), these functions continue on the common part and
 * report what they skipped in `notes`.
 */
import { compareCodePoints } from './compare.ts';
import { NUM_MEASURES } from './measures.ts';
import { kendallTauB, mean, roundTo, sequentialSum, ttestInd, ttestRel } from './stats.ts';
import type { TTestResult } from './stats.ts';
import { measureColumn, rowsByTopic } from './trec-eval.ts';
import type { ScoreTable } from './trec-eval.ts';
import type { Ranking, Run, ScoredDoc } from './trec-format.ts';

/** `repro_eval.RUN_LENGTH`: runs are trimmed to this many documents per topic. */
export const RUN_LENGTH = 1000;
/** `repro_eval.RBO_DEPTH`. */
export const RBO_DEPTH = 1000;
/** `repro_eval.RBO_P`. */
export const RBO_P = 0.95;

// ---------------------------------------------------------------------------
// Run preparation (repro_eval.util)

/**
 * `break_ties`: inside every maximal group of consecutive entries with equal score,
 * order the documents by descending id (trec_eval's tie-breaking). Entries are
 * not sorted by score; runs are expected to be sorted already.
 */
export function breakTies(ranking: Ranking): ScoredDoc[] {
  const out: ScoredDoc[] = [];
  let i = 0;
  while (i < ranking.length) {
    const score = (ranking[i] as ScoredDoc).score;
    let j = i + 1;
    while (j < ranking.length && (ranking[j] as ScoredDoc).score === score) j++;
    if (j - i === 1) {
      out.push(ranking[i] as ScoredDoc);
    } else {
      out.push(...ranking.slice(i, j).sort((a, b) => compareCodePoints(b.docId, a.docId)));
    }
    i = j;
  }
  return out;
}

/** `Evaluator.trim(t)`: break ties, then keep the first `depth` entries of every topic. */
export function prepareRun(run: Run, depth: number = RUN_LENGTH): Run {
  const out = new Map<string, Ranking>();
  for (const [topic, ranking] of run) out.set(topic, breakTies(ranking).slice(0, depth));
  return out;
}

/** `arp_scores`: average retrieval performance (mean over topics) per measure. */
export function arp(scores: ScoreTable): Float64Array {
  const out = new Float64Array(NUM_MEASURES);
  for (let m = 0; m < NUM_MEASURES; m++) out[m] = mean(measureColumn(scores, m));
  return out;
}

// ---------------------------------------------------------------------------
// Document order (repro_eval.measure.document_order)

export interface PerTopicResult {
  /** Topic → value, in code-point order of the topics. */
  readonly perTopic: ReadonlyMap<string, number>;
  /** `numpy.mean` over the topics (NaN if any topic is NaN, as in repro_eval). */
  readonly mean: number;
  readonly notes: readonly string[];
}

function sharedTopics(orig: Run, rep: Run, notes: string[]): string[] {
  const shared = [...rep.keys()].filter((topic) => orig.has(topic));
  const onlyRep = rep.size - shared.length;
  const onlyOrig = [...orig.keys()].filter((topic) => !rep.has(topic)).length;
  if (onlyRep > 0) notes.push(`${onlyRep} topic(s) of the reproduced run are missing from the original run and were skipped.`);
  if (onlyOrig > 0) notes.push(`${onlyOrig} topic(s) of the original run are missing from the reproduced run and were skipped.`);
  return shared;
}

/** Kendall's tau Union of one topic (`_KTU`), comparing the first `depth` documents. */
export function ktuTopic(orig: Ranking, rep: Ranking, depth: number = RUN_LENGTH): number {
  const n = Math.min(orig.length, rep.length, depth);
  const origDocs = orig.slice(0, n).map((d) => d.docId);
  const repDocs = rep.slice(0, n).map((d) => d.docId);
  const union = [...new Set([...origDocs, ...repDocs])].sort(compareCodePoints);
  const position = new Map(union.map((doc, i) => [doc, i]));
  const origIdx = origDocs.map((doc) => position.get(doc) as number);
  const repIdx = repDocs.map((doc) => position.get(doc) as number);
  return roundTo(kendallTauB(origIdx, repIdx), 14);
}

/**
 * Kendall's tau Union (KTU) between the original and the reproduced document orderings.
 * Runs must be prepared with `prepareRun`.
 */
export function ktu(orig: Run, rep: Run, depth: number = RUN_LENGTH): PerTopicResult {
  const notes: string[] = [];
  const perTopic = new Map<string, number>();
  let truncated = 0;
  for (const topic of sharedTopics(orig, rep, notes)) {
    const o = orig.get(topic) as Ranking;
    const r = rep.get(topic) as Ranking;
    if (Math.min(o.length, depth) !== Math.min(r.length, depth)) truncated++;
    perTopic.set(topic, ktuTopic(o, r, depth));
  }
  if (truncated > 0) {
    notes.push(
      `${truncated} topic(s) have rankings of different length; KTU compares their common top ` +
        `(repro_eval would raise an error here).`,
    );
  }
  const undefinedTopics = [...perTopic.values()].filter(Number.isNaN).length;
  if (undefinedTopics > 0) notes.push(`KTU is undefined for ${undefinedTopics} topic(s) with fewer than two documents.`);
  return { perTopic, mean: mean([...perTopic.values()]), notes };
}

/**
 * Rank-biased overlap of one topic (`_rbo`, after Clarke et al., https://doi.org/10.1145/3451161).
 * `run` is the reproduced ranking, `ideal` the original one.
 */
export function rboTopic(run: readonly string[], ideal: readonly string[], p: number = RBO_P, depth: number = RBO_DEPTH): number {
  const runSet = new Set<string>();
  const idealSet = new Set<string>();
  let overlap = 0;
  let score = 0.0;
  let normalizer = 0.0;
  let weight = 1.0;
  for (let i = 0; i < depth; i++) {
    if (i < run.length) {
      const doc = run[i] as string;
      if (!runSet.has(doc)) {
        runSet.add(doc);
        if (idealSet.has(doc)) overlap++;
      }
    }
    if (i < ideal.length) {
      const doc = ideal[i] as string;
      if (!idealSet.has(doc)) {
        idealSet.add(doc);
        if (runSet.has(doc)) overlap++;
      }
    }
    score += (weight * overlap) / (i + 1);
    normalizer += weight;
    weight *= p;
  }
  return score / normalizer;
}

/** Rank-biased overlap (RBO) between the original and the reproduced document orderings. */
export function rbo(orig: Run, rep: Run, p: number = RBO_P, depth: number = RBO_DEPTH): PerTopicResult {
  const notes: string[] = [];
  const perTopic = new Map<string, number>();
  for (const topic of sharedTopics(orig, rep, notes)) {
    const r = (rep.get(topic) as Ranking).map((d) => d.docId);
    const o = (orig.get(topic) as Ranking).map((d) => d.docId);
    perTopic.set(topic, rboTopic(r, o, p, depth));
  }
  return { perTopic, mean: mean([...perTopic.values()]), notes };
}

// ---------------------------------------------------------------------------
// Effectiveness (repro_eval.measure.effectiveness)

/** Pairs of per-topic rows, over the topics of `orig` that `rep` also contains. */
function alignedRows(orig: ScoreTable, rep: ScoreTable): Array<[Float64Array, Float64Array]> {
  const repRows = rowsByTopic(rep);
  const pairs: Array<[Float64Array, Float64Array]> = [];
  orig.topics.forEach((topic, t) => {
    const r = repRows.get(topic);
    if (r !== undefined) pairs.push([orig.values[t] as Float64Array, r]);
  });
  return pairs;
}

/** Root mean square error between original and reproduced topic scores, per measure. */
export function rmse(orig: ScoreTable, rep: ScoreTable): Float64Array {
  const rows = alignedRows(orig, rep);
  const out = new Float64Array(NUM_MEASURES);
  for (let m = 0; m < NUM_MEASURES; m++) {
    const sq = rows.map(([o, r]) => {
      const d = (o[m] as number) - (r[m] as number);
      return d * d;
    });
    out[m] = Math.sqrt(sequentialSum(sq) / sq.length);
  }
  return out;
}

/**
 * RMSE normalized by the largest RMSE possible for the original scores,
 * i.e. the one obtained if every topic were off by max(x, 1 − x).
 */
export function nrmse(orig: ScoreTable, rep: ScoreTable): Float64Array {
  const errors = rmse(orig, rep);
  const out = new Float64Array(NUM_MEASURES);
  for (let m = 0; m < NUM_MEASURES; m++) {
    const sq = orig.values.map((row) => {
      const x = row[m] as number;
      const d = Math.max(x, 1 - x);
      return d * d;
    });
    out[m] = (errors[m] as number) / Math.sqrt(sequentialSum(sq) / sq.length);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Overall effects (repro_eval.measure.overall_effects)

/** Mean per-topic improvement of `advanced` over `baseline`, per measure. */
export function meanImprovement(advanced: ScoreTable, baseline: ScoreTable): Float64Array {
  const rows = alignedRows(advanced, baseline);
  const out = new Float64Array(NUM_MEASURES);
  for (let m = 0; m < NUM_MEASURES; m++) {
    out[m] = mean(rows.map(([a, b]) => (a[m] as number) - (b[m] as number)));
  }
  return out;
}

/** Effect ratio: mean improvement of the reproduction divided by that of the original experiment. */
export function effectRatio(origAdvanced: ScoreTable, origBaseline: ScoreTable, repAdvanced: ScoreTable, repBaseline: ScoreTable): Float64Array {
  const miOrig = meanImprovement(origAdvanced, origBaseline);
  const miRep = meanImprovement(repAdvanced, repBaseline);
  return miRep.map((value, m) => value / (miOrig[m] as number));
}

/** Relative improvement of the mean scores: (mean(a) − mean(b)) / mean(b), per measure. */
export function relativeImprovement(advanced: ScoreTable, baseline: ScoreTable): Float64Array {
  const a = arp(advanced);
  const b = arp(baseline);
  return a.map((value, m) => (value - (b[m] as number)) / (b[m] as number));
}

/** Delta relative improvement: RI of the original experiment minus RI of the reproduction. */
export function deltaRelativeImprovement(origAdvanced: ScoreTable, origBaseline: ScoreTable, repAdvanced: ScoreTable, repBaseline: ScoreTable): Float64Array {
  const riOrig = relativeImprovement(origAdvanced, origBaseline);
  const riRep = relativeImprovement(repAdvanced, repBaseline);
  return riOrig.map((value, m) => value - (riRep[m] as number));
}

// ---------------------------------------------------------------------------
// Statistics (repro_eval.measure.statistics)

function tablesEqual(a: ScoreTable, b: ScoreTable): boolean {
  if (a.topics.length !== b.topics.length) return false;
  return a.topics.every((topic, t) => {
    if (b.topics[t] !== topic) return false;
    const x = a.values[t] as Float64Array;
    const y = b.values[t] as Float64Array;
    return x.every((value, m) => value === y[m]);
  });
}

/**
 * Two-tailed t-test per measure: paired over the shared topics (reproducibility) or
 * unpaired (replicability). As in repro_eval, if every p-value is NaN because the two
 * score tables are identical, all p-values are 1.
 */
export function ttest(orig: ScoreTable, rep: ScoreTable, paired: boolean): TTestResult[] {
  const results: TTestResult[] = [];
  if (paired) {
    const rows = alignedRows(orig, rep);
    for (let m = 0; m < NUM_MEASURES; m++) {
      results.push(ttestRel(rows.map(([o]) => o[m] as number), rows.map(([, r]) => r[m] as number)));
    }
  } else {
    for (let m = 0; m < NUM_MEASURES; m++) results.push(ttestInd(measureColumn(orig, m), measureColumn(rep, m)));
  }
  if (results.every((r) => Number.isNaN(r.pvalue)) && tablesEqual(orig, rep)) {
    return results.map((r) => ({ ...r, pvalue: 1.0 }));
  }
  return results;
}
