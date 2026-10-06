# Portable Paradigm evidence, 6 October 2026

This folder supports the parent research summary. It contains 5 bounded context tests, 2 positive/negative import-rule pairs, and 1 package-name collision control. It is evidence from local, non-AI runs. It does not establish better expert judgment or engineer-time savings.

## Contents

- pins.json: exact public source revisions, dates and history counts
- evaluation.json: measured counts, expected fixture relationships and observed limits
- timings.json: single-run elapsed machine seconds, without host paths or environment details
- fixtures/: tiny post-change inputs and their before/after patches, plus import-rule controls
- outputs/: captured fixture results and selected historical result objects; 2 text searches have only their snapshot-folder prefix removed
- evidence-manifest.json: hashes, sizes and descriptions of transformations
- requirements.txt: exact installed package versions and public tools pinned to their tested Git revisions
- reproduce.py: creates a fresh scratch environment and repeats local runs

Historical excerpts preserve captured object values. They are explicitly partial, and the original full-output hashes are recorded. No large source snapshots, vendor source trees or private pull request bodies are bundled. Expected fixture relationships were not supplied to the tools. The historical patches are already-corrected revisions with regression tests, so their results measure retrospective context coverage, not prediction of the original bugs.

## Repeat the comparison

Requires Python 3.12 or newer, Git and ripgrep. Public package downloads require network access. The script does not load API keys or enable AI analysis. It installs packages into the supplied scratch folder and reads Alethical's Git history without changing files or refs. Use a new scratch folder outside Alethical.

The Alethical clone must already contain these exact revisions and their parents:

- 63c7a1dfd0729f65d6871eeb70b789cbcd9e879a
- 2aa30d3fb06377361dd10decf9d3397e8c93a8aa

Run from this evidence folder, replacing the 2 placeholders with your folders:

```sh
python3 reproduce.py --alethical-root '<Alethical clone>' --scratch '<new scratch folder>'
```

Outputs and new timings land inside the new scratch folder. The script expects exit 1 on positive forbidden-import controls and cycle reports; those exit codes are findings rather than setup failures. Every blast-radius run uses --no-ai. Its printed PASS is an unconditional no-AI value and is not a safety verdict.

The historical snapshots include alethical/, apps/frontend/src/, apps/frontend/scripts/, apps/frontend/tsconfig.json, scripts/, docs/, .gitignore and pyproject.toml. Other tracked and untracked content is excluded. The matched-name search uses changed names returned by the parser, without expected caller names. The raw search and structured context differ in detail, so command seconds are not engineer-time savings.

## Source and license scope

The tested blast-radius-cr and code-governance revisions declare MIT licensing. Preserve their notices when adopting code. The skill_a_thon revision has no LICENSE file; its setup description was read, and its hosted service was not run. This bundle adopts no vendor code into Alethical and makes no hosted-service performance claim.
