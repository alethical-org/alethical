# Android prototype: paused

Android app publishing is paused. Desktop and phone browsers are the supported
clients. The Android build and local network configuration helpers are retired;
a generated Android project is not a supported release target.

[Native app publishing pause and restart](ios-release.md) owns the pause,
restoration requirements, account safeguards and future acceptance checks.
[Issue 91](https://github.com/alethical-org/alethical/issues/91) remains open for
future native work, subject to Eugene's explicit restart approval.

The prototype instructions and helper scripts remain in
[commit fb435d30](https://github.com/alethical-org/alethical/commit/fb435d3062fcf3498caad55296103017ff9e2c43).
Read the [previous Android prototype instructions](https://github.com/alethical-org/alethical/blob/fb435d3062fcf3498caad55296103017ff9e2c43/docs/operations/android-prototype-handoff.md)
as recovery context, not current commands. Before restoring the Android helper,
recheck the current package versions, Java/Android tools, emulator network rules,
physical-device connections and service addresses. Website setup must continue
to work without Java, an Android SDK or native publishing tools.
