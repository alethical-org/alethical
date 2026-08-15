<!-- describes: pyproject.toml, .env.example, alethical/monitoring.py, alethical/logging.py, alethical/api/main.py, alethical/api/problems.py, alethical/api/auth.py, alethical/api/routers/me.py, alethical/pipeline/minnesota.py, alethical/pipeline/oban.py, apps/frontend/src/screens/LegalScreens.tsx -->

# Error monitoring

**Net:** Sentry emails the maintainer when a Minnesota import, Supabase sign-in check,
Anthropic or OpenAI answer request, or unexpected API request fails. Normal requests and
expected mistakes stay quiet. No question, message, account detail, request body, or log
line goes to Sentry.

## What is covered

| Failure | What appears in Sentry | What never appears |
| --- | --- | --- |
| Minnesota import failed | Error class, code stack, adapter, public target type and bill key; or one queue summary with failed-job counts | Downloaded response body and error sentence |
| Supabase sign-in service unavailable | Error class, code stack, safe route pattern, status 503 | Token, email address, account id, or provider reply |
| Anthropic or OpenAI answer request failed | Error class, code stack, provider name and public bill key | Question, answer, bill passages, key, or provider reply |
| Unexpected API error | Error class, code stack, request method, status, and route pattern | Real path values, query values, headers, body, account, or local variables |

A route pattern is the public shape of an address, such as
`/api/v1/me/chat-sessions/{chat_session_id}/messages`. It never contains the real
conversation id. Expected `4xx` responses, including a bad or expired sign-in token, do
not create events. Successful requests do not contact Sentry.

Sentry's automatic request, web-framework, logging, performance, session, metric, and
local-variable collection is off. Alethical sends only the failures above. Before each
event leaves the process, it removes any request, user, log message, extra field,
breadcrumb, exception sentence, and saved local variable a future caller could add.

## Why Sentry, not the other choices

Checked on 15 August 2026.

| Choice | Cost at Alethical's size | What it would mean | Decision |
| --- | --- | --- | --- |
| [Sentry Developer](https://sentry.io/pricing/) | $0, 5,000 errors a month, 30-day view, 1 user | Purpose-built error grouping, stack views, a dashboard, and email on each new issue | **Use this** |
| [PostHog Error Tracking](https://posthog.com/pricing) | $0 for 100,000 errors a month, 1-year retention | A much larger product and analytics system; its FastAPI setup needs manual capture anyway | Do not add a second broad data platform for this narrow job |
| [Railway logs and monitors](https://docs.railway.com/observability) | Logs are included; monitors require Pro | Railway monitors CPU, memory, disk, and network. It keeps logs but does not group and email application errors | Keep it for readable logs, not alerts |
| Build it inside Alethical | More Railway storage and maintainer time | We would own an error table, duplicate grouping, stack display, email rules, retention, cleanup, and a dashboard | Do not rebuild a standard service |
| Self-host OpenTelemetry | More running services and maintainer time | A collector, storage, dashboard, and alert engine would all need operating | Too much machinery for 1 maintainer |

Sentry is not Alethical's answer-quality record. It never receives model prompts,
questions, answers, bill passages, or full provider replies. Answer evaluation and the
evidence trail remain inside Alethical. Stale-data prevention is separate work in
[#800, which stops current-status answers when the source record is too old](https://github.com/alethical-org/alethical/issues/800).

## First setup

1. Sign into Sentry through Google with `alethicaldev@gmail.com`. Use organization
   `Alethical`, United States storage, the Developer plan, and 1 FastAPI project named
   `alethical-api`. Never connect a maintainer's personal Google or GitHub account.
2. Keep the project's default alert rule on. Sentry creates projects with email on every new issue unless that default is turned off.
3. Copy the project's client address from **Project Settings → Client Keys (DSN)**.
4. Add it to the Railway `alethical-api` service as `SENTRY_DSN`.
5. Let Railway release the current `main` commit again.
6. In a Railway shell for `alethical-api`, run `uv run python -m alethical.monitoring`.
7. Confirm 1 `monitoring / verification` event appears in Sentry and its email arrives.
8. Open the event and confirm it has no **Request**, **User**, **Breadcrumbs**, or local-variable values.

The client address can send events into that one Sentry project. It cannot read events,
change settings, or open the Sentry account. Keep it in Railway rather than the shipped
frontend so random browsers cannot fill the free allowance.

## During an incident

1. Open Sentry **Issues** and filter to `environment:production`.
2. Filter `alethical.area` to `ingestion`, `auth`, `chat`, or `server`.
3. Open the newest event and use its release, code stack, route pattern, and operation to find the failed code path.
4. Open Railway's `alethical-api` logs for the same time. Railway keeps the privacy-safe operational lines Sentry deliberately does not copy.
5. Fix and release the cause, then resolve the Sentry issue.
6. If the same failure returns, Sentry treats it as a regression and alerts again.

Sentry groups by the area and operation Alethical supplies, then by the error stack. The
same broken provider call should become 1 issue rather than 1 email per request.

## Turn it off

Remove `SENTRY_DSN` from Railway and release the service again. Alethical continues to
write the same privacy-safe Railway logs; it stops creating Sentry events. No code change
or database change is needed.
