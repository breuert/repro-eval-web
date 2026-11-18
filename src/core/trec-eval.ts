/*! Derived from trec_eval (https://github.com/usnistgov/trec_eval); NIST is the source of
 * the software. Changed on 2026-11-18: the measures repro_eval uses were translated from C
 * to TypeScript (see THIRD_PARTY_NOTICES.md). License of trec_eval:
 *
 * The code for the original trec_eval, up to version 9, are Copyright (C) 2008 Chris Buckley.
 * Significant modifications have been done by Ian Soboroff as an employee of NIST. Other
 * modifications and ongoing support are by Ian Soboroff and other contributors on
 * https://github.com/usnistgov/trec_eval. trec_eval is now made available under the following
 * license.
 *
 * NIST-developed software is provided by NIST as a public service. You may use, copy, and
 * distribute copies of the software in any medium, provided that you keep intact this entire
 * notice. You may improve, modify, and create derivative works of the software or any portion
 * of the software, and you may copy and distribute such modifications or works. Modified works
 * should carry a notice stating that you changed the software and should note the date and
 * nature of any such change. Please explicitly acknowledge the National Institute of Standards
 * and Technology as the source of the software.
 *
 * NIST-developed software is expressly provided "AS IS." NIST MAKES NO WARRANTY OF ANY KIND,
 * EXPRESS, IMPLIED, IN FACT, OR ARISING BY OPERATION OF LAW, INCLUDING, WITHOUT LIMITATION, THE
 * IMPLIED WARRANTY OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AND
 * DATA ACCURACY. NIST NEITHER REPRESENTS NOR WARRANTS THAT THE OPERATION OF THE SOFTWARE WILL BE
 * UNINTERRUPTED OR ERROR-FREE, OR THAT ANY DEFECTS WILL BE CORRECTED. NIST DOES NOT WARRANT OR
 * MAKE ANY REPRESENTATIONS REGARDING THE USE OF THE SOFTWARE OR THE RESULTS THEREOF, INCLUDING
 * BUT NOT LIMITED TO THE CORRECTNESS, ACCURACY, RELIABILITY, OR USEFULNESS OF THE SOFTWARE.
 *
 * You are solely responsible for determining the appropriateness of using and distributing the
 * software and you assume all risks associated with its use, including but not limited to the
 * risks and costs of program errors, compliance with applicable laws, damage to or loss of data,
 * programs or equipment, and the unavailability or interruption of operation. This software is
 * not intended to be used in any situation where a failure could cause risk of injury or damage
 * to property. The software developed by NIST employees is not subject to copyright protection
 * within the United States.
 */

/**
 * A port of the trec_eval measures that repro_eval uses.
 *
 * Each function below is a line-by-line transcription of the corresponding
 * trec_eval source file (`form_res_rels.c`, `m_P.c`, `m_ndcg.c`, ...), keeping the
 * order of floating-point operations so that results agree with trec_eval and
 * pytrec_eval. Per-topic values are verified against pytrec_eval (trec_eval 9.x)
 * and trec_eval 10.0 in `test/trec-eval.test.ts`.
 *
 * Evaluation follows what repro_eval obtains through ir_measures:
 *   - every topic of the qrels gets a score; topics without retrieved documents
 *     score 0 for every measure (ir_measures fills in `measure.DEFAULT`),
 *   - retrieved topics without judgements are ignored.
 */
import { compareCodePoints } from './compare.ts';
import { CUTOFFS, MEASURES, NUM_MEASURES, RECALL_LEVELS, measureIndex } from './measures.ts';
import type { Judgements, Qrels, Ranking, Run, ScoredDoc } from './trec-format.ts';

/** Relevance value of a retrieved document that is not in the qrels. */
export const RELVALUE_NONPOOL = -1;
/** Relevance value of a retrieved document judged with a negative label (pooled but unjudged). */
export const RELVALUE_UNJUDGED = -2;
/** `INFAP_EPSILON` in trec_eval.h. */
const INFAP_EPSILON = 0.00001;

/**
 * How `iprec_at_recall` turns a recall level into a number of relevant documents.
 *
 * - `v9`: `(long) (level * num_rel + 0.9)` evaluated with two roundings, as trec_eval 9.x
 *   and pytrec_eval (repro_eval's backend) compute it on x86-64.
 * - `v9-fma`: the same expression with a single rounding. Compilers for ARM (Apple Silicon,
 *   aarch64 Linux) fuse the multiply-add, which changes the result for some numbers of
 *   relevant documents at the recall levels 0.3 and 0.7 (for example 3, 23 and 57).
 * - `v10`: `lround(level * num_rel)`, trec_eval 10.0, which removed the platform dependence.
 */
export type IprecRounding = 'v9' | 'v9-fma' | 'v10';

export interface TrecEvalOptions {
  /** trec_eval's `-l`: minimum label of a relevant document (default 1). */
  readonly relevanceLevel?: number;
  readonly iprecRounding?: IprecRounding;
}

/** The intermediate representation trec_eval builds for every topic (`RES_RELS`). */
export interface ResRels {
  /** Relevance of the retrieved documents in rank order. */
  readonly relList: Int32Array;
  readonly numRet: number;
  readonly numRel: number;
  readonly numRelRet: number;
  readonly numNonpool: number;
  readonly numUnjudgedInPool: number;
  /** Number of judged documents per non-negative label (index = label). */
  readonly relLevels: readonly number[];
  readonly numRelLevels: number;
}

/** Retrieved documents in trec_eval's rank order: score descending, ties by docid descending. */
export function rankDocuments(ranking: Ranking): ScoredDoc[] {
  return ranking.slice().sort((x, y) => {
    if (x.score > y.score) return -1;
    if (x.score < y.score) return 1;
    return compareCodePoints(y.docId, x.docId);
  });
}

/** `te_form_res_rels`: merge one topic's ranking with its judgements. */
export function formResRels(ranking: Ranking, judgements: Judgements, relevanceLevel = 1): ResRels {
  const docs = rankDocuments(ranking);
  const numRet = docs.length;
  const relList = new Int32Array(numRet);
  let numRelRet = 0;
  let numNonpool = 0;
  let numUnjudgedInPool = 0;
  for (let i = 0; i < numRet; i++) {
    const label = judgements.get((docs[i] as ScoredDoc).docId);
    if (label === undefined) {
      relList[i] = RELVALUE_NONPOOL;
      numNonpool++;
    } else if (label < 0) {
      relList[i] = RELVALUE_UNJUDGED;
      numUnjudgedInPool++;
    } else {
      relList[i] = label;
      if (label >= relevanceLevel) numRelRet++;
    }
  }

  let maxLabel = -1;
  for (const label of judgements.values()) if (label > maxLabel) maxLabel = label;
  const relLevels = new Array<number>(Math.max(maxLabel + 1, 0)).fill(0);
  for (const label of judgements.values()) if (label >= 0) relLevels[label] = (relLevels[label] as number) + 1;

  let numRel = 0;
  let numRelLevels = 0;
  for (let i = 0; i < relLevels.length; i++) {
    const count = relLevels[i] as number;
    if (count) {
      numRelLevels = i + 1;
      if (i >= relevanceLevel) numRel += count;
    }
  }

  return { relList, numRet, numRel, numRelRet, numNonpool, numUnjudgedInPool, relLevels, numRelLevels };
}

const OFF_P = measureIndex('P@5');
const OFF_R = measureIndex('R@5');
const OFF_NDCG = measureIndex('nDCG');
const OFF_NDCG_CUT = measureIndex('nDCG@5');
const OFF_AP_CUT = measureIndex('AP@5');
const OFF_SET_AP = measureIndex('SetAP');
const OFF_SET_P = measureIndex('SetP');
const OFF_SET_REL_P = measureIndex('SetP(relative=True)');
const OFF_SET_R = measureIndex('SetR');
const OFF_SET_F = measureIndex('SetF');
const OFF_RPREC = measureIndex('Rprec');
const OFF_INFAP = measureIndex('infAP');
const OFF_BPREF = measureIndex('Bpref');
const OFF_RR = measureIndex('RR');
const OFF_AP = measureIndex('AP');
const OFF_IPREC = measureIndex('IPrec@0.0');

const NUM_CUTOFFS = CUTOFFS.length;

/** m_P.c */
function precisionAtCutoffs(rr: ResRels, level: number, out: Float64Array): void {
  let ci = 0;
  let relSoFar = 0;
  for (let i = 0; i < rr.numRet; i++) {
    if (i === CUTOFFS[ci]) {
      out[OFF_P + ci] = relSoFar / i;
      if (++ci === NUM_CUTOFFS) break;
    }
    if ((rr.relList[i] as number) >= level) relSoFar++;
  }
  while (ci < NUM_CUTOFFS) {
    out[OFF_P + ci] = relSoFar / (CUTOFFS[ci] as number);
    ci++;
  }
}

/** m_recall.c */
function recallAtCutoffs(rr: ResRels, level: number, out: Float64Array): void {
  if (rr.numRel === 0) return;
  let ci = 0;
  let relSoFar = 0;
  for (let i = 0; i < rr.numRet; i++) {
    if (i === CUTOFFS[ci]) {
      out[OFF_R + ci] = relSoFar / rr.numRel;
      if (++ci === NUM_CUTOFFS) break;
    }
    if ((rr.relList[i] as number) >= level) relSoFar++;
  }
  while (ci < NUM_CUTOFFS) {
    out[OFF_R + ci] = relSoFar / rr.numRel;
    ci++;
  }
}

/**
 * m_ndcg.c with the default gains (gain of a document = its label).
 * `setup_gains` then lists the labels 0..numRelLevels-1 in increasing gain order.
 */
function ndcg(rr: ResRels, out: Float64Array): void {
  const numGains = rr.numRelLevels;
  const gainOf = (rel: number): number => (rel >= 0 && rel < numGains ? rel : 0);
  let resultsDcg = 0;
  let idealDcg = 0;
  let curLevel = numGains - 1;
  let idealGain = curLevel >= 0 ? curLevel : 0;
  let numAtLevel = 0;
  let i = 0;
  for (; i < rr.numRet && idealGain > 0; i++) {
    const resultsGain = gainOf(rr.relList[i] as number);
    if (resultsGain !== 0) resultsDcg += resultsGain / Math.log2(i + 2);
    numAtLevel++;
    while (curLevel >= 0 && numAtLevel > (rr.relLevels[curLevel] as number)) {
      numAtLevel = 1;
      curLevel--;
      idealGain = curLevel >= 0 ? curLevel : 0;
    }
    if (idealGain > 0) idealDcg += idealGain / Math.log2(i + 2);
  }
  for (; i < rr.numRet; i++) {
    const resultsGain = gainOf(rr.relList[i] as number);
    if (resultsGain !== 0) resultsDcg += resultsGain / Math.log2(i + 2);
  }
  while (idealGain > 0) {
    numAtLevel++;
    while (curLevel >= 0 && numAtLevel > (rr.relLevels[curLevel] as number)) {
      numAtLevel = 1;
      curLevel--;
      idealGain = curLevel >= 0 ? curLevel : 0;
    }
    if (idealGain > 0) idealDcg += idealGain / Math.log2(i + 2);
    i++;
  }
  if (idealDcg > 0) out[OFF_NDCG] = resultsDcg / idealDcg;
}

/** m_ndcg_cut.c */
function ndcgAtCutoffs(rr: ResRels, out: Float64Array): void {
  let ci = 0;
  let sum = 0;
  for (let i = 0; i < rr.numRet; i++) {
    if (i === CUTOFFS[ci]) {
      out[OFF_NDCG_CUT + ci] = sum;
      if (++ci === NUM_CUTOFFS) break;
    }
    const gain = rr.relList[i] as number;
    if (gain > 0) sum += gain / Math.log2(i + 2);
  }
  while (ci < NUM_CUTOFFS) {
    out[OFF_NDCG_CUT + ci] = sum;
    ci++;
  }

  // Ideal DCG, normalizing each cutoff as it is passed. A topic without judged
  // documents (numRelLevels = 0) has no ideal ranking; the C code then reads
  // stale memory, here the values simply stay unnormalized (they are 0).
  ci = 0;
  let curLvl = rr.numRelLevels - 1;
  let lvlCount = 0;
  let idealDcg = 0;
  if (curLvl > 0) {
    for (let i = 0; ; i++) {
      lvlCount++;
      while (curLvl > 0 && lvlCount > (rr.relLevels[curLvl] as number)) {
        curLvl--;
        lvlCount = 1;
      }
      if (curLvl === 0) break;
      if (i === CUTOFFS[ci]) {
        if (idealDcg > 0) out[OFF_NDCG_CUT + ci] = (out[OFF_NDCG_CUT + ci] as number) / idealDcg;
        if (++ci === NUM_CUTOFFS) break;
      }
      idealDcg += curLvl / Math.log2(i + 2);
    }
  }
  while (ci < NUM_CUTOFFS) {
    if (idealDcg > 0) out[OFF_NDCG_CUT + ci] = (out[OFF_NDCG_CUT + ci] as number) / idealDcg;
    ci++;
  }
}

/** m_map_cut.c */
function apAtCutoffs(rr: ResRels, level: number, out: Float64Array): void {
  if (rr.numRel === 0) return;
  let ci = 0;
  let relSoFar = 0;
  let sum = 0;
  for (let i = 0; i < rr.numRet; i++) {
    if (i === CUTOFFS[ci]) {
      out[OFF_AP_CUT + ci] = sum / rr.numRel;
      if (++ci === NUM_CUTOFFS) break;
    }
    if ((rr.relList[i] as number) >= level) {
      relSoFar++;
      sum += relSoFar / (i + 1);
    }
  }
  while (ci < NUM_CUTOFFS) {
    out[OFF_AP_CUT + ci] = sum / rr.numRel;
    ci++;
  }
}

/** m_set_map.c, m_set_P.c, m_set_rel_P.c, m_set_recall.c, m_set_F.c */
function setMeasures(rr: ResRels, out: Float64Array): void {
  const { numRet, numRel, numRelRet } = rr;
  if (numRet && numRel) out[OFF_SET_AP] = (numRelRet * numRelRet) / (numRet * numRel);
  if (numRet) out[OFF_SET_P] = numRelRet / numRet;
  if (numRet && numRel) out[OFF_SET_REL_P] = numRelRet / Math.min(numRet, numRel);
  if (numRel) out[OFF_SET_R] = numRelRet / numRel;
  if (numRelRet) {
    const p = numRelRet / numRet;
    const r = numRelRet / numRel;
    const x = 1.0;
    out[OFF_SET_F] = ((x + 1.0) * p * r) / (x * p + r);
  }
}

/** m_Rprec.c */
function rPrecision(rr: ResRels, level: number, out: Float64Array): void {
  const numToLookAt = Math.min(rr.numRet, rr.numRel);
  if (numToLookAt === 0) return;
  let relSoFar = 0;
  for (let i = 0; i < numToLookAt; i++) if ((rr.relList[i] as number) >= level) relSoFar++;
  out[OFF_RPREC] = relSoFar / rr.numRel;
}

/** m_infap.c */
function infAP(rr: ResRels, level: number, out: Float64Array): void {
  let nonrelSoFar = 0;
  let relSoFar = 0;
  let poolUnjudgedSoFar = 0;
  let value = 0.0;
  for (let j = 0; j < rr.numRet; j++) {
    const rel = rr.relList[j] as number;
    if (rel === RELVALUE_NONPOOL) continue;
    if (rel === RELVALUE_UNJUDGED) {
      poolUnjudgedSoFar++;
      continue;
    }
    if (rel >= 0 && rel < level) {
      nonrelSoFar++;
    } else {
      relSoFar++;
      if (j === 0) {
        value += 1.0;
      } else {
        const fj = j;
        value +=
          1.0 / (fj + 1.0) +
          (fj / (fj + 1.0)) *
            ((relSoFar - 1 + nonrelSoFar + poolUnjudgedSoFar) / fj) *
            ((relSoFar - 1 + INFAP_EPSILON) / (relSoFar - 1 + nonrelSoFar + 2 * INFAP_EPSILON));
      }
    }
  }
  if (rr.numRel) value /= rr.numRel;
  out[OFF_INFAP] = value;
}

/** m_bpref.c */
function bpref(rr: ResRels, level: number, out: Float64Array): void {
  let numNonrel = 0;
  for (let j = 0; j < level; j++) numNonrel += rr.relLevels[j] ?? 0;
  let nonrelSoFar = 0;
  let value = 0.0;
  for (let j = 0; j < rr.numRet; j++) {
    const rel = rr.relList[j] as number;
    if (rel === RELVALUE_NONPOOL || rel === RELVALUE_UNJUDGED) continue;
    if (rel >= 0 && rel < level) {
      nonrelSoFar++;
    } else if (nonrelSoFar > 0) {
      value += 1.0 - Math.min(nonrelSoFar, rr.numRel) / Math.min(numNonrel, rr.numRel);
    } else {
      value += 1.0;
    }
  }
  if (rr.numRel) value /= rr.numRel;
  out[OFF_BPREF] = value;
}

/** m_recip_rank.c */
function reciprocalRank(rr: ResRels, level: number, out: Float64Array): void {
  for (let i = 0; i < rr.numRet; i++) {
    if ((rr.relList[i] as number) >= level) {
      out[OFF_RR] = 1.0 / (i + 1);
      return;
    }
  }
}

/** m_map.c */
function averagePrecision(rr: ResRels, level: number, out: Float64Array): void {
  let relSoFar = 0;
  let sum = 0.0;
  for (let i = 0; i < rr.numRet; i++) {
    if ((rr.relList[i] as number) >= level) {
      relSoFar++;
      sum += relSoFar / (i + 1);
    }
  }
  if (relSoFar) out[OFF_AP] = sum / rr.numRel;
}

/** C `lround` for non-negative arguments (round half away from zero). */
function lround(x: number): number {
  const f = Math.floor(x);
  return x - f >= 0.5 ? f + 1 : f;
}

/** A finite double as an exact integer mantissa and a binary exponent. */
function decompose(x: number): [mantissa: bigint, exponent: number] {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const biased = (hi >>> 20) & 0x7ff;
  const fraction = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  return biased === 0 ? [fraction, -1074] : [fraction | (1n << 52n), biased - 1075];
}

/** `trunc(fma(a, b, c))`: a·b + c rounded once to double, for non-negative finite operands. */
export function truncFusedMultiplyAdd(a: number, b: number, c: number): number {
  const [ma, ea] = decompose(a);
  const [mb, eb] = decompose(b);
  const [mc, ec] = decompose(c);
  const e = Math.min(ea + eb, ec);
  const exact = ((ma * mb) << BigInt(ea + eb - e)) + (mc << BigInt(ec - e)); // value = exact · 2^e
  const shift = Math.max(exact.toString(2).length - 53, 0);
  let rounded = exact >> BigInt(shift);
  if (shift > 0) {
    const rest = exact - (rounded << BigInt(shift));
    const half = 1n << BigInt(shift - 1);
    if (rest > half || (rest === half && (rounded & 1n) === 1n)) rounded += 1n;
  }
  return Math.trunc(Number(rounded) * 2 ** (e + shift));
}

function iprecCutoff(level: number, numRel: number, rounding: IprecRounding): number {
  switch (rounding) {
    case 'v9':
      return Math.trunc(level * numRel + 0.9);
    case 'v9-fma':
      return truncFusedMultiplyAdd(level, numRel, 0.9);
    case 'v10':
      return lround(level * numRel);
  }
}

/** m_iprec_at_recall.c */
function interpolatedPrecision(rr: ResRels, level: number, rounding: IprecRounding, out: Float64Array): void {
  const n = RECALL_LEVELS.length;
  const cutoffs = RECALL_LEVELS.map((r) => iprecCutoff(r, rr.numRel, rounding));
  let currentCut = n - 1;
  while (currentCut >= 0 && (cutoffs[currentCut] as number) > rr.numRelRet) currentCut--;

  let precis = rr.numRelRet / rr.numRet;
  let intPrecis = precis;
  let relSoFar = rr.numRelRet;
  for (let i = rr.numRet; i > 0 && relSoFar > 0; i--) {
    precis = relSoFar / i;
    if (intPrecis < precis) intPrecis = precis;
    if ((rr.relList[i - 1] as number) >= level) {
      while (currentCut >= 0 && relSoFar === cutoffs[currentCut]) {
        out[OFF_IPREC + currentCut] = intPrecis;
        currentCut--;
      }
      relSoFar--;
    }
  }
  while (currentCut >= 0) {
    out[OFF_IPREC + currentCut] = intPrecis;
    currentCut--;
  }
}

/** All measures for one topic, indexed like `MEASURES`. */
export function evaluateResRels(rr: ResRels, options: TrecEvalOptions = {}): Float64Array {
  const level = options.relevanceLevel ?? 1;
  const out = new Float64Array(NUM_MEASURES);
  precisionAtCutoffs(rr, level, out);
  recallAtCutoffs(rr, level, out);
  ndcg(rr, out);
  ndcgAtCutoffs(rr, out);
  apAtCutoffs(rr, level, out);
  setMeasures(rr, out);
  rPrecision(rr, level, out);
  infAP(rr, level, out);
  bpref(rr, level, out);
  reciprocalRank(rr, level, out);
  averagePrecision(rr, level, out);
  interpolatedPrecision(rr, level, options.iprecRounding ?? 'v9', out);
  return out;
}

export function evaluateTopic(ranking: Ranking, judgements: Judgements, options: TrecEvalOptions = {}): Float64Array {
  return evaluateResRels(formResRels(ranking, judgements, options.relevanceLevel ?? 1), options);
}

/** Per-topic scores of one run (the result of `repro_eval.util.evaluate_run`). */
export interface ScoreTable {
  /** All topics of the qrels, in code-point order. */
  readonly topics: readonly string[];
  /** `values[t][m]`: score of topic `topics[t]` for measure `MEASURES[m]`. */
  readonly values: readonly Float64Array[];
  /** Topics of the qrels the run does not contain; they score 0 for every measure. */
  readonly missingTopics: readonly string[];
  /** Topics of the run the qrels do not contain; they are not evaluated. */
  readonly ignoredTopics: readonly string[];
}

export function evaluateRun(run: Run, qrels: Qrels, options: TrecEvalOptions = {}): ScoreTable {
  const topics: string[] = [];
  const values: Float64Array[] = [];
  const missingTopics: string[] = [];
  for (const [topic, judgements] of qrels) {
    topics.push(topic);
    const ranking = run.get(topic);
    if (ranking === undefined || ranking.length === 0) {
      missingTopics.push(topic);
      values.push(new Float64Array(NUM_MEASURES));
    } else {
      values.push(evaluateTopic(ranking, judgements, options));
    }
  }
  const ignoredTopics = [...run.keys()].filter((topic) => !qrels.has(topic));
  return { topics, values, missingTopics, ignoredTopics };
}

/** Scores of one measure across topics, aligned with `table.topics`. */
export function measureColumn(table: ScoreTable, measure: number): Float64Array {
  const column = new Float64Array(table.topics.length);
  table.values.forEach((row, t) => {
    column[t] = row[measure] as number;
  });
  return column;
}

/** `Map` from topic to its row, for lookups by topic id. */
export function rowsByTopic(table: ScoreTable): Map<string, Float64Array> {
  const map = new Map<string, Float64Array>();
  table.topics.forEach((topic, t) => map.set(topic, table.values[t] as Float64Array));
  return map;
}

export { MEASURES };
