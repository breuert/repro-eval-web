# Third-party notices

## trec_eval

`src/core/trec-eval.ts` is a derivative work of trec_eval
(<https://github.com/usnistgov/trec_eval>), developed by Chris Buckley and the
National Institute of Standards and Technology (NIST).

Changes: on 2026-11-18, the computation of the measures `P`, `recall`, `ndcg`,
`ndcg_cut`, `map_cut`, `set_map`, `set_P`, `set_relative_P`, `set_recall`, `set_F`,
`Rprec`, `infAP`, `bpref`, `recip_rank`, `map` and `iprec_at_recall`, and of
`te_form_res_rels`, was translated from C to TypeScript. The command-line interface,
file handling, averaging and all other measures were not translated. Measure
parameters are fixed to trec_eval's defaults; `iprec_at_recall` can follow trec_eval 9
or 10.

The license of trec_eval:

> The code for the original trec_eval, up to version 9, are Copyright (C) 2008 Chris Buckley. Significant modifications have been done by Ian Soboroff as an employee of NIST. Other modifications and ongoing support are by Ian Soboroff and other contributors on https://github.com/usnistgov/trec_eval. trec_eval is now made available under the following license.
>
> NIST-developed software is provided by NIST as a public service. You may use, copy, and distribute copies of the software in any medium, provided that you keep intact this entire notice. You may improve, modify, and create derivative works of the software or any portion of the software, and you may copy and distribute such modifications or works. Modified works should carry a notice stating that you changed the software and should note the date and nature of any such change. Please explicitly acknowledge the National Institute of Standards and Technology as the source of the software.
>
> NIST-developed software is expressly provided "AS IS." NIST MAKES NO WARRANTY OF ANY KIND, EXPRESS, IMPLIED, IN FACT, OR ARISING BY OPERATION OF LAW, INCLUDING, WITHOUT LIMITATION, THE IMPLIED WARRANTY OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AND DATA ACCURACY. NIST NEITHER REPRESENTS NOR WARRANTS THAT THE OPERATION OF THE SOFTWARE WILL BE UNINTERRUPTED OR ERROR-FREE, OR THAT ANY DEFECTS WILL BE CORRECTED. NIST DOES NOT WARRANT OR MAKE ANY REPRESENTATIONS REGARDING THE USE OF THE SOFTWARE OR THE RESULTS THEREOF, INCLUDING BUT NOT LIMITED TO THE CORRECTNESS, ACCURACY, RELIABILITY, OR USEFULNESS OF THE SOFTWARE.
>
> You are solely responsible for determining the appropriateness of using and distributing the software and you assume all risks associated with its use, including but not limited to the risks and costs of program errors, compliance with applicable laws, damage to or loss of data, programs or equipment, and the unavailability or interruption of operation. This software is not intended to be used in any situation where a failure could cause risk of injury or damage to property. The software developed by NIST employees is not subject to copyright protection within the United States.

## repro_eval

`src/core/repro-measures.ts` and `src/core/experiment.ts` are a TypeScript port of
repro_eval (<https://github.com/irgroup/repro_eval>), translated on 2026-11-18.

> MIT License
>
> Copyright (c) 2020 Timo Breuer, Nicola Ferro, Maria Maistro, Philipp Schaer
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

The Cephes routines in `src/core/stats.ts` (incomplete beta integral) follow
Stephen L. Moshier's Cephes Math Library, as distributed with SciPy (BSD-3-Clause).
