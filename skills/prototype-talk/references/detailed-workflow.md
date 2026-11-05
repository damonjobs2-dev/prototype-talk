# Prototype Talk review rules

Read this reference when implementing or reviewing a card, field, contract, or correction. The launch sequence and authorization boundary live in `SKILL.md`; this file describes how to judge the output.

## Locate the interaction

- Treat a route, query-driven screen, or hash-driven screen as a logical page when it shows a different task or data view. A single HTML entry can contain several logical pages.
- Identify the clicked control by page → named dialog/tab/form/section → repeated row/item → control label and stable attributes. The component catalogue chooses relevant questions; it does not identify a rendered instance. Temporary CSS selectors are only current-page hints.
- Keep **where the click occurred** separate from **what changed afterward**. Navigation can affect the whole destination page, opening a dialog affects that dialog, switching a tab affects its panel, and focusing a field concerns that field. Record the observed destination region and its visible fields.
- If two controls still share an identity, leave the operation pending location. Do not attach an existing card by label, position, generated ID, or a stale selector alone.

## Write the product explanation

For a page, show its purpose, visible layout and regions, default state, available tasks, displayed data, and important empty/loading/error states. For an operation, make the first sentence state the goal and result. Then show only applicable facts: trigger and prerequisites, affected object or area, immediate feedback, validation, downstream change, and acceptance result. Distinguish a source-predicted result from an observed click result.

Keep the panel scannable. Put file paths, line numbers, and quoted evidence in the Evidence view. Let a reviewer correct or supplement a fact in place; save that fact as a versioned rule and update generated documents from the same record. A model may flag a conflict with a confirmed rule but must not silently overwrite it.

For an editable empty input, the current value is user-entered; ask about validation, write destination, or downstream effect only where needed. For a prefilled or read-only field, show editability and trace its displayed value when the source supports it. For a dropdown, distinguish the source of the option list, the selected value, and the records subsequently filtered. Use component-specific questions; a selection control does not need submit success/rollback questions.

## Write the technical explanation

Present front-end layout and state handling, the shared client/server interface contract, and back-end data or processing rules as separate concerns. A single request has one contract shown to both sides, not duplicate “front-end” and “back-end” APIs.

The contract first states purpose, method and path, then request and response field rows, then authentication, errors, and open decisions. Prototype-visible fields become fixed UI requirements; reviewers may map them to request/response JSON paths and add API-only fields such as IDs. They may not delete or rename a prototype-visible field from the contract editor; that requires changing the prototype. A page query contract and a write-operation contract remain distinct.

Mock values, local storage and source bindings establish Demo behavior. They do not establish a production service, database table, endpoint, field type, or authorization rule. Mark these as proposals until an actual contract, service source, or technical reviewer confirms them. Keep read/write evidence and cross-page relationships explicit rather than inferring a link from similar field names.

## Reconcile evidence and review status

- Compare PRD requirements, Demo source, actual browser observation, and confirmed user rules as separate origins. A PRD/Demo contradiction is a discrepancy with both sides cited; it is not a product-choice question. Missing operation evidence is a test gap. An unspecified formal API is a technical gap.
- Check whether a cited source location exists **and** whether it supports the specific claim. For submit operations, inspect validation and write branches before claiming success, failure, or a data effect. Schema and path checks alone cannot prove meaning.
- A returned model card is ready for review, not approved. Show queued, running, failed, stale, pending, confirmed, and rejected states without substituting invented content. Preserve failed traces for targeted retry.
- Source or document changes should make affected conclusions stale. Keep human rules and API edits for review, but do not present them as revalidated against the new prototype until checked.

## Coverage and performance

Keep component families and their question templates in `scripts/component-catalog.mjs`. Research an unknown component once per signature and add a reusable matcher only when its behavior is supported by markup, documentation, or observation. Do not add a project name as a universal component rule.

Report the first usable page/card time separately from the full queue time with `scripts/metrics.mjs`. Group page work; interpret operations when opened or requested. A separate model review is optional and should be justified by the evaluation in `references/evaluation.md`, not imposed on every card.
