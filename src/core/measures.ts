/**
 * The retrieval measures repro_eval evaluates.
 *
 * `repro_eval.util.load_measures()` expands these trec_eval measure families with
 * `ir_measures.convert_trec_name`:
 *
 *   P, recall, ndcg, ndcg_cut, map_cut, set_map, set_P, set_relative_P,
 *   set_recall, set_F, Rprec, infAP, bpref, recip_rank, map, iprec_at_recall
 *
 * which yields the 58 measures below, in the same order. `id` is the ir_measures
 * notation that repro_eval reports, `trecName` the trec_eval notation.
 */

/** Rank cutoffs of the P, recall, ndcg_cut and map_cut families (trec_eval defaults). */
export const CUTOFFS = [5, 10, 15, 20, 30, 100, 200, 500, 1000] as const;

/** Recall levels of the iprec_at_recall family (trec_eval defaults). */
export const RECALL_LEVELS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0] as const;

export type MeasureGroup = 'P' | 'R' | 'nDCG' | 'AP' | 'set' | 'other' | 'IPrec';

export interface MeasureDef {
  /** ir_measures notation, as reported by repro_eval (e.g. `P@10`, `nDCG`). */
  readonly id: string;
  /** trec_eval notation (e.g. `P_10`, `ndcg`). */
  readonly trecName: string;
  readonly group: MeasureGroup;
  /** Rank cutoff for P@k, R@k, nDCG@k and AP@k. */
  readonly cutoff?: number;
  /** Recall level for IPrec@r. */
  readonly recall?: number;
}

export const MEASURE_GROUPS: ReadonlyArray<{ readonly id: MeasureGroup; readonly label: string }> = [
  { id: 'AP', label: 'AP' },
  { id: 'nDCG', label: 'nDCG' },
  { id: 'P', label: 'Precision' },
  { id: 'R', label: 'Recall' },
  { id: 'other', label: 'Rprec, infAP, Bpref, RR' },
  { id: 'set', label: 'Set-based' },
  { id: 'IPrec', label: 'Interpolated precision' },
];

function build(): MeasureDef[] {
  const m: MeasureDef[] = [];
  for (const k of CUTOFFS) m.push({ id: `P@${k}`, trecName: `P_${k}`, group: 'P', cutoff: k });
  for (const k of CUTOFFS) m.push({ id: `R@${k}`, trecName: `recall_${k}`, group: 'R', cutoff: k });
  m.push({ id: 'nDCG', trecName: 'ndcg', group: 'nDCG' });
  for (const k of CUTOFFS) m.push({ id: `nDCG@${k}`, trecName: `ndcg_cut_${k}`, group: 'nDCG', cutoff: k });
  for (const k of CUTOFFS) m.push({ id: `AP@${k}`, trecName: `map_cut_${k}`, group: 'AP', cutoff: k });
  m.push({ id: 'SetAP', trecName: 'set_map', group: 'set' });
  m.push({ id: 'SetP', trecName: 'set_P', group: 'set' });
  m.push({ id: 'SetP(relative=True)', trecName: 'set_relative_P', group: 'set' });
  m.push({ id: 'SetR', trecName: 'set_recall', group: 'set' });
  m.push({ id: 'SetF', trecName: 'set_F', group: 'set' });
  m.push({ id: 'Rprec', trecName: 'Rprec', group: 'other' });
  m.push({ id: 'infAP', trecName: 'infAP', group: 'other' });
  m.push({ id: 'Bpref', trecName: 'bpref', group: 'other' });
  m.push({ id: 'RR', trecName: 'recip_rank', group: 'other' });
  m.push({ id: 'AP', trecName: 'map', group: 'AP' });
  for (const r of RECALL_LEVELS) {
    m.push({ id: `IPrec@${r.toFixed(1)}`, trecName: `iprec_at_recall_${r.toFixed(2)}`, group: 'IPrec', recall: r });
  }
  return m;
}

export const MEASURES: readonly MeasureDef[] = build();

export const NUM_MEASURES = MEASURES.length;

const INDEX = new Map<string, number>();
MEASURES.forEach((m, i) => {
  INDEX.set(m.id, i);
  INDEX.set(m.trecName, i);
});

/** Index of a measure in `MEASURES`, looked up by ir_measures or trec_eval name. */
export function measureIndex(name: string): number {
  const i = INDEX.get(name);
  if (i === undefined) throw new Error(`Unknown measure: ${name}`);
  return i;
}

/**
 * The order in which repro_eval reports measures (pytrec_eval's internal measure order),
 * as indices into `MEASURES`. Tables and the text report follow it.
 */
export const DISPLAY_ORDER: readonly number[] = [
  'AP', 'Rprec', 'Bpref', 'RR',
  ...RECALL_LEVELS.map((r) => `IPrec@${r.toFixed(1)}`),
  ...CUTOFFS.map((k) => `P@${k}`),
  ...CUTOFFS.map((k) => `R@${k}`),
  'infAP', 'nDCG',
  ...CUTOFFS.map((k) => `nDCG@${k}`),
  ...CUTOFFS.map((k) => `AP@${k}`),
  'SetP', 'SetP(relative=True)', 'SetR', 'SetAP', 'SetF',
].map(measureIndex);

/** `DISPLAY_ORDER` grouped by `MEASURE_GROUPS` (for tables with one section per group). */
export const GROUPED_ORDER: readonly number[] = MEASURE_GROUPS.flatMap((g) => DISPLAY_ORDER.filter((i) => MEASURES[i]?.group === g.id));

/** The measures repro_eval's example scripts plot (map, ndcg and P_10). */
export const HEADLINE_MEASURES: readonly string[] = ['AP', 'nDCG', 'P@10'];

export type MeasureNaming = 'ir_measures' | 'trec_eval';

export function measureName(m: MeasureDef, naming: MeasureNaming): string {
  return naming === 'trec_eval' ? m.trecName : m.id;
}
