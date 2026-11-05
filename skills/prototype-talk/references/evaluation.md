# Evaluate Prototype Talk output

Use this protocol when changing generation, validation, or model-review behavior. It is not a required step for ordinary use.

## Frozen cases

Select several independent Web demos, including at least one project that did **not** shape the current rules. For each, freeze the source, PRD/Mock, logical page, operation preconditions, actual interaction record, and expected evidence. Include page layout, a field state/source, a verifiable action, and a cross-page or cross-module effect. Product and engineering reviewers define reference facts and major-error criteria before seeing generated cards.

Test that a page, named dialog, tab, form, repeated row/item, and same-label controls bind to the right card after navigation, reload, and row reorder. Record correct matches, wrong matches, unresolved controls, and time spent locating them. A lower unresolved count is not an improvement if wrong matches increase.

## Generation versus independent review

For each frozen case, run the first model interpretation **once** and save its evidence pack and draft. Compare:

- **A:** that same draft after program checks.
- **B:** the same checked draft after an independent model identifies unsupported claims, contradictions, and concrete edits; check its citations again.

Keep model configuration, prompt version, evidence pack, and initial draft fixed. Blind the A/B labels for human reviewers. Allow the reviewer model to say “uncertain”; it may not overwrite confirmed human rules or invent an API to complete a table.

## Measure

Score atomic claims for correctness, evidence support, important omissions, unsupported formal API details, useful questions, duplicate questions, and PRD/Demo discrepancies. Have product and engineering reviewers amend a card until usable and record their actual editing time. Report first usable card time, full completion time, model time, failures and retries separately.

Enable an independent review by default only if it reduces serious errors or human editing time enough to justify its additional latency. Otherwise use it selectively for high-risk claims, such as disputed requirements, cross-module effects, or formal API assertions. A valid file path or schema is not proof of semantic correctness.
