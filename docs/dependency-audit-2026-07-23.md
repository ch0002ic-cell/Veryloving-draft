# Dependency and Toolchain Audit — 23 July 2026

Branch: `features/dual-product-draft`

Scope: mobile app, backend, mock simulator, TypeScript projects, test/build tools, environment contracts, container/deployment configuration, and active operator documentation.

Registry candidates were inventoried with `npm-check-updates` in both workspaces and then reconciled against Expo's supported-version check, runtime release lines, lockfile audits, and isolated compatibility tests. “Latest” below therefore means the newest reviewed compatible release, not an unsafe registry-major override.

## Executive result

The repository now uses the newest versions that are compatible with its reviewed Expo SDK 57 / React Native 0.86 platform. Node is upgraded to the current 24.18.0 LTS line, Expo packages match Expo's own compatibility matrix, backend packages are current, security scans contain no known vulnerabilities, and the toolchain is pinned by an executable release policy. Raw registry majors that conflict with Expo or the production runtime remain intentionally pinned and are listed below rather than being hidden by an unsafe forced update.

Primary compatibility authorities:

- [Node.js release status](https://nodejs.org/en/about/previous-releases) and [Node.js 24.18.0 release](https://nodejs.org/en/blog/release/v24.18.0)
- [Expo SDK documentation](https://docs.expo.dev/versions/latest/)
- [Expo dependency validation](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/)
- [npm audit documentation](https://docs.npmjs.com/cli/commands/npm-audit/)

## Reviewed baseline changes

### Runtime and release tooling

| Item | Previous | Reviewed value | Rationale |
| --- | --- | --- | --- |
| Node.js | 22.23.1 | 24.18.0 | Newest LTS; coordinated across manifests, EAS, CI, Docker, tests, and policy. |
| npm | 10.9.8 | 11.16.0 | Exact npm bundled with Node 24.18.0; avoids an unreviewed network bootstrap inside Docker/EAS. npm 12 is therefore a documented deployment-compatibility hold. |
| EAS CLI | 21.0.2 | 21.1.0 | Current registry release and Node 24 compatible. |
| Docker base | Node 22 Alpine | `node:24.18.0-alpine3.24` | Exact tag plus reviewed OCI index digest in `release-policy.json`. |
| GitHub Actions | checkout/setup-node/upload-artifact 4.x; implicit runner Buildx | 7.0.1 / 7.0.0 / 7.0.1; setup-buildx 4.2.0 | Current immutable commit pins. Trivy 0.36.0 was already current and remains pinned. The release job now provisions a reviewed BuildKit builder before requesting image SBOM/provenance attestations. |

The release gate now verifies the actual Node and npm executables, not only manifest strings. CI also runs the full source regression gate (environment validation, lint, strict server type checks, the mobile compiler/config smoke, tests, Expo Doctor, and both production exports) before artifact validation.

### Mobile and Expo packages

| Package/group | Previous | Final |
| --- | --- | --- |
| Expo SDK | 57.0.7 | 57.0.8 |
| Expo modules | older SDK-57 patches | Expo-recommended patches for asset 57.0.7, audio 57.0.3, constants 57.0.7, dev-client 57.0.8, linking 57.0.4, location 57.0.6, notifications 57.0.7, router 57.0.8, sharing 57.0.7, splash-screen 57.0.5, file-system/font 57.0.1 |
| React Native Screens | 4.25.2 | 4.26.2 (`~4.26.0`) |
| Google Sign-In | 15.0.0 | 16.1.2 |
| Mapbox React Native | 10.3.2 locked | 10.3.5 |
| libphonenumber-js | 1.13.8 | 1.13.9 |
| Vector icons / BLE PLX / RN Web | older manifest floors | normalized to installed current compatible versions 15.1.1 / 3.5.1 / 0.21.2 |

Google Sign-In 16 retains the app-used Original API and passed Expo configuration/prebuild checks. Its iOS SDK major changes, so credential-backed native sign-in remains part of the signed-build external acceptance gate.

### Backend and developer tools

| Package | Previous | Final |
| --- | --- | --- |
| AWS DynamoDB client + document client | 3.1085.0 | 3.1093.0 (kept matched) |
| `ws` | 8.21.0 | 8.21.1 |
| Server TypeScript | 6.0.3 | 7.0.2 |
| Jest / Babel Jest / Jest types | 29.7.0 / 29.7.0 / 29.5.14 | 29.7.0 / 29.7.0 / 29.5.14 (Expo SDK 57 compatibility pin) |
| ESLint | 9.39.4 locked | 10.7.0 |
| Node types | 22.20.1 | 24.13.3, aligned to Node 24 |

The obsolete direct `react-native-codegen@0.70.7` package was removed because React Native 0.86 already owns `@react-native/codegen@0.86.0`. The unused EXAV CocoaPods patch and standalone Ruby helper were also removed; this app uses `expo-audio` (`ExpoAudio`), not `expo-av` (`EXAV`).

## Intentional compatibility holds

These entries are reported by `npm outdated`, but upgrading them would leave the reviewed platform matrix or runtime. They are not silent omissions.

| Package | Held value | Registry value observed | Reason |
| --- | --- | --- | --- |
| React / React DOM | 19.2.3 | 19.2.8 | Expo SDK 57 exact template pin. |
| AsyncStorage | 2.2.0 | 3.1.1 | Expo SDK 57 native compatibility pin; v3 is a native/API migration. |
| Gesture Handler | 2.32.0 | 3.1.0 | Expo SDK 57 pin. |
| Reanimated | 4.5.0 | 4.5.3 | Expo SDK 57 exact pin. |
| Safe Area Context | 5.7.0 | 5.8.0 | Expo SDK 57 pin. |
| Worklets | 0.10.0 | 0.11.1 | Expo SDK 57 exact pin. |
| Mobile TypeScript | 6.0.3 | 7.0.2 | Expo SDK 57 template/tooling pin; isolated server compilation uses TypeScript 7. |
| Jest / Babel Jest / Jest types | 29.7.0 / 29.7.0 / 29.5.14 | 30.4.2 / 30.4.1 / 30.0.0 | Expo Doctor requires the SDK 57-supported Jest 29 line; the newer line was tested but not shipped. |
| Babel core/register | 7.29.7 | 8.0.1 | Expo/Metro remains on Babel 7; a Babel 8 move is a separate platform migration. |
| Node types | 24.13.3 | 26.1.1 | Types intentionally match production Node 24, not Current Node 26. |
| npm | 11.16.0 | 12.0.1 | Uses the npm shipped by the pinned Node LTS image/EAS runtime for reproducibility. |

## Security and supply chain

- Root live audit: **PASS — 0 vulnerabilities** (0 critical/high/moderate/low).
- Root production audit: **PASS — 0 vulnerabilities**.
- Server live audit: **PASS — 0 vulnerabilities** (0 critical/high/moderate/low).
- Server production audit: **PASS — 0 vulnerabilities**.
- No `npm audit fix --force` was used.
- Both lockfiles remain lockfile v3 with registry HTTPS resolutions and integrity hashes enforced by the release policy.
- Production and CI dependency installation continues to use `--ignore-scripts`; the two packages npm 12 identified as having lifecycle scripts (`fsevents` and `unrs-resolver`) were also verified loadable from their locked prebuilt modules without executing those scripts.
- The Docker base is pinned to `sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd`.

## Defects found and closed during the audit

1. **High — npm lifecycle collision:** adding a root `build` aggregate implicitly invoked the existing Expo `prebuild` lifecycle, regenerating native folders before server compilation. The aggregate is now `build:server`, which is side-effect-free.
2. **High — TypeScript test blind spot:** production configs excluded every TypeScript test. A strict `server/tsconfig.tests.json` gate now covers adapter, AI-native, simulator, and integration tests; the newly exposed unsafe optional access and incomplete fixtures were corrected without weakening strictness.
3. **High — declared toolchain drift:** policy checked version strings but not the executing Node/npm binaries. `validate:toolchain` now fails on runtime drift and is enforced by local/CI production validation.
4. **Medium — environment contract gaps:** malformed simulator probabilities/ports/latencies, adapter retry settings, Hume persona/provisioning values, and soak limits could pass validation. The validator and committed server template are now synchronized and bounded by regression tests.
5. **Medium — obsolete native dependency workarounds:** unused legacy codegen and EXAV patches could confuse clean native generation. They were removed and Expo prebuild configuration was revalidated.

## Verification record

| Check | Result |
| --- | --- |
| Exact Node 24.18.0 / npm 11.16.0 toolchain | ✅ PASS |
| Root and server dependency installation/lock consistency | ✅ PASS |
| Expo dependency compatibility check | ✅ PASS |
| Server TypeScript production/test configs | ✅ PASS — strict semantic checks cover adapters, simulator, AI-native, and all TypeScript tests |
| Mobile JavaScript compiler/config smoke | ✅ PASS — the app is JavaScript; `tsc --noEmit` validates the Expo config boundary, while ESLint and 821 mobile/core tests provide semantic regression coverage |
| Root/server live and production npm audits | ✅ PASS — zero vulnerabilities |
| Backend, adapter, AI-native, and simulator builds | ✅ PASS |
| Full test suite | ✅ PASS — 1,056/1,056 (821 core, 44 adapter, 8 adapter integration, 183 AI-native) |
| ESLint | ✅ PASS |
| Expo Doctor 1.20.1 | ✅ PASS — 20/20 |
| iOS production JavaScript export | ✅ PASS — Hermes bundle and 82 assets |
| Android production JavaScript export | ✅ PASS — Hermes bundle and 86 assets |
| `validate:production` | ✅ PASS — 183 AI-native tests, 49 boundary tests, two validated CycloneDX SBOMs, zero cached vulnerabilities |
| Adapter soak test | ✅ PASS — 60 seconds, 5,104,841 commands, 0.012 ms p95 admission, 24,424-byte heap growth, zero leaked handles |
| Backend `/health` + scenario/mock dashboard smoke | ✅ PASS — health OK; fall scenario admitted and completed; both devices, scenario log, status, and 1 Hz telemetry observed |
| Docker build/runtime health test | ⚠️ NOT RUN LOCALLY — no container runtime is installed; immutable Docker/Trivy validation is enforced by the commit-pinned CI release job |
| iOS Simulator runtime | ✅ PASS — unsigned `iphonesimulator` build, install, and launch on iOS 26.5; no fatal/crash event in the launch log |
| Android Emulator runtime | ⚠️ NOT RUN LOCALLY — Android SDK/emulator is not installed on this workstation |

The local iOS native build completed without errors. Xcode emitted dependency-owned warnings from current Expo, React Native, Mapbox, BLE PLX/RxBluetoothKit, Screens, Gesture Handler, Reanimated, and Worklets sources under the iOS 26.5 SDK. No application-source warning caused a build failure. These upstream diagnostics are retained as upgrade-monitoring evidence rather than patched inside `node_modules`.

The clean npm install also emits the known `glob@7`/`inflight` deprecation chain from Jest 29 coverage tooling. Jest 30.4.2, Babel Jest 30.4.1, and Jest types 30.0.0 passed the test suites, but the actual project then failed Expo Doctor's SDK dependency check (19/20; expected Jest 29.7.0 and Jest types 29.5.14). The experiment was reverted. The shipped Jest 29 graph has zero npm vulnerabilities; upgrading it is tied to the next Expo compatibility review.

The mobile application is currently JavaScript rather than TypeScript. Its root `tsconfig.json` deliberately declares `checkJs: false`: enabling strict JavaScript inference today surfaces thousands of pre-existing annotation and React-prop inference findings and would require a separate source migration, which this dependency-only change must not disguise as a package update. No strict mobile semantic-check claim is made; server TypeScript remains fully strict, and mobile source is covered by ESLint plus the deterministic core/mobile suite.

The Docker and Android-emulator rows above are still open verification-evidence gates, not manufacturer/provider/credential blockers and not claimed as passes. Container build, health, and Trivy checks are encoded in the immutable release workflow; an Android runtime walkthrough still requires a workstation or CI runner with the Android SDK and emulator installed.

## Remaining external acceptance

No manufacturer API, physical robot/wearable, or production provider credential is needed for the source checks above. Signed EAS/TestFlight/Google builds, credential-backed Google/Apple/Twilio/Hume/APNs/FCM flows, real-vendor APIs, and physical BLE/robot validation remain the external gates already owned in the final handoff document.
