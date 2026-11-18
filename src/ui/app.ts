import { runExperiment } from '../core/experiment.ts';
import type { ExperimentInput, ExperimentResult } from '../core/experiment.ts';
import { measureIndex } from '../core/measures.ts';
import { parseQrels, parseRun } from '../core/trec-format.ts';
import type { ParsedQrels, ParsedRun } from '../core/trec-format.ts';
import { chartTheme, hideTooltip } from './charts.ts';
import { disposeCharts } from './components.ts';
import { generateDemo } from './demo.ts';
import type { DemoRuns } from './demo.ts';
import { h, icon, replaceChildren } from './dom.ts';
import { readText } from './files.ts';
import { renderResults } from './results.ts';
import type { ResultActions } from './results.ts';
import { renderSetup } from './setup.ts';
import type { RunTarget, SetupActions } from './setup.ts';
import { EMPTY, initialState, missingInputs, newReproduction, reproductionNoun } from './state.ts';
import type { AppState, FileSlot, ReproductionSlot, Role, TabId } from './state.ts';

const THEME_KEY = 'repro-eval-web:theme';
type ThemeChoice = 'auto' | 'light' | 'dark';

function storedTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function applyTheme(choice: ThemeChoice): void {
  if (choice === 'auto') delete document.documentElement.dataset['theme'];
  else document.documentElement.dataset['theme'] = choice;
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // storage unavailable (private mode); the choice lasts for this page view
  }
}

/** Keep keyboard focus (and the caret) on an element that is re-created by a render. */
function preservingFocus(render: () => void): void {
  const active = document.activeElement as HTMLElement | null;
  const key = active?.getAttribute('data-key');
  const caret = active instanceof HTMLInputElement && active.type === 'text' ? [active.selectionStart, active.selectionEnd] : undefined;
  render();
  if (!key) return;
  const next = document.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
  if (!next) return;
  next.focus({ preventScroll: true });
  if (caret && next instanceof HTMLInputElement) next.setSelectionRange(caret[0] ?? null, caret[1] ?? null);
}

function masthead(onTheme: () => void, themeChoice: ThemeChoice): HTMLElement {
  const themeLabel: Record<ThemeChoice, string> = { auto: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' };
  const themeIcon: Record<ThemeChoice, string> = { auto: 'auto', light: 'sun', dark: 'moon' };
  const toggle = h('button', { class: 'btn ghost icon', type: 'button', title: themeLabel[themeChoice], 'aria-label': themeLabel[themeChoice], 'data-key': 'theme' }, icon(themeIcon[themeChoice], 18));
  toggle.addEventListener('click', onTheme);
  return h(
    'header',
    { class: 'masthead' },
    h(
      'div',
      { class: 'brand' },
      h('h1', null, 'repro_eval', h('span', { class: 'tag' }, 'web')),
      h('p', null, 'Quantify how well a system-oriented IR experiment was reproduced or replicated: compare TREC runs with the measures of repro_eval, from document orderings to effect sizes and significance tests.'),
      h('span', { class: 'privacy' }, icon('lock', 14), 'Runs are evaluated in this browser tab. Nothing is uploaded.'),
    ),
    h(
      'div',
      { class: 'masthead-actions' },
      h('a', { class: 'btn ghost', href: 'https://github.com/irgroup/repro_eval', target: '_blank', rel: 'noopener' }, icon('github', 16), 'repro_eval'),
      toggle,
    ),
  );
}

function footer(): HTMLElement {
  const paper = 'https://doi.org/10.1145/3397271.3401036';
  const demoPaper = 'https://doi.org/10.1007/978-3-030-72240-1_51';
  return h(
    'footer',
    { class: 'foot' },
    h(
      'p',
      null,
      'A TypeScript port of ',
      h('a', { href: 'https://github.com/irgroup/repro_eval', target: '_blank', rel: 'noopener' }, 'repro_eval'),
      ' and of the measures of ',
      h('a', { href: 'https://github.com/usnistgov/trec_eval', target: '_blank', rel: 'noopener' }, 'trec_eval'),
      ' (Chris Buckley; National Institute of Standards and Technology) that it uses, checked against the Python package, pytrec_eval and trec_eval. Measures: Breuer et al., ',
      h('a', { href: paper, target: '_blank', rel: 'noopener' }, 'SIGIR 2020'),
      '; tool: Breuer et al., ',
      h('a', { href: demoPaper, target: '_blank', rel: 'noopener' }, 'ECIR 2021'),
      '.',
    ),
    h('p', null, 'This page cannot make network requests (Content-Security-Policy).'),
  );
}

function introCard(): HTMLElement {
  return h(
    'section',
    { class: 'card empty intro' },
    h('h3', null, 'Add runs to see the results'),
    h(
      'p',
      { class: 'explain' },
      'Runs use the TREC format ',
      h('code', null, 'topic Q0 docid rank score tag'),
      ', qrels ',
      h('code', null, 'topic iteration docid relevance'),
      '. Gzip-compressed files work too. Or load the synthetic example data to explore the dashboard.',
    ),
  );
}

export function startApp(root: HTMLElement): void {
  const state: AppState = initialState();
  let themeChoice = storedTheme();
  applyTheme(themeChoice);

  const headerHost = h('div');
  const bannerHost = h('div');
  const setupHost = h('div');
  const resultsHost = h('div');
  root.replaceChildren(h('div', { class: 'app' }, headerHost, bannerHost, setupHost, resultsHost, footer()));

  // Dropping a file outside a slot must not navigate away from the page.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  const seriesColor = (i: number): string => chartTheme().series[i % 8] as string;

  const renderHeader = (): void => {
    replaceChildren(
      headerHost,
      masthead(() => {
        themeChoice = themeChoice === 'auto' ? 'light' : themeChoice === 'light' ? 'dark' : 'auto';
        applyTheme(themeChoice);
        preservingFocus(() => {
          renderHeader();
          renderSetupPanel();
          renderResultsPanel();
        });
      }, themeChoice),
    );
  };

  const renderBanner = (): void => {
    replaceChildren(
      bannerHost,
      state.demo
        ? h(
            'div',
            { class: 'banner' },
            icon('info', 16),
            h('span', null, h('strong', null, 'Synthetic example data. '), 'The runs and judgements were generated in your browser to demonstrate the dashboard; they do not come from a real experiment.'),
          )
        : null,
    );
  };

  const renderSetupPanel = (): void => {
    preservingFocus(() => replaceChildren(setupHost, renderSetup(state, setupActions, seriesColor)));
  };

  const inputLabels = (): Record<string, string> => {
    const label = (slot: FileSlot<unknown>): string => slot.fileName ?? '';
    const out: Record<string, string> = { qrels: label(state.qrels), original_baseline: label(state.original.baseline) };
    if (state.mode === 'rpl') out['replication_qrels'] = label(state.replicationQrels);
    if (state.original.advanced.status === 'ready') out['original_advanced'] = label(state.original.advanced);
    state.reproductions.forEach((r) => {
      out[`${r.name} baseline`] = label(r.baseline);
      if (r.advanced.status === 'ready') out[`${r.name} advanced`] = label(r.advanced);
    });
    return out;
  };

  const renderResultsPanel = (): void => {
    disposeCharts();
    hideTooltip();
    preservingFocus(() => {
      replaceChildren(resultsHost, state.result ? renderResults(state, state.result, chartTheme(), resultActions, inputLabels()) : introCard());
    });
  };

  // ------------------------------------------------------------------ evaluation

  let timer: ReturnType<typeof setTimeout> | undefined;
  const evaluateSoon = (delay = 150): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(evaluate, delay);
  };

  function evaluate(): void {
    timer = undefined;
    if (missingInputs(state).length > 0) {
      state.result = undefined;
      state.error = undefined;
      renderSetupPanel();
      renderResultsPanel();
      return;
    }
    state.busy = true;
    renderSetupPanel();
    // Let the browser paint the busy state before the synchronous computation.
    setTimeout(() => {
      try {
        const run = (slot: FileSlot<ParsedRun>) => (slot.status === 'ready' ? slot.data?.run : undefined);
        const input: ExperimentInput = {
          mode: state.mode,
          qrels: (state.qrels.data as ParsedQrels).qrels,
          replicationQrels: state.replicationQrels.data?.qrels,
          original: { baseline: run(state.original.baseline) as NonNullable<ReturnType<typeof run>>, advanced: run(state.original.advanced) },
          reproductions: state.reproductions
            .filter((r) => r.baseline.status === 'ready')
            .map((r, i) => ({
              name: r.name.trim() || `${reproductionNoun(state.mode)} ${i + 1}`,
              runs: { baseline: run(r.baseline) as NonNullable<ReturnType<typeof run>>, advanced: run(r.advanced) },
            })),
          settings: state.settings,
        };
        const result: ExperimentResult = runExperiment(input);
        state.result = result;
        state.error = undefined;
        state.view.reproduction = Math.min(state.view.reproduction, result.reproductions.length - 1);
      } catch (error) {
        state.result = undefined;
        state.error = error instanceof Error ? error.message : String(error);
      }
      state.busy = false;
      renderSetupPanel();
      renderResultsPanel();
    }, 30);
  }

  // ------------------------------------------------------------------ inputs

  const findRun = (target: RunTarget): { baseline: FileSlot<ParsedRun>; advanced: FileSlot<ParsedRun> } | undefined =>
    target.kind === 'original' ? state.original : state.reproductions.find((r) => r.id === target.id);

  async function load<T>(file: File, parse: (text: string) => T, assign: (slot: FileSlot<T>) => boolean): Promise<void> {
    if (!assign({ status: 'loading', fileName: file.name, size: file.size })) return;
    renderSetupPanel();
    let slot: FileSlot<T>;
    try {
      const text = await readText(file);
      slot = { status: 'ready', fileName: file.name, size: file.size, data: parse(text) };
    } catch (error) {
      slot = { status: 'error', fileName: file.name, size: file.size, error: error instanceof Error ? error.message : String(error) };
    }
    if (assign(slot)) {
      state.demo = false;
      renderBanner();
      renderSetupPanel();
      evaluateSoon();
    }
  }

  const setupActions: SetupActions = {
    setMode(mode) {
      if (state.mode === mode) return;
      state.mode = mode;
      state.reproductions.forEach((r, i) => {
        if (/^(Reproduction|Replication) \d+$/.test(r.name)) r.name = `${mode === 'rpd' ? 'Reproduction' : 'Replication'} ${i + 1}`;
      });
      renderSetupPanel();
      evaluateSoon(0);
    },
    loadQrels(which, file) {
      void load(file, parseQrels, (slot) => {
        state[which] = slot;
        return true;
      });
    },
    clearQrels(which) {
      state[which] = EMPTY;
      renderSetupPanel();
      evaluateSoon(0);
    },
    loadRun(target, role, file) {
      void load(file, parseRun, (slot) => {
        const runs = findRun(target);
        if (!runs) return false;
        runs[role] = slot;
        return true;
      });
    },
    clearRun(target, role) {
      const runs = findRun(target);
      if (runs) runs[role] = EMPTY;
      renderSetupPanel();
      evaluateSoon(0);
    },
    addReproduction() {
      state.reproductions.push(newReproduction(`${state.mode === 'rpd' ? 'Reproduction' : 'Replication'} ${state.reproductions.length + 1}`));
      renderSetupPanel();
    },
    removeReproduction(id) {
      state.reproductions = state.reproductions.filter((r) => r.id !== id);
      renderSetupPanel();
      evaluateSoon(0);
    },
    renameReproduction(id, name) {
      const rep = state.reproductions.find((r) => r.id === id);
      if (!rep) return;
      rep.name = name;
      evaluateSoon(400);
    },
    updateSettings(patch) {
      state.settings = { ...state.settings, ...patch };
      renderSetupPanel();
      evaluateSoon(0);
    },
    setAlpha(alpha) {
      if (alpha > 0 && alpha < 1) state.alpha = alpha;
      renderSetupPanel();
      renderResultsPanel();
    },
    setNaming(naming) {
      state.naming = naming;
      renderSetupPanel();
      renderResultsPanel();
    },
    setComparison(index, measure) {
      measureIndex(measure);
      state.comparison[index] = measure;
      renderSetupPanel();
      renderResultsPanel();
    },
    loadDemo() {
      state.busy = true;
      renderSetupPanel();
      setTimeout(() => {
        const data = generateDemo();
        const file = (name: string, text: string): { fileName: string; size: number } => ({ fileName: name, size: text.length });
        const runSlot = (name: string, text: string): FileSlot<ParsedRun> => ({ status: 'ready', ...file(name, text), data: parseRun(text) });
        const qrelsSlot = (name: string, text: string): FileSlot<ParsedQrels> => ({ status: 'ready', ...file(name, text), data: parseQrels(text) });
        const pair = (runs: DemoRuns, prefix: string): ReproductionSlot => ({
          ...newReproduction(runs.name),
          baseline: runSlot(`${prefix}-baseline.txt`, runs.baseline),
          advanced: runSlot(`${prefix}-advanced.txt`, runs.advanced),
        });
        state.qrels = qrelsSlot('example-qrels.txt', data.qrels);
        state.replicationQrels = qrelsSlot('example-qrels-replication.txt', data.replicationQrels);
        state.original = { baseline: runSlot('example-original-baseline.txt', data.original.baseline), advanced: runSlot('example-original-advanced.txt', data.original.advanced) };
        state.reproductions = (state.mode === 'rpd' ? data.reproductions : data.replications).map((runs, i) => pair(runs, `example-${state.mode}${i + 1}`));
        state.demo = true;
        state.busy = false;
        state.setupCollapsed = true;
        renderBanner();
        evaluate();
      }, 30);
    },
    setCollapsed(collapsed) {
      state.setupCollapsed = collapsed;
      renderSetupPanel();
    },
    clearAll() {
      const fresh = initialState();
      Object.assign(state, { ...fresh, settings: state.settings, naming: state.naming, alpha: state.alpha, mode: state.mode, comparison: state.comparison });
      if (state.mode === 'rpl') state.reproductions = [newReproduction('Replication 1')];
      renderBanner();
      renderSetupPanel();
      renderResultsPanel();
    },
  };

  const resultActions: ResultActions = {
    setTab(tab) {
      state.view.tab = tab;
      renderResultsPanel();
    },
    setReproduction(index) {
      state.view.reproduction = index;
      renderResultsPanel();
    },
    setFocus(measure) {
      state.view.focus = measure;
      renderResultsPanel();
    },
    toggleGroup(group) {
      const groups = state.view.groups;
      if (groups.has(group) && groups.size > 1) groups.delete(group);
      else groups.add(group);
      renderResultsPanel();
    },
    setRankingMetric(metric) {
      state.view.rankingMetric = metric;
      renderResultsPanel();
    },
    setRole(role: Role) {
      state.view.depthRole = role;
      renderResultsPanel();
    },
  };

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (themeChoice === 'auto') renderResultsPanel();
  });

  renderHeader();
  renderBanner();
  renderSetupPanel();
  renderResultsPanel();

  // Deep links to the example data: #example, #example-rpl, optionally followed by /<tab>.
  const [command, tab] = location.hash.replace(/^#/, '').split('/');
  if (command === 'example' || command === 'example-rpl') {
    if (command === 'example-rpl') state.mode = 'rpl';
    const tabs: readonly TabId[] = ['overview', 'ranking', 'topics', 'effects', 'significance', 'export'];
    if (tabs.includes(tab as TabId)) state.view.tab = tab as TabId;
    setupActions.loadDemo();
  }
}
