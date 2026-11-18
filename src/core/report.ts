/**
 * Text, JSON and CSV renderings of an experiment result.
 */
import type { ExperimentResult, Pair, ReproductionResult } from './experiment.ts';
import { formatFixed, padRight } from './format.ts';
import { DISPLAY_ORDER, measureName } from './measures.ts';
import type { MeasureNaming } from './measures.ts';
import type { PerTopicResult } from './repro-measures.ts';
import type { TTestResult } from './stats.ts';
import type { ScoreTable } from './trec-eval.ts';

const RULE = '------------------------------------------------------------------';

/** `print_base_adv` of repro_eval's CLI. Unlike the CLI, ADV is printed even when it is exactly 0. */
function baseAdvLine(label: string, measure: string, base: number, adv?: number): string {
  const head = padRight(label, 25) + padRight(measure, 8) + padRight('BASE', 8) + formatFixed(base);
  if (adv === undefined) return head;
  return head + (base < 0 ? '   ' : '    ') + padRight('ADV', 8) + formatFixed(adv);
}

/** `print_simple_line` of repro_eval's CLI. */
function simpleLine(label: string, measure: string, value: number): string {
  return padRight(label, 25) + padRight(measure, 8) + formatFixed(value);
}

/**
 * The output of `python -m repro_eval` for one reproduction, in the same layout, so
 * the two can be compared line by line.
 */
export function cliReport(result: ExperimentResult, reproduction: ReproductionResult, naming: MeasureNaming = 'ir_measures'): string {
  const lines: string[] = [];
  const name = (i: number): string => measureName(result.measures[i] as (typeof result.measures)[number], naming);
  const block = (title: string, body: string[]): void => {
    lines.push(title, RULE, ...body, '');
  };
  const perMeasure = (label: string, pair: Pair<ArrayLike<number>>): string[] =>
    DISPLAY_ORDER.map((i) => baseAdvLine(name(i), label, pair.baseline[i] as number, pair.advanced?.[i]));
  const simple = (label: string, values: ArrayLike<number>): string[] => DISPLAY_ORDER.map((i) => simpleLine(name(i), label, values[i] as number));

  if (result.mode === 'rpd') {
    if (reproduction.ktu) block("Kendall's tau Union (KTU)", [baseAdvLine('KTU', 'all', reproduction.ktu.baseline.mean, reproduction.ktu.advanced?.mean)]);
    if (reproduction.rbo) block('Rank-biased Overlap (RBO)', [baseAdvLine('RBO', 'all', reproduction.rbo.baseline.mean, reproduction.rbo.advanced?.mean)]);
    if (reproduction.rmse) block('Root mean square error (RMSE)', perMeasure('RMSE', reproduction.rmse));
  }
  if (reproduction.er) block('Effect Ratio (ER)', simple('ER', reproduction.er));
  if (reproduction.dri) block('Delta Relative Improvement (DRI)', simple('DRI', reproduction.dri));
  const pvalues: Pair<number[]> = {
    baseline: reproduction.ttest.baseline.map((t) => t.pvalue),
    advanced: reproduction.ttest.advanced?.map((t) => t.pvalue),
  };
  block(`Two-tailed ${result.mode === 'rpd' ? 'paired' : 'unpaired'} t-test (p-value)`, perMeasure('PVAL', pvalues));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// JSON

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** JSON has no NaN or infinities; they are written as strings ("NaN", "Infinity", "-Infinity"). */
function num(x: number): Json {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity';
  return x;
}

export interface JsonOptions {
  readonly naming?: MeasureNaming;
  /** Include per-topic scores (large). */
  readonly perTopic?: boolean;
  /** Free-form labels of the input files. */
  readonly inputs?: Record<string, string>;
}

/** The result in the nested-dict shape repro_eval returns (`{'baseline': ..., 'advanced': ...}`). */
export function toJson(result: ExperimentResult, options: JsonOptions = {}): Json {
  const naming = options.naming ?? 'ir_measures';
  const names = result.measures.map((m) => measureName(m, naming));
  const byMeasure = (values: ArrayLike<number>): Json => Object.fromEntries(names.map((name, i) => [name, num(values[i] as number)]));
  const scores = (table: ScoreTable): Json =>
    Object.fromEntries(table.topics.map((topic, t) => [topic, byMeasure(table.values[t] as Float64Array)]));
  const pair = <T>(p: Pair<T> | undefined, fn: (value: T) => Json): Json => {
    if (p === undefined) return null;
    const out: { [key: string]: Json } = { baseline: fn(p.baseline) };
    if (p.advanced !== undefined) out['advanced'] = fn(p.advanced);
    return out;
  };
  const perTopic = (r: PerTopicResult): Json => ({
    mean: num(r.mean),
    per_topic: Object.fromEntries([...r.perTopic].map(([topic, v]) => [topic, num(v)])),
  });
  const ttest = (rows: TTestResult[]): Json =>
    Object.fromEntries(names.map((name, i) => {
      const r = rows[i] as TTestResult;
      return [name, { statistic: num(r.statistic), pvalue: num(r.pvalue), df: num(r.df) }];
    }));
  const runs = (arp: Pair<Float64Array>, tables: Pair<ScoreTable>): Json => {
    const one = (a: Float64Array, table: ScoreTable): Json => {
      const out: { [key: string]: Json } = {
        arp: byMeasure(a),
        topics: table.topics.length,
        missing_topics: table.missingTopics as string[],
        ignored_topics: table.ignoredTopics as string[],
      };
      if (options.perTopic) out['scores'] = scores(table);
      return out;
    };
    const out: { [key: string]: Json } = { baseline: one(arp.baseline, tables.baseline) };
    if (arp.advanced !== undefined && tables.advanced !== undefined) out['advanced'] = one(arp.advanced, tables.advanced);
    return out;
  };

  return {
    generator: 'repro-eval-web',
    type: result.mode === 'rpd' ? 'reproducibility' : 'replicability',
    settings: { ...result.settings },
    measure_names: naming,
    inputs: options.inputs ?? {},
    original: runs(result.original.arp, result.original.scores),
    reproductions: result.reproductions.map((rep) => ({
      name: rep.name,
      runs: runs(rep.arp, rep.scores),
      ktu: pair(rep.ktu, perTopic),
      rbo: pair(rep.rbo, perTopic),
      rmse: pair(rep.rmse, byMeasure),
      nrmse: pair(rep.nrmse, byMeasure),
      er: rep.er ? byMeasure(rep.er) : null,
      dri: rep.dri ? byMeasure(rep.dri) : null,
      ttest: pair(rep.ttest, ttest),
      notes: rep.notes.map((n) => n.message),
    })),
  };
}

// ---------------------------------------------------------------------------
// CSV

function csvCell(value: string | number): string {
  const text = typeof value === 'number' ? (Number.isNaN(value) ? 'NaN' : String(value)) : value;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}

/** Long-format per-topic scores of every evaluated run: run, topic, measure, value. */
export function scoresCsv(result: ExperimentResult, naming: MeasureNaming = 'ir_measures'): string {
  const names = result.measures.map((m) => measureName(m, naming));
  const rows: Array<Array<string | number>> = [];
  const add = (run: string, table: ScoreTable | undefined): void => {
    if (table === undefined) return;
    table.topics.forEach((topic, t) => {
      const row = table.values[t] as Float64Array;
      names.forEach((name, m) => rows.push([run, topic, name, row[m] as number]));
    });
  };
  add('original/baseline', result.original.scores.baseline);
  add('original/advanced', result.original.scores.advanced);
  for (const rep of result.reproductions) {
    add(`${rep.name}/baseline`, rep.scores.baseline);
    add(`${rep.name}/advanced`, rep.scores.advanced);
  }
  return toCsv(['run', 'topic', 'measure', 'value'], rows);
}

/** One row per (reproduction, measure) with every per-measure reproducibility value. */
export function summaryCsv(result: ExperimentResult, naming: MeasureNaming = 'ir_measures'): string {
  const header = [
    'reproduction', 'measure',
    'arp_orig_baseline', 'arp_orig_advanced', 'arp_rep_baseline', 'arp_rep_advanced',
    'rmse_baseline', 'rmse_advanced', 'nrmse_baseline', 'nrmse_advanced',
    'er', 'delta_ri', 'pvalue_baseline', 'pvalue_advanced',
  ];
  const cell = (values: ArrayLike<number> | undefined, i: number): string | number => (values === undefined ? '' : (values[i] as number));
  const rows: Array<Array<string | number>> = [];
  for (const rep of result.reproductions) {
    result.measures.forEach((m, i) => {
      rows.push([
        rep.name, measureName(m, naming),
        cell(result.original.arp.baseline, i), cell(result.original.arp.advanced, i),
        cell(rep.arp.baseline, i), cell(rep.arp.advanced, i),
        cell(rep.rmse?.baseline, i), cell(rep.rmse?.advanced, i),
        cell(rep.nrmse?.baseline, i), cell(rep.nrmse?.advanced, i),
        cell(rep.er, i), cell(rep.dri, i),
        cell(rep.ttest.baseline.map((t) => t.pvalue), i), cell(rep.ttest.advanced?.map((t) => t.pvalue), i),
      ]);
    });
  }
  return toCsv(header, rows);
}
