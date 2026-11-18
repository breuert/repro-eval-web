import type { ExperimentResult, Pair, ReproductionResult } from '../core/experiment.ts';
import { CUTOFFS, GROUPED_ORDER, MEASURE_GROUPS, MEASURES, measureIndex, measureName } from '../core/measures.ts';
import type { MeasureDef, MeasureGroup } from '../core/measures.ts';
import { cliReport, scoresCsv, summaryCsv, toJson } from '../core/report.ts';
import { ktu, rbo } from '../core/repro-measures.ts';
import type { PerTopicResult } from '../core/repro-measures.ts';
import { compareNatural } from '../core/compare.ts';
import type { TTestResult } from '../core/stats.ts';
import { rowsByTopic } from '../core/trec-eval.ts';
import type { Run } from '../core/trec-format.ts';
import { columnChart, dotKey, lineChart, lineKey, rectKey, scatterChart } from './charts.ts';
import type { ChartTheme, LegendItem, Series, Shape } from './charts.ts';
import { card, chartCard, chips, dataTable, emptyState, segmented, select, tiles } from './components.ts';
import type { CellValue, TableData } from './components.ts';
import { copyText, download, h, icon } from './dom.ts';
import type { Child } from './dom.ts';
import { fmt, fmtP, plural, slug } from './format.ts';
import { GUIDE, reproductionNoun } from './state.ts';
import type { AppState, Role, TabId } from './state.ts';

export interface ResultActions {
  setTab(tab: TabId): void;
  setReproduction(index: number): void;
  setFocus(measure: string): void;
  toggleGroup(group: MeasureGroup): void;
  setRankingMetric(metric: 'rbo' | 'ktu'): void;
  setRole(role: Role): void;
}

const ROLES: readonly Role[] = ['baseline', 'advanced'];
const ROLE_LABEL: Record<Role, string> = { baseline: 'Baseline', advanced: 'Advanced' };
const SHAPES: readonly Shape[] = ['circle', 'triangle', 'square'];

interface Context {
  readonly state: AppState;
  readonly result: ExperimentResult;
  readonly theme: ChartTheme;
  readonly actions: ResultActions;
  readonly rep: ReproductionResult;
  readonly repIndex: number;
  readonly focus: number;
  readonly name: (i: number) => string;
  readonly color: (i: number) => string;
  readonly noun: string;
}

const roles = <T>(pair: Pair<T> | undefined): Role[] => ROLES.filter((r) => pair?.[r] !== undefined);

function measureRows(ctx: Context): number[] {
  return GROUPED_ORDER.filter((i) => ctx.state.view.groups.has((MEASURES[i] as MeasureDef).group));
}

function groupChips(ctx: Context): HTMLElement {
  return chips(
    MEASURE_GROUPS.map((g) => ({ value: g.id, label: g.label })),
    ctx.state.view.groups,
    ctx.actions.toggleGroup,
    'Measure groups shown in the table',
  );
}

function sections(rows: readonly number[]): Map<number, string> {
  const map = new Map<number, string>();
  let last: MeasureGroup | undefined;
  rows.forEach((m, i) => {
    const group = (MEASURES[m] as MeasureDef).group;
    if (group !== last) map.set(i, MEASURE_GROUPS.find((g) => g.id === group)?.label ?? group);
    last = group;
  });
  return map;
}

const num = (x: number | undefined, title?: string): CellValue => ({
  text: fmt(x),
  className: x === undefined || Number.isNaN(x) ? 'na' : '',
  ...(title ? { title } : {}),
});

function pCell(t: TTestResult | undefined, alpha: number): CellValue {
  if (t === undefined) return { text: '–', className: 'na' };
  const title = `t = ${fmt(t.statistic)}, df = ${t.df}, p = ${Number.isNaN(t.pvalue) ? 'n/a' : t.pvalue.toPrecision(6)}`;
  if (t.pvalue < alpha) {
    return { text: fmtP(t.pvalue), title: `${title} (significant at α = ${alpha})`, node: h('span', { class: 'sig' }, icon('alert', 13), fmtP(t.pvalue)) };
  }
  return { text: fmtP(t.pvalue), title, className: Number.isNaN(t.pvalue) ? 'na' : '' };
}

function needsAdvanced(ctx: Context, what: string): HTMLElement {
  return emptyState(`${what} needs advanced runs`, `Add the advanced run of the original experiment and of the ${ctx.noun} to compare the improvements.`);
}

// ---------------------------------------------------------------------------- overview

function overview(ctx: Context): Child[] {
  const { result, state } = ctx;
  const rpd = result.mode === 'rpd';
  const f = ctx.focus;
  const fname = ctx.name(f);
  const ideal = (key: keyof typeof GUIDE): string => `ideal ${GUIDE[key]?.ideal ?? ''}`;

  const header = ['', ...(rpd ? ['KTU B', 'KTU A', 'RBO B', 'RBO A', `RMSE ${fname} B`, `RMSE ${fname} A`] : []), `ER ${fname}`, `ΔRI ${fname}`, `p ${fname} B`, `p ${fname} A`];
  const idealRow = ['', ...(rpd ? [ideal('ktu'), ideal('ktu'), ideal('rbo'), ideal('rbo'), ideal('rmse'), ideal('rmse')] : []), ideal('er'), ideal('dri'), ideal('pvalue'), ideal('pvalue')];
  const rows = result.reproductions.map((rep) => [
    { text: rep.name, node: h('span', { style: 'display:inline-flex;align-items:center;gap:6px' }, rectKey(ctx.color(result.reproductions.indexOf(rep))), rep.name) },
    ...(rpd
      ? [num(rep.ktu?.baseline.mean), num(rep.ktu?.advanced?.mean), num(rep.rbo?.baseline.mean), num(rep.rbo?.advanced?.mean), num(rep.rmse?.baseline[f]), num(rep.rmse?.advanced?.[f])]
      : []),
    num(rep.er?.[f]),
    num(rep.dri?.[f]),
    pCell(rep.ttest.baseline[f], state.alpha),
    pCell(rep.ttest.advanced?.[f], state.alpha),
  ]);

  const out: Child[] = [
    card(
      'Summary',
      [`One row per ${ctx.noun}. Per-measure values refer to ${fname}; change it with the measure selector above. B = baseline, A = advanced. `, rpd ? 'KTU and RBO are means over topics.' : 'Replicability compares effects only, because the topics differ.'],
      dataTable({ header, ideal: idealRow, rows }, { caption: 'Summary of reproducibility measures' }),
    ),
  ];

  const withEffects = result.reproductions.map((rep, i) => ({ rep, i })).filter(({ rep }) => rep.er && rep.dri);
  if (withEffects.length > 0) {
    const measures = state.comparison.slice(0, 3).map((id) => measureIndex(id));
    const series: Series[] = withEffects.map(({ rep, i }) => ({ key: String(i), label: rep.name, color: ctx.color(i) }));
    const points = withEffects.flatMap(({ rep, i }) =>
      measures.map((m, k) => ({
        x: rep.er?.[m] as number,
        y: rep.dri?.[m] as number,
        series: String(i),
        shape: SHAPES[k] as Shape,
        title: `${rep.name} · ${ctx.name(m)}`,
      })),
    );
    const legendItems: LegendItem[] = [
      ...series.map((s) => ({ label: s.label, key: dotKey(s.color) })),
      ...measures.map((m, k) => ({ label: ctx.name(m), key: dotKey(ctx.theme.ink2, SHAPES[k]) })),
    ];
    out.push(
      chartCard({
        title: 'Effect ratio vs. ΔRI',
        description: `Each point is a measure of a ${ctx.noun}; color identifies the ${ctx.noun}, shape the measure. If the improvement was reproduced perfectly, the point lies at ER = 1, ΔRI = 0. Left of ER = 1 the effect is smaller than in the original, right of it larger; ΔRI > 0 means a smaller relative improvement.`,
        legend: legendItems,
        fileName: 'er-vs-dri',
        draw: (width, theme) =>
          scatterChart(
            {
              label: 'Effect ratio versus delta relative improvement',
              series,
              panels: [{ points }],
              xTitle: 'Effect ratio (ER)',
              yTitle: 'ΔRI',
              refX: 1,
              refY: 0,
              target: { x: 1, y: 0, label: 'ideal' },
              xClip: [-2, 4],
              yClip: [-2, 2],
              format: (v) => fmt(v),
              height: 300,
            },
            width,
            theme,
          ),
        table: () => ({
          header: [ctx.noun, 'Measure', 'ER', 'ΔRI'],
          rows: points.map((p) => [p.title.split(' · ')[0] ?? '', p.title.split(' · ')[1] ?? '', fmt(p.x), fmt(p.y)]),
        }),
      }),
    );
  }

  out.push(
    card(
      'How to read the measures',
      'repro_eval quantifies reproducibility at increasing levels of abstraction (Breuer et al., SIGIR 2020).',
      h(
        'dl',
        { class: 'measure-guide' },
        Object.values(GUIDE).map((g) => h('div', null, h('dt', null, g.name, h('span', null, `ideal: ${g.ideal}`)), h('dd', null, g.text))),
      ),
    ),
  );
  return out;
}

// ---------------------------------------------------------------------------- ranked lists

const depthCache = new WeakMap<ExperimentResult, Map<string, Array<{ depth: number; ktu: number; rbo: number }>>>();

function depthCurve(result: ExperimentResult, rep: number, role: Role): Array<{ depth: number; ktu: number; rbo: number }> | undefined {
  const origRun: Run | undefined = result.original.runs[role];
  const repRun: Run | undefined = result.reproductions[rep]?.runs[role];
  if (!origRun || !repRun) return undefined;
  let cache = depthCache.get(result);
  if (!cache) {
    cache = new Map();
    depthCache.set(result, cache);
  }
  const key = `${rep}/${role}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const maxDepth = Math.max(...[...origRun.values(), ...repRun.values()].map((r) => r.length), 1);
  const depths = [5, 10, 20, 50, 100, 200, 500, 1000].filter((d) => d <= Math.max(5, maxDepth));
  const curve = depths.map((depth) => ({ depth, ktu: ktu(origRun, repRun, depth).mean, rbo: rbo(origRun, repRun, result.settings.rboP, depth).mean }));
  cache.set(key, curve);
  return curve;
}

function rankedLists(ctx: Context): Child[] {
  const { rep, result, state } = ctx;
  if (!rep.ktu || !rep.rbo) return [emptyState('Not available for replicability', 'KTU and RBO compare rankings of the same topics, so they only apply to reproducibility.')];
  const ktuR = rep.ktu;
  const rboR = rep.rbo;
  const topicsCompared = ktuR.baseline.perTopic.size;
  const tileItems = roles(ktuR).flatMap((role) => [
    { label: `KTU · ${ROLE_LABEL[role].toLowerCase()}`, value: fmt(ktuR[role]?.mean), hint: 'mean over topics, ideal 1' },
    { label: `RBO · ${ROLE_LABEL[role].toLowerCase()}`, value: fmt(rboR[role]?.mean), hint: `p = ${result.settings.rboP}, depth ${result.settings.rboDepth}` },
  ]);

  const metric = state.view.rankingMetric;
  const perTopic: Pair<PerTopicResult> = metric === 'ktu' ? ktuR : rboR;
  const panelRoles = roles(perTopic);
  const topics = [...perTopic.baseline.perTopic.keys()].sort(compareNatural);
  const metricLabel = metric === 'ktu' ? 'KTU' : 'RBO';
  const perTopicCard = chartCard({
    title: `${metricLabel} per topic`,
    description: metric === 'ktu' ? 'Kendall’s τ between the original and the reproduced ordering of the top documents of every topic (−1 to 1).' : 'Rank-biased overlap of the original and the reproduced ranking of every topic (0 to 1).',
    controls: segmented(
      [
        { value: 'rbo', label: 'RBO' },
        { value: 'ktu', label: 'KTU' },
      ],
      metric,
      ctx.actions.setRankingMetric,
      'Measure',
    ),
    fileName: `${metric}-per-topic-${slug(rep.name)}`,
    draw: (width, theme) =>
      columnChart(
        {
          label: `${metricLabel} per topic`,
          series: [{ key: 'v', label: metricLabel, color: ctx.color(ctx.repIndex) }],
          panels: panelRoles.map((role) => ({
            title: ROLE_LABEL[role],
            groups: topics.map((t) => ({ key: t, label: t })),
            value: (t) => perTopic[role]?.perTopic.get(t),
          })),
          yTitle: metricLabel,
          yDomain: metric === 'ktu' ? [-1, 1] : [0, 1],
          format: (v) => fmt(v),
          groupTitle: 'Topic',
          height: 200,
          minPanelWidth: 380,
        },
        width,
        theme,
      ),
    table: () => ({
      header: ['Topic', ...panelRoles.map((r) => `${metricLabel} ${ROLE_LABEL[r].toLowerCase()}`)],
      rows: topics.map((t) => [t, ...panelRoles.map((r) => fmt(perTopic[r]?.perTopic.get(t)))]),
    }),
  });

  const role = state.view.depthRole;
  const reps = result.reproductions.map((r, i) => ({ r, i })).filter(({ r }) => r.ktu !== undefined && r.runs[role] !== undefined);
  const curves = reps.map(({ i }) => depthCurve(result, i, role));
  const depths = curves.find((c) => c)?.map((p) => p.depth) ?? [];
  const depthCard = chartCard({
    title: 'Agreement by ranking depth',
    description: 'Mean KTU over the top-k documents and RBO with depth k, for every reproduction. Agreement at the top of the ranking matters most to users.',
    controls: result.original.runs.advanced
      ? segmented(
          ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })),
          role,
          ctx.actions.setRole,
          'Runs',
        )
      : null,
    legend: reps.length > 1 ? reps.map(({ r, i }) => ({ label: r.name, key: lineKey(ctx.color(i)) })) : [],
    fileName: `agreement-by-depth-${role}`,
    draw: (width, theme) =>
      lineChart(
        {
          label: 'KTU and RBO by ranking depth',
          x: depths.map((d) => ({ key: String(d), label: String(d) })),
          xTitle: 'Depth',
          series: reps.map(({ r, i }) => ({ key: String(i), label: r.name, color: ctx.color(i) })),
          panels: (['ktu', 'rbo'] as const).map((m) => ({
            title: m === 'ktu' ? 'KTU' : 'RBO',
            value: (key, xi) => curves[reps.findIndex(({ i }) => String(i) === key)]?.[xi]?.[m],
          })),
          format: (v) => fmt(v),
          height: 200,
        },
        width,
        theme,
      ),
    table: () => ({
      header: ['Depth', ...reps.flatMap(({ r }) => [`KTU ${r.name}`, `RBO ${r.name}`])],
      rows: depths.map((d, xi) => [String(d), ...curves.flatMap((c) => [fmt(c?.[xi]?.ktu), fmt(c?.[xi]?.rbo)])]),
    }),
  });

  return [tiles([...tileItems, { label: 'Topics compared', value: String(topicsCompared), hint: `of the ${ctx.noun}` }]), perTopicCard, depthCard];
}

// ---------------------------------------------------------------------------- topic scores

function topicScores(ctx: Context): Child[] {
  const { rep, result, state } = ctx;
  if (!rep.rmse || !rep.nrmse) return [emptyState('Not available for replicability', 'Per-topic errors compare scores of the same topics, so they only apply to reproducibility.')];
  const f = ctx.focus;
  const fname = ctx.name(f);
  const rmseR = rep.rmse;
  const nrmseR = rep.nrmse;
  const panelRoles = roles(rmseR);

  const tileItems = panelRoles.flatMap((role) => [
    { label: `RMSE ${fname} · ${role}`, value: fmt(rmseR[role]?.[f]), hint: 'ideal 0' },
    { label: `nRMSE ${fname} · ${role}`, value: fmt(nrmseR[role]?.[f]), hint: 'normalized, ideal 0' },
  ]);

  const pairs = panelRoles.map((role) => {
    const orig = result.original.scores[role];
    const reproduced = rep.scores[role];
    if (!orig || !reproduced) return { role, points: [] };
    const repRows = rowsByTopic(reproduced);
    const points = orig.topics.flatMap((topic, t) => {
      const r = repRows.get(topic);
      return r ? [{ x: (orig.values[t] as Float64Array)[f] as number, y: r[f] as number, series: 'p', title: `Topic ${topic}`, topic }] : [];
    });
    return { role, points };
  });
  const scatterCard = chartCard({
    title: `Per-topic ${fname}: original vs. ${ctx.noun}`,
    description: `Every point is a topic. On the diagonal the ${ctx.noun} scores exactly like the original; RMSE summarizes the distance to it.`,
    fileName: `per-topic-${slug(fname)}-${slug(rep.name)}`,
    draw: (width, theme) =>
      scatterChart(
        {
          label: `Per-topic ${fname}`,
          series: [{ key: 'p', label: rep.name, color: ctx.color(ctx.repIndex) }],
          panels: pairs.map((p) => ({ title: ROLE_LABEL[p.role], points: p.points })),
          xTitle: `Original ${fname}`,
          yTitle: `${rep.name} ${fname}`,
          diagonal: true,
          format: (v) => fmt(v),
          height: 260,
          minPanelWidth: 300,
        },
        width,
        theme,
      ),
    table: () => {
      const topics = pairs[0]?.points.map((p) => p.topic) ?? [];
      return {
        header: ['Topic', ...pairs.flatMap((p) => [`Original ${p.role}`, `${rep.name} ${p.role}`])],
        rows: topics.map((topic, k) => [topic, ...pairs.flatMap((p) => [fmt(p.points[k]?.x), fmt(p.points[k]?.y)])]),
      };
    },
  });

  const role = state.view.depthRole;
  const reps = result.reproductions.map((r, i) => ({ r, i })).filter(({ r }) => r.rmse?.[role] !== undefined);
  const families = [
    { title: 'nDCG@k', prefix: 'nDCG@' },
    { title: 'AP@k', prefix: 'AP@' },
    { title: 'P@k', prefix: 'P@' },
    { title: 'R@k', prefix: 'R@' },
  ];
  const cutoffCard = chartCard({
    title: 'RMSE by cutoff',
    description: 'Error of the per-topic scores at increasing rank cutoffs, for every reproduction.',
    controls: result.original.scores.advanced
      ? segmented(
          ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })),
          role,
          ctx.actions.setRole,
          'Runs',
        )
      : null,
    legend: reps.length > 1 ? reps.map(({ r, i }) => ({ label: r.name, key: lineKey(ctx.color(i)) })) : [],
    fileName: `rmse-by-cutoff-${role}`,
    draw: (width, theme) =>
      lineChart(
        {
          label: 'RMSE by cutoff',
          x: CUTOFFS.map((k) => ({ key: String(k), label: String(k) })),
          xTitle: 'Cutoff',
          series: reps.map(({ r, i }) => ({ key: String(i), label: r.name, color: ctx.color(i) })),
          panels: families.map((fam) => ({
            title: fam.title,
            value: (key, xi) => result.reproductions[Number(key)]?.rmse?.[role]?.[measureIndex(`${fam.prefix}${CUTOFFS[xi]}`)],
          })),
          format: (v) => fmt(v),
          height: 170,
          minPanelWidth: 250,
        },
        width,
        theme,
      ),
    table: () => ({
      header: ['Cutoff', ...families.flatMap((fam) => reps.map(({ r }) => `${fam.prefix}k ${r.name}`))],
      rows: CUTOFFS.map((k) => [String(k), ...families.flatMap((fam) => reps.map(({ r }) => fmt(r.rmse?.[role]?.[measureIndex(`${fam.prefix}${k}`)])))]),
    }),
  });

  const rows = measureRows(ctx);
  const table: TableData = {
    header: ['Measure', ...panelRoles.flatMap((r) => [`RMSE ${r}`, `nRMSE ${r}`])],
    rows: rows.map((m) => [ctx.name(m), ...panelRoles.flatMap((r) => [num(rmseR[r]?.[m]), num(nrmseR[r]?.[m])])]),
    sections: sections(rows),
  };
  return [
    tiles(tileItems),
    scatterCard,
    cutoffCard,
    card('RMSE per measure', `Root mean square error of the per-topic scores of ${rep.name}, raw and normalized.`, [h('div', { class: 'table-tools' }, groupChips(ctx)), dataTable(table, { tall: true })]),
  ];
}

// ---------------------------------------------------------------------------- effects

function effects(ctx: Context): Child[] {
  const { rep, result, state } = ctx;
  const measures = state.comparison.map((id) => measureIndex(id));
  const panelRoles = ROLES.filter((r) => result.original.arp[r] !== undefined);
  const seriesAll: Series[] = [
    { key: 'orig', label: 'Original', color: ctx.theme.neutral },
    ...result.reproductions.map((r, i) => ({ key: String(i), label: r.name, color: ctx.color(i) })),
  ];
  const arpValue = (role: Role, key: string, m: number): number | undefined =>
    key === 'orig' ? result.original.arp[role]?.[m] : result.reproductions[Number(key)]?.arp[role]?.[m];

  const out: Child[] = [
    chartCard({
      title: 'Average retrieval performance',
      description: `Mean scores over topics of the original runs (gray) and of every ${ctx.noun}.`,
      legend: seriesAll.map((s) => ({ label: s.label, key: rectKey(s.color) })),
      fileName: 'arp',
      draw: (width, theme) =>
        columnChart(
          {
            label: 'Average retrieval performance',
            series: seriesAll.map((s, i) => ({ ...s, color: i === 0 ? theme.neutral : ctx.color(i - 1) })),
            panels: panelRoles.map((role) => ({
              title: ROLE_LABEL[role],
              groups: measures.map((m) => ({ key: String(m), label: ctx.name(m) })),
              value: (g, key) => arpValue(role, key, Number(g)),
            })),
            yTitle: 'Score',
            format: (v) => fmt(v),
            height: 220,
          },
          width,
          theme,
        ),
      table: () => ({
        header: ['Measure', ...panelRoles.flatMap((role) => seriesAll.map((s) => `${s.label} ${role}`))],
        rows: measures.map((m) => [ctx.name(m), ...panelRoles.flatMap((role) => seriesAll.map((s) => fmt(arpValue(role, s.key, m))))]),
      }),
    }),
  ];

  const withEr = result.reproductions.map((r, i) => ({ r, i })).filter(({ r }) => r.er !== undefined);
  if (withEr.length > 0) {
    out.push(
      chartCard({
        title: 'Effect ratio',
        description: `Improvement of the advanced over the baseline run, relative to the original experiment (1 = the same effect).`,
        legend: withEr.length > 1 ? withEr.map(({ r, i }) => ({ label: r.name, key: rectKey(ctx.color(i)) })) : [],
        fileName: 'effect-ratio',
        draw: (width, theme) =>
          columnChart(
            {
              label: 'Effect ratio',
              series: withEr.map(({ r, i }) => ({ key: String(i), label: r.name, color: ctx.color(i) })),
              panels: [{ groups: measures.map((m) => ({ key: String(m), label: ctx.name(m) })), value: (g, key) => result.reproductions[Number(key)]?.er?.[Number(g)] }],
              yTitle: 'ER',
              references: [{ value: 1, label: 'original effect' }],
              yClip: [-2, 4],
              format: (v) => fmt(v),
              height: 220,
            },
            width,
            theme,
          ),
        table: () => ({
          header: ['Measure', ...withEr.map(({ r }) => `ER ${r.name}`)],
          rows: measures.map((m) => [ctx.name(m), ...withEr.map(({ r }) => fmt(r.er?.[m]))]),
        }),
      }),
    );
  } else {
    out.push(needsAdvanced(ctx, 'The effect ratio'));
  }

  const rows = measureRows(ctx);
  const origA = result.original.arp.advanced;
  const repA = rep.arp.advanced;
  const table: TableData = {
    header: ['Measure', 'Original B', 'Original A', `${rep.name} B`, `${rep.name} A`, 'ER', 'ΔRI'],
    ideal: ['', '', '', '', '', `ideal ${GUIDE['er']?.ideal}`, `ideal ${GUIDE['dri']?.ideal}`],
    rows: rows.map((m) => [ctx.name(m), num(result.original.arp.baseline[m]), num(origA?.[m]), num(rep.arp.baseline[m]), num(repA?.[m]), num(rep.er?.[m]), num(rep.dri?.[m])]),
    sections: sections(rows),
  };
  out.push(card('Effects per measure', `ARP of the original runs and of ${rep.name}, effect ratio and delta relative improvement.`, [h('div', { class: 'table-tools' }, groupChips(ctx)), dataTable(table, { tall: true })]));
  return out;
}

// ---------------------------------------------------------------------------- significance

function significance(ctx: Context): Child[] {
  const { rep, result, state } = ctx;
  const panelRoles = roles(rep.ttest);
  const kind = result.mode === 'rpd' ? 'paired' : 'unpaired';
  const tileItems = panelRoles.map((role) => {
    const tests = rep.ttest[role] as TTestResult[];
    const significant = tests.filter((t) => t.pvalue < state.alpha).length;
    return { label: `Significant differences · ${role}`, value: String(significant), unit: `of ${tests.length}`, hint: `measures with p < ${state.alpha}` };
  });
  const rows = measureRows(ctx);
  const table: TableData = {
    header: ['Measure', ...panelRoles.flatMap((r) => [`t ${r}`, `p ${r}`])],
    rows: rows.map((m) => [ctx.name(m), ...panelRoles.flatMap((r) => {
      const t = rep.ttest[r]?.[m];
      return [num(t?.statistic), pCell(t, state.alpha)];
    })]),
    sections: sections(rows),
  };
  return [
    tiles(tileItems),
    card(
      `Two-tailed ${kind} t-tests`,
      `Original vs. ${rep.name}, per measure. A small p-value means the ${ctx.noun} differs significantly from the original. Hover a p-value for the test statistic and degrees of freedom.`,
      [h('div', { class: 'table-tools' }, groupChips(ctx)), dataTable(table, { tall: true })],
    ),
  ];
}

// ---------------------------------------------------------------------------- export

function exportTab(ctx: Context, inputs: Record<string, string>): Child[] {
  const { result, rep, state } = ctx;
  const report = cliReport(result, rep, state.naming);
  const copy = h('button', { class: 'btn small', type: 'button' }, icon('copy', 14), 'Copy');
  copy.addEventListener('click', () => {
    void copyText(report).then((ok) => {
      copy.lastChild?.replaceWith(ok ? 'Copied' : 'Copy failed');
      setTimeout(() => copy.lastChild?.replaceWith('Copy'), 1500);
    });
  });
  const save = h('button', { class: 'btn small', type: 'button' }, icon('download', 14), 'Download');
  save.addEventListener('click', () => download(`repro_eval-${slug(rep.name)}.txt`, report));

  const item = (title: string, text: string, fileName: string, make: () => string, type: string): HTMLElement => {
    const b = h('button', { class: 'btn small', type: 'button' }, icon('download', 14), fileName.split('.').pop()?.toUpperCase() ?? 'File');
    b.addEventListener('click', () => download(fileName, make(), type));
    return h('div', { class: 'download' }, h('div', null, h('strong', null, title), h('span', null, text)), b);
  };
  const json = (perTopic: boolean): string => JSON.stringify(toJson(result, { naming: state.naming, perTopic, inputs }), null, 2) + '\n';

  return [
    card(
      'Text report',
      [`The output of `, h('code', null, `python -m repro_eval -t ${result.mode}`), ` for ${rep.name}, in the same layout.`],
      h('pre', { class: 'report' }, report),
      [copy, save],
    ),
    card(
      'Downloads',
      'All results of all reproductions. Non-finite values are written as "NaN" or "Infinity".',
      h(
        'div',
        { class: 'downloads' },
        item('Results (JSON)', 'Every measure, nested like repro_eval’s dicts', 'repro_eval-results.json', () => json(false), 'application/json'),
        item('Results with topic scores (JSON)', 'Adds the per-topic score of every run', 'repro_eval-results-topics.json', () => json(true), 'application/json'),
        item('Summary (CSV)', 'One row per reproduction and measure', 'repro_eval-summary.csv', () => summaryCsv(result, state.naming), 'text/csv'),
        item('Topic scores (CSV)', 'run, topic, measure, value', 'repro_eval-topic-scores.csv', () => scoresCsv(result, state.naming), 'text/csv'),
      ),
    ),
  ];
}

/** The focus-measure picker, one option group per measure family. */
function measureSelect(ctx: Context): HTMLElement {
  const el = h(
    'select',
    { 'data-key': 'filter-measure' },
    MEASURE_GROUPS.map((g) =>
      h(
        'optgroup',
        { label: g.label },
        GROUPED_ORDER.filter((i) => MEASURES[i]?.group === g.id).map((i) => {
          const m = MEASURES[i] as MeasureDef;
          return h('option', { value: m.id, selected: m.id === ctx.state.view.focus }, ctx.name(i));
        }),
      ),
    ),
  );
  el.addEventListener('change', () => ctx.actions.setFocus(el.value));
  return h('label', { class: 'field' }, h('span', null, 'Measure'), el);
}

// ---------------------------------------------------------------------------- frame

const TABS: ReadonlyArray<{ id: TabId; label: string; rpdOnly?: boolean }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'ranking', label: 'Ranked lists', rpdOnly: true },
  { id: 'topics', label: 'Topic scores', rpdOnly: true },
  { id: 'effects', label: 'Effects' },
  { id: 'significance', label: 'Significance' },
  { id: 'export', label: 'Export' },
];

export function renderResults(state: AppState, result: ExperimentResult, theme: ChartTheme, actions: ResultActions, inputs: Record<string, string>): HTMLElement {
  const repIndex = Math.min(state.view.reproduction, result.reproductions.length - 1);
  const rep = result.reproductions[repIndex] as ReproductionResult;
  const focus = measureIndex(state.view.focus);
  const ctx: Context = {
    state,
    result,
    theme,
    actions,
    rep,
    repIndex,
    focus,
    name: (i) => measureName(MEASURES[i] as MeasureDef, state.naming),
    color: (i) => theme.series[i % theme.series.length] as string,
    noun: reproductionNoun(result.mode),
  };
  const tabs = TABS.filter((t) => !t.rpdOnly || result.mode === 'rpd');
  const tab = tabs.some((t) => t.id === state.view.tab) ? state.view.tab : 'overview';

  const filters = h(
    'div',
    { class: 'filters' },
    result.reproductions.length > 1
      ? select(
          reproductionNoun(result.mode)[0]?.toUpperCase() + reproductionNoun(result.mode).slice(1),
          result.reproductions.map((r, i) => ({ value: String(i), label: r.name })),
          String(repIndex),
          (v) => actions.setReproduction(Number(v)),
          'filter-rep',
        )
      : null,
    measureSelect(ctx),
    h('span', { class: 'spacer' }),
    h('span', { class: 'explain' }, `${result.mode === 'rpd' ? 'Reproducibility' : 'Replicability'} · ${plural(result.original.scores.baseline.topics.length, 'topic')} · ${plural(result.reproductions.length, reproductionNoun(result.mode))}`),
  );

  const tabBar = h(
    'div',
    { class: 'tabs', role: 'tablist', 'aria-label': 'Result views' },
    tabs.map((t) => {
      const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(t.id === tab), 'data-key': `tab-${t.id}` }, t.label);
      b.addEventListener('click', () => actions.setTab(t.id));
      return b;
    }),
  );

  const notes = [...result.original.notes, ...result.reproductions.flatMap((r) => r.notes)];
  const notesEl =
    notes.length > 0
      ? h(
          'details',
          { class: 'notes' },
          h('summary', null, `${plural(notes.length, 'note')} about the input`),
          h('ul', null, notes.map((n) => h('li', { class: n.level }, n.message))),
        )
      : null;

  let body: Child[];
  switch (tab) {
    case 'ranking':
      body = rankedLists(ctx);
      break;
    case 'topics':
      body = topicScores(ctx);
      break;
    case 'effects':
      body = effects(ctx);
      break;
    case 'significance':
      body = significance(ctx);
      break;
    case 'export':
      body = exportTab(ctx, inputs);
      break;
    default:
      body = overview(ctx);
  }

  return h(
    'section',
    { class: 'results', 'aria-label': 'Results' },
    h('div', { class: 'results-head' }, filters, tabBar),
    notesEl,
    h('div', { class: 'stack', role: 'tabpanel' }, body),
  );
}
