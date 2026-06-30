# Shipping Veryloving to TestFlight

A step-by-step guide to archive, validate, export, and upload the Veryloving iOS
app to App Store Connect for beta distribution via TestFlight.

This project is **XcodeGen-driven** — the `.xcodeproj` is generated from
[`project.yml`](../project.yml) and is git-ignored. Always run `xcodegen
generate` before archiving so the project reflects the latest config.

Key facts for this app:

| Setting | Value | Where |
|---------|-------|-------|
| Bundle identifier | `ai.veryloving.app` | `project.yml` → `PRODUCT_BUNDLE_IDENTIFIER` |
| Marketing version | `1.0.0` | `project.yml` → `MARKETING_VERSION` (Info.plist `CFBundleShortVersionString`) |
| Build number | `1` | `project.yml` → `CURRENT_PROJECT_VERSION` (Info.plist `CFBundleVersion`) |
| Deployment target | iOS 16.0 | `project.yml` |
| Capabilities | Push, Sign in with Apple, CloudKit | `Veryloving/Resources/Veryloving.entitlements` |
| Scheme | `Veryloving` (Archive uses Release) | `project.yml` → `schemes` |

> **Items that require YOUR input** are called out as **🛑 BLOCKED** boxes. Collect
> these before starting: Apple Developer **Team ID**, the **distribution
> provisioning profile name**, the **CloudKit container** id, an **APNs key**,
> and **subscription product IDs**.

---

## 0. Prerequisites

1. **Apple Developer Program membership** ($99/yr), with **Account Holder** or
   **Admin/App Manager** role in [App Store Connect](https://appstoreconnect.apple.com).
2. **Xcode** (matching the toolchain that built this project) signed in to your
   Apple ID: *Xcode ▸ Settings ▸ Accounts ▸ add your Apple ID*.
3. **XcodeGen** (`brew install xcodegen`) — already used by this repo.
4. A Mac that can run `xcodebuild` and (optionally) **Transporter** from the Mac
   App Store for uploads.

> **🛑 BLOCKED — Team ID**
> Find it at <https://developer.apple.com/account> ▸ *Membership details* ▸
> *Team ID* (10 characters, e.g. `AB12CD34EF`). Put it in:
> - `project.yml` → `DEVELOPMENT_TEAM` (then `xcodegen generate`), and
> - `ExportOptions.plist` → `teamID`.

---

## 1. Register the App ID & capabilities

1. Go to **Certificates, Identifiers & Profiles** →
   <https://developer.apple.com/account/resources/identifiers/list>.
2. Click **➕ ▸ App IDs ▸ App**. Set:
   - **Description**: `Veryloving`
   - **Bundle ID**: *Explicit* → `ai.veryloving.app`
3. Enable the capabilities this app declares (must match the entitlements file):
   - **Push Notifications**
   - **Sign in with Apple**
   - **iCloud (CloudKit)** — then create/choose a container
     `iCloud.ai.veryloving.app`.

> **🛑 BLOCKED — CloudKit container**
> Create the container `iCloud.ai.veryloving.app` under the iCloud capability.
> It must match `com.apple.developer.icloud-container-identifiers` in
> [`Veryloving.entitlements`](../Veryloving/Resources/Veryloving.entitlements).

---

## 2. Create the App Store Connect record

1. In [App Store Connect](https://appstoreconnect.apple.com) → **Apps ▸ ➕ ▸ New App**.
2. Fill in:
   - **Platform**: iOS
   - **Name**: `Veryloving` (must be globally unique on the App Store)
   - **Primary language**: English (U.S.)
   - **Bundle ID**: `ai.veryloving.app` (the App ID from step 1)
   - **SKU**: any internal string, e.g. `VERYLOVING-001`
   - **User access**: Full Access
3. Create. You now have a record TestFlight builds can attach to.

### (Optional) In-app subscription products

> **🛑 BLOCKED — Subscription product IDs**
> The app references `ai.veryloving.plus.monthly` and `ai.veryloving.pro.monthly`
> (see `StoreKitSubscriptionService`). Create these as **Auto-Renewable
> Subscriptions** in App Store Connect ▸ *Subscriptions* if you want to test
> purchases in TestFlight. Local testing uses `Veryloving/Resources/Products.storekit`.

---

## 3. Certificates & provisioning profiles

You can let Xcode manage signing automatically, or create a manual profile for
command-line export. **Automatic** is easiest for first upload.

### Option A — Automatic signing (recommended for the first build)

1. Open the project in Xcode: `xcodegen generate && open Veryloving.xcodeproj`.
2. Select the **Veryloving** target ▸ **Signing & Capabilities**.
3. Check **Automatically manage signing**, choose your **Team**.
4. Xcode creates the **Apple Distribution** certificate and a managed App Store
   provisioning profile on demand. Confirm there are **no red signing errors**
   and that Push, Sign in with Apple, and iCloud (CloudKit) all appear.

### Option B — Manual signing (for `xcodebuild -exportArchive` / CI)

1. **Distribution certificate**: Developer portal ▸ *Certificates ▸ ➕ ▸ Apple
   Distribution*. Create a CSR via *Keychain Access ▸ Certificate Assistant ▸
   Request a Certificate from a Certificate Authority*, upload it, download the
   `.cer`, and double-click to install in your login keychain.
2. **Provisioning profile**: *Profiles ▸ ➕ ▸ App Store Connect (Distribution)*,
   select App ID `ai.veryloving.app` and your distribution certificate. Name it
   something memorable (e.g. `Veryloving App Store`) and download/install it.

> **🛑 BLOCKED — Provisioning profile name**
> Put the exact profile name into `ExportOptions.plist` →
> `provisioningProfiles ▸ ai.veryloving.app`.

### Switch push to production

For App Store / TestFlight builds, APNs must target production. Edit
[`Veryloving.entitlements`](../Veryloving/Resources/Veryloving.entitlements):

```diff
- <key>aps-environment</key>
- <string>development</string>
+ <key>aps-environment</key>
+ <string>production</string>
```

> **🛑 BLOCKED — APNs auth key**
> Create an **APNs Auth Key (.p8)** in the Developer portal ▸ *Keys* and give it
> to the **backend** (it sends pushes; the app only uploads its device token via
> `POST /v1/devices/push-token`). The `.p8` never ships in the app.

### Point at the production backend

The app talks to mock services until `VL_API_HOST` is set. For a real build,
edit `Config/Secrets.xcconfig` (git-ignored):

```
VL_API_SCHEME = https
VL_API_HOST = api.veryloving.ai     # your deployed backend host (no scheme, no "//")
```

Then `xcodegen generate`. (The localhost ATS exception in Info.plist is harmless
in production — the app uses HTTPS for any real host.)

---

## 4. Bump the version / build number (for later uploads)

Each upload to App Store Connect needs a **unique build number** for a given
marketing version. Edit [`project.yml`](../project.yml) and re-generate:

```yaml
settings:
  base:
    MARKETING_VERSION: "1.0.0"      # CFBundleShortVersionString — user-facing
    CURRENT_PROJECT_VERSION: "2"    # CFBundleVersion — bump every upload
```

```bash
xcodegen generate
```

The first submission stays at `1.0.0 (1)`.

---

## 5. Archive the app

### Via Xcode (GUI)

1. `xcodegen generate && open Veryloving.xcodeproj`.
2. Select the **Veryloving** scheme and destination **Any iOS Device (arm64)**.
3. **Product ▸ Archive**. When it finishes, the **Organizer** opens with the
   archive.

### Via command line

```bash
cd /Users/ch0002techvc/Documents/veryloving/Veryloving
xcodegen generate

xcodebuild \
  -project Veryloving.xcodeproj \
  -scheme Veryloving \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/Veryloving.xcarchive \
  archive
```

This requires valid signing (a Team + distribution cert/profile). To prove the
*code* compiles for release without signing (no archive), use:

```bash
xcodebuild -project Veryloving.xcodeproj -scheme Veryloving \
  -configuration Release -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO build
```

---

## 6. Validate the archive

Catch signing/metadata problems before uploading.

### Xcode Organizer

**Window ▸ Organizer ▸ Archives** → select the archive → **Validate App** →
choose your team/distribution profile → fix any reported issues.

### Command line

```bash
xcodebuild -exportArchive \
  -archivePath build/Veryloving.xcarchive \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath build/export \
  -allowProvisioningUpdates
```

`-allowProvisioningUpdates` lets Xcode create/download missing profiles. Common
validation failures: missing capability on the App ID, `aps-environment` still
`development`, a CloudKit container that doesn't exist, or a duplicate build
number.

---

## 7. Export the IPA (without uploading)

If you set `ExportOptions.plist` → `destination = export` (instead of `upload`),
the same `-exportArchive` command writes `build/export/Veryloving.ipa`, which you
can inspect or upload manually. Keep `destination = upload` to push straight to
App Store Connect.

---

## 8. Upload to App Store Connect

Pick one:

**A. Xcode Organizer** — select the archive ▸ **Distribute App ▸ App Store
Connect ▸ Upload** ▸ follow the signing prompts. Easiest path.

**B. `xcodebuild -exportArchive`** with `ExportOptions.plist` `destination =
upload` (see step 6) — uploads as part of export. Good for CI.

**C. Transporter app** (Mac App Store) — if you exported an `.ipa` (step 7), drag
it into Transporter and **Deliver**.

After a successful upload the build appears in **App Store Connect ▸ your app ▸
TestFlight** with status **Processing** (usually a few minutes to ~1 hour).

> **Note on `ITSAppUsesNonExemptEncryption`:** Veryloving uses only standard
> HTTPS/TLS, which is exempt. To skip the per-build export-compliance prompt, you
> may add `<key>ITSAppUsesNonExemptEncryption</key><false/>` to Info.plist.

---

## 9. TestFlight: metadata, testers, and releases

Once the build finishes **Processing**:

1. **Export compliance** — answer the encryption question (HTTPS only → exempt).
2. **Test Information** (TestFlight tab) — fill in *Beta App Description*,
   *Feedback email*, *Privacy Policy URL*, and *What to Test* notes.
3. **Internal testing** — add up to 100 members of your App Store Connect team to
   an internal group; they get the build immediately, no review.
4. **External testing** — create an external group, add testers by email or share
   a **public link**. The **first** external build requires a short **Beta App
   Review**; subsequent builds of the same version usually don't.
5. Testers install the **TestFlight** app and redeem the invite/link.

### App Store listing assets (needed before public release, good to prep now)

- **Screenshots**: 6.7"/6.9" iPhone is mandatory (e.g. iPhone 15/16/17 Pro Max).
  Capture from the simulator: `xcrun simctl io booted screenshot shot.png`.
- **App icon**: 1024×1024 (no alpha) — populate `Assets.xcassets/AppIcon`.
- **Description, keywords, support URL, marketing URL**.
- **App Privacy** questionnaire — declare data collected: location (SOS),
  contacts, identifiers, etc.
- **Age rating** and **category** (e.g. *Health & Fitness* / *Lifestyle*).

---

## 10. Submit for App Store review (after beta)

When beta testing is done: **App Store** tab ▸ select the build ▸ complete all
metadata ▸ **Add for Review ▸ Submit**. Apple review typically takes 24–48h.

---

## Pre-flight checklist

- [ ] `DEVELOPMENT_TEAM` set in `project.yml`; `xcodegen generate` run.
- [ ] App ID `ai.veryloving.app` registered with Push, Sign in with Apple, iCloud.
- [ ] CloudKit container `iCloud.ai.veryloving.app` created.
- [ ] App Store Connect app record created.
- [ ] Distribution certificate + App Store provisioning profile installed.
- [ ] `ExportOptions.plist` filled in (`teamID`, profile name).
- [ ] `aps-environment` switched to `production`.
- [ ] `Config/Secrets.xcconfig` points at the production HTTPS backend.
- [ ] Build number unique for this marketing version.
- [ ] Archive **validated** with no errors.
- [ ] Build uploaded and shows in TestFlight.
- [ ] Test Information / export compliance completed; testers added.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| `No profiles for 'ai.veryloving.app' were found` | Create the App Store profile (step 3B) or use `-allowProvisioningUpdates`. |
| `Provisioning profile doesn't include the … entitlement` | Enable the capability on the App ID and regenerate the profile. |
| `aps-environment` mismatch on upload | Set it to `production` in the entitlements. |
| `The bundle version must be higher than the previously uploaded version` | Bump `CURRENT_PROJECT_VERSION` and `xcodegen generate`. |
| CloudKit validation error | Create the container id and select it on the profile. |
| Invalid icon / missing 1024 icon | Provide a 1024×1024 PNG with no alpha in `AppIcon`. |
| Upload hangs / auth fails | Use an app-specific password or sign in to Xcode/Transporter again. |
