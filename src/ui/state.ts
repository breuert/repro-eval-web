import { DEFAULT_SETTINGS } from '../core/experiment.ts';
import type { ExperimentMode, ExperimentResult, ExperimentSettings } from '../core/experiment.ts';
import { HEADLINE_MEASURES, MEASURE_GROUPS } from '../core/measures.ts';
import type { MeasureGroup, MeasureNaming } from '../core/measures.ts';
import type { ParsedQrels, ParsedRun } from '../core/trec-format.ts';

export interface FileSlot<T> {
  readonly status: 'empty' | 'loading' | 'ready' | 'error';
  readonly fileName?: string;
  readonly size?: number;
  readonly data?: T;
  readonly error?: string;
}

export const EMPTY: FileSlot<never> = { status: 'empty' };

export interface ReproductionSlot {
  readonly id: number;
  name: string;
  baseline: FileSlot<ParsedRun>;
  advanced: FileSlot<ParsedRun>;
}

export type TabId = 'overview' | 'ranking' | 'topics' | 'effects' | 'significance' | 'export';
export type Role = 'baseline' | 'advanced';

export interface ViewState {
  tab: TabId;
  reproduction: number;
  focus: string;
  groups: Set<MeasureGroup>;
  rankingMetric: 'rbo' | 'ktu';
  depthRole: Role;
}

export interface AppState {
  mode: ExperimentMode;
  qrels: FileSlot<ParsedQrels>;
  replicationQrels: FileSlot<ParsedQrels>;
  original: { baseline: FileSlot<ParsedRun>; advanced: FileSlot<ParsedRun> };
  reproductions: ReproductionSlot[];
  settings: ExperimentSettings;
  alpha: number;
  naming: MeasureNaming;
  /** Measures compared side by side in charts (the first three in the ER/ΔRI plot). */
  comparison: string[];
  demo: boolean;
  busy: boolean;
  /** The setup is shown as a one-line summary (only once results exist). */
  setupCollapsed: boolean;
  result?: ExperimentResult | undefined;
  error?: string | undefined;
  view: ViewState;
}

let nextId = 1;

export function newReproduction(name: string): ReproductionSlot {
  return { id: nextId++, name, baseline: EMPTY, advanced: EMPTY };
}

export function initialState(): AppState {
  return {
    mode: 'rpd',
    qrels: EMPTY,
    replicationQrels: EMPTY,
    original: { baseline: EMPTY, advanced: EMPTY },
    reproductions: [newReproduction('Reproduction 1')],
    settings: { ...DEFAULT_SETTINGS },
    alpha: 0.05,
    naming: 'ir_measures',
    comparison: [...HEADLINE_MEASURES],
    demo: false,
    busy: false,
    setupCollapsed: false,
    view: {
      tab: 'overview',
      reproduction: 0,
      focus: 'AP',
      groups: new Set(MEASURE_GROUPS.map((g) => g.id)),
      rankingMetric: 'rbo',
      depthRole: 'baseline',
    },
  };
}

/** What is still missing before the experiment can be evaluated (empty when ready). */
export function missingInputs(state: AppState): string[] {
  const missing: string[] = [];
  if (state.qrels.status !== 'ready') missing.push(state.mode === 'rpd' ? 'qrels' : 'original qrels');
  if (state.mode === 'rpl' && state.replicationQrels.status !== 'ready') missing.push('replication qrels');
  if (state.original.baseline.status !== 'ready') missing.push('original baseline run');
  if (!state.reproductions.some((r) => r.baseline.status === 'ready')) {
    missing.push(state.mode === 'rpd' ? 'a reproduced baseline run' : 'a replicated baseline run');
  }
  return missing;
}

export function reproductionNoun(mode: ExperimentMode, plural = false): string {
  const noun = mode === 'rpd' ? 'reproduction' : 'replication';
  return plural ? `${noun}s` : noun;
}

export interface MeasureInfo {
  readonly name: string;
  readonly ideal: string;
  readonly text: string;
}

/** Short explanations, after Breuer et al. (SIGIR 2020). */
export const GUIDE: Readonly<Record<string, MeasureInfo>> = {
  ktu: {
    name: "Kendall's τ Union (KTU)",
    ideal: '1',
    text: 'Agreement of the document orderings of the original and the reproduced run, computed on the union of both rankings per topic. Reproducibility only.',
  },
  rbo: {
    name: 'Rank-biased overlap (RBO)',
    ideal: '1',
    text: 'Top-weighted overlap of the two rankings (persistence p). Unlike KTU it does not require the same documents to be retrieved. Reproducibility only.',
  },
  rmse: {
    name: 'Root mean square error (RMSE)',
    ideal: '0',
    text: 'How far the per-topic scores of the reproduction are from the original ones. nRMSE divides by the largest possible error. Reproducibility only.',
  },
  arp: {
    name: 'Average retrieval performance (ARP)',
    ideal: 'as original',
    text: 'The mean score over topics: does the reproduction reach the same effectiveness?',
  },
  er: {
    name: 'Effect ratio (ER)',
    ideal: '1',
    text: 'Mean per-topic improvement of the advanced over the baseline run in the reproduction, divided by the same improvement in the original experiment. Below 1: smaller effect; above 1: larger effect.',
  },
  dri: {
    name: 'Delta relative improvement (ΔRI)',
    ideal: '0',
    text: 'Relative improvement of the advanced over the baseline mean score in the original experiment minus that in the reproduction. Together with ER, it tells whether an improvement was reproduced.',
  },
  pvalue: {
    name: 't-test p-value',
    ideal: 'large',
    text: 'Two-tailed t-test between original and reproduced topic scores: paired for reproducibility (same topics), unpaired for replicability. A small p-value indicates a significant difference to the original.',
  },
};
