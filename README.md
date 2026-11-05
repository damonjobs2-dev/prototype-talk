# Prototype Talk

Prototype Talk is a local agent Skill that explains a runnable Web prototype **beside the prototype itself**. It connects the visible UI, source code, PRD/Mock, and recorded interactions to product explanations, technical drafts, evidence, and review tasks. On first use, it asks which interpretation mode and data scope you authorize: the current conversation model, optional Codex CLI automation, or local indexing only.

> Experimental release. Generated explanations and API contracts are drafts until a product or engineering reviewer confirms them.

## What it does

- Shows a floating review panel while the original Demo remains interactive.
- Explains the selected page, dialog, field, or operation; records corrections and missing rules in `docs/prototype-talk/` inside the Demo project.
- Separates PRD requirements, Demo source, actual browser observations, and technical proposals. The product, technical, evidence, and review views use the same saved state.
- Exports requirement and technical handoff documents with each review item's confirmation status.
- Uses the model in the current conversation to write cards while the chat is active. Codex CLI is optional when cards must keep generating after the chat ends; it is not required to use the Skill.

The complete local workflow supports runnable HTML/JavaScript and React JSX/TSX Web demos with related PRD or Mock material. Vue SFC parsing is not yet supported. Figma Design, published Figma Sites, and Axure links currently provide **partial evidence review**; they do not yet receive the full interactive local-source viewer or prove a production API.

## Install

If your GitHub CLI supports skill installation:

```bash
gh skill install damonjobs2-dev/prototype-talk prototype-talk --agent codex --scope user
```

Or clone this repository and copy the entire `skills/prototype-talk` directory into the Codex skill directory used by your installation. Keep `SKILL.md`, `scripts/`, `assets/`, `references/`, and `agents/` together. Start a new Codex session, then invoke `$prototype-talk` with the Demo directory and related requirements.

## Local preview

Node.js is required. When invoked as a Skill, it confirms the mode and data scope before starting model interpretation. The following are manual commands for the **current conversation** option after that authorization; run them from the repository root and replace `/path/to/demo`:

```bash
node skills/prototype-talk/scripts/doctor.mjs --source /path/to/demo
node skills/prototype-talk/scripts/server.mjs --source /path/to/demo --port 4179
```

Open the URL printed by the server. The default mode queues page and operation tasks for the model in the **current conversation**. In that conversation, the Skill claims a scoped task, produces the structured explanation and writes it back; the floating panel updates from saved results. No Codex CLI is required. Run `node skills/prototype-talk/scripts/conversation-task.mjs next --source /path/to/demo --port 4179 --output /tmp/prototype-task.json` to inspect the handoff; submit results with the same script's `submit --file` command as described in [conversation-model.md](skills/prototype-talk/references/conversation-model.md). The Skill normally performs those commands for the user.

For automatic processing even after the current chat ends, use the optional Codex CLI mode after confirming its ChatGPT/Codex destination and the project-data scope. That scope can include relevant source code, PRD, Mock, and recorded interactions with input changes and before/after page states. The local output folder does not imply that model analysis stays on device. An installed and signed-in Codex CLI is needed only for this optional mode.

On first use for a project, the Skill proactively asks one question combining the interpretation mode and the exact data authorization: current conversation, Codex CLI if available, or local index only. It reuses authorization already given in the conversation for the same project, destination and scope. The flag below is passed by the Skill to its local server after CLI authorization; it is not a setting you must choose for every control in the browser.

```bash
node skills/prototype-talk/scripts/server.mjs --source /path/to/demo --port 4179 --cli-model --model-authorized
```

The server binds to `127.0.0.1`. It does not require `npm install` or `esbuild` at runtime. See [SKILL.md](skills/prototype-talk/SKILL.md) for the complete workflow and [link input limits](skills/prototype-talk/references/link-inputs.md) for Figma/Axure.

`--index-only` remains available when only local indexing and existing saved cards are wanted. Browser clicks in the default conversation mode remain queued after the chat ends and are resumed on the next Skill invocation; they cannot awaken a closed chat on their own.

The generated `docs/prototype-talk/viewer/` is a copy of the Skill's runtime at export time. After updating the Skill, restart it against the Demo to refresh that viewer before sharing the Demo with someone else.

## Before sharing a release

Run `python3 scripts/verify-release.py` from the repository root. It creates `dist/prototype-talk.zip`, unpacks it into a temporary directory, scans HTML/JavaScript and built JSX demos, starts each Skill viewer, removes the installed Skill, and starts each exported standalone viewer. Share the ZIP only after this check passes. Python is needed for this release check, not for normal Skill use.

The same unit and package checks run on GitHub Actions for Node.js 20, 22, and 24 whenever this repository is pushed or changed through a pull request.

## Review data and licenses

Review state and generated documents belong to the Demo project at `docs/prototype-talk/`. Check them before sharing a Demo repository: even masked input recordings and evidence excerpts may reveal project details. Do not publish a project's generated review folder without reviewing it.

Original Prototype Talk code is licensed under the [MIT License](LICENSE). The bundled `@medv/finder` and Babel parser retain their own license notices at `assets/finder.LICENSE` and `scripts/vendor/babel-parser/LICENSE`.
