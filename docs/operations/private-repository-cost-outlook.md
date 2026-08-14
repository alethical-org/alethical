# Private repository cost outlook

Point-in-time decision record, verified 2026-08-11. Prices and access counts can
change, so re-check the linked service screens before buying anything.

## Recommendation

Keep the repo public until all 3 regular code authors have paid Vercel access,
the 2 collaborators without two-step login have enrolled, and the GitHub Actions
budget is raised from $0. Then make the repo private with GitHub Team and GitHub
Secret Protection in the same change window.

Private without paid secret protection is cheaper, but it trades GitHub's
before-push block for a free check that runs after the secret has already reached
GitHub. That is a useful backstop, not equal protection.

## Current access count

- 3 organization members: `adagradschool`, `euglopi`, and `jfleish`.
- 3 outside collaborators: `joelethical`, `Myahmyahmeow-cat`, and
  `TheRoyalTnetennba`.
- A private repo bills all 6 people as GitHub Team seats while they keep access.
- The estimate below assumes only 3 people push code. If more people push, GitHub
  Secret Protection and Vercel can both need more paid seats.

## Current public-repo cost

- $20/month for repo collaboration and frontend hosting. Railway, Supabase, and
  other existing Alethical services are outside this comparison.
  - $20 Vercel Pro, including 1 deploying seat and $20 of use credit.
  - $0 GitHub plan.
  - $0 GitHub Actions because public-repo jobs are free.
  - $0 GitHub secret scanning and push protection because the repo is public.

The Vercel cleanup saves about $3.79/month of build credit at the current pace.
It does not lower the $20 invoice while total Vercel use stays inside the included
credit.

## Private-repo monthly estimate for 3 code authors

- $173.59/month with today's 6 GitHub users and paid secret protection.
  - $24 GitHub Team for 6 people at $4 each.
  - $57 GitHub Secret Protection for 3 active code authors at $19 each.
  - $60 Vercel Pro for 3 people who can deploy at $20 each.
  - $32.59 projected GitHub Actions overage after the cleanup.
- $161.59/month if the 3 outside collaborators are removed before the switch.
  - $12 GitHub Team for 3 people at $4 each.
  - $57 GitHub Secret Protection for 3 active code authors at $19 each.
  - $60 Vercel Pro for 3 people who can deploy at $20 each.
  - $32.59 projected GitHub Actions overage after the cleanup.

Secret Protection bills anyone who pushed a commit during the last 90 days. If
all 6 users push, that line becomes $114/month and the 6-seat total becomes
$230.59/month.

### Strongest free secret-scanning option

- $116.59/month with today's 6 GitHub users and no paid Secret Protection.
  - $24 GitHub Team.
  - $60 Vercel Pro for 3 deploying people.
  - $32.59 projected GitHub Actions overage.
- $104.59/month with only 3 GitHub users and no paid Secret Protection.
  - $12 GitHub Team.
  - $60 Vercel Pro for 3 deploying people.
  - $32.59 projected GitHub Actions overage.

The free version is now implemented in `ci.yml`. TruffleHog checks every PR and
`main` push for confirmed live credentials and candidates it could not verify.
Only its Lob check is off: Alethical has no Lob account or code, and Lob's key
shape also matches ordinary Python test names. Every other check stays on.
A separate full-history scan checked 1,298 revisions and about 74 MB, finding 0
verified secrets. Its 297 warnings were all package-download hashes in `uv.lock`.

What the free version lacks:

- It runs after a push, so a secret reaches GitHub before the check can fail.
- It does not block a push inside the Git client or GitHub page.
- It does not cover every unverified secret-like value because doing so makes the
  package lock file fail on hundreds of download hashes.
- It does not provide GitHub's bypass records, partner alerts, or one security
  screen that tracks the finding through cleanup.

Paid Secret Protection is the stronger choice for a private repo. The free check
is worth keeping as a second scanner because different scanners miss different
patterns.

## GitHub Actions history and forecast

- July 2026: 3,840 rounded Linux minutes, worth $23.04 if private.
- August 1 through 11: 4,375 minutes, worth $26.25 if private.
  - August used 14% more minutes in 11 days than all of July.
  - Main received 322 merges in those 11 days, or 29.3/day.
  - July received 567 merges, or 18.3/day.
  - The merge pace rose 60%, and each change often runs tests once on the PR and
    again after merge.
- August straight-line pace before cleanup: about 12,330 minutes, worth $73.98.
- August forecast after measured cleanup: about 8,431 minutes.
  - The GitHub Team plan includes 3,000 private-repo minutes.
  - About 5,431 extra minutes at $0.006 each cost $32.59.
- Canceling outdated PR runs can save up to another 180 minutes, or $1.08, but
  the estimate keeps that saving as safety room.

The increase came from more feature changes plus more safety work per change.
Late July added frontend tests, document-link checks, document-sync checks, NUL
byte checks, package-declaration checks, and database-schema checks. Those checks
protect real failure paths. The waste was running a second 1-minute documentation
job on every change and releasing the same frontend commit twice.

The cleanup removes about 3,899 projected monthly minutes, or 32% of the
straight-line August pace. Canceling replaced PR runs can lift the avoidable share
to about 33%.

Every additional 1,000 private Linux minutes costs about $6. If the cleaned job
volume doubles as the team and feature pace grow, Actions overage becomes about
$83.17/month instead of $32.59/month.

## What each paid job does

GitHub charges by the rounded minute for every job on a hosted Linux computer.
There is no separate fee for the job name.

- `changes`: decides which tests are needed, checks document links and changed
  behavior notes, rejects hidden NUL bytes, and scans new commits for secrets.
- `backend`: checks Python formatting, types, declared packages, database changes,
  and server behavior.
- `frontend`: checks TypeScript, formatting, 728 web tests, and the production web
  build.
- `migrate`: applies reviewed database changes to production after merge.
- `railway-deploy`: releases server changes to Railway after merge.
- `vercel-deploy`: hand-run frontend fallback when GitHub Actions is available.
  Normal releases come directly from Vercel's Git connection.
- `vote-backfill`: imports newly recorded roll-call votes each day.
- `bill-section-gaps`: checks each day that a bill page did not publish missing
  sections.
- `rag-coverage-gaps`: checks each day that every stored bill can be found and
  cited by Grounded Ask.
- `legislator-city-backfill`: hand-run preview or fill for missing legislator
  residence cities. It costs nothing when nobody starts it.

## What the current $0 Actions budget would do

The organization has a $0 Actions overage budget with **Stop usage** turned on.
On GitHub Team, jobs run through the included 3,000 minutes. Then all GitHub-hosted
jobs stop until the next month or until the budget is raised.

The website already online stays online. New work cannot safely ship because the
required tests never report, so PRs cannot merge. Railway releases, database
changes, daily vote imports, and the 2 daily data checks also stop. Vercel's
direct Git release does not itself need Actions, but the protected `main` branch
cannot receive a change without the stopped tests.

Set a $50/month hard Actions overage budget immediately before making the repo
private. The current cleaned estimate is $32.59, so $50 gives growth room while
still capping the surprise. Revisit the cap after 1 full private month.

## Vercel with only 1 deploying seat

The 2 GitHub users without a Vercel seat can still push code, open PRs, and pass
GitHub tests. Vercel blocks their preview and production releases from the private
repo because the commit author is not a member of the Vercel Pro team. Merging the
PR does not reliably solve that because the final commit keeps author information.

Do not use the owner's release token to hide that seat requirement. Buy 2 more
deploying seats before the private switch, or keep the repo public. Free Vercel
viewer seats can read results but cannot deploy.

## Public versus private attack risk

A private repo modestly lowers source-code and architecture exposure. It does not
hide the public website, API addresses, browser code, or network requests. It does
not stop traffic floods, hosting outages, stolen cloud accounts, weak login rules,
or a vulnerable package.

For website uptime, public versus private changes little. Cloudflare, Vercel,
Railway, Supabase, rate limits, tested releases, and account security carry most
of that risk.

For leaked credentials, public with free GitHub push protection is safer than
private with only an after-push free scanner. Private plus paid Secret Protection
is the strongest of the 3 choices.

Changing visibility also has 3 one-way or paid consequences today:

- The repo has 0 forks, so no fork is detached or lost.
- Its 2 stars and 1 watcher are erased and do not return if the repo becomes
  public again.
- Dependabot's normal alerts stay available, but the 1 custom Dependabot alert
  rule is disabled unless GitHub Code Security is also bought. CodeQL is not set
  up today, so no current CodeQL scan is lost.

## GitHub Team benefits useful now

For this private repo, Team keeps the controls already used today:

- protected `main`, including required tests and a current-branch rule;
- Code Owner review requests for sensitive files;
- multiple reviewers and assignees;
- 3,000 included private-repo Actions minutes instead of 2,000 on Free;
- standard GitHub support; and
- the ability to buy GitHub Secret Protection.

The protection and workflow controls are the useful reasons to buy Team. The
project does not need Enterprise features today.

## Gates before changing visibility

1. Add 2 Vercel deploying seats for the other regular code authors.
2. Ask `joelethical` and `Myahmyahmeow-cat` to enable two-step login, or remove
   their access after a deliberate access review.
3. Set the GitHub Actions hard overage budget to $50/month.
4. Buy GitHub Team for every person who still needs private access.
5. Enable GitHub Secret Protection for Alethical.
6. Make the repo private and immediately verify 1 PR preview, 1 production web
   release, 1 Railway release, and all 3 required checks from a non-owner account.
