/**
 * Readers for TREC-formatted run and qrels files.
 *
 * The behaviour mirrors what repro_eval does through ir_measures
 * (`read_trec_run` / `read_trec_qrels`) followed by building nested dicts:
 *
 * - runs have exactly six whitespace-separated columns
 *   (`topic Q0 docid rank score tag`); the rank column is ignored,
 * - qrels have exactly four columns (`topic iteration docid relevance`),
 * - a repeated (topic, docid) keeps the position of its first occurrence and
 *   the value of its last one (Python dict semantics),
 * - topics are ordered by code point (Python's `sorted`), documents keep file order.
 *
 * Additionally, blank lines and lines starting with `#` are skipped. trec_eval 10
 * treats such lines as comments, and they carry ir_metadata annotations.
 */
import { compareCodePoints } from './compare.ts';

export interface ScoredDoc {
  readonly docId: string;
  readonly score: number;
}

/** Retrieved documents of one topic, in file order. */
export type Ranking = readonly ScoredDoc[];

/** Topic id → ranking. Iteration order is code-point order of the topic ids. */
export type Run = ReadonlyMap<string, Ranking>;

/** Judgements of one topic: document id → relevance label. */
export type Judgements = ReadonlyMap<string, number>;

/** Topic id → judgements. Iteration order is code-point order of the topic ids. */
export type Qrels = ReadonlyMap<string, Judgements>;

export class TrecFormatError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(`Line ${line}: ${message}`);
    this.name = 'TrecFormatError';
    this.line = line;
  }
}

export interface RunInfo {
  /** Distinct run tags (sixth column) in order of first appearance. */
  readonly tags: readonly string[];
  readonly numLines: number;
  readonly numTopics: number;
  /** Retrieved documents after collapsing repeated (topic, docid) entries. */
  readonly numDocs: number;
  readonly minDepth: number;
  readonly maxDepth: number;
  /** Lines that repeated an earlier (topic, docid) pair. */
  readonly duplicates: number;
  /** Topics whose scores are not non-increasing in file order. */
  readonly unsortedTopics: number;
  /** Comment lines (for example ir_metadata), without the leading `#`. */
  readonly comments: readonly string[];
}

export interface ParsedRun {
  readonly run: Run;
  readonly info: RunInfo;
}

export interface QrelsInfo {
  readonly numLines: number;
  readonly numTopics: number;
  readonly numJudged: number;
  /** Judgements with a label of at least 1 (trec_eval's default relevance level). */
  readonly numRelevant: number;
  /** Label → number of judgements, ascending by label. */
  readonly labels: ReadonlyMap<number, number>;
  readonly duplicates: number;
  readonly comments: readonly string[];
}

export interface ParsedQrels {
  readonly qrels: Qrels;
  readonly info: QrelsInfo;
}

const RUN_COLUMNS = 'topic, Q0, docid, rank, score, tag';
const QRELS_COLUMNS = 'topic, iteration, docid, relevance';
/** Labels are used as array indices by trec_eval; keep them in a sane range. */
const MAX_ABS_LABEL = 1_000_000;

const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const INFINITY = /^([+-]?)inf(?:inity)?$/i;
const INTEGER = /^[+-]?\d+(?:\.0*)?$/;

/** Parse a score the way Python's `float()` does for the forms that occur in run files. */
export function parseScore(token: string): number {
  if (DECIMAL.test(token)) return Number(token);
  const inf = INFINITY.exec(token);
  if (inf) return inf[1] === '-' ? -Infinity : Infinity;
  return NaN;
}

function* lines(text: string): Generator<[lineNo: number, content: string]> {
  let start = 0;
  let lineNo = 0;
  const n = text.length;
  while (start <= n) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = n;
    lineNo++;
    yield [lineNo, text.slice(start, end)];
    start = end + 1;
  }
}

function columnHint(found: number, kind: 'run' | 'qrels'): string {
  if (kind === 'run' && found === 4) return ' This looks like a qrels file.';
  if (kind === 'qrels' && found === 6) return ' This looks like a run file.';
  return '';
}

function sortedByTopic<V>(map: Map<string, V>): Map<string, V> {
  const keys = [...map.keys()].sort(compareCodePoints);
  const out = new Map<string, V>();
  for (const key of keys) out.set(key, map.get(key) as V);
  return out;
}

export function parseRun(text: string): ParsedRun {
  const docs = new Map<string, ScoredDoc[]>();
  const positions = new Map<string, Map<string, number>>();
  const tags: string[] = [];
  const tagSet = new Set<string>();
  const comments: string[] = [];
  let numLines = 0;
  let duplicates = 0;

  for (const [lineNo, raw] of lines(text)) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('#')) {
      comments.push(line.slice(1));
      continue;
    }
    const cols = line.split(/\s+/);
    if (cols.length !== 6) {
      throw new TrecFormatError(
        `expected 6 columns (${RUN_COLUMNS}) but found ${cols.length}.${columnHint(cols.length, 'run')}`,
        lineNo,
      );
    }
    const [topic, , docId, , scoreToken, tag] = cols as [string, string, string, string, string, string];
    const score = parseScore(scoreToken);
    if (Number.isNaN(score)) {
      throw new TrecFormatError(`score "${scoreToken}" is not a number.`, lineNo);
    }
    numLines++;
    if (!tagSet.has(tag)) {
      tagSet.add(tag);
      tags.push(tag);
    }
    let ranking = docs.get(topic);
    let index = positions.get(topic);
    if (ranking === undefined || index === undefined) {
      ranking = [];
      index = new Map();
      docs.set(topic, ranking);
      positions.set(topic, index);
    }
    const seen = index.get(docId);
    if (seen === undefined) {
      index.set(docId, ranking.length);
      ranking.push({ docId, score });
    } else {
      duplicates++;
      ranking[seen] = { docId, score };
    }
  }

  if (numLines === 0) throw new TrecFormatError('the file contains no run lines.', 1);

  let numDocs = 0;
  let minDepth = Infinity;
  let maxDepth = 0;
  let unsortedTopics = 0;
  for (const ranking of docs.values()) {
    numDocs += ranking.length;
    minDepth = Math.min(minDepth, ranking.length);
    maxDepth = Math.max(maxDepth, ranking.length);
    for (let i = 1; i < ranking.length; i++) {
      if ((ranking[i] as ScoredDoc).score > (ranking[i - 1] as ScoredDoc).score) {
        unsortedTopics++;
        break;
      }
    }
  }

  return {
    run: sortedByTopic(docs),
    info: {
      tags,
      numLines,
      numTopics: docs.size,
      numDocs,
      minDepth,
      maxDepth,
      duplicates,
      unsortedTopics,
      comments,
    },
  };
}

export function parseQrels(text: string): ParsedQrels {
  const qrels = new Map<string, Map<string, number>>();
  const comments: string[] = [];
  let numLines = 0;
  let duplicates = 0;

  for (const [lineNo, raw] of lines(text)) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('#')) {
      comments.push(line.slice(1));
      continue;
    }
    const cols = line.split(/\s+/);
    if (cols.length !== 4) {
      throw new TrecFormatError(
        `expected 4 columns (${QRELS_COLUMNS}) but found ${cols.length}.${columnHint(cols.length, 'qrels')}`,
        lineNo,
      );
    }
    const [topic, , docId, labelToken] = cols as [string, string, string, string];
    if (!INTEGER.test(labelToken)) {
      throw new TrecFormatError(`relevance label "${labelToken}" is not an integer.`, lineNo);
    }
    const label = Number.parseInt(labelToken, 10);
    if (Math.abs(label) > MAX_ABS_LABEL) {
      throw new TrecFormatError(`relevance label ${label} is out of range.`, lineNo);
    }
    numLines++;
    let judgements = qrels.get(topic);
    if (judgements === undefined) {
      judgements = new Map();
      qrels.set(topic, judgements);
    }
    if (judgements.has(docId)) duplicates++;
    judgements.set(docId, label);
  }

  if (numLines === 0) throw new TrecFormatError('the file contains no judgements.', 1);

  const labelCounts = new Map<number, number>();
  let numJudged = 0;
  let numRelevant = 0;
  for (const judgements of qrels.values()) {
    for (const label of judgements.values()) {
      numJudged++;
      if (label >= 1) numRelevant++;
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    }
  }
  const labels = new Map([...labelCounts.entries()].sort((a, b) => a[0] - b[0]));

  return {
    qrels: sortedByTopic(qrels),
    info: { numLines, numTopics: qrels.size, numJudged, numRelevant, labels, duplicates, comments },
  };
}

/** Serialize a run back to TREC format (ranks follow the given order). */
export function formatRun(run: Run, tag: string): string {
  const out: string[] = [];
  for (const [topic, ranking] of run) {
    ranking.forEach((doc, i) => out.push(`${topic} Q0 ${doc.docId} ${i + 1} ${doc.score} ${tag}`));
  }
  return out.join('\n') + '\n';
}

/** Serialize qrels back to TREC format. */
export function formatQrels(qrels: Qrels): string {
  const out: string[] = [];
  for (const [topic, judgements] of qrels) {
    for (const [docId, label] of judgements) out.push(`${topic} 0 ${docId} ${label}`);
  }
  return out.join('\n') + '\n';
}
