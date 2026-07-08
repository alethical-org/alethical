# Coding-discipline rules

How to approach writing and changing code in this repo. Adapted from [Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876) on common LLM coding mistakes (source: [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills), MIT). Machine-facing; a human-facing counterpart in `CONTRIBUTING.md` can follow if the team wants one.

**Tradeoff:** these bias toward caution over raw speed. For trivial changes, use judgment.

1. **Think before coding.** Don't assume silently. State assumptions; when multiple interpretations exist, surface them rather than picking one quietly; push back when a simpler approach exists; stop and name what's unclear when genuinely confused. This is about surfacing *real* ambiguity and tradeoffs — not gating routine, reversible work (small PRs, direct spec edits, filing issues at the moment of discovery) behind approval. Those autonomy norms stand; this rule sharpens them, it doesn't reverse them.

2. **Simplicity first.** Ship the minimum code that solves the problem. No features beyond what was asked, no abstractions for single-use code, no speculative flexibility, no error handling for impossible cases. If 200 lines could be 50, rewrite it. The test: would a senior engineer call this overcomplicated?

3. **Surgical changes.** Touch only what the task requires. Don't "improve" adjacent code, refactor what isn't broken, or restyle to taste — match the surrounding code even where you'd do it differently. Remove only the imports/variables/functions your own change orphaned; flag pre-existing dead code rather than deleting it unasked. Every changed line should trace to the request.

4. **Goal-driven execution.** Turn a task into a verifiable goal before starting: "add validation" → "write tests for invalid inputs, then make them pass"; "fix the bug" → "write a failing test that reproduces it, then make it pass"; "refactor X" → "ensure tests pass before and after." For multi-step work, state a brief plan with a verification check per step. Strong success criteria let you loop to done without constant check-ins; weak ones ("make it work") force needless clarification.
