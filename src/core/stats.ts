/**
 * Numerical routines with the semantics of the NumPy/SciPy calls repro_eval makes.
 *
 * - `mean`: `numpy.mean` (pairwise summation, so results match bit for bit)
 * - `ttestRel` / `ttestInd`: `scipy.stats.ttest_rel` / `scipy.stats.ttest_ind`
 *   (two-sided, equal variances), same formulas and order of operations
 * - `kendallTauB`: `scipy.stats.kendalltau` (variant b, ties handled)
 * - `incompleteBeta`: Cephes `incbet`, on which SciPy's Student t distribution is built
 */

/** NumPy's `pairwise_sum` for float64 (`numpy/_core/src/umath/loops_utils.h.src`). */
export function pairwiseSum(a: ArrayLike<number>, start = 0, n = a.length - start): number {
  if (n < 8) {
    let res = 0;
    for (let i = 0; i < n; i++) res += a[start + i] as number;
    return res;
  }
  if (n <= 128) {
    let r0 = a[start] as number;
    let r1 = a[start + 1] as number;
    let r2 = a[start + 2] as number;
    let r3 = a[start + 3] as number;
    let r4 = a[start + 4] as number;
    let r5 = a[start + 5] as number;
    let r6 = a[start + 6] as number;
    let r7 = a[start + 7] as number;
    let i = 8;
    for (; i < n - (n % 8); i += 8) {
      const j = start + i;
      r0 += a[j] as number;
      r1 += a[j + 1] as number;
      r2 += a[j + 2] as number;
      r3 += a[j + 3] as number;
      r4 += a[j + 4] as number;
      r5 += a[j + 5] as number;
      r6 += a[j + 6] as number;
      r7 += a[j + 7] as number;
    }
    let res = r0 + r1 + (r2 + r3) + (r4 + r5 + (r6 + r7));
    for (; i < n; i++) res += a[start + i] as number;
    return res;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return pairwiseSum(a, start, n2) + pairwiseSum(a, start + n2, n - n2);
}

/** `numpy.mean` of a float64 vector (NaN for an empty vector). */
export function mean(a: ArrayLike<number>): number {
  return pairwiseSum(a) / a.length;
}

/** Python's built-in `sum` (left to right). */
export function sequentialSum(a: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] as number;
  return s;
}

/** Mean that ignores NaN entries (`numpy.nanmean`); NaN when every entry is NaN. */
export function nanMean(a: ArrayLike<number>): number {
  const kept: number[] = [];
  for (let i = 0; i < a.length; i++) if (!Number.isNaN(a[i])) kept.push(a[i] as number);
  return mean(kept);
}

/** SciPy's `_var(x, ddof=1)`: mean of squared deviations times n / (n - 1). */
export function sampleVariance(a: ArrayLike<number>): number {
  const n = a.length;
  const m = mean(a);
  const sq = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = (a[i] as number) - m;
    sq[i] = d * d;
  }
  return mean(sq) * (n / (n - 1));
}

// ---------------------------------------------------------------------------
// Special functions

const MACHEP = 1.11022302462515654042e-16;
const MAXLOG = 7.09782712893383996843e2;
const MINLOG = -7.08396418532264106224e2;
const MAXGAM = 171.624376956302725;
const BIG = 4.503599627370496e15;
const BIGINV = 2.22044604925031308085e-16;

const LANCZOS = [
  57.1562356658629235, -59.5979603554754912, 14.1360979747417471, -0.491913816097620199,
  0.339946499848118887e-4, 0.465236289270485756e-4, -0.983744753048795646e-4, 0.158088703224912494e-3,
  -0.210264441724104883e-3, 0.217439618115212643e-3, -0.16431810653676389e-3, 0.844182239838527433e-4,
  -0.261908384015814087e-4, 0.368991826595316234e-5,
];

/** ln Γ(x) for x > 0 (Lanczos approximation, Numerical Recipes 3rd ed. `gammln`). */
export function logGamma(x: number): number {
  if (!(x > 0)) return NaN;
  let y = x;
  let tmp = x + 5.2421875;
  tmp = (x + 0.5) * Math.log(tmp) - tmp;
  let ser = 0.999999999999997092;
  for (const c of LANCZOS) ser += c / ++y;
  return tmp + Math.log((2.5066282746310005 * ser) / x);
}

function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

/** Power series for the incomplete beta integral (Cephes `pseries`). */
function betaSeries(a: number, b: number, x: number): number {
  const ai = 1.0 / a;
  let u = (1.0 - b) * x;
  let v = u / (a + 1.0);
  const t1 = v;
  let t = u;
  let n = 2.0;
  let s = 0.0;
  const z = MACHEP * ai;
  while (Math.abs(v) > z) {
    u = ((n - b) * x) / n;
    t *= u;
    v = t / (a + n);
    s += v;
    n += 1.0;
  }
  s += t1;
  s += ai;
  const lu = a * Math.log(x);
  if (a + b < MAXGAM && Math.abs(lu) < MAXLOG) {
    return s * Math.exp(-logBeta(a, b)) * Math.pow(x, a);
  }
  const lt = -logBeta(a, b) + lu + Math.log(s);
  return lt < MINLOG ? 0.0 : Math.exp(lt);
}

/** Continued fraction expansion #1 for the incomplete beta integral (Cephes `incbcf`). */
function betaContinuedFraction1(a: number, b: number, x: number): number {
  let k1 = a;
  let k2 = a + b;
  let k3 = a;
  let k4 = a + 1.0;
  let k5 = 1.0;
  let k6 = b - 1.0;
  let k7 = k4;
  let k8 = a + 2.0;
  let pkm2 = 0.0;
  let qkm2 = 1.0;
  let pkm1 = 1.0;
  let qkm1 = 1.0;
  let ans = 1.0;
  let r = 1.0;
  const thresh = 3.0 * MACHEP;
  for (let n = 0; n < 300; n++) {
    let xk = -(x * k1 * k2) / (k3 * k4);
    let pk = pkm1 + pkm2 * xk;
    let qk = qkm1 + qkm2 * xk;
    pkm2 = pkm1;
    pkm1 = pk;
    qkm2 = qkm1;
    qkm1 = qk;

    xk = (x * k5 * k6) / (k7 * k8);
    pk = pkm1 + pkm2 * xk;
    qk = qkm1 + qkm2 * xk;
    pkm2 = pkm1;
    pkm1 = pk;
    qkm2 = qkm1;
    qkm1 = qk;

    if (qk !== 0) r = pk / qk;
    let t: number;
    if (r !== 0) {
      t = Math.abs((ans - r) / r);
      ans = r;
    } else {
      t = 1.0;
    }
    if (t < thresh) break;

    k1 += 1.0;
    k2 += 1.0;
    k3 += 2.0;
    k4 += 2.0;
    k5 += 1.0;
    k6 -= 1.0;
    k7 += 2.0;
    k8 += 2.0;

    if (Math.abs(qk) + Math.abs(pk) > BIG) {
      pkm2 *= BIGINV;
      pkm1 *= BIGINV;
      qkm2 *= BIGINV;
      qkm1 *= BIGINV;
    }
    if (Math.abs(qk) < BIGINV || Math.abs(pk) < BIGINV) {
      pkm2 *= BIG;
      pkm1 *= BIG;
      qkm2 *= BIG;
      qkm1 *= BIG;
    }
  }
  return ans;
}

/** Continued fraction expansion #2 for the incomplete beta integral (Cephes `incbd`), z = x / (1 - x). */
function betaContinuedFraction2(a: number, b: number, z: number): number {
  let k1 = a;
  let k2 = b - 1.0;
  let k3 = a;
  let k4 = a + 1.0;
  let k5 = 1.0;
  let k6 = a + b;
  let k7 = a + 1.0;
  let k8 = a + 2.0;
  let pkm2 = 0.0;
  let qkm2 = 1.0;
  let pkm1 = 1.0;
  let qkm1 = 1.0;
  let ans = 1.0;
  let r = 1.0;
  const thresh = 3.0 * MACHEP;
  for (let n = 0; n < 300; n++) {
    let xk = -(z * k1 * k2) / (k3 * k4);
    let pk = pkm1 + pkm2 * xk;
    let qk = qkm1 + qkm2 * xk;
    pkm2 = pkm1;
    pkm1 = pk;
    qkm2 = qkm1;
    qkm1 = qk;

    xk = (z * k5 * k6) / (k7 * k8);
    pk = pkm1 + pkm2 * xk;
    qk = qkm1 + qkm2 * xk;
    pkm2 = pkm1;
    pkm1 = pk;
    qkm2 = qkm1;
    qkm1 = qk;

    if (qk !== 0) r = pk / qk;
    let t: number;
    if (r !== 0) {
      t = Math.abs((ans - r) / r);
      ans = r;
    } else {
      t = 1.0;
    }
    if (t < thresh) break;

    k1 += 1.0;
    k2 -= 1.0;
    k3 += 2.0;
    k4 += 2.0;
    k5 += 1.0;
    k6 += 1.0;
    k7 += 2.0;
    k8 += 2.0;

    if (Math.abs(qk) + Math.abs(pk) > BIG) {
      pkm2 *= BIGINV;
      pkm1 *= BIGINV;
      qkm2 *= BIGINV;
      qkm1 *= BIGINV;
    }
    if (Math.abs(qk) < BIGINV || Math.abs(pk) < BIGINV) {
      pkm2 *= BIG;
      pkm1 *= BIG;
      qkm2 *= BIG;
      qkm1 *= BIG;
    }
  }
  return ans;
}

/**
 * Regularized incomplete beta function I_x(a, b) (Cephes `incbet`).
 * `xc` is 1 - x; pass it when it is known more accurately than `1 - x`.
 */
export function incompleteBeta(aa: number, bb: number, xx: number, xxc = 1.0 - xx): number {
  if (!(aa > 0) || !(bb > 0) || Number.isNaN(xx) || Number.isNaN(xxc)) return NaN;
  if (xx <= 0.0) return xx === 0.0 ? 0.0 : NaN;
  // x may round to 1 while its complement is still accurate (tiny t statistics).
  if (xxc <= 0.0) return xxc === 0.0 ? 1.0 : NaN;

  if (bb * xx <= 1.0 && xx <= 0.95) return betaSeries(aa, bb, xx);

  let a: number;
  let b: number;
  let x: number;
  let xc: number;
  let flip = false;
  if (xx > aa / (aa + bb)) {
    flip = true;
    a = bb;
    b = aa;
    xc = xx;
    x = xxc;
  } else {
    a = aa;
    b = bb;
    xc = xxc;
    x = xx;
  }

  let t: number;
  if (flip && b * x <= 1.0 && x <= 0.95) {
    t = betaSeries(a, b, x);
  } else {
    const y = x * (a + b - 2.0) - (a - 1.0);
    const w = y < 0.0 ? betaContinuedFraction1(a, b, x) : betaContinuedFraction2(a, b, x / xc) / xc;
    const ly = a * Math.log(x);
    const lt = b * Math.log(xc);
    if (a + b < MAXGAM && Math.abs(ly) < MAXLOG && Math.abs(lt) < MAXLOG) {
      t = Math.pow(xc, b);
      t *= Math.pow(x, a);
      t /= a;
      t *= w;
      t *= Math.exp(-logBeta(a, b));
    } else {
      const s = ly + lt - logBeta(a, b) + Math.log(w / a);
      t = s < MINLOG ? 0.0 : Math.exp(s);
    }
  }

  if (flip) t = t <= MACHEP ? 1.0 - MACHEP : 1.0 - t;
  return t;
}

/** Two-sided p-value of a Student t statistic: 2 · P(T > |t|). */
export function studentTwoSidedP(t: number, df: number): number {
  if (Number.isNaN(t) || !(df > 0)) return NaN;
  if (!Number.isFinite(t)) return 0;
  if (t === 0) return 1;
  const t2 = t * t;
  return incompleteBeta(0.5 * df, 0.5, df / (df + t2), t2 / (df + t2));
}

// ---------------------------------------------------------------------------
// Tests

export interface TTestResult {
  readonly statistic: number;
  readonly pvalue: number;
  readonly df: number;
}

/** `scipy.stats.ttest_rel(a, b)` (two-sided). */
export function ttestRel(a: ArrayLike<number>, b: ArrayLike<number>): TTestResult {
  if (a.length !== b.length) throw new Error('ttestRel: samples must have equal length');
  const n = a.length;
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = (a[i] as number) - (b[i] as number);
  const df = n - 1;
  if (n === 0) return { statistic: NaN, pvalue: NaN, df: NaN };
  const m = mean(d);
  const v = sampleVariance(d);
  const denom = Math.sqrt(v / n);
  const statistic = (m - 0.0) / denom;
  return { statistic, pvalue: studentTwoSidedP(statistic, df), df };
}

/** `scipy.stats.ttest_ind(a, b)` (two-sided, equal variances). */
export function ttestInd(a: ArrayLike<number>, b: ArrayLike<number>): TTestResult {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 === 0 || n2 === 0) return { statistic: NaN, pvalue: NaN, df: NaN };
  const v1 = n1 === 1 ? 0.0 : sampleVariance(a);
  const v2 = n2 === 1 ? 0.0 : sampleVariance(b);
  const df = n1 + n2 - 2.0;
  const svar = ((n1 - 1) * v1 + (n2 - 1) * v2) / df;
  const denom = Math.sqrt(svar * (1.0 / n1 + 1.0 / n2));
  const statistic = (mean(a) - mean(b)) / denom;
  return { statistic, pvalue: studentTwoSidedP(statistic, df), df };
}

// ---------------------------------------------------------------------------
// Rank correlation

function denseRanks(values: ArrayLike<number>, order: readonly number[]): Int32Array {
  const ranks = new Int32Array(values.length);
  let rank = 0;
  for (let k = 0; k < order.length; k++) {
    const i = order[k] as number;
    if (k === 0 || values[i] !== values[order[k - 1] as number]) rank++;
    ranks[i] = rank;
  }
  return ranks;
}

/**
 * Kendall's tau-b, as computed by `scipy.stats.kendalltau` (O(n log n), Knight's algorithm
 * with a Fenwick tree for the discordant pairs). NaN for fewer than two observations or
 * when one variable is constant.
 */
export function kendallTauB(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const size = x.length;
  if (size !== y.length) throw new Error('kendallTauB: inputs must have equal length');
  if (size === 0) return NaN;

  const index = Array.from({ length: size }, (_, i) => i);
  const byY = index.slice().sort((i, j) => (y[i] as number) - (y[j] as number));
  const yr = denseRanks(y, byY);
  const order = index.slice().sort((i, j) => (x[i] as number) - (x[j] as number) || (yr[i] as number) - (yr[j] as number));
  const xr = denseRanks(x, order);

  // Discordant pairs: for every observation, the earlier observations with a smaller
  // x rank and a larger y rank (`_kendall_dis`).
  let sup = 0;
  for (let i = 0; i < size; i++) sup = Math.max(sup, (yr[i] as number) + 1);
  const tree = new Float64Array(sup);
  let dis = 0;
  let i = 0;
  let k = 0;
  while (i < size) {
    while (k < size && xr[order[i] as number] === xr[order[k] as number]) {
      dis += i;
      for (let idx = yr[order[k] as number] as number; idx !== 0; idx &= idx - 1) dis -= tree[idx] as number;
      k++;
    }
    while (i < k) {
      for (let idx = yr[order[i] as number] as number; idx < sup; idx += idx & -idx) tree[idx] = (tree[idx] as number) + 1;
      i++;
    }
  }

  const pairs = (c: number): number => (c * (c - 1)) / 2;
  let ntie = 0;
  let xtie = 0;
  let runXY = 1;
  let runX = 1;
  for (let j = 1; j <= size; j++) {
    const prev = order[j - 1] as number;
    const cur = order[j];
    const sameX = cur !== undefined && xr[cur] === xr[prev];
    const sameXY = sameX && yr[cur as number] === yr[prev];
    if (sameXY) runXY++;
    else {
      ntie += pairs(runXY);
      runXY = 1;
    }
    if (sameX) runX++;
    else {
      xtie += pairs(runX);
      runX = 1;
    }
  }
  const yCounts = new Map<number, number>();
  for (let j = 0; j < size; j++) yCounts.set(yr[j] as number, (yCounts.get(yr[j] as number) ?? 0) + 1);
  let ytie = 0;
  for (const c of yCounts.values()) ytie += pairs(c);

  const tot = pairs(size);
  if (xtie === tot || ytie === tot) return NaN;
  const conMinusDis = tot - xtie - ytie + ntie - 2 * dis;
  const tau = conMinusDis / Math.sqrt(tot - xtie) / Math.sqrt(tot - ytie);
  return Math.min(1.0, Math.max(-1.0, tau));
}

/** Python's `round(value, digits)` for the magnitudes used here. */
export function roundTo(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  return Number(value.toFixed(digits));
}
