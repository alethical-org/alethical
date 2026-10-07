# Native app publishing pause and restart

Native iOS and Android publishing is paused. Desktop and phone browsers are the
supported clients. [Issue 91](https://github.com/alethical-org/alethical/issues/91)
remains the future native-app work item; restarting native work requires Eugene's
explicit approval. There is no promise to keep native builds working during the pause.

## What the pause removes

The separate phone publishing package list and lockfile, native release workflow,
native-only dependency updates, EAS build settings, iOS publishing commands and
Android build helpers are retired. Ordinary website setup, tests and releases
must not install or maintain those tools.

Expo and React Native still build the website. Their shared packages, app settings,
brand assets and browser security checks remain supported. Existing app identifiers
and native runtime branches are retained as recovery context, not tested native
release support. This pause does not cancel accounts, change billing, remove
credentials or change sign-in return addresses.

## Recovery point

The full previous release instructions and tooling remain in
[commit fb435d30](https://github.com/alethical-org/alethical/commit/fb435d3062fcf3498caad55296103017ff9e2c43).
The [previous iOS release instructions](https://github.com/alethical-org/alethical/blob/fb435d3062fcf3498caad55296103017ff9e2c43/docs/operations/ios-release.md)
and [previous Android prototype instructions](https://github.com/alethical-org/alethical/blob/fb435d3062fcf3498caad55296103017ff9e2c43/docs/operations/android-prototype-handoff.md)
are historical references. Their package versions and service settings must be
reviewed before reuse; restoring an old lockfile is not a security review.

## Restart requirements

1. Obtain explicit approval to resume native work through
   [issue 91](https://github.com/alethical-org/alethical/issues/91), with a release
   owner and intended iOS or Android scope.
2. Read the recovery point in a separate working folder. Restore only the native
   tooling needed for the approved work, leaving the current website intact.
3. Review current Expo, Apple and Google requirements. Choose supported package
   versions, rebuild the native-only lockfile, and resolve security findings before
   restoring native dependency updates and native release checks. Update the
   paused-native tool guard as part of that reviewed restart.
4. Inventory the actual Expo project, Apple/Google accounts, billing, credentials,
   automatic build triggers and saved sign-in return addresses. Preserve browser
   sign-in, get approval for new spending, and do not remove shared credentials.
5. Recheck the intended service addresses and public environment values. Recover
   the iOS bundle identifier and Android application identifier from the retained
   app settings, and confirm account ownership before building or submitting.
6. Run the current website tests, security checks, production web build and desktop
   and phone browser checks. Native restoration must not add native installation
   or release requirements to the browser delivery path.
7. Build and test the approved native target using current tools. Test navigation,
   readable text, API connections, account persistence and saved tracking. Android
   emulator networking and device networking need separate checks. Distribution,
   invitations and paid builds retain their own approval and safety requirements.

## Native account and tracking acceptance checks

Run these checks before a native release; they are acceptance requirements, not a
claim that the native client passes today.

Use the designated Alethical test account for a real Google sign-in. The account
and callback protections in [AGENTS.md](../../AGENTS.md#hard-lines) apply: never
capture or print private callback values, and never complete sign-in merely to
prove a return address is allowed.

- Sign in, close the app, and reopen it. Confirm the signed-in state remains.
- Sign out, close the app, and reopen it. Confirm the signed-out state remains.
- With the same designated test account on web and native, track and untrack a bill
  in each client. Refresh the other client and confirm its saved list matches.
