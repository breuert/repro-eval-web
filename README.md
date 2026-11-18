# repro_eval web

An interactive dashboard that brings [repro_eval](https://github.com/irgroup/repro_eval) to the
browser: load TREC runs and qrels, and get the reproducibility and replicability measures of
Breuer et al. ([SIGIR 2020](https://doi.org/10.1145/3397271.3401036)) as tables, plots and exports.

- **One HTML file.** `dist/index.html` contains all code and styles. Host it on GitHub Pages,
  attach it to a paper artifact, or open it from disk; it works offline.
- **Private by construction.** Runs are evaluated in the browser tab. The page's
  Content-Security-Policy forbids network requests, so evaluated data cannot leave the machine.
- **Same numbers as repro_eval.** The computations are checked against the Python package,
  pytrec_eval and trec_eval (see [Verification](#verification)).

Open the page with `#example` (for example `index.html#example` or `#example-rpl`) to load
synthetic example data.

## What the dashboard shows

| Tab | Content |
| --- | --- |
| Overview | One row per reproduction (KTU, RBO, RMSE, ER, ΔRI, p-values) and the ER–ΔRI plot |
| Ranked lists | KTU and RBO per topic and by ranking depth (reproducibility) |
| Topic scores | Original vs. reproduced score per topic, RMSE/nRMSE per measure and by cutoff (reproducibility) |
| Effects | Average retrieval performance, effect ratio and ΔRI per measure |
| Significance | Paired (reproducibility) or unpaired (replicability) t-tests per measure |
| Export | The text report of `python -m repro_eval`, JSON and CSV downloads |

An experiment has one original baseline run, an optional original advanced run and any number of
reproductions (or replications), each with a baseline and an optional advanced run. ER and ΔRI
need advanced runs. Every chart can be shown as a table and downloaded as SVG, PNG or CSV.

### Input formats

- Runs: `topic Q0 docid rank score tag`, six whitespace-separated columns. The rank column is
  ignored; documents are ranked by score with trec_eval's tie-breaking.
- Qrels: `topic iteration docid relevance`, four columns, integer labels. Negative labels mark
  documents that were pooled but not judged (used by infAP and bpref).
- Lines starting with `#` (for example [ir_metadata](https://www.ir-metadata.org/) annotations)
  and blank lines are skipped. Files may be gzip-compressed.

## How results relate to repro_eval

The dashboard computes what `RpdEvaluator` / `RplEvaluator` compute after `trim()` and
`evaluate()`:

1. Ties in a run are broken like trec_eval (equal scores ordered by descending document id),
   then every topic is cut to the run length (default 1000).
2. The 58 measures of `repro_eval.util.load_measures()` are computed per topic, as
   `ir_measures`/`pytrec_eval` do: topics in the qrels without results score 0, topics without
   judgements are ignored.
3. KTU, RBO, RMSE, nRMSE, ER, ΔRI and the t-tests follow `repro_eval.measure` and SciPy
   (`ttest_rel`, `ttest_ind`); means use NumPy's pairwise summation, so ARP, ER and ΔRI agree to
   the last bit in most cases.

Measures can be named as in repro_eval (ir_measures: `P@10`, `nDCG`) or as in trec_eval
(`P_10`, `ndcg`). Tables and the text report list them in repro_eval's order.

Where the Python package raises an error, the dashboard continues and explains what it did in the
"notes about the input": topics present in only one of two compared runs are skipped (KTU, RBO,
RMSE, paired t-test), and KTU of two rankings with a different number of documents compares their
common top part (`scipy.stats.kendalltau` requires equal lengths).

### Interpolated precision and trec_eval versions

`iprec_at_recall` converts a recall level into a number of relevant documents. trec_eval 9 (and
pytrec_eval, which repro_eval uses) computes `(long)(level * num_rel + 0.9)`. On ARM CPUs (Apple
Silicon, aarch64 Linux) the compiler fuses this multiply-add into one instruction, which changes
the result for some topics at the levels 0.3 and 0.7 (for example with 3, 23 or 57 relevant
documents), so repro_eval itself gives slightly different `IPrec@0.3`/`IPrec@0.7` on different
machines. trec_eval 10 uses `lround` instead. The settings offer all three variants; the default
matches pytrec_eval on x86-64 (Linux servers, Colab, CI). No other measure is affected.

## Design decisions

**trec_eval: a TypeScript port, not WebAssembly.** repro_eval needs 16 of trec_eval's measure
families. Porting those is about 400 lines of TypeScript, each function a transcription of the
corresponding C file with the same order of floating-point operations. Compiling trec_eval to
WebAssembly would have meant an Emscripten toolchain for every contributor, a second language in
the code base, an opaque binary embedded in the page and a C shim to obtain full-precision values
(the command-line tool prints four decimals). trec_eval changes rarely, and the port is pinned to
it by tests generated with the real trec_eval (C) and pytrec_eval, so the port keeps WebAssembly's
main advantage, fidelity, without its costs. Should more trec_eval measures ever be needed, the
same pattern extends per measure.

**repro_eval: a TypeScript port.** Running the Python package in the browser (Pyodide) would add
tens of megabytes of NumPy, SciPy and pandas and still lack pytrec_eval. The repro_eval logic
itself is small; the port mirrors its modules in `src/core/repro-measures.ts`, and the statistics it
takes from NumPy and SciPy are reimplemented with the same algorithms in `src/core/stats.ts`.

**No runtime dependencies.** The charts are plain SVG (`src/ui/charts.ts`) and the UI uses the DOM
directly. The build has two development dependencies: TypeScript for type checking and esbuild for
bundling. Tests use Node's built-in test runner.

## Development

Requirements: Node.js 22.18 or newer (runs the TypeScript tests natively).

```sh
npm install
npm run check      # type check, tests, build
npm run build      # → dist/index.html
npm run watch      # rebuild on changes; open dist/index.html in a browser
```

```
src/core/          computation, no DOM
  trec-format.ts     run and qrels parsing
  measures.ts        the 58 measures and their names
  trec-eval.ts       port of the trec_eval measures
  stats.ts           NumPy/SciPy equivalents: pairwise mean, t-tests, Kendall's tau, incomplete beta
  repro-measures.ts  port of repro_eval (KTU, RBO, RMSE, nRMSE, ER, ΔRI, t-tests)
  experiment.ts      end-to-end evaluation of an experiment with several reproductions
  report.ts          text report (CLI layout), JSON, CSV
src/ui/            the dashboard (setup, results, charts, example data)
test/              tests and golden fixtures
scripts/           build and fixture generation
```

### Verification

`test/` compares the port with the reference implementations on deterministic synthetic data
covering ties, graded and negative labels, unjudged and unretrieved documents, short and long
rankings and non-ASCII document ids:

- per-topic scores of all 58 measures against `repro_eval.util.evaluate_run` (pytrec_eval) and
  against trec_eval 10 (C) for both `iprec_at_recall` variants,
- KTU, RBO, RMSE, nRMSE, ER, ΔRI, p-values and ARP against `RpdEvaluator` / `RplEvaluator`,
- the text report line by line against `python -m repro_eval`,
- means bit for bit against NumPy, t-tests, Student t p-values, Kendall's tau and ln Γ against SciPy.

The fixtures are generated by the reference software itself:

```sh
python3 -m venv .venv
.venv/bin/pip install numpy scipy pandas tqdm ir-measures pytrec_eval_terrier
git clone https://github.com/irgroup/repro_eval
git clone https://github.com/usnistgov/trec_eval
.venv/bin/python scripts/make_fixtures.py --repro-eval ./repro_eval --trec-eval ./trec_eval
```

The script records the machine architecture, and the tests select the matching
`iprec_at_recall` variant.

## Deployment

`.github/workflows/pages.yml` type checks, tests and builds every push and pull request, and
deploys `dist/` to GitHub Pages from `main`. Enable it once under *Settings → Pages → Build and
deployment → Source: GitHub Actions*. Commit the `package-lock.json` created by `npm install` so CI
installs the same versions.

## Citation

If you use the measures, please cite repro_eval and the paper that introduced them (as in repro_eval's README):

```bibtex
@inproceedings{10.1007/978-3-030-72240-1_51,
    author = {Timo Breuer and Nicola Ferro and Maria Maistro and Philipp Schaer},
    title = {repro{\_}eval: {A} Python Interface to Reproducibility Measures of System-Oriented {IR} Experiments},
    year = {2021},
    publisher = {Springer},
    doi = {10.1007/978-3-030-72240-1\_51},
    booktitle = {Advances in Information Retrieval - 43rd European Conference on {IR} Research, {ECIR} 2021, Virtual Event, March 28 - April 1, 2021, Proceedings, Part {II}},
    pages = {481--486},
    series = {Lecture Notes in Computer Science}
}

@inproceedings{10.1145/3397271.3401036,
    author = {Breuer, Timo and Ferro, Nicola and Fuhr, Norbert and Maistro, Maria and Sakai, Tetsuya and Schaer, Philipp and Soboroff, Ian},
    title = {How to Measure the Reproducibility of System-Oriented IR Experiments},
    year = {2020},
    publisher = {Association for Computing Machinery},
    address = {New York, NY, USA},
    doi = {10.1145/3397271.3401036},
    booktitle = {Proceedings of the 43rd International ACM SIGIR Conference on Research and Development in Information Retrieval},
    pages = {349–358},
    series = {SIGIR '20}
}
```

The trec_eval measures are derived from trec_eval by Chris Buckley and the National Institute of
Standards and Technology; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
