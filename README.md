# Prototype Talk

Prototype Talk is a local Codex Skill for reviewing a runnable Web prototype **beside the prototype itself**. It connects the visible UI, source code, PRD/Mock, and recorded interactions to product explanations, technical drafts, evidence, and review tasks.

> Experimental release. Generated explanations and API contracts are drafts until a product or engineering reviewer confirms them.

## What it does

- Shows a floating review panel while the original Demo remains interactive.
- Explains the selected page, dialog, field, or operation; records corrections and missing rules in `docs/prototype-talk/` inside the Demo project.
- Separates PRD requirements, Demo source, actual browser observations, and technical proposals. The product, technical, evidence, and review views use the same saved state.
- Exports requirement and technical handoff documents with each review item's confirmation status.

The complete local workflow supports runnable HTML/JavaScript and React JSX/TSX Web demos with related PRD or Mock material. Vue SFC parsing is not yet supported. Figma Design, published Figma Sites, and Axure links currently provide **partial evidence review**; they do not yet receive the full interactive local-source viewer or prove a production API.

## Install

If your GitHub CLI supports skill installation:

```bash
gh skill install damonjobs2-dev/prototype-talk prototype-talk --agent codex --scope user
```

Or clone this repository and copy the entire `skills/prototype-talk` directory into the Codex skill directory used by your installation. Keep `SKILL.md`, `scripts/`, `assets/`, `references/`, and `agents/` together. Start a new Codex session, then invoke `$prototype-talk` with the Demo directory and related requirements.

## Local preview

Node.js is required. Run from the repository root and replace `/path/to/demo`:

```bash
node skills/prototype-talk/scripts/doctor.mjs --source /path/to/demo
node skills/prototype-talk/scripts/server.mjs --source /path/to/demo --port 4179 --index-only
```

Open the URL printed by the server. `--index-only` scans locally and shows preliminary facts or saved cards; it does not create new complete model explanations.

To generate page and operation explanations, run with `--model-parse` **after authorizing the configured ChatGPT/Codex destination and the specific project-data scope**. That scope can include relevant source code, PRD, Mock, and recorded interactions with input changes and before/after page states. The local output folder does not imply that model analysis stays on device. An installed and signed-in Codex CLI is needed for this mode.

```bash
node skills/prototype-talk/scripts/server.mjs --source /path/to/demo --port 4179 --model-parse
```

The server binds to `127.0.0.1`. It does not require `npm install` or `esbuild` at runtime. See [SKILL.md](skills/prototype-talk/SKILL.md) for the complete workflow and [link input limits](skills/prototype-talk/references/link-inputs.md) for Figma/Axure.

The generated `docs/prototype-talk/viewer/` is a copy of the Skill's runtime at export time. After updating the Skill, restart it against the Demo to refresh that viewer before sharing the Demo with someone else.

## Before sharing a release

Run `python3 scripts/verify-release.py` from the repository root. It creates `dist/prototype-talk.zip`, unpacks it into a temporary directory, scans HTML/JavaScript and built JSX demos, starts each Skill viewer, removes the installed Skill, and starts each exported standalone viewer. Share the ZIP only after this check passes. Python is needed for this release check, not for normal Skill use.

The same unit and package checks run on GitHub Actions for Node.js 20, 22, and 24 whenever this repository is pushed or changed through a pull request.

## Review data and licenses

Review state and generated documents belong to the Demo project at `docs/prototype-talk/`. Check them before sharing a Demo repository: even masked input recordings and evidence excerpts may reveal project details. Do not publish a project's generated review folder without reviewing it.

Original Prototype Talk code is licensed under the [MIT License](LICENSE). The bundled `@medv/finder` and Babel parser retain their own license notices at `assets/finder.LICENSE` and `scripts/vendor/babel-parser/LICENSE`.
