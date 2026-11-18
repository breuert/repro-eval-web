import { formatFixed } from '../core/format.ts';

/** A value as trec_eval / repro_eval print it (4 decimals), with typographic NaN and infinity. */
export function fmt(x: number | undefined, digits = 4): string {
  if (x === undefined) return '–';
  if (Number.isNaN(x)) return 'n/a';
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '−∞';
  return formatFixed(x, digits).replace(/^-/, '−');
}

/** p-values: 4 decimals, scientific notation below 0.0001. */
export function fmtP(p: number | undefined): string {
  if (p === undefined) return '–';
  if (Number.isNaN(p)) return 'n/a';
  if (p > 0 && p < 0.0001) {
    const [mantissa, exponent] = p.toExponential(1).split('e');
    return `${mantissa}e${(exponent ?? '').replace('-', '−')}`;
  }
  return formatFixed(p, 4);
}

const integer = new Intl.NumberFormat('en');

export function fmtInt(n: number): string {
  return integer.format(n);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

/** Short tick labels for chart axes. */
export function fmtTick(value: number, step: number): string {
  if (value === 0) return '0';
  const decimals = Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
  return value.toFixed(decimals).replace(/^-/, '−');
}

/** A safe file-name fragment. */
export function slug(text: string): string {
  return text.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'export';
}
