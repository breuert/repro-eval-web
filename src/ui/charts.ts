/**
 * Dependency-free SVG charts: grouped columns, lines and scatter plots, each drawn
 * as one or more panels (small multiples) inside a single SVG. Colors are resolved
 * from the CSS custom properties at render time and written as attributes, so an
 * exported SVG looks like the chart on screen.
 *
 * Mark specs follow the dashboard's data-viz rules: columns ≤ 24 px with a 4 px
 * rounded data end and a 2 px surface gap, 2 px lines, ≥ 8 px markers with a
 * 2 px surface ring, hairline solid gridlines, hover targets of at least 24 px.
 */
import { h, s } from './dom.ts';
import type { Child } from './dom.ts';
import { fmtTick } from './format.ts';

export type Shape = 'circle' | 'square' | 'triangle' | 'diamond';

export interface Series {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly shape?: Shape;
}

export interface ChartTheme {
  readonly surface: string;
  readonly ink: string;
  readonly ink2: string;
  readonly muted: string;
  readonly grid: string;
  readonly axis: string;
  readonly neutral: string;
  readonly pos: string;
  readonly neg: string;
  readonly series: readonly string[];
}

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export function chartTheme(): ChartTheme {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string): string => style.getPropertyValue(name).trim();
  return {
    surface: v('--surface'),
    ink: v('--ink'),
    ink2: v('--ink-2'),
    muted: v('--chart-muted'),
    grid: v('--grid'),
    axis: v('--axis'),
    neutral: v('--neutral'),
    pos: v('--pos'),
    neg: v('--neg'),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--s${i}`)),
  };
}

let measureContext: CanvasRenderingContext2D | null | undefined;

export function textWidth(text: string, size = 12, weight = 400): number {
  if (measureContext === undefined) measureContext = document.createElement('canvas').getContext('2d');
  if (!measureContext) return text.length * size * 0.58;
  measureContext.font = `${weight} ${size}px ${FONT}`;
  return measureContext.measureText(text).width;
}

// ---------------------------------------------------------------------------- scales

export function tickStep(min: number, max: number, count: number): number {
  const span = max - min;
  if (!(span > 0)) return 1;
  const raw = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const error = raw / power;
  return (error >= 7.5 ? 10 : error >= 3.5 ? 5 : error >= 1.5 ? 2 : 1) * power;
}

export function niceDomain(min: number, max: number, count = 5): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    if (min === 0) return [0, 1];
    const pad = Math.abs(min) * 0.1;
    min -= pad;
    max += pad;
  }
  const step = tickStep(min, max, count);
  return [Math.floor(min / step + 1e-9) * step, Math.ceil(max / step - 1e-9) * step];
}

export function ticks(min: number, max: number, count = 5): number[] {
  const step = tickStep(min, max, count);
  const out: number[] = [];
  for (let i = Math.ceil(min / step - 1e-9); i <= Math.floor(max / step + 1e-9); i++) out.push(i * step);
  return out;
}

type Scale = (v: number) => number;

function linear(domain: readonly [number, number], range: readonly [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * k;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------- tooltip

let tooltipEl: HTMLDivElement | undefined;

export interface TooltipRow {
  readonly label: string;
  readonly value: string;
  readonly color?: string;
}

function tooltip(): HTMLDivElement {
  if (!tooltipEl) {
    tooltipEl = h('div', { class: 'tooltip', role: 'presentation' });
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

export function showTooltip(clientX: number, clientY: number, title: string, rows: readonly TooltipRow[]): void {
  const el = tooltip();
  el.replaceChildren(
    h('div', { class: 'tt-title' }, title),
    ...rows.map((row) =>
      h(
        'div',
        { class: 'tt-row' },
        h('span', { class: 'tt-key' }, row.color ? lineKey(row.color) : null, row.label),
        h('strong', null, row.value),
      ),
    ),
  );
  el.classList.add('show');
  const { width, height } = el.getBoundingClientRect();
  let x = clientX + 14;
  let y = clientY + 14;
  if (x + width > window.innerWidth - 8) x = clientX - width - 14;
  if (y + height > window.innerHeight - 8) y = clientY - height - 14;
  el.style.left = `${Math.max(8, x)}px`;
  el.style.top = `${Math.max(8, y)}px`;
}

export function hideTooltip(): void {
  tooltipEl?.classList.remove('show');
}

// ---------------------------------------------------------------------------- legend keys

export function lineKey(color: string): SVGSVGElement {
  return s('svg', { class: 'key', width: 14, height: 8, 'aria-hidden': 'true' }, s('line', { x1: 1, y1: 4, x2: 13, y2: 4, stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round' }));
}

export function rectKey(color: string): SVGSVGElement {
  return s('svg', { class: 'key', width: 10, height: 10, 'aria-hidden': 'true' }, s('rect', { x: 0, y: 0, width: 10, height: 10, rx: 2.5, fill: color }));
}

function shapePath(shape: Shape, cx: number, cy: number, r: number): string {
  switch (shape) {
    case 'square':
      return `M${cx - r * 0.9},${cy - r * 0.9}h${1.8 * r}v${1.8 * r}h${-1.8 * r}z`;
    case 'triangle':
      return `M${cx},${cy - r * 1.15}L${cx + r * 1.1},${cy + r * 0.8}L${cx - r * 1.1},${cy + r * 0.8}z`;
    case 'diamond':
      return `M${cx},${cy - r * 1.25}L${cx + r * 1.15},${cy}L${cx},${cy + r * 1.25}L${cx - r * 1.15},${cy}z`;
    case 'circle':
      return `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
  }
}

export function dotKey(color: string, shape: Shape = 'circle'): SVGSVGElement {
  return s('svg', { class: 'key', width: 12, height: 12, 'aria-hidden': 'true' }, s('path', { d: shapePath(shape, 6, 6, 4.2), fill: color }));
}

export interface LegendItem {
  readonly label: string;
  readonly key: SVGSVGElement;
}

export function legend(items: readonly LegendItem[]): HTMLUListElement {
  return h('ul', { class: 'legend' }, items.map((item) => h('li', null, item.key, item.label)));
}

// ---------------------------------------------------------------------------- frame

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface PanelLayout {
  readonly boxes: Box[];
  readonly width: number;
  readonly height: number;
}

const PANEL_GAP = 28;
const TITLE_HEIGHT = 22;

function layoutPanels(count: number, width: number, panelHeight: number, minPanelWidth: number, titled: boolean): PanelLayout {
  const perRow = count > 1 && (width - PANEL_GAP * (count - 1)) / count >= minPanelWidth ? count : 1;
  const panelWidth = (width - PANEL_GAP * (perRow - 1)) / perRow;
  const h0 = panelHeight + (titled ? TITLE_HEIGHT : 0);
  const boxes: Box[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    boxes.push({ x: col * (panelWidth + PANEL_GAP), y: row * (h0 + PANEL_GAP), width: panelWidth, height: h0 });
  }
  const rows = Math.ceil(count / perRow);
  return { boxes, width, height: rows * h0 + (rows - 1) * PANEL_GAP };
}

function svgRoot(width: number, height: number, label: string, theme: ChartTheme): SVGSVGElement {
  return s('svg', {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': label,
    'font-family': FONT,
    'font-size': 12,
    fill: theme.ink2,
  });
}

function panelTitle(g: SVGGElement, box: Box, title: string | undefined, theme: ChartTheme): number {
  if (!title) return 0;
  g.appendChild(s('text', { x: box.x, y: box.y + 13, 'font-size': 12.5, 'font-weight': 600, fill: theme.ink }, title));
  return TITLE_HEIGHT;
}

interface YAxis {
  readonly scale: Scale;
  readonly domain: [number, number];
  readonly ticks: number[];
  readonly step: number;
}

function yAxis(domain: [number, number], top: number, bottom: number): YAxis {
  const count = Math.max(2, Math.min(6, Math.floor((bottom - top) / 44)));
  const tks = ticks(domain[0], domain[1], count);
  return { scale: linear(domain, [bottom, top]), domain, ticks: tks, step: tickStep(domain[0], domain[1], count) };
}

function yAxisWidth(axis: YAxis, title: string | undefined): number {
  const w = Math.max(...axis.ticks.map((t) => textWidth(fmtTick(t, axis.step), 11)), 10);
  return Math.ceil(w) + 10 + (title ? 18 : 0);
}

function drawYGrid(g: SVGGElement, axis: YAxis, left: number, right: number, theme: ChartTheme, title: string | undefined, plotTop: number, plotBottom: number, outerLeft: number): void {
  for (const t of axis.ticks) {
    const y = Math.round(axis.scale(t)) + 0.5;
    g.appendChild(s('line', { x1: left, x2: right, y1: y, y2: y, stroke: t === 0 ? theme.axis : theme.grid, 'stroke-width': 1 }));
    g.appendChild(s('text', { x: left - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: theme.muted }, fmtTick(t, axis.step)));
  }
  if (title) {
    const cy = (plotTop + plotBottom) / 2;
    g.appendChild(s('text', { x: outerLeft + 9, y: cy, transform: `rotate(-90 ${outerLeft + 9} ${cy})`, 'text-anchor': 'middle', 'font-size': 11.5, fill: theme.ink2 }, title));
  }
}

/** Category labels under evenly spaced positions, thinned so they never collide. */
function drawCategoryLabels(g: SVGGElement, labels: readonly string[], centers: readonly number[], y: number, step: number, theme: ChartTheme): void {
  const widest = Math.max(...labels.map((l) => textWidth(l, 11)), 1);
  const every = Math.max(1, Math.ceil((widest + 8) / Math.max(step, 1)));
  labels.forEach((label, i) => {
    if (i % every !== 0) return;
    g.appendChild(s('text', { x: centers[i], y, 'text-anchor': 'middle', 'font-size': 11, fill: theme.muted }, label));
  });
}

function domainOf(values: Iterable<number>, include: readonly number[] = []): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of [...values, ...include]) {
    if (!Number.isFinite(v)) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return lo === Infinity ? [0, 1] : [lo, hi];
}

function clipDomain(domain: [number, number], clip: readonly [number, number] | undefined): [number, number] {
  return clip ? [Math.max(domain[0], clip[0]), Math.min(domain[1], clip[1])] : domain;
}

// ---------------------------------------------------------------------------- columns

export interface ColumnPanel {
  readonly title?: string;
  readonly groups: ReadonlyArray<{ readonly key: string; readonly label: string }>;
  readonly value: (group: string, series: string) => number | undefined;
}

export interface ColumnChartSpec {
  readonly label: string;
  readonly series: readonly Series[];
  readonly panels: readonly ColumnPanel[];
  readonly yTitle?: string;
  readonly yDomain?: [number, number];
  /** Values outside are drawn to the edge of the plot (the tooltip keeps the true value). */
  readonly yClip?: readonly [number, number];
  readonly references?: ReadonlyArray<{ readonly value: number; readonly label: string }>;
  /** Color each column by its sign (diverging), ignoring the series color. */
  readonly diverging?: boolean;
  readonly format: (v: number) => string;
  readonly groupTitle?: string;
  readonly height?: number;
  readonly minPanelWidth?: number;
}

function columnPath(x: number, w: number, y0: number, y1: number): string {
  const top = Math.min(y0, y1);
  const height = Math.abs(y1 - y0);
  const r = Math.min(4, w / 2, height);
  if (height < 0.5) return `M${x},${y0}h${w}v0.5h${-w}z`;
  if (y1 <= y0) {
    // grows upwards: rounded top
    return `M${x},${y0}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${y0}Z`;
  }
  const bottom = top + height;
  return `M${x},${y0}V${bottom - r}Q${x},${bottom} ${x + r},${bottom}H${x + w - r}Q${x + w},${bottom} ${x + w},${bottom - r}V${y0}Z`;
}

export function columnChart(spec: ColumnChartSpec, width: number, theme: ChartTheme): SVGSVGElement {
  const plotHeight = spec.height ?? 240;
  const titled = spec.panels.some((p) => p.title);
  const layout = layoutPanels(spec.panels.length, width, plotHeight + 26, spec.minPanelWidth ?? 300, titled);
  const svg = svgRoot(width, layout.height, spec.label, theme);
  const all: number[] = [];
  for (const panel of spec.panels) {
    for (const group of panel.groups) {
      for (const series of spec.series) {
        const v = panel.value(group.key, series.key);
        if (v !== undefined) all.push(v);
      }
    }
  }
  const raw = spec.yDomain ?? domainOf(all, [0, ...(spec.references ?? []).map((r) => r.value)]);
  const domain = niceDomain(...clipDomain(raw, spec.yClip));

  spec.panels.forEach((panel, p) => {
    const box = layout.boxes[p] as Box;
    const g = s('g');
    svg.appendChild(g);
    const top = box.y + panelTitle(g, box, panel.title, theme) + 6;
    const bottom = box.y + box.height - 22;
    const axis = yAxis(domain, top, bottom);
    const left = box.x + yAxisWidth(axis, spec.yTitle);
    const right = box.x + box.width;
    drawYGrid(g, axis, left, right, theme, spec.yTitle, top, bottom, box.x);

    const n = panel.groups.length;
    const step = (right - left) / Math.max(n, 1);
    const k = spec.series.length;
    const inner = Math.max(1, step * 0.78);
    const barWidth = Math.max(1, Math.min(24, (inner - 2 * (k - 1)) / k));
    const groupWidth = barWidth * k + 2 * (k - 1);
    const zero = Math.round(axis.scale(clamp(0, domain[0], domain[1])));
    const centers: number[] = [];

    for (const ref of spec.references ?? []) {
      if (ref.value < domain[0] || ref.value > domain[1]) continue;
      const y = Math.round(axis.scale(ref.value)) + 0.5;
      g.appendChild(s('line', { x1: left, x2: right, y1: y, y2: y, stroke: theme.ink2, 'stroke-width': 1.5 }));
      const tw = textWidth(ref.label, 11);
      g.appendChild(s('rect', { x: right - tw - 8, y: y - 15, width: tw + 6, height: 13, fill: theme.surface, opacity: 0.85 }));
      g.appendChild(s('text', { x: right - 5, y: y - 5, 'text-anchor': 'end', 'font-size': 11, fill: theme.ink2 }, ref.label));
    }

    panel.groups.forEach((group, gi) => {
      const cx = left + step * gi + step / 2;
      centers.push(cx);
      const x0 = cx - groupWidth / 2;
      const rows: TooltipRow[] = [];
      spec.series.forEach((series, si) => {
        const v = panel.value(group.key, series.key);
        if (v === undefined) return;
        rows.push({ label: series.label, value: spec.format(v), color: series.color });
        if (!Number.isFinite(v)) return;
        const x = x0 + si * (barWidth + 2);
        const y = axis.scale(clamp(v, domain[0], domain[1]));
        const color = spec.diverging ? (v < 0 ? theme.neg : theme.pos) : series.color;
        g.appendChild(s('path', { d: columnPath(x, barWidth, zero, y), fill: color }));
        if (v > domain[1] || v < domain[0]) {
          const ty = v > domain[1] ? axis.scale(domain[1]) - 4 : axis.scale(domain[0]) + 4;
          const dir = v > domain[1] ? -1 : 1;
          g.appendChild(s('path', { d: `M${x + barWidth / 2 - 4},${ty}l4,${dir * 5}l4,${-dir * 5}`, fill: 'none', stroke: theme.ink2, 'stroke-width': 1.5 }));
        }
      });
      const hit = s('rect', { class: 'hit', x: cx - step / 2, y: top, width: step, height: bottom - top, fill: 'transparent' });
      const title = spec.groupTitle ? `${spec.groupTitle} ${group.label}` : group.label;
      hit.addEventListener('pointermove', (e) => showTooltip(e.clientX, e.clientY, title, rows));
      hit.addEventListener('pointerleave', hideTooltip);
      g.appendChild(hit);
    });
    g.appendChild(s('line', { x1: left, x2: right, y1: zero + 0.5, y2: zero + 0.5, stroke: theme.axis, 'stroke-width': 1 }));
    drawCategoryLabels(g, panel.groups.map((gr) => gr.label), centers, bottom + 16, step, theme);
  });
  return svg;
}

// ---------------------------------------------------------------------------- lines

export interface LinePanel {
  readonly title?: string;
  readonly value: (series: string, xIndex: number) => number | undefined;
}

export interface LineChartSpec {
  readonly label: string;
  readonly x: ReadonlyArray<{ readonly key: string; readonly label: string }>;
  readonly xTitle: string;
  readonly yTitle?: string;
  readonly series: readonly Series[];
  readonly panels: readonly LinePanel[];
  readonly yDomain?: [number, number];
  readonly format: (v: number) => string;
  readonly height?: number;
  readonly minPanelWidth?: number;
}

export function lineChart(spec: LineChartSpec, width: number, theme: ChartTheme): SVGSVGElement {
  const plotHeight = spec.height ?? 220;
  const titled = spec.panels.some((p) => p.title);
  const layout = layoutPanels(spec.panels.length, width, plotHeight + 42, spec.minPanelWidth ?? 300, titled);
  const svg = svgRoot(width, layout.height, spec.label, theme);
  const all: number[] = [];
  for (const panel of spec.panels) {
    for (const series of spec.series) spec.x.forEach((_, i) => {
      const v = panel.value(series.key, i);
      if (v !== undefined) all.push(v);
    });
  }
  const domain = spec.yDomain ?? niceDomain(...domainOf(all));

  spec.panels.forEach((panel, p) => {
    const box = layout.boxes[p] as Box;
    const g = s('g');
    svg.appendChild(g);
    const top = box.y + panelTitle(g, box, panel.title, theme) + 6;
    const bottom = box.y + box.height - 40;
    const axis = yAxis(domain, top, bottom);
    const left = box.x + yAxisWidth(axis, spec.yTitle) + 6;
    const right = box.x + box.width - 8;
    drawYGrid(g, axis, left - 6, right + 8, theme, spec.yTitle, top, bottom, box.x);
    const n = spec.x.length;
    const step = n > 1 ? (right - left) / (n - 1) : 0;
    const xAt = (i: number): number => (n > 1 ? left + i * step : (left + right) / 2);
    const centers = spec.x.map((_, i) => xAt(i));
    drawCategoryLabels(g, spec.x.map((x) => x.label), centers, bottom + 18, step || right - left, theme);
    g.appendChild(s('text', { x: (left + right) / 2, y: bottom + 36, 'text-anchor': 'middle', 'font-size': 11.5, fill: theme.ink2 }, spec.xTitle));

    for (const series of spec.series) {
      let d = '';
      let pen = false;
      spec.x.forEach((_, i) => {
        const v = panel.value(series.key, i);
        if (v === undefined || !Number.isFinite(v)) {
          pen = false;
          return;
        }
        d += `${pen ? 'L' : 'M'}${xAt(i)},${axis.scale(v)}`;
        pen = true;
      });
      g.appendChild(s('path', { d, fill: 'none', stroke: series.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      spec.x.forEach((_, i) => {
        const v = panel.value(series.key, i);
        if (v === undefined || !Number.isFinite(v)) return;
        g.appendChild(s('circle', { cx: xAt(i), cy: axis.scale(v), r: 4, fill: series.color, stroke: theme.surface, 'stroke-width': 2 }));
      });
    }

    // Crosshair snapping to the nearest x position; the tooltip lists every series.
    const cross = s('line', { x1: 0, x2: 0, y1: top, y2: bottom, stroke: theme.ink2, 'stroke-width': 1, visibility: 'hidden' });
    g.appendChild(cross);
    const hit = s('rect', { class: 'hit', x: left - 12, y: top, width: right - left + 24, height: bottom - top, fill: 'transparent' });
    hit.addEventListener('pointermove', (e) => {
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) * width) / rect.width;
      const i = n > 1 ? clamp(Math.round((px - left) / step), 0, n - 1) : 0;
      const x = xAt(i);
      cross.setAttribute('x1', String(x));
      cross.setAttribute('x2', String(x));
      cross.setAttribute('visibility', 'visible');
      const rows = spec.series.flatMap((series) => {
        const v = panel.value(series.key, i);
        return v === undefined ? [] : [{ label: series.label, value: spec.format(v), color: series.color }];
      });
      showTooltip(e.clientX, e.clientY, `${spec.xTitle} ${spec.x[i]?.label ?? ''}`, rows);
    });
    hit.addEventListener('pointerleave', () => {
      cross.setAttribute('visibility', 'hidden');
      hideTooltip();
    });
    g.appendChild(hit);
  });
  return svg;
}

// ---------------------------------------------------------------------------- scatter

export interface ScatterPoint {
  readonly x: number;
  readonly y: number;
  readonly series: string;
  readonly title: string;
  /** Overrides the series' shape (e.g. when shape encodes a second dimension). */
  readonly shape?: Shape;
  readonly rows?: readonly TooltipRow[];
}

export interface ScatterPanel {
  readonly title?: string;
  readonly points: readonly ScatterPoint[];
}

export interface ScatterSpec {
  readonly label: string;
  readonly series: readonly Series[];
  readonly panels: readonly ScatterPanel[];
  readonly xTitle: string;
  readonly yTitle: string;
  readonly xDomain?: [number, number];
  readonly yDomain?: [number, number];
  readonly xClip?: readonly [number, number];
  readonly yClip?: readonly [number, number];
  readonly refX?: number;
  readonly refY?: number;
  readonly diagonal?: boolean;
  readonly target?: { readonly x: number; readonly y: number; readonly label: string };
  readonly format: (v: number) => string;
  readonly height?: number;
  readonly minPanelWidth?: number;
}

export function scatterChart(spec: ScatterSpec, width: number, theme: ChartTheme): SVGSVGElement {
  const plotHeight = spec.height ?? 280;
  const titled = spec.panels.some((p) => p.title);
  const layout = layoutPanels(spec.panels.length, width, plotHeight + 40, spec.minPanelWidth ?? 280, titled);
  const svg = svgRoot(width, layout.height, spec.label, theme);
  const points = spec.panels.flatMap((p) => p.points);
  const extraX = [spec.refX, spec.target?.x].filter((v): v is number => v !== undefined);
  const extraY = [spec.refY, spec.target?.y].filter((v): v is number => v !== undefined);
  // Keep points and reference marks off the plot edges (not needed with a diagonal,
  // where scores start at 0).
  const pad = (d: [number, number]): [number, number] => {
    if (spec.diagonal) return d;
    const span = d[1] - d[0] || Math.abs(d[0]) || 1;
    return [d[0] - span * 0.06, d[1] + span * 0.06];
  };
  let xDomain = spec.xDomain ?? niceDomain(...pad(clipDomain(domainOf(points.map((pt) => pt.x), extraX), spec.xClip)));
  let yDomain = spec.yDomain ?? niceDomain(...pad(clipDomain(domainOf(points.map((pt) => pt.y), extraY), spec.yClip)));
  if (spec.diagonal) {
    const lo = Math.min(xDomain[0], yDomain[0]);
    const hi = Math.max(xDomain[1], yDomain[1]);
    xDomain = [lo, hi];
    yDomain = [lo, hi];
  }
  const seriesByKey = new Map(spec.series.map((sr) => [sr.key, sr]));

  spec.panels.forEach((panel, p) => {
    const box = layout.boxes[p] as Box;
    const g = s('g');
    svg.appendChild(g);
    const top = box.y + panelTitle(g, box, panel.title, theme) + 8;
    const bottom = box.y + box.height - 40;
    const axis = yAxis(yDomain, top, bottom);
    const left = box.x + yAxisWidth(axis, spec.yTitle) + 4;
    let right = box.x + box.width - 10;
    if (spec.diagonal) right = Math.min(right, left + (bottom - top));
    drawYGrid(g, axis, left, right, theme, spec.yTitle, top, bottom, box.x);
    const xCount = Math.max(2, Math.min(7, Math.floor((right - left) / 70)));
    const xScale = linear(xDomain, [left, right]);
    const xStep = tickStep(xDomain[0], xDomain[1], xCount);
    for (const t of ticks(xDomain[0], xDomain[1], xCount)) {
      const x = Math.round(xScale(t)) + 0.5;
      g.appendChild(s('line', { x1: x, x2: x, y1: top, y2: bottom, stroke: theme.grid, 'stroke-width': 1 }));
      g.appendChild(s('text', { x, y: bottom + 16, 'text-anchor': 'middle', 'font-size': 11, fill: theme.muted }, fmtTick(t, xStep)));
    }
    g.appendChild(s('text', { x: (left + right) / 2, y: bottom + 34, 'text-anchor': 'middle', 'font-size': 11.5, fill: theme.ink2 }, spec.xTitle));

    const ref = (attrs: Record<string, number>): void => {
      g.appendChild(s('line', { ...attrs, stroke: theme.ink2, 'stroke-width': 1.25 }));
    };
    if (spec.refX !== undefined && spec.refX >= xDomain[0] && spec.refX <= xDomain[1]) ref({ x1: xScale(spec.refX), x2: xScale(spec.refX), y1: top, y2: bottom });
    if (spec.refY !== undefined && spec.refY >= yDomain[0] && spec.refY <= yDomain[1]) ref({ x1: left, x2: right, y1: axis.scale(spec.refY), y2: axis.scale(spec.refY) });
    if (spec.diagonal) ref({ x1: xScale(xDomain[0]), y1: axis.scale(xDomain[0]), x2: xScale(xDomain[1]), y2: axis.scale(xDomain[1]) });
    if (spec.target) {
      const tx = xScale(spec.target.x);
      const ty = axis.scale(spec.target.y);
      g.appendChild(s('circle', { cx: tx, cy: ty, r: 9, fill: 'none', stroke: theme.ink2, 'stroke-width': 1.25 }));
      const inward = tx + 13 + textWidth(spec.target.label, 11) > right;
      g.appendChild(s('text', { x: inward ? tx - 13 : tx + 13, y: ty - 8, 'text-anchor': inward ? 'end' : 'start', 'font-size': 11, fill: theme.ink2 }, spec.target.label));
    }

    for (const pt of panel.points) {
      if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
      const series = seriesByKey.get(pt.series);
      const color = series?.color ?? theme.ink2;
      const clipped = pt.x < xDomain[0] || pt.x > xDomain[1] || pt.y < yDomain[0] || pt.y > yDomain[1];
      const cx = xScale(clamp(pt.x, xDomain[0], xDomain[1]));
      const cy = axis.scale(clamp(pt.y, yDomain[0], yDomain[1]));
      const d = shapePath(pt.shape ?? series?.shape ?? 'circle', cx, cy, 5);
      g.appendChild(
        clipped
          ? s('path', { d, fill: theme.surface, stroke: color, 'stroke-width': 2 })
          : s('path', { d, fill: color, stroke: theme.surface, 'stroke-width': 2 }),
      );
      const hit = s('circle', { class: 'hit', cx, cy, r: 12, fill: 'transparent' });
      const rows: TooltipRow[] = [
        ...(series ? [{ label: series.label, value: '', color }] : []),
        { label: spec.xTitle, value: spec.format(pt.x) },
        { label: spec.yTitle, value: spec.format(pt.y) },
        ...(pt.rows ?? []),
        ...(clipped ? [{ label: 'outside the axis range', value: '' }] : []),
      ];
      hit.addEventListener('pointermove', (e) => showTooltip(e.clientX, e.clientY, pt.title, rows));
      hit.addEventListener('pointerleave', hideTooltip);
      g.appendChild(hit);
    }
  });
  return svg;
}

// ---------------------------------------------------------------------------- export

/** A standalone SVG document of a rendered chart (with background). */
export function serializeSvg(svg: SVGSVGElement, theme: ChartTheme): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.querySelectorAll('.hit').forEach((el) => el.remove());
  const bg = s('rect', { x: 0, y: 0, width: '100%', height: '100%', fill: theme.surface });
  clone.insertBefore(bg, clone.firstChild);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

export async function svgToPng(svgText: string, width: number, height: number, scale = 2): Promise<Blob> {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available.');
  ctx.scale(scale, scale);
  ctx.drawImage(image, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed.'))), 'image/png'));
}

export type ChartContent = Child;
