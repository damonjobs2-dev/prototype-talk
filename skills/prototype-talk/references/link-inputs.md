# Link inputs: evidence and completion rules

Use `scripts/doctor.mjs --link <URL>` first. The output separates link recognition from successful access. Do not describe a link as fully supported until the actual page or design file has been inspected and a review artifact has been produced.

| Input | Available evidence | Access check | Current completion boundary |
| --- | --- | --- | --- |
| Figma Design or Prototype file URL | Design nodes, text, bounds and prototype interactions when file content is readable; runtime clicks if the prototype opens | Figma file permission plus `file_content:read` token or a connected Figma tool | `figma-import.mjs` writes node evidence; a model review and interactive viewer for this evidence still need validation on a real file |
| Published `*.figma.site` | Browser DOM, visible text, layout and before/after interaction observations | Open in a browser and test representative controls | Browser evidence only; no claim about original design layers, source code, or production interfaces |
| Axure Cloud/RP share link | Browser interaction; if Inspect is available, widget positions, styles and text | Open the share link and check Inspect in the prototype player | Browser/Inspect evidence only until tested with a real Axure link; request exported HTML if a fuller source view is needed |

For a browser-only link, use the browser skill to record: page URL and title; visible regions, controls and fields; before/action/after for representative interactions; and a screenshot when layout matters. Save a capture JSON with `url`, optional `provider`, and `pages: [{ title, url, visible_regions, interactions: [{ control, action, before, after }] }]`. Run `node scripts/browser-evidence.mjs --file <capture.json> --out <result-directory>` to create `inputs/browser-observations.json` and `link-evidence.md`. Keep source/document/observed evidence separate. For every claim, store a page or node reference and identify it as browser observation, design structure, PRD requirement, or proposal. If a link is inaccessible, requires a code, or the Inspect view is unavailable, report the exact missing access and stop short of claiming a complete output. PRD and Mock files remain separate input evidence; a matching label alone does not prove data flow or an API.

The full Prototype Talk experience requires an interactive review beside the original prototype. For remote pages, the current local source server does not provide that overlay. Until the remote viewer is implemented and tested, deliver an evidence bundle and a clearly marked partial review, and keep this limitation visible to the user.

Primary references: [Figma file endpoints](https://developers.figma.com/docs/rest-api/file-endpoints/), [Figma scopes](https://developers.figma.com/docs/rest-api/scopes/), [Axure Inspect](https://docs.axure.com/axure-cloud/reference/inspect/), [Axure RP sharing](https://docs.axure.com/axure-rp/reference/viewing-sharing-prototypes/).
