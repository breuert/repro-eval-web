/**
 * End-to-end evaluation of a reproducibility or replicability experiment, i.e. what
 * `RpdEvaluator` / `RplEvaluator` do after `trim()` and `evaluate()`, generalized to
 * any number of reproductions of the same original experiment (as the PRIMAD
 * module and the example scripts of repro_eval do).
 *
 * - Reproducibility (`rpd`): reproduced runs are evaluated with the original qrels;
 *   KTU, RBO, RMSE, nRMSE, ER, ΔRI and paired t-tests are computed.
 * - Replicability (`rpl`): replicated runs are evaluated with the qrels of another
 *   test collection; ER, ΔRI and unpaired t-tests are computed.
 *
 * ER and ΔRI need both a baseline and an advanced run on each side.
 */
import { MEASURES } from './measures.ts';
import type { MeasureDef } from './measures.ts';
import {
  RBO_DEPTH,
  RBO_P,
  RUN_LENGTH,
  arp,
  deltaRelativeImprovement,
  effectRatio,
  ktu,
  nrmse,
  prepareRun,
  rbo,
  rmse,
  ttest,
} from './repro-measures.ts';
import type { PerTopicResult } from './repro-measures.ts';
import type { TTestResult } from './stats.ts';
import { evaluateRun } from './trec-eval.ts';
import type { IprecRounding, ScoreTable } from './trec-eval.ts';
import type { Qrels, Run } from './trec-format.ts';

export type ExperimentMode = 'rpd' | 'rpl';

export interface ExperimentSettings {
  /** Documents kept per topic before evaluation (`Evaluator.trim(t)`). */
  readonly runLength: number;
  /** Documents compared by KTU (`trim_thresh`). */
  readonly ktuDepth: number;
  /** Depth of RBO. */
  readonly rboDepth: number;
  /** Persistence parameter of RBO. */
  readonly rboP: number;
  /** trec_eval's relevance level (`-l`). */
  readonly relevanceLevel: number;
  readonly iprecRounding: IprecRounding;
}

export const DEFAULT_SETTINGS: ExperimentSettings = {
  runLength: RUN_LENGTH,
  ktuDepth: RUN_LENGTH,
  rboDepth: RBO_DEPTH,
  rboP: RBO_P,
  relevanceLevel: 1,
  iprecRounding: 'v9',
};

/** A value for the baseline run and, if one was given, for the advanced run. */
export interface Pair<T> {
  readonly baseline: T;
  readonly advanced?: T | undefined;
}

export interface ReproductionInput {
  readonly name: string;
  readonly runs: Pair<Run>;
}

export interface ExperimentInput {
  readonly mode: ExperimentMode;
  /** Qrels of the original test collection. */
  readonly qrels: Qrels;
  /** Qrels of the test collection of the replication (replicability only). */
  readonly replicationQrels?: Qrels | undefined;
  readonly original: Pair<Run>;
  readonly reproductions: readonly ReproductionInput[];
  readonly settings?: Partial<ExperimentSettings>;
}

export interface Note {
  readonly level: 'info' | 'warning';
  readonly message: string;
}

export interface EvaluatedRuns {
  /** Runs after tie-breaking and trimming. */
  readonly runs: Pair<Run>;
  readonly scores: Pair<ScoreTable>;
  readonly arp: Pair<Float64Array>;
}

export interface ReproductionResult extends EvaluatedRuns {
  readonly name: string;
  readonly ktu?: Pair<PerTopicResult> | undefined;
  readonly rbo?: Pair<PerTopicResult> | undefined;
  readonly rmse?: Pair<Float64Array> | undefined;
  readonly nrmse?: Pair<Float64Array> | undefined;
  readonly er?: Float64Array | undefined;
  readonly dri?: Float64Array | undefined;
  readonly ttest: Pair<TTestResult[]>;
  readonly notes: readonly Note[];
}

export interface ExperimentResult {
  readonly mode: ExperimentMode;
  readonly settings: ExperimentSettings;
  readonly measures: readonly MeasureDef[];
  readonly original: EvaluatedRuns & { readonly notes: readonly Note[] };
  readonly reproductions: readonly ReproductionResult[];
}

function mapPair<T, U>(pair: Pair<T>, fn: (value: T, role: 'baseline' | 'advanced') => U): Pair<U> {
  return {
    baseline: fn(pair.baseline, 'baseline'),
    advanced: pair.advanced === undefined ? undefined : fn(pair.advanced, 'advanced'),
  };
}

function coverageNotes(scores: Pair<ScoreTable>, label: string): Note[] {
  const notes: Note[] = [];
  for (const role of ['baseline', 'advanced'] as const) {
    const table = scores[role];
    if (table === undefined) continue;
    if (table.missingTopics.length > 0) {
      notes.push({
        level: 'warning',
        message:
          `${label} ${role} run has no results for ${table.missingTopics.length} of ${table.topics.length} judged ` +
          `topic(s); they score 0 (as in repro_eval/ir_measures).`,
      });
    }
    if (table.ignoredTopics.length > 0) {
      notes.push({
        level: 'info',
        message: `${label} ${role} run contains ${table.ignoredTopics.length} topic(s) without judgements; they are not evaluated.`,
      });
    }
  }
  return notes;
}

function validateSettings(s: ExperimentSettings): void {
  const positiveInt = (v: number): boolean => Number.isInteger(v) && v >= 1;
  if (!positiveInt(s.runLength)) throw new Error('The run length must be a positive integer.');
  if (!positiveInt(s.ktuDepth)) throw new Error('The KTU depth must be a positive integer.');
  if (!positiveInt(s.rboDepth)) throw new Error('The RBO depth must be a positive integer.');
  if (!(s.rboP > 0 && s.rboP < 1)) throw new Error('The RBO persistence p must be between 0 and 1.');
  if (!positiveInt(s.relevanceLevel)) throw new Error('The relevance level must be a positive integer.');
}

export function runExperiment(input: ExperimentInput): ExperimentResult {
  const settings: ExperimentSettings = { ...DEFAULT_SETTINGS, ...input.settings };
  validateSettings(settings);
  const rpd = input.mode === 'rpd';
  const repQrels = rpd ? input.qrels : input.replicationQrels;
  if (repQrels === undefined) throw new Error('Replicability needs the qrels of the replication test collection.');
  const evalOptions = { relevanceLevel: settings.relevanceLevel, iprecRounding: settings.iprecRounding };

  const evaluate = (runs: Pair<Run>, qrels: Qrels): EvaluatedRuns => {
    const prepared = mapPair(runs, (run) => prepareRun(run, settings.runLength));
    const scores = mapPair(prepared, (run) => evaluateRun(run, qrels, evalOptions));
    return { runs: prepared, scores, arp: mapPair(scores, arp) };
  };

  const original = evaluate(input.original, input.qrels);
  const originalNotes = coverageNotes(original.scores, 'The original');

  const reproductions = input.reproductions.map((reproduction): ReproductionResult => {
    const evaluated = evaluate(reproduction.runs, repQrels);
    const notes: Note[] = coverageNotes(evaluated.scores, `The ${reproduction.name}`);
    const pairedRuns = <T>(fn: (orig: Run, rep: Run) => T): Pair<T> | undefined => {
      if (!rpd) return undefined;
      const origAdv = original.runs.advanced;
      const repAdv = evaluated.runs.advanced;
      return {
        baseline: fn(original.runs.baseline, evaluated.runs.baseline),
        advanced: origAdv !== undefined && repAdv !== undefined ? fn(origAdv, repAdv) : undefined,
      };
    };
    const pairedScores = <T>(fn: (orig: ScoreTable, rep: ScoreTable) => T): Pair<T> => {
      const origAdv = original.scores.advanced;
      const repAdv = evaluated.scores.advanced;
      return {
        baseline: fn(original.scores.baseline, evaluated.scores.baseline),
        advanced: origAdv !== undefined && repAdv !== undefined ? fn(origAdv, repAdv) : undefined,
      };
    };

    const ktuResult = pairedRuns((o, r) => ktu(o, r, settings.ktuDepth));
    const rboResult = pairedRuns((o, r) => rbo(o, r, settings.rboP, settings.rboDepth));
    for (const result of [ktuResult, rboResult]) {
      for (const role of ['baseline', 'advanced'] as const) {
        for (const message of result?.[role]?.notes ?? []) notes.push({ level: 'warning', message: `${role}: ${message}` });
      }
    }

    const { advanced: origAdv, baseline: origBase } = original.scores;
    const { advanced: repAdv, baseline: repBase } = evaluated.scores;
    const effects = origAdv !== undefined && repAdv !== undefined;

    return {
      name: reproduction.name,
      ...evaluated,
      ktu: ktuResult,
      rbo: rboResult,
      rmse: rpd ? pairedScores(rmse) : undefined,
      nrmse: rpd ? pairedScores(nrmse) : undefined,
      er: effects ? effectRatio(origAdv, origBase, repAdv, repBase) : undefined,
      dri: effects ? deltaRelativeImprovement(origAdv, origBase, repAdv, repBase) : undefined,
      ttest: pairedScores((o, r) => ttest(o, r, rpd)),
      notes,
    };
  });

  return { mode: input.mode, settings, measures: MEASURES, original: { ...original, notes: originalNotes }, reproductions };
}
