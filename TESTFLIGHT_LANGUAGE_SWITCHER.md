# How to Test the Language Switcher on TestFlight

Audience: Grace and mobile QA
Primary acceptance artifact: the exact signed TestFlight build recorded below

## Current Verification Status

The language-switching implementation, persistence contract, locale gate, selected-row accessibility state, localized reminder transition, and LTR/RTL reload coordination have deterministic regression coverage. The full source validator must be green before a candidate is uploaded.

**Physical-device status for this change set: BLOCKED — EXTERNAL.** No physical iPhone is connected to the engineering environment, and the authenticated Expo account does not have read/build permission for the configured EAS project. Therefore this document does not claim that the current commit has passed on a real device. An EAS project owner must grant access or build the committed SHA, publish it to TestFlight, and complete the steps below.

The dedicated `testflight` EAS profile is the required artifact for this test. It exposes the reviewed production set—English, Spanish, French, and Simplified Chinese—plus Arabic and Hebrew solely for signed RTL QA. A normal development or production profile may intentionally omit the two QA-only RTL locales.

## Test Record

- Tester:
- Date/time and timezone:
- Git commit SHA:
- App version / TestFlight build number:
- Device model / iOS version:
- Clean install or upgrade from build:
- Evidence link:

Do not reuse a PASS from Expo Go, a simulator, a development build, or another TestFlight build number.

## Install the Candidate

1. The EAS project owner builds the exact committed SHA with:

   ```bash
   eas build --platform ios --profile testflight
   ```

2. After the archive succeeds, submit that exact build to App Store Connect and add it to Grace's internal TestFlight group.
3. On the test iPhone, install or update **TestFlight** from the App Store, accept the invitation, open VeryLoving's listing, and tap **Install** or **Update**.
4. Open VeryLoving from TestFlight. Record the version/build number shown in TestFlight before testing.
5. Run once as a clean install and once as an upgrade from the previously supported build.

## Test the Language Switcher

### Immediate change and selected state

1. Sign in, complete onboarding if needed, and open **Settings → Language**.
2. Confirm the list contains exactly **System default, English, Spanish, French, Simplified Chinese, Arabic, and Hebrew**.
3. Select **Spanish**.
4. Confirm the sheet closes, the visible Settings copy changes immediately, and the language trigger reads `Español / ES`.
5. Reopen Language and confirm Spanish has the visible selected/checkmark state. With VoiceOver enabled, confirm the row is announced as selected.
6. Open Home, Map, Settings, emergency contacts, Saved Places, voice, history, privacy, and the SOS confirmation. Confirm app-owned copy changes and no raw native/provider error is displayed.
7. Repeat steps 3–6 for **French** and **Simplified Chinese**.

### Persistence

1. Leave the app in Spanish on a safe screen such as Settings.
2. Remove VeryLoving from the app switcher, then launch it again from TestFlight or the Home Screen.
3. Confirm Spanish remains active, Settings remains translated, and Spanish remains selected in the Language sheet.
4. Repeat after restarting the iPhone and after upgrading from the previous TestFlight build.

### RTL behavior

1. Enable a Capybear reminder first so notification-copy migration is exercised.
2. Select **Arabic**. One intentional app-process reload may occur when changing from LTR to RTL.
3. Confirm the app returns in Arabic, Arabic is selected, the layout is mirrored, and there is no reload loop.
4. Inspect headers/back controls, lists, forms, Language, dialogs, map controls/annotations, Saved Places, dates, coordinates, and phone numbers. Numeric content must remain readable and must not be reversed incorrectly.
5. Force-quit and relaunch; Arabic and RTL direction must persist.
6. Confirm the enabled Capybear reminder is still enabled and its scheduled app-owned copy is Arabic.
7. Repeat with **Hebrew**.
8. Switch to **English**. Confirm one return-to-LTR reload, English persistence after force-quit, and no loop.

Arabic and Hebrew are TestFlight QA locales, not public-release approvals. Record native-speaker review separately for safety, emergency, consent, authentication, permission, map, voice, privacy, and notification copy.

### System-language fallback

1. Select **System default** in VeryLoving.
2. In iOS Settings, change the preferred app/device language to Spanish, French, or Simplified Chinese; terminate and relaunch VeryLoving.
3. Confirm the matching maintained interface is used.
4. Select an unsupported language or Traditional Chinese. Confirm VeryLoving explicitly uses English instead of labeling English or Simplified Chinese copy as the unsupported locale.

## Pass/Fail Criteria

Mark **PASS** only when every applicable item below is observed on the recorded TestFlight build:

- Same-direction selections update mounted app-owned UI immediately.
- The chosen row is visibly and accessibly selected.
- The preference survives force-quit, device restart, and supported-build upgrade.
- Arabic and Hebrew perform a bounded direction reload, mirror correctly, persist, and never loop.
- Enabled reminder copy follows the selected locale without leaving an old-language schedule.
- System default follows maintained device locales and falls back honestly to English.
- No screen shows mixed stale app-owned copy, a raw technical error, a crash, or an unrecoverable blank state.

Mark **FAIL** for any reproducible mismatch. Record expected/actual behavior, screen, exact build, language transition, install type, and a screenshot/video. Capture at minimum Spanish selected, Spanish after relaunch, Arabic selected, the same representative screen in LTR and RTL, and a short English → Arabic → relaunch → English recording.

## Related Full-Framework Test

After this priority flow passes, complete [TESTFLIGHT_UI_CHECKLIST.md](./TESTFLIGHT_UI_CHECKLIST.md). It covers protected navigation and direct deep links, auth/onboarding restoration, account isolation, contacts and Saved Places, errors/loading/retry, permissions, accessibility, background/foreground recovery, audio, BLE, performance, and privacy behavior on the same signed build.

## Development-Environment Note

An iOS 26.5 Simulator debug app was compiled and ad-hoc signed successfully during this pass, but CoreSimulator intermittently timed out while delivering the Expo development-client URL. No simulator-only production code or routing bypass was added. This is a local development-tool quirk, not TestFlight evidence and not a reason to mark the real-device steps PASS or FAIL.
