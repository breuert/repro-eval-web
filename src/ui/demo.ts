/**
 * Synthetic example data, generated in the browser from a fixed seed.
 *
 * Every topic has a pool of judged documents (labels 0, 1, 2) and unjudged ones.
 * A "system" scores a document as `weight · relevance + shared noise + own noise`:
 * the shared part makes different systems agree on which documents look good, the
 * own part makes them disagree. The advanced system weighs relevance more than the
 * baseline, so it is more effective. Reproductions perturb or re-implement the
 * original systems to different degrees.
 */
export interface DemoRuns {
  readonly name: string;
  readonly baseline: string;
  readonly advanced: string;
}

export interface DemoData {
  readonly qrels: string;
  readonly replicationQrels: string;
  readonly original: DemoRuns;
  readonly reproductions: readonly DemoRuns[];
  readonly replications: readonly DemoRuns[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number): () => number {
  return () => {
    const u = 1 - random();
    const v = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

interface Doc {
  readonly id: string;
  readonly relevance: number;
  readonly shared: number;
}

interface Collection {
  readonly topics: ReadonlyArray<{ readonly id: string; readonly docs: readonly Doc[] }>;
  readonly qrels: string;
}

const DEPTH = 1000;

function collection(seed: number, firstTopic: number, numTopics: number): Collection {
  const random = mulberry32(seed);
  const normal = gaussian(random);
  const topics: Array<{ id: string; docs: Doc[] }> = [];
  const qrels: string[] = [];
  for (let t = 0; t < numTopics; t++) {
    const id = String(firstTopic + t);
    const judged = 150 + Math.floor(random() * 250);
    const relevantShare = 0.06 + random() * 0.22;
    const docs: Doc[] = [];
    for (let k = 0; k < judged + 1300; k++) {
      const docId = `doc-${id}-${String(k).padStart(5, '0')}`;
      let relevance = 0;
      if (k < judged) {
        const r = random();
        relevance = r < relevantShare * 0.35 ? 2 : r < relevantShare ? 1 : 0;
        qrels.push(`${id} 0 ${docId} ${relevance}`);
      } else if (random() < 0.01) {
        relevance = 1; // relevant but never judged
      }
      docs.push({ id: docId, relevance, shared: normal() });
    }
    topics.push({ id, docs });
  }
  return { topics, qrels: qrels.join('\n') + '\n' };
}

interface System {
  readonly weight: number;
  readonly noise: number;
  readonly seed: number;
}

/** Scores of a system for every document of every topic. */
function scores(col: Collection, system: System): Float64Array[] {
  const normal = gaussian(mulberry32(system.seed));
  return col.topics.map((topic) => Float64Array.from(topic.docs, (d) => system.weight * d.relevance + d.shared + system.noise * normal()));
}

function perturb(base: Float64Array[], sigma: number, seed: number): Float64Array[] {
  const normal = gaussian(mulberry32(seed));
  return base.map((topic) => topic.map((v) => v + sigma * normal()));
}

function runText(col: Collection, values: Float64Array[], tag: string): string {
  const lines: string[] = [];
  col.topics.forEach((topic, t) => {
    const s = values[t] as Float64Array;
    const order = topic.docs.map((_, i) => i).sort((a, b) => (s[b] as number) - (s[a] as number)).slice(0, DEPTH);
    order.forEach((i, rank) => lines.push(`${topic.id} Q0 ${(topic.docs[i] as Doc).id} ${rank + 1} ${(s[i] as number).toFixed(4)} ${tag}`));
  });
  return lines.join('\n') + '\n';
}

export function generateDemo(): DemoData {
  const original = collection(2020, 301, 40);
  const other = collection(2021, 401, 40);

  const origBase = scores(original, { weight: 1.0, noise: 0.8, seed: 11 });
  const origAdv = scores(original, { weight: 1.7, noise: 0.8, seed: 12 });

  return {
    qrels: original.qrels,
    replicationQrels: other.qrels,
    original: { name: 'Original', baseline: runText(original, origBase, 'orig-base'), advanced: runText(original, origAdv, 'orig-adv') },
    reproductions: [
      {
        name: 'Close reproduction',
        baseline: runText(original, perturb(origBase, 0.15, 21), 'rpd1-base'),
        advanced: runText(original, perturb(origAdv, 0.15, 22), 'rpd1-adv'),
      },
      {
        name: 'Re-implementation',
        baseline: runText(original, scores(original, { weight: 1.0, noise: 0.8, seed: 31 }), 'rpd2-base'),
        advanced: runText(original, scores(original, { weight: 1.45, noise: 0.8, seed: 32 }), 'rpd2-adv'),
      },
      {
        name: 'Weaker effect',
        baseline: runText(original, scores(original, { weight: 1.1, noise: 0.9, seed: 41 }), 'rpd3-base'),
        advanced: runText(original, scores(original, { weight: 1.25, noise: 0.9, seed: 42 }), 'rpd3-adv'),
      },
    ],
    replications: [
      {
        name: 'Replication',
        baseline: runText(other, scores(other, { weight: 1.0, noise: 0.8, seed: 51 }), 'rpl1-base'),
        advanced: runText(other, scores(other, { weight: 1.6, noise: 0.8, seed: 52 }), 'rpl1-adv'),
      },
      {
        name: 'Weaker replication',
        baseline: runText(other, scores(other, { weight: 1.0, noise: 0.9, seed: 61 }), 'rpl2-base'),
        advanced: runText(other, scores(other, { weight: 1.2, noise: 0.9, seed: 62 }), 'rpl2-adv'),
      },
    ],
  };
}
