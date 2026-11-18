import type { ExperimentMode, ExperimentSettings } from '../core/experiment.ts';
import { GROUPED_ORDER, MEASURES, measureName } from '../core/measures.ts';
import type { MeasureNaming } from '../core/measures.ts';
import type { IprecRounding } from '../core/trec-eval.ts';
import type { ParsedQrels, ParsedRun } from '../core/trec-format.ts';
import { h, icon } from './dom.ts';
import { fileSize } from './files.ts';
import { fmtInt, plural } from './format.ts';
import { missingInputs, reproductionNoun } from './state.ts';
import type { AppState, FileSlot, Role } from './state.ts';

export type RunTarget = { readonly kind: 'original' } | { readonly kind: 'reproduction'; readonly id: number };

export interface SetupActions {
  setMode(mode: ExperimentMode): void;
  loadQrels(which: 'qrels' | 'replicationQrels', file: File): void;
  clearQrels(which: 'qrels' | 'replicationQrels'): void;
  loadRun(target: RunTarget, role: Role, file: File): void;
  clearRun(target: RunTarget, role: Role): void;
  addReproduction(): void;
  removeReproduction(id: number): void;
  renameReproduction(id: number, name: string): void;
  updateSettings(patch: Partial<ExperimentSettings>): void;
  setAlpha(alpha: number): void;
  setNaming(naming: MeasureNaming): void;
  setComparison(index: number, measure: string): void;
  loadDemo(): void;
  clearAll(): void;
  setCollapsed(collapsed: boolean): void;
}

interface SlotOptions<T> {
  readonly title: string;
  readonly optional?: boolean;
  readonly slot: FileSlot<T>;
  readonly describe: (data: T) => string;
  readonly warning?: (data: T) => string | undefined;
  readonly onFile: (file: File) => void;
  readonly onClear: () => void;
  readonly key: string;
}

function fileSlot<T>(o: SlotOptions<T>): HTMLElement {
  const { slot } = o;
  const input = h('input', { type: 'file', 'aria-label': `Choose the ${o.title.toLowerCase()} file`, 'data-key': o.key });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) o.onFile(file);
    input.value = '';
  });

  let detail: string;
  let title: string | undefined;
  const meta: HTMLElement[] = [];
  if (slot.status === 'loading') detail = `Reading ${slot.fileName ?? 'file'} …`;
  else if (slot.status === 'error') detail = `${slot.fileName ?? 'File'}: ${slot.error ?? 'could not be read'}`;
  else if (slot.status === 'ready' && slot.data !== undefined) {
    const warning = o.warning?.(slot.data);
    detail = slot.fileName ?? '';
    title = `${slot.fileName ?? ''} (${fileSize(slot.size ?? 0)})`;
    meta.push(h('span', { class: 'slot-meta' }, o.describe(slot.data)));
    if (warning) meta.push(h('span', { class: 'slot-meta warn' }, warning));
  } else detail = 'Drop a file here or click to browse';

  const filled = slot.status === 'ready';
  const actions = h('div', { class: 'slot-actions' });
  if (filled || slot.status === 'error') {
    const replace = h('button', { class: 'btn ghost small', type: 'button' }, 'Replace');
    replace.addEventListener('click', () => input.click());
    const remove = h('button', { class: 'btn ghost small icon', type: 'button', title: 'Remove', 'aria-label': `Remove the ${o.title.toLowerCase()} file` }, icon('x', 14));
    remove.addEventListener('click', o.onClear);
    actions.append(replace, remove);
  }

  const root = h(
    'div',
    { class: `slot${filled ? ' filled' : ''}${slot.status === 'error' ? ' error' : ''}` },
    h('div', { class: 'slot-icon' }, icon(filled ? 'check' : slot.status === 'error' ? 'alert' : 'file', 18)),
    h(
      'div',
      { class: 'slot-text' },
      h('span', { class: 'slot-title' }, o.title, o.optional ? h('span', { class: 'optional' }, 'optional') : null),
      h('span', { class: 'slot-detail', title }, detail),
      meta,
    ),
    actions,
    input,
  );
  root.addEventListener('dragover', (e) => {
    e.preventDefault();
    root.classList.add('dragover');
  });
  root.addEventListener('dragleave', () => root.classList.remove('dragover'));
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    root.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) o.onFile(file);
  });
  return root;
}

const describeRun = (r: ParsedRun): string =>
  `${plural(r.info.numTopics, 'topic')} · ${fmtInt(r.info.numDocs)} docs${r.info.tags.length === 1 ? ` · ${r.info.tags[0]}` : ''}`;

function runWarning(r: ParsedRun): string | undefined {
  const parts: string[] = [];
  if (r.info.duplicates > 0) parts.push(`${plural(r.info.duplicates, 'repeated document')} (last score kept)`);
  if (r.info.unsortedTopics > 0) parts.push(`${plural(r.info.unsortedTopics, 'topic')} not sorted by score`);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

const describeQrels = (q: ParsedQrels): string =>
  `${plural(q.info.numTopics, 'topic')} · ${fmtInt(q.info.numJudged)} judgements · ${fmtInt(q.info.numRelevant)} relevant`;

const qrelsWarning = (q: ParsedQrels): string | undefined => (q.info.duplicates > 0 ? `${plural(q.info.duplicates, 'repeated judgement')} (last kept)` : undefined);

function numberField(label: string, value: number, hint: string, onChange: (v: number) => void, attrs: Record<string, number | string> = {}): HTMLElement {
  const input = h('input', { type: 'number', value, ...attrs });
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) onChange(v);
  });
  return h('label', { class: 'field' }, h('span', null, label), input, h('small', null, hint));
}

function selectField<T extends string>(label: string, options: ReadonlyArray<{ value: T; label: string }>, value: T, hint: string, onChange: (v: T) => void, wide = false): HTMLElement {
  const el = h('select', null, options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  el.addEventListener('change', () => onChange(el.value as T));
  return h('label', { class: `field${wide ? ' wide' : ''}` }, h('span', null, label), el, h('small', null, hint));
}

export function renderSetup(state: AppState, actions: SetupActions, seriesColor: (i: number) => string): HTMLElement {
  const rpd = state.mode === 'rpd';
  const noun = reproductionNoun(state.mode);
  const Noun = noun[0]?.toUpperCase() + noun.slice(1);

  const modeButton = (mode: ExperimentMode, title: string, sub: string): HTMLElement => {
    const b = h('button', { type: 'button', 'aria-pressed': String(state.mode === mode) }, title, h('small', null, sub));
    b.addEventListener('click', () => actions.setMode(mode));
    return b;
  };

  const runSlot = (target: RunTarget, role: Role, slot: FileSlot<ParsedRun>, title: string, key: string): HTMLElement =>
    fileSlot({
      title,
      optional: role === 'advanced',
      slot,
      describe: describeRun,
      warning: runWarning,
      onFile: (f) => actions.loadRun(target, role, f),
      onClear: () => actions.clearRun(target, role),
      key,
    });

  // Charts color the evaluated reproductions in order; incomplete ones are skipped.
  const colorIndex = new Map(state.reproductions.filter((r) => r.baseline.status === 'ready').map((r, i) => [r.id, i]));
  const reproductions = state.reproductions.map((rep, i) => {
    const name = h('input', { type: 'text', value: rep.name, 'aria-label': `Name of ${noun} ${i + 1}`, 'data-key': `name-${rep.id}`, maxlength: 60 });
    name.addEventListener('input', () => actions.renameReproduction(rep.id, name.value));
    const remove = h('button', { class: 'btn ghost small', type: 'button', disabled: state.reproductions.length === 1 }, 'Remove');
    remove.addEventListener('click', () => actions.removeReproduction(rep.id));
    const index = colorIndex.get(rep.id);
    const swatch = index === undefined ? 'var(--neutral)' : seriesColor(index);
    return h(
      'div',
      { class: 'repro-card' },
      h('div', { class: 'repro-card-head' }, h('span', { class: 'swatch', style: `background:${swatch}` }), name, remove),
      h(
        'div',
        { class: 'slots' },
        runSlot({ kind: 'reproduction', id: rep.id }, 'baseline', rep.baseline, `${Noun}: baseline run`, `rep-${rep.id}-b`),
        runSlot({ kind: 'reproduction', id: rep.id }, 'advanced', rep.advanced, `${Noun}: advanced run`, `rep-${rep.id}-a`),
      ),
    );
  });
  const add = h('button', { class: 'btn small', type: 'button', disabled: state.reproductions.length >= 8 }, icon('plus', 14), `Add ${noun}`);
  add.addEventListener('click', actions.addReproduction);

  const { settings } = state;
  const measureOptions = GROUPED_ORDER.map((i) => {
    const m = MEASURES[i] as (typeof MEASURES)[number];
    return { value: m.id, label: measureName(m, state.naming) };
  });
  const rounding: ReadonlyArray<{ value: IprecRounding; label: string }> = [
    { value: 'v9', label: 'trec_eval 9 / pytrec_eval (x86-64)' },
    { value: 'v9-fma', label: 'trec_eval 9 / pytrec_eval (ARM)' },
    { value: 'v10', label: 'trec_eval 10' },
  ];

  const settingsPanel = h(
    'details',
    { class: 'settings' },
    h('summary', null, 'Settings'),
    h(
      'div',
      { class: 'settings-grid' },
      numberField('Run length', settings.runLength, 'Documents kept per topic (trim)', (v) => actions.updateSettings({ runLength: Math.round(v) }), { min: 1, step: 1 }),
      numberField('KTU depth', settings.ktuDepth, 'Documents compared by KTU', (v) => actions.updateSettings({ ktuDepth: Math.round(v) }), { min: 1, step: 1 }),
      numberField('RBO depth', settings.rboDepth, 'Evaluation depth of RBO', (v) => actions.updateSettings({ rboDepth: Math.round(v) }), { min: 1, step: 1 }),
      numberField('RBO persistence p', settings.rboP, 'Between 0 and 1; higher is deeper', (v) => actions.updateSettings({ rboP: v }), { min: 0.01, max: 0.99, step: 0.01 }),
      numberField('Relevance level', settings.relevanceLevel, 'Minimum label of a relevant document', (v) => actions.updateSettings({ relevanceLevel: Math.round(v) }), { min: 1, step: 1 }),
      numberField('Significance level α', state.alpha, 'Marks p-values below α', (v) => actions.setAlpha(v), { min: 0.0001, max: 0.5, step: 0.01 }),
      selectField(
        'Measure names',
        [
          { value: 'ir_measures', label: 'ir_measures (P@10, nDCG)' },
          { value: 'trec_eval', label: 'trec_eval (P_10, ndcg)' },
        ],
        state.naming,
        'As repro_eval prints them, or as trec_eval does',
        (v: MeasureNaming) => actions.setNaming(v),
      ),
      selectField(
        'Interpolated precision',
        rounding,
        settings.iprecRounding,
        'Only IPrec@0.3/0.7 can differ, and only for some topics',
        (v: IprecRounding) => actions.updateSettings({ iprecRounding: v }),
      ),
      ...[0, 1, 2].map((i) =>
        selectField(`Compared measure ${i + 1}`, measureOptions, (state.comparison[i] ?? 'AP') as string, i === 0 ? 'Shown in the ER/ΔRI plot and bar charts' : '', (v) => actions.setComparison(i, v)),
      ),
    ),
  );

  const missing = missingInputs(state);
  let status: HTMLElement;
  if (state.busy) status = h('span', { class: 'status busy' }, h('span', { class: 'dot' }), 'Evaluating …');
  else if (state.error) status = h('span', { class: 'status error' }, h('span', { class: 'dot' }), state.error);
  else if (missing.length > 0) status = h('span', { class: 'status' }, h('span', { class: 'dot' }), `Missing: ${missing.join(', ')}`);
  else status = h('span', { class: 'status ready' }, h('span', { class: 'dot' }), 'Evaluated');

  const demo = h('button', { class: 'btn', type: 'button' }, icon('sparkles', 14), 'Load example data');
  demo.addEventListener('click', actions.loadDemo);
  const clear = h('button', { class: 'btn ghost', type: 'button' }, 'Clear all');
  clear.addEventListener('click', actions.clearAll);
  const hide = state.result ? h('button', { class: 'btn ghost', type: 'button', 'data-key': 'setup-toggle' }, 'Hide inputs') : null;
  hide?.addEventListener('click', () => actions.setCollapsed(true));

  if (state.setupCollapsed && state.result) {
    const qrels = state.qrels.data?.info.numTopics;
    const ready = state.reproductions.filter((r) => r.baseline.status === 'ready');
    const runs = (adv: boolean): string => (adv ? 'baseline and advanced run' : 'baseline run');
    const edit = h('button', { class: 'btn', type: 'button', 'data-key': 'setup-toggle' }, 'Edit inputs');
    edit.addEventListener('click', () => actions.setCollapsed(false));
    return h(
      'section',
      { class: 'card setup-card collapsed', 'aria-label': 'Experiment setup' },
      h(
        'div',
        { class: 'setup-foot' },
        h(
          'div',
          { class: 'setup-summary' },
          h('strong', null, rpd ? 'Reproducibility' : 'Replicability'),
          h('span', null, `${qrels ?? 0} judged topics`),
          h('span', null, `original ${runs(state.original.advanced.status === 'ready')}`),
          h('span', { title: ready.map((r) => r.name).join(', ') }, `${ready.length} ${reproductionNoun(state.mode, ready.length !== 1)}: ${ready.map((r) => r.name).join(', ')}`),
        ),
        h('div', { class: 'card-actions' }, edit, demo, clear),
      ),
    );
  }

  return h(
    'section',
    { class: 'card setup-card', 'aria-label': 'Experiment setup' },
    h(
      'div',
      { class: 'card-body' },
      h(
        'div',
        { class: 'setup-grid' },
        h('div', { class: 'label' }, h('h3', null, 'Experiment'), h('p', null, 'What kind of repetition is evaluated?')),
        h(
          'div',
          { class: 'segmented big', role: 'group', 'aria-label': 'Experiment type' },
          modeButton('rpd', 'Reproducibility', 'Same test collection as the original'),
          modeButton('rpl', 'Replicability', 'Different test collection'),
        ),
        h('hr'),
        h('div', { class: 'label' }, h('h3', null, 'Relevance judgements'), h('p', null, rpd ? 'Qrels of the test collection' : 'Qrels of both test collections')),
        h(
          'div',
          { class: 'slots' },
          fileSlot({
            title: rpd ? 'Qrels' : 'Qrels of the original collection',
            slot: state.qrels,
            describe: describeQrels,
            warning: qrelsWarning,
            onFile: (f) => actions.loadQrels('qrels', f),
            onClear: () => actions.clearQrels('qrels'),
            key: 'qrels',
          }),
          rpd
            ? null
            : fileSlot({
                title: 'Qrels of the replication collection',
                slot: state.replicationQrels,
                describe: describeQrels,
                warning: qrelsWarning,
                onFile: (f) => actions.loadQrels('replicationQrels', f),
                onClear: () => actions.clearQrels('replicationQrels'),
                key: 'rqrels',
              }),
        ),
        h('hr'),
        h('div', { class: 'label' }, h('h3', null, 'Original experiment'), h('p', null, 'The baseline and the improved (advanced) run')),
        h(
          'div',
          { class: 'slots' },
          runSlot({ kind: 'original' }, 'baseline', state.original.baseline, 'Original baseline run', 'orig-b'),
          runSlot({ kind: 'original' }, 'advanced', state.original.advanced, 'Original advanced run', 'orig-a'),
        ),
        h('hr'),
        h(
          'div',
          { class: 'label' },
          h('h3', null, rpd ? 'Reproductions' : 'Replications'),
          h('p', null, 'One or more repetitions of the original experiment. ER and ΔRI need both runs.'),
        ),
        h('div', { class: 'repro-list' }, reproductions, h('div', null, add)),
      ),
    ),
    settingsPanel,
    h('div', { class: 'setup-foot' }, status, h('div', { class: 'card-actions' }, hide, demo, clear)),
  );
}
