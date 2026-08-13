# Build-tool security verification for issue 1493

This record covers
[issue 1493, clear the Expo 55 build-tool security warnings](https://github.com/alethical-org/alethical/issues/1493).

## Result

GitHub reported 10 open JavaScript dependency warnings on 2026-08-13. This change
updates every package that has an Expo 55-compatible fixed release. The local
security scan now reports only the 2 `image-size` warnings that have no fixed release.

Expo stays on SDK 55. The website dependency versions do not change.
EAS CLI 21.6.0 was the newest release old enough for the repository's 7-day
package-release safety gate on 2026-08-13; EAS CLI 21.8.0 had been published only
2 days earlier.

## Fixed warnings

| GitHub warning                                                                                                                                                                                                                                                                                                                                                                                                         | Package owner                                                          | Fixed version and compatibility proof                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5 high warnings in `@xmldom/xmldom` ([GHSA-2v35-w6hq-6mfw](https://github.com/advisories/GHSA-2v35-w6hq-6mfw), [GHSA-f6ww-3ggp-fr8h](https://github.com/advisories/GHSA-f6ww-3ggp-fr8h), [GHSA-x6wf-f3px-wcqx](https://github.com/advisories/GHSA-x6wf-f3px-wcqx), [GHSA-j759-j44w-7fr8](https://github.com/advisories/GHSA-j759-j44w-7fr8), [GHSA-wh4c-j3r5-mjhp](https://github.com/advisories/GHSA-wh4c-j3r5-mjhp)) | EAS CLI 20 brought old `@expo/plist` copies into the lockfile.         | EAS CLI 21.6.0 brings `@expo/plist` 0.3.5, which resolves to fixed `@xmldom/xmldom` 0.8.13. A property-list build and parse check passes.                                                                                              |
| 1 medium warning in `ts-deepmerge` ([GHSA-87mf-gv2c-c62c](https://github.com/advisories/GHSA-87mf-gv2c-c62c))                                                                                                                                                                                                                                                                                                          | EAS CLI 21.6.0 directly requests `ts-deepmerge` 6.2.0.                 | The narrow override installs fixed 8.0.0. Version 8 removed the default export EAS CLI uses, so the local patch restores only that old export. The fixed merge code remains unchanged, and an EAS-shaped nested-settings merge passes. |
| 1 medium warning in `uuid` ([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq))                                                                                                                                                                                                                                                                                                                  | EAS CLI, Expo telemetry tools, and `xcode` bring in old `uuid` copies. | The override installs fixed 11.1.1 for every copy. The callers use only `v1`, `v4`, `validate`, and `version`, which remain available. Xcode's 24-character project identifier check passes.                                           |
| 1 low warning in `diff` ([GHSA-73rr-hh4g-fpgx](https://github.com/advisories/GHSA-73rr-hh4g-fpgx))                                                                                                                                                                                                                                                                                                                     | EAS CLI 21.6.0 directly requests `diff` 7.0.0.                         | The narrow override installs fixed 8.0.3. EAS CLI uses only `diffLines`, and its line-change check passes.                                                                                                                             |

The compatibility checks run on every pull request through
`pnpm run check:build-tool-security`. They assert the exact fixed versions, the
`ts-deepmerge` security behavior, and the narrow commands EAS CLI, Expo, and Xcode use.
They also start EAS CLI's configuration, build, and submit commands without sending a
build, then load Alethical's public Expo configuration and its 3 EAS build profiles. This
prevents a future grouped dependency update from restoring a vulnerable release or
installing an incompatible one while still allowing installation to succeed.

## Remaining upstream exceptions

| Advisory                                                                                                 | Exact package path                                               | Missing fixed release                                                                                                                                        | Exposure                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ICNS infinite-loop warning, GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr)     | `image-size` 1.2.1, brought in by `metro` 0.83.7 through Expo 55 | The advisory marks every release through the current 2.0.2 as affected and lists no patched release. Metro 0.83.7 is the current Metro line used by Expo 55. | The warning needs a specially made ICNS image buffer. Metro calls `image-size` only while building files from the project checkout. Website visitors cannot add or replace those build files.        |
| [JXL/HEIF infinite-loop warning, GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) | `image-size` 1.2.1, brought in by `metro` 0.83.7 through Expo 55 | The advisory marks every release through the current 2.0.2 as affected and lists no patched release. Metro 0.83.7 is the current Metro line used by Expo 55. | The warning needs a specially made JXL or HEIF image buffer. Metro calls `image-size` only while building files from the project checkout. Website visitors cannot add or replace those build files. |

`image-size` is not present in the finished website files or their JavaScript bundle.
The release output contains no source map that could ship Metro's build code. The smallest
safe exception is therefore to keep Metro's Expo 55-tested `image-size` 1.2.1 until the
`image-size` project publishes a fixed release and Expo adopts it.

A developer or compromised package could still add a harmful image file to the project
checkout and freeze that one Metro build. This residual build-machine risk cannot be
removed without a fixed `image-size` release, but it cannot be triggered by a website
visitor.

## Verification

Completed locally on 2026-08-13:

- `pnpm install --frozen-lockfile`: passed.
- `pnpm --dir apps/frontend exec expo install --check`: passed against Expo's online SDK 55 list.
- `npx expo-doctor@latest`: 19 of 19 checks passed with Expo Doctor 1.20.1.
- `pnpm --dir apps/frontend run check:build-tool-security`: passed.
- `pnpm --dir apps/frontend exec tsc --noEmit`: passed.
- `pnpm --dir apps/frontend exec prettier --check .`: passed.
- `pnpm --dir apps/frontend run test`: 104 files and 931 tests passed after the branch was updated with current `main`.
- `pnpm --dir apps/frontend run build`: passed and produced the production website bundle.
- `pnpm audit --json`: 0 critical, 2 high, 0 moderate, and 0 low warnings; both high warnings are the no-fix `image-size` exceptions above.
- Separate read-only security and Expo 55 reviews: added exact package-version checks, real EAS command startup checks, project-configuration loading, and the current test totals; no actionable finding remains.

## Release checklist

- [x] Read the current GitHub warnings and map each package to the dependency that brings it in.
- [x] Confirm the worktree is based on current `main` and that no open pull request or worktree owns issue 1493.
- [x] Compare every fixed release with the exact Expo, Metro, EAS CLI, or Xcode call site that uses it.
- [x] Apply the smallest Expo 55-compatible direct upgrade, narrow overrides, and compatibility bridge.
- [x] Pass the locked install, Expo checks, website checks, release build, and security scan.
- [x] Pass a separate read-only security and Expo 55 compatibility review and resolve its version-check finding.
- [ ] Merge the pull request, verify the public website, and confirm GitHub retains only warnings with no published fix.
