---
name: browser-user-test
description: Run an end-to-end browser test of Alethical as a real user — after a feature lands, on demand ("browser-test this", "drive the app", "test it like a user"), or before calling frontend work done. Spawns a FRESH-context agent on a cheap model that knows nothing about the implementation, drives the running app through a browser in scripted user stories or free exploration, and reports what breaks. Also owns the on-demand Playwright checks (just e2e) and the path from a stable story to a Playwright spec.
---

# Browser-test the app like a real user

## Purpose

Code-level tests prove functions; they cannot prove a first-time visitor can actually
search a bill and read it. This skill runs that proof on demand: an agent with **fresh
context** — it knows the product task, never the diff — drives the app in a browser and
reports what breaks. Fresh context is the point: an agent that knows the implementation
tests the diff; one that doesn't tests the product.

Two layers, both on demand (deliberately not wired into CI yet — that is a pending
decision, not an oversight):

1. **Agent-driven user tests** — a spawned agent follows the stories in
   [`stories.md`](stories.md) or explores freely, judging what a human would judge
   (is this readable? did anything dead-end?).
2. **Playwright checks** (`apps/frontend/e2e/`, run with `just e2e`) — fast scripted
   assertions graduated from stories that have proven stable, runnable against any
   host in 3 browser engines (Chromium, Firefox, WebKit — the Safari engine).

## When to run which

- **A frontend feature just landed** → run the agent-driven scripted stories that touch
  it, plus `just e2e` as the regression floor.
- **Before declaring a big frontend change done** → agent-driven exploration
  ("click around for ~20 minutes") on the changed area.
- **Quick regression check, no judgment needed** → `just e2e` alone.

## Running an agent-driven test

Spawn a subagent (the Agent tool) with **model `sonnet`** — driving a browser is
mostly mechanical, and the cheap tier keeps a 20-minute exploration affordable. The
brief must contain **no implementation detail**: no file names, no diff summary, no
"we changed X". Give it only:

- the persona and mindset: a first-time Minnesota resident, no political or technical
  background, arriving with a worry (see `docs/philosophy.md`, "Who we assume is reading");
- the mode: which numbered stories from [`stories.md`](stories.md), or an exploration
  charter ("spend ~20 minutes on <area>; follow your curiosity; note every dead end");
- the target host (see below) and the reporting format.

Report format the brief must ask for: for each problem — what the tester was trying to
do, what happened instead, the exact URL for an ordinary page, how bad it is (blocks the
task / confusing / cosmetic), and what a fix would look like from the user's side. An
authentication return never includes an exact URL; use the safe report below. Plus a
one-line verdict per story: passed / failed / passed-with-friction.

**Judging correctness:** an honest "no matches" or a refusal to answer is CORRECT
behavior when the data isn't there (`.claude/rules/grounded-answers.md` rule 1) — the
tester reports it as friction only if a real user would be misled, not as a bug per se.

## Sign-in safety hard line

- **A redirect allow-list check never completes sign-in.** Read the saved Supabase
  redirect list, or stop at the Google provider page before selecting an account. A
  successful OAuth return proves more than the allow-list and creates a real session,
  so it is the wrong test.
- **A real sign-in check proves the browser identity first.** Continue only in a fresh
  isolated browser profile with no signed-in Google account, or after the account chooser
  visibly names the saved Alethical test account (`alethicaldev@gmail.com`). Stop before
  selecting an account when neither fact can be proved. Never use a personal account.
- **The full authentication return address never enters task or tool output.** Do not ask
  a browser tool for the current URL after sign-in. Do not print, copy, paste, save, or
  type its query or fragment into a command. Cleaning it after retrieval is too late.
  Only clearly fake callback values inside the focused automated tests are exempt.
- **Code-driven browser checks report through the tested helper.** Import
  `safeAuthCallbackReport` from
  `apps/frontend/scripts/safe-auth-callback-report.mjs`, call it on the address in memory,
  and log only its result. It returns the origin, path, and booleans for private fields in
  the query and fragment. It recognizes `access_token`, `refresh_token`, `provider_token`,
  `provider_refresh_token`, `id_token`, `token_hash`, `token`, `code`, `code_verifier`,
  `state`, `nonce`, `otp`, `device_code`, `user_code`, `session_state`, and similarly
  named one-use values. It never returns any query, fragment, field name, or field value.
- **Interactive browser control computes the same 4-field report inside the page.** If
  the browser control cannot run page code without first returning the full address, stop
  before the callback. The inability to report a callback safely is a failed test, not a
  reason to expose it.

[Issue 1600, Prevent browser sign-in tokens from entering task output](https://github.com/alethical-org/alethical/issues/1600)
records why this is a hard line: on 2026-08-15, a redirect-list check completed Google
OAuth in a browser that was already signed into a personal account, then the browser tool
printed the full return address. No credential from that incident belongs in this file.

## Target hosts

- **Local dev server** (`just up` → http://localhost:19006) — for unmerged changes.
- **Vercel preview URL** — for an open PR.
- **Production** (https://alethical.com) — for read-only stories only. **Never sign in,
  submit, track, or write anything on production during a test.** And never test
  against alethical-web.vercel.app — it is a demo with fake data and not our account.

## Playwright checks

- Specs live in `apps/frontend/e2e/`; config in `apps/frontend/playwright.config.ts`.
- One-time setup per machine: `pnpm --dir apps/frontend exec playwright install`
  (downloads the 3 browser engines).
- Run: `just e2e` (Chromium), `just e2e firefox`, `just e2e webkit` — or all three:
  `pnpm --dir apps/frontend exec playwright test`.
- Target host: `E2E_BASE_URL` env var; defaults to the local dev server
  (http://localhost:19006). The committed specs are read-only, so pointing them at
  production is safe: `E2E_BASE_URL=https://alethical.com just e2e`.
- Vitest and Playwright are separate runners: `vitest.config.ts` excludes `e2e/**`,
  and `just test-frontend` never runs these.

## Graduating a story into a Playwright spec

When an agent-driven story has passed twice without wording churn on the screen it
tests, write it as a spec in `apps/frontend/e2e/` and record the spec filename in the
story's `Spec:` field in [`stories.md`](stories.md). Anchor on user-visible text and
roles, never on style or DOM structure; keep each spec independent and read-only.
Stories with judgment in them (is the summary *readable*?) stay agent-driven — a spec
can assert presence, not quality.

## What this deliberately does not do yet

Running these on every PR or merge is a **pending decision** (cost, flakiness policy,
and CI wiring), not a technical gap. Until it lands, this skill is the trigger:
frontend feature → run the stories. Component rendering and visual-regression testing
remain uncovered on purpose (see CONTRIBUTING.md, "Frontend tests").
