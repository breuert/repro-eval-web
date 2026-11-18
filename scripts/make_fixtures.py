#!/usr/bin/env python3
"""Generate the golden fixtures that pin the TypeScript port to the reference implementations.

Everything is computed by the reference software itself on deterministic synthetic data:

  test/fixtures/measures/        qrels and run used to compare per-topic scores
  test/fixtures/measures-pytrec_eval.json
        repro_eval.util.evaluate_run (ir_measures + pytrec_eval, i.e. trec_eval 9.x),
        exactly what repro_eval computes
  test/fixtures/measures-trec_eval10.json
        the same input evaluated by trec_eval 10 (C), built from --trec-eval with
        full-precision output (skipped when --trec-eval is not given)
  test/fixtures/repro/           qrels and runs of a small experiment
  test/fixtures/repro.json       RpdEvaluator / RplEvaluator results on them
  test/fixtures/stats.json       numpy / scipy reference values

Setup (Python 3.9+):

  python3 -m venv .venv
  .venv/bin/pip install numpy scipy pandas tqdm ir-measures pytrec_eval_terrier
  .venv/bin/python scripts/make_fixtures.py --repro-eval ./repro_eval --trec-eval ./trec_eval

--repro-eval is a checkout of https://github.com/irgroup/repro_eval (omit it if the
package is installed); --trec-eval a checkout of https://github.com/usnistgov/trec_eval.
"""

import argparse
import json
import math
import os
import platform
import random
import shutil
import subprocess
import sys
import tempfile
import warnings
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "test" / "fixtures"

TREC_EVAL_MEASURES = [
    "P", "recall", "ndcg", "ndcg_cut", "map_cut", "set_map", "set_P", "set_relative_P",
    "set_recall", "set_F", "Rprec", "infAP", "bpref", "recip_rank", "map", "iprec_at_recall",
]


# --------------------------------------------------------------------------- helpers

def encode(value):
    """JSON cannot represent NaN or infinities; encode them as strings."""
    if isinstance(value, dict):
        return {str(k): encode(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [encode(v) for v in value]
    if hasattr(value, "item"):  # numpy scalar
        value = value.item()
    if isinstance(value, float):
        if math.isnan(value):
            return "NaN"
        if math.isinf(value):
            return "Infinity" if value > 0 else "-Infinity"
    return value


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(encode(data), indent=1, sort_keys=False) + "\n")
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KiB)")


def write_lines(path, lines):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def run_lines(run, tag):
    """run: list of (topic, docid, score) in file order."""
    return [f"{topic} Q0 {doc} {rank} {score} {tag}" for rank, (topic, doc, score) in enumerate(run, start=1)]


def qrels_lines(qrels):
    """qrels: list of (topic, docid, label)."""
    return [f"{topic} 0 {doc} {label}" for topic, doc, label in qrels]


def doc_id(i):
    """Document ids in several styles, including non-ASCII ones whose code point order
    differs from UTF-16 order (U+FF21 sorts before U+1F600 by code point, after it by
    UTF-16 code unit)."""
    style = i % 9
    if style == 0:
        return f"d{i}"
    if style == 1:
        return f"DOC-{i:06d}"
    if style == 2:
        return f"doc_{i}"
    if style == 3:
        return f"x{i}y"
    if style == 4:
        return f"Z{i}"
    if style == 5:
        return f"é{i}"
    if style == 6:
        return f"\U0001F600{i}"
    if style == 7:
        return f"Ａ{i}"
    return f"{i}"


def score_with_ties(rng, value):
    digits = rng.choice([1, 2, 2, 3, 6])
    return round(value, digits)


# --------------------------------------------------------------------------- per-topic measures

def measures_input(seed=7):
    """Qrels and a run covering the corner cases of the trec_eval measures."""
    rng = random.Random(seed)
    qrels, run = [], []
    topics = [str(t) for t in range(100, 220)] + ["99", "1001", "q7"]
    for n, topic in enumerate(topics):
        num_judged = rng.choice([1, 2, 3, 5, 8, 13, 30, 60, 120])
        if n < 60:
            # every number of relevant documents from 1 to 60 (iprec_at_recall rounding)
            num_rel = n + 1
            num_judged = max(num_judged, num_rel + rng.randint(0, 40))
        else:
            num_rel = None
        pool = rng.sample(range(10 * num_judged + 50), num_judged + 25)
        judged, nonpool = pool[:num_judged], pool[num_judged:]
        labels = {}
        for k, d in enumerate(judged):
            if num_rel is not None:
                labels[d] = rng.choice([1, 1, 2, 3]) if k < num_rel else rng.choice([0, 0, 0, 0, -1])
            else:
                labels[d] = rng.choices([0, 1, 2, 3, 4, -1], weights=[60, 18, 10, 5, 2, 5])[0]
        if topic == "150":  # no relevant document at all
            labels = {d: 0 for d in judged}
        if topic == "151":  # labels with gaps: only 0 and 3
            labels = {d: (3 if k % 4 == 0 else 0) for k, d in enumerate(judged)}
        if all(v < 0 for v in labels.values()):
            labels[judged[0]] = 0  # trec_eval reads stale memory for all-negative topics
        if topic != "160":  # topic 160 is retrieved but not judged
            for d in judged:
                qrels.append((topic, doc_id(d), labels[d]))
        if topic == "161":  # judged but not retrieved
            continue

        depth = rng.choice([1, 2, 4, 9, 16, 30, 60, 120])
        depth = {"162": 1100, "170": 1000, "171": 500, "172": 200, "173": 30}.get(topic, depth)
        candidates = judged + nonpool + [10_000 + k for k in range(depth)]
        rng.shuffle(candidates)
        entries = []
        for d in candidates[:depth]:
            label = labels.get(d, 0)
            entries.append((doc_id(d), score_with_ties(rng, max(label, 0) * rng.uniform(0.2, 1.0) + rng.uniform(0, 2))))
        if topic == "163":  # every score tied
            entries = [(doc, 1.0) for doc, _ in entries]
        entries.sort(key=lambda e: -e[1])
        run.extend((topic, doc, score) for doc, score in entries)
    return qrels, run


def pytrec_eval_scores(qrels_path, run_path):
    from repro_eval.util import evaluate_run, load_measures, load_qrels, load_run
    return evaluate_run(load_measures(), load_qrels(str(qrels_path)), load_run(str(run_path)))


def build_trec_eval(src):
    """Build trec_eval with full-precision per-topic output in a temporary directory."""
    build = Path(tempfile.mkdtemp(prefix="trec_eval_build_"))
    shutil.copytree(src, build, dirs_exist_ok=True, ignore=shutil.ignore_patterns(".git"))
    printer = build / "meas_print_single.c"
    printer.write_text(printer.read_text().replace("%6.4f", "%.17g"))
    subprocess.run(["make", "-s", "trec_eval"], cwd=build, check=True, capture_output=True)
    return build / "trec_eval"


def trec_eval_scores(binary, qrels_path, run_path, run_topics):
    """Per-topic scores of the topics both files contain. trec_eval 10 stops at judged topics
    without results unless -c is given; those follow ir_measures' fill-in rule in the port anyway."""
    args = [str(binary), "-q", "-c"]
    for m in TREC_EVAL_MEASURES:
        args += ["-m", m]
    out = subprocess.run(args + [str(qrels_path), str(run_path)], check=True, capture_output=True, text=True).stdout
    version = subprocess.run([str(binary), "-v"], capture_output=True, text=True)
    scores = {}
    for line in out.splitlines():
        measure, topic, value = line.split()
        if topic == "all" or topic not in run_topics:
            continue
        scores.setdefault(topic, {})[measure] = float(value)
    return scores, (version.stdout + version.stderr).strip()


# --------------------------------------------------------------------------- repro_eval experiment

def system_run(rng, topics, labels, quality, depth, noise=1.0, tie_digits=3):
    run = []
    for topic in topics:
        docs = list(labels[topic].keys()) + [f"u{topic}_{k}" for k in range(depth)]
        scored = []
        for d in docs:
            rel = max(labels[topic].get(d, 0), 0)
            scored.append((d, round(quality * rel + rng.gauss(0, noise), tie_digits)))
        scored.sort(key=lambda e: -e[1])
        run.extend((topic, d, s) for d, s in scored[:depth])
    return run


def perturb(rng, run, noise, swap_prob):
    """A 'reproduction': the original scores with noise, some documents exchanged."""
    out = []
    by_topic = {}
    for topic, d, s in run:
        by_topic.setdefault(topic, []).append((d, s))
    for topic, entries in by_topic.items():
        new = []
        for k, (d, s) in enumerate(entries):
            if rng.random() < swap_prob:
                d = f"r{topic}_{k}"
            new.append((d, round(s + rng.gauss(0, noise), 3)))
        new.sort(key=lambda e: -e[1])
        out.extend((topic, d, s) for d, s in new)
    return out


def repro_input(seed=11):
    rng = random.Random(seed)
    files = {}

    def judgements(topics, num_docs):
        labels = {}
        for topic in topics:
            labels[topic] = {}
            for k in range(rng.randint(num_docs // 2, num_docs)):
                labels[topic][f"D{topic}-{k:03d}"] = rng.choices([0, 1, 2], weights=[70, 20, 10])[0]
        return labels

    depth = 60
    rpd_topics = [str(t) for t in range(301, 321)]
    labels = judgements(rpd_topics, 120)
    orig_b = system_run(rng, rpd_topics, labels, quality=1.2, depth=depth)
    orig_a = system_run(rng, rpd_topics, labels, quality=1.8, depth=depth)
    rep_b = perturb(rng, orig_b, noise=0.4, swap_prob=0.15)
    rep_a = perturb(rng, orig_a, noise=0.6, swap_prob=0.25)

    # Topic 320 is not reproduced (ir_measures scores it 0, KTU/RBO skip it).
    rep_b = [e for e in rep_b if e[0] != "320"]
    rep_a = [e for e in rep_a if e[0] != "320"]
    # Topic 399 has no judgements; it is retrieved by both advanced runs.
    orig_a += [("399", f"n{k}", 10.0 - k) for k in range(depth)]
    rep_a += [("399", f"n{(k * 7) % depth}", 10.0 - k) for k in range(depth)]
    # Topic 305 of rep_b is not sorted by score (break_ties does not sort, trim keeps file order).
    i = next(k for k, e in enumerate(rep_b) if e[0] == "305")
    rep_b[i + 2], rep_b[i + 20] = rep_b[i + 20], rep_b[i + 2]
    # A repeated document: Python dicts keep the first position and the last score.
    j = next(k for k, e in enumerate(rep_b) if e[0] == "310")
    rep_b.insert(j + 30, ("310", rep_b[j + 1][1], 99.0))

    rpl_topics = [str(t) for t in range(401, 416)]
    rpl_labels = judgements(rpl_topics, 120)
    rpl_b = system_run(rng, rpl_topics, rpl_labels, quality=1.0, depth=depth)
    rpl_a = system_run(rng, rpl_topics, rpl_labels, quality=1.5, depth=depth)

    files["qrels_rpd.txt"] = qrels_lines([(t, d, l) for t in rpd_topics for d, l in labels[t].items()])
    files["qrels_rpl.txt"] = qrels_lines([(t, d, l) for t in rpl_topics for d, l in rpl_labels[t].items()])
    files["orig_b.txt"] = run_lines(orig_b, "orig_b")
    files["orig_a.txt"] = run_lines(orig_a, "orig_a")
    files["rpd_b.txt"] = run_lines(rep_b, "rpd_b")
    files["rpd_a.txt"] = run_lines(rep_a, "rpd_a")
    files["rpl_b.txt"] = run_lines(rpl_b, "rpl_b")
    files["rpl_a.txt"] = run_lines(rpl_a, "rpl_a")
    return files


def repro_results(directory):
    from repro_eval.Evaluator import RplEvaluator, RpdEvaluator
    from repro_eval.util import arp_scores

    p = lambda name: str(directory / name)
    results = {}

    for trim in [1000, 25]:
        ev = RpdEvaluator(qrels_orig_path=p("qrels_rpd.txt"),
                          run_b_orig_path=p("orig_b.txt"), run_a_orig_path=p("orig_a.txt"),
                          run_b_rep_path=p("rpd_b.txt"), run_a_rep_path=p("rpd_a.txt"))
        ev.trim(trim)
        ev.evaluate()
        all_scores = {"orig_b": ev.run_b_orig_score, "orig_a": ev.run_a_orig_score,
                      "rep_b": ev.run_b_rep_score, "rep_a": ev.run_a_rep_score}
        results[f"rpd_trim{trim}"] = {
            "trim": trim,
            # per-topic scores only for the untrimmed runs; the trimmed ones are pinned by their ARP
            "scores": all_scores if trim == 1000 else {},
            "arp": {name: arp_scores(scores) for name, scores in all_scores.items()},
            "ktu": ev.ktu(per_topic=True),
            "ktu_mean": ev.ktu(),
            "rbo": ev.rbo(per_topic=True),
            "rbo_mean": ev.rbo(),
            "rmse": ev.rmse(),
            "nrmse": ev.nrmse(),
            "er": ev.er(),
            "dri": ev.dri(),
            "ttest": ev.ttest(),
        }

    ev = RpdEvaluator(qrels_orig_path=p("qrels_rpd.txt"),
                      run_b_orig_path=p("orig_b.txt"), run_a_orig_path=p("orig_a.txt"),
                      run_b_rep_path=p("orig_b.txt"), run_a_rep_path=p("orig_a.txt"))
    ev.trim()
    ev.evaluate()
    results["rpd_identical"] = {"ttest": ev.ttest(), "ktu_mean": ev.ktu(), "rbo_mean": ev.rbo(), "er": ev.er()}

    ev = RplEvaluator(qrels_orig_path=p("qrels_rpd.txt"), qrels_rpl_path=p("qrels_rpl.txt"),
                      run_b_orig_path=p("orig_b.txt"), run_a_orig_path=p("orig_a.txt"),
                      run_b_rep_path=p("rpl_b.txt"), run_a_rep_path=p("rpl_a.txt"))
    ev.trim()
    ev.evaluate()
    results["rpl"] = {
        "scores": {"rep_b": ev.run_b_rep_score, "rep_a": ev.run_a_rep_score},
        "er": ev.er(),
        "dri": ev.dri(),
        "ttest": ev.ttest(),
    }
    # The order in which repro_eval lists measures (pytrec_eval's internal measure order).
    results["measure_order"] = list(ev.ttest()["baseline"].keys())
    return results


def cli_outputs(directory, repro_eval_path):
    """stdout of `python -m repro_eval` for both experiment types."""
    env = dict(os.environ)
    if repro_eval_path:
        env["PYTHONPATH"] = str(repro_eval_path) + ":" + env.get("PYTHONPATH", "")
    env["PYTHONWARNINGS"] = "ignore"
    p = lambda name: str(directory / name)
    rpd = [sys.executable, "-m", "repro_eval", "-t", "rpd", "-q", p("qrels_rpd.txt"),
           "-r", p("orig_b.txt"), p("orig_a.txt"), p("rpd_b.txt"), p("rpd_a.txt")]
    rpl = [sys.executable, "-m", "repro_eval", "-t", "rpl", "-q", p("qrels_rpd.txt"), p("qrels_rpl.txt"),
           "-r", p("orig_b.txt"), p("orig_a.txt"), p("rpl_b.txt"), p("rpl_a.txt")]
    run = lambda args: subprocess.run(args, check=True, capture_output=True, text=True, env=env).stdout
    return {"rpd": run(rpd), "rpl": run(rpl)}


# --------------------------------------------------------------------------- numerics

def stats_reference(seed=3):
    import numpy as np
    from scipy import stats

    rng = random.Random(seed)
    ref = {"mean": [], "ttest_rel": [], "ttest_ind": [], "pvalue": [], "lgamma": [], "kendalltau": []}

    for n in [1, 2, 3, 7, 8, 9, 15, 16, 17, 24, 50, 64, 127, 128, 129, 130, 200, 255, 256, 257, 300, 513]:
        for _ in range(2):
            scale = 10 ** rng.randint(-3, 2)
            xs = [round(rng.uniform(-0.3, 1) * scale, 7) for _ in range(n)]
            ref["mean"].append({"x": xs, "mean": float(np.array(xs).mean())})

    def sample(n):
        if rng.random() < 0.2:
            return [round(rng.random(), 1) for _ in range(n)]  # many ties
        return [round(rng.betavariate(2, 5), 9) for _ in range(n)]

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for k in range(80):
            n = rng.choice([2, 3, 5, 10, 25, 50, 100])
            a = sample(n)
            if k % 10 == 0:
                b = list(a)  # identical: NaN
            elif k % 10 == 1:
                b = [x - 0.125 for x in a]  # constant difference (not exactly representable for all x)
            else:
                b = [min(1.0, max(0.0, x + rng.gauss(0.02, 0.1))) for x in a]
            r = stats.ttest_rel(a, b)
            ref["ttest_rel"].append({"a": a, "b": b, "statistic": float(r.statistic), "pvalue": float(r.pvalue)})
        for k in range(80):
            a = sample(rng.choice([2, 3, 5, 10, 25, 50, 100]))
            b = sample(rng.choice([2, 3, 5, 10, 25, 50, 100]))
            if k % 15 == 0:
                b = list(a)
            r = stats.ttest_ind(a, b)
            ref["ttest_ind"].append({"a": a, "b": b, "statistic": float(r.statistic), "pvalue": float(r.pvalue)})

    for df in [1, 2, 3, 4, 5, 9, 10, 19, 24, 30, 49, 99, 149, 249, 499, 999, 4999, 99999]:
        for t in [0, 1e-9, 1e-5, 0.01, 0.1, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 7, 10, 20, 40, 100, 1e3, 1e6]:
            for sign in [1, -1]:
                ref["pvalue"].append({"t": sign * t, "df": df, "p": float(2 * stats.t.sf(abs(t), df))})

    for x in [1e-8, 1e-3, 0.1, 0.5, 1, 1.5, 2, 2.5, 3, 4.75, 10, 24.5, 50.5, 100, 171.5, 500.5, 1e4, 1e6]:
        ref["lgamma"].append({"x": x, "lgamma": math.lgamma(x)})

    for _ in range(60):
        n = rng.choice([1, 2, 3, 5, 10, 40, 100, 300])
        ties = rng.random() < 0.5
        x = [rng.randint(0, 5 if ties else 10_000) for _ in range(n)]
        y = [rng.randint(0, 5 if ties else 10_000) for _ in range(n)]
        if rng.random() < 0.2:
            y = list(x)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            tau = stats.kendalltau(x, y).statistic
        ref["kendalltau"].append({"x": x, "y": y, "tau": float(tau)})
    return ref


# --------------------------------------------------------------------------- main

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repro-eval", type=Path, help="path to a repro_eval checkout")
    parser.add_argument("--trec-eval", type=Path, help="path to a trec_eval source checkout")
    args = parser.parse_args()
    if args.repro_eval:
        sys.path.insert(0, str(args.repro_eval.resolve()))
    warnings.simplefilter("ignore")

    import ir_measures
    import numpy
    import pytrec_eval
    import scipy
    # pytrec_eval's iprec_at_recall depends on the CPU: ARM builds fuse `level * num_rel + 0.9`
    # into one multiply-add (see IprecRounding in src/core/trec-eval.ts). The tests read `machine`.
    versions = {"python": sys.version.split()[0], "numpy": numpy.__version__, "scipy": scipy.__version__,
                "ir_measures": ir_measures.__version__, "pytrec_eval": getattr(pytrec_eval, "__version__", "?"),
                "machine": platform.machine()}

    measures_dir = FIXTURES / "measures"
    qrels, run = measures_input()
    write_lines(measures_dir / "qrels.txt", qrels_lines(qrels))
    write_lines(measures_dir / "run.txt", run_lines(run, "fixture"))
    write_json(FIXTURES / "measures-pytrec_eval.json", {
        "generator": "repro_eval.util.evaluate_run", "versions": versions,
        "scores": pytrec_eval_scores(measures_dir / "qrels.txt", measures_dir / "run.txt"),
    })
    if args.trec_eval:
        binary = build_trec_eval(args.trec_eval.resolve())
        run_topics = {topic for topic, _, _ in run}
        scores, version = trec_eval_scores(binary, measures_dir / "qrels.txt", measures_dir / "run.txt", run_topics)
        write_json(FIXTURES / "measures-trec_eval10.json", {"generator": version, "scores": scores})
        shutil.rmtree(binary.parent, ignore_errors=True)

    repro_dir = FIXTURES / "repro"
    for name, lines in repro_input().items():
        write_lines(repro_dir / name, lines)
    write_json(FIXTURES / "repro.json", {
        "versions": versions,
        "results": repro_results(repro_dir),
        "cli": cli_outputs(repro_dir, args.repro_eval.resolve() if args.repro_eval else None),
    })

    write_json(FIXTURES / "stats.json", {"versions": versions, **stats_reference()})


if __name__ == "__main__":
    main()
