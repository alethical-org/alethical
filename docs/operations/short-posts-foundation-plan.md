# Short posts foundation delivery plan

[Issue 2377](https://github.com/alethical-org/alethical/issues/2377) owns this work. The approved product decisions are in [published-writing-decisions.md §7](../architecture/published-writing-decisions.md#7-short-posts-from-checked-social-material). The existing task “social posts seo” owns drawing review and acceptance before merge.

## Boundaries

- Build only nonvisual foundations. Keep new public routes, `/read` layout changes, article and chart layouts, comments, and real articles out of this change. Both published-writing registries reject Short posts until the public layout can show their evidence and disclosures.
- Keep provisional claims and source copies private. Never commit the 2 supplied posters or a draft needing privacy to the public repository.
- Preserve existing published articles and the publication/indexing distinction that currently governs them.

## Sequence and checks

1. Record the product decisions in the owning writing requirements. Check against the approved Research/Guide address and source rules. **Done.**
2. Add a scoped Short post editorial record and prepublication gate to the existing piece model. Test missing evidence, coverage, method, unresolved claims, calculations, and approvals. **Done; focused tests pass.**
3. Add shared deterministic percentage, comparison, and overlap calculations, with focused failure tests. **Done; focused tests pass.**
4. Add controlled topics, stable newest-first selection, deduplication, related reading, and pagination. Test title changes, timestamp ties, and corrections. **Done; focused tests pass.**
5. Connect the gate to published-registry entry and check public article, metadata, search, and sitemap paths exclude drafts. Preserve existing output. **Done; current public routes, full frontend tests, lint, and production build pass.**
6. Investigate the 2 supplied graphics privately, record what held and official sources establish, and keep uncertainty explicit. **Initial investigation done in a private local inventory; unresolved source-version and party-mapping claims remain held.**
7. Run focused and repository checks, send the coordinating task the review package, apply its findings, then merge, deploy, and check live regressions. **Full checks done; pull request 2380 is under coordinating review, with its findings corrected locally. Merge and live check remain held for acceptance.**

## Next decision boundary

The public Short posts, topic, chart, and article screens wait for accepted drawings and Eugene's separate build instruction. Publishing any individual article requires another explicit instruction.
