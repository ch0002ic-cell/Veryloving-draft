'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { colors } = require('../src/constants/theme');

const ROOT = process.cwd();

function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((value) => {
    const channel = Number.parseInt(value, 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrastRatio(first, second) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(absolutePath);
    return entry.isFile() && entry.name.endsWith('.js') ? [absolutePath] : [];
  });
}

test('semantic foreground tokens meet WCAG AA against their intended surfaces', () => {
  for (const token of [
    'orangeAccessible',
    'goldAccessible',
    'greenAccessible',
    'redAccessible',
    'blueAccessible'
  ]) {
    assert.ok(
      contrastRatio(colors[token], colors.paper) >= 4.5,
      `${token} must reach 4.5:1 against paper`
    );
  }
  assert.ok(contrastRatio(colors.orangeAccessible, colors.cream) >= 3);
  assert.ok(contrastRatio(colors.controlBorder, colors.paper) >= 3);
  assert.ok(contrastRatio(colors.controlBorder, colors.cream) >= 3);
});

test('every current TextInput placeholder has an explicit accessible colour', () => {
  for (const absolutePath of [
    ...javascriptFiles(path.join(ROOT, 'app')),
    ...javascriptFiles(path.join(ROOT, 'src'))
  ]) {
    const contents = fs.readFileSync(absolutePath, 'utf8');
    const inputs = contents.match(/<TextInput\b[\s\S]*?\/>/g) || [];
    for (const input of inputs.filter((value) => value.includes('placeholder='))) {
      assert.match(
        input,
        /placeholderTextColor=\{colors\.(?:inkSoft|textSecondary)\}/,
        `${path.relative(ROOT, absolutePath)} must colour each placeholder`
      );
    }
  }
});

test('critical text inputs expose localized programmatic labels', () => {
  for (const [relativePath, label] of [
    ['app/(auth)/verify-code.js', "t('auth.verificationCode')"],
    ['app/emergency-contacts.js', "t('contacts.name')"],
    ['app/safety-call.js', "t('safetyCall.typePlaceholder')"],
    ['src/components/CountryPicker.js', "t('phone.searchCountry')"],
    ['src/components/LanguageSelector.js', "t('languages.search')"]
  ]) {
    const inputs = source(relativePath).match(/<TextInput\b[\s\S]*?\/>/g) || [];
    assert.ok(
      inputs.some((input) => input.includes(`accessibilityLabel={${label}}`)),
      `${relativePath} must associate its critical input with a localized accessibility label`
    );
  }
});

test('shared async feedback is announced with status semantics', () => {
  const feedbackBanner = source('src/components/FeedbackBanner.js');
  assert.match(
    feedbackBanner,
    /accessibilityLiveRegion=\{tone === 'error' \? 'assertive' : 'polite'\}/
  );

  const loadingState = source('src/components/LoadingState.js');
  assert.match(loadingState, /\baccessible\b/);
  assert.match(loadingState, /accessibilityLabel=\{message\}/);
  assert.match(loadingState, /accessibilityLiveRegion="polite"/);
  assert.match(loadingState, /accessibilityRole="progressbar"/);
  assert.match(loadingState, /accessibilityState=\{\{ busy: true \}\}/);
});

test('permission recovery never swallows a failed system-settings launch', () => {
  for (const relativePath of [
    'app/(auth)/jewelry-setup.js',
    'app/(auth)/location-permission.js',
    'app/(tabs)/map.js',
    'app/safety-call.js'
  ]) {
    const contents = source(relativePath);
    assert.doesNotMatch(
      contents,
      /Linking\.openSettings\(\)\.catch\(\(\) => \{\}\)/,
      `${relativePath} must not silently discard Settings launch failures`
    );
    assert.match(contents, /const openSystemSettings = useCallback\(async \(\) => \{/);
    assert.match(contents, /settings\.linkFailed/);
  }
});

test('semantic screen and modal section titles participate in heading navigation', () => {
  for (const [relativePath, translationKey] of [
    ['app/(tabs)/index.js', 'settings.deviceManagement'],
    ['app/(tabs)/index.js', 'settings.sections.deviceSafety'],
    ['app/(tabs)/index.js', 'home.mode'],
    ['app/(tabs)/map.js', 'settings.deviceManagement'],
    ['app/(tabs)/map.js', 'map.savedTitle'],
    ['app/device-management.js', 'settings.sections.deviceSafety'],
    ['app/medication-reminders.js', 'medication.create'],
    ['app/medication-reminders.js', 'medication.upcoming'],
    ['app/emergency-sos.js', 'releaseCritical.lastSOSAttempt'],
    ['src/components/CountryPicker.js', 'phone.selectCountry'],
    ['src/components/LanguageSelector.js', 'languages.title']
  ]) {
    const contents = source(relativePath);
    const escapedKey = translationKey.replaceAll('.', '\\.');
    assert.match(
      contents,
      new RegExp(`<Text[\\s\\S]{0,240}?accessibilityRole="header"[\\s\\S]{0,240}?>[\\s\\S]{0,120}?\\{t\\('${escapedKey}'\\)`),
      `${relativePath} must expose ${translationKey} as a heading`
    );
  }

  const jewelrySetup = source('app/(auth)/jewelry-setup.js');
  assert.match(
    jewelrySetup,
    /<Text accessibilityRole="header"[^>]*>\{scanning \? t\('jewelry\.scanning'\) : t\('jewelry\.pairTitle'\)\}<\/Text>/
  );

  const emptyState = source('src/components/EmptyState.js');
  assert.match(emptyState, /<Text accessibilityRole="header"[^>]*>\{title\}<\/Text>/);
});

test('shared critical controls expand for Dynamic Type without clipping labels', () => {
  const button = source('src/components/Button.js');
  assert.doesNotMatch(button, /<Text\s+numberOfLines=/);
  assert.doesNotMatch(button, /base:\s*\{[^}]*overflow:\s*'hidden'/);
  assert.match(button, /row:\s*\{[^}]*flexShrink:\s*1/);
});

test('map annotations are named and decorative empty-state art stays silent', () => {
  const map = source('app/(tabs)/map.js');
  assert.match(map, /title=\{zoneTitle\}/);
  assert.match(map, /snippet=\{zoneDescription\}/);
  assert.match(map, /accessibilityLabel=\{zoneTitle\}/);
  assert.match(map, /accessibilityHint=\{zoneDescription\}/);

  const emptyState = source('src/components/EmptyState.js');
  assert.match(emptyState, /<Image accessible=\{false\}/);
});

test('protected detail screens expose visible, localized back navigation', () => {
  for (const relativePath of [
    'app/settings.js',
    'app/voices.js',
    'app/friends.js',
    'app/emergency-contacts.js',
    'app/medical-profile.js',
    'app/device-management.js',
    'app/medication-reminders.js',
    'app/conversation-history.js',
    'app/quick-share-location.js',
    'app/capybear-tap.js',
    'app/debug.js'
  ]) {
    const contents = source(relativePath);
    assert.match(contents, /showBack/);
    assert.match(contents, /backLabel=\{t\('common\.back'\)\}/);
  }
  const header = source('src/components/Header.js');
  assert.match(header, /const \{ isRTL \} = useI18n\(\)/);
  assert.match(header, /backButton: \{ width: 48, height: 48/);
});

test('medication management exposes an accessible create, list, and acknowledge journey', () => {
  const screen = source('app/medication-reminders.js');
  assert.match(screen, /accessibilityRole="radio"/);
  assert.match(screen, /accessibilityState=\{\{ checked: selected, disabled: Boolean\(busyAction\) \}\}/);
  assert.match(screen, /scheduleMedicationReminder\(input\)/);
  assert.match(screen, /listMedicationReminders\(\)/);
  assert.match(screen, /acknowledgeMedicationReminder\(reminderId\)/);
  assert.match(screen, /backLabel=\{t\('common\.back'\)\}/);

  const settings = source('app/settings.js');
  assert.match(settings, /router\.push\('\/medication-reminders'\)/);
  const authRouting = source('src/utils/auth-routing.js');
  assert.match(authRouting, /'medication-reminders'/);
});

test('medical emergency sharing is reachable, explicit, and accessibly labelled', () => {
  const settings = source('app/settings.js');
  const medicalProfile = source('app/medical-profile.js');
  const authRouting = source('src/utils/auth-routing.js');

  assert.match(settings, /router\.push\('\/medical-profile'\)/);
  assert.match(authRouting, /'medical-profile'/);
  assert.match(medicalProfile, /loadMedicalEmergencyProfile\(user\.id\)/);
  assert.match(medicalProfile, /saveMedicalEmergencyProfile\(user\.id/);
  assert.match(medicalProfile, /clearMedicalEmergencyProfile\(user\.id\)/);
  assert.match(medicalProfile, /accessibilityLabel=\{t\('medicalProfile\.shareLabel'\)\}/);
  assert.match(medicalProfile, /accessibilityHint=\{t\('medicalProfile\.shareHint'\)\}/);
  assert.match(medicalProfile, /consentRecordedAt: form\.shareInEmergency/);
  assert.match(medicalProfile, /toLocaleString\(locale\)/);
});

test('shared screen content is never hidden behind an entrance animation', () => {
  const screen = source('src/components/Screen.js');
  assert.doesNotMatch(screen, /entering=/);
  assert.doesNotMatch(screen, /FadeInDown|SCREEN_ENTERING/);
  assert.match(screen, /<View style=\{\[styles\.content/);
});

test('legacy voice, contact, picker, phone, and chat surfaces consume semantic design tokens', () => {
  for (const relativePath of [
    'app/(auth)/verify-code.js',
    'app/emergency-contacts.js',
    'app/voices.js',
    'src/components/ChatBubble.js',
    'src/components/CountryPicker.js',
    'src/components/GlobalPhoneInput.js',
    'src/components/LanguageSelector.js'
  ]) {
    const contents = source(relativePath);
    assert.doesNotMatch(contents, /#[0-9a-f]{3,8}\b/i, `${relativePath} must not embed palette values`);
    assert.doesNotMatch(contents, /fontFamily:\s*fonts\.|fontSize:\s*\d+/, `${relativePath} must use typography tokens`);
    assert.match(contents, /typography\./, `${relativePath} must consume typography tokens`);
  }
});

test('legacy async and modal controls expose busy, validation, retry, and modal semantics', () => {
  const voices = source('app/voices.js');
  assert.match(voices, /accessibilityState=\{\{ busy: saving, checked: selected, disabled: interactionDisabled \}\}/);
  assert.match(voices, /<FeedbackBanner[\s\S]*onAction=\{feedback \? retryFeedback : undefined\}/);

  const verification = source('app/(auth)/verify-code.js');
  assert.match(verification, /aria-invalid=\{codeTouched && !codeValid\}/);
  assert.match(verification, /accessibilityState=\{\{ busy: submitting, disabled: submitting \}\}/);

  const contacts = source('app/emergency-contacts.js');
  assert.match(contacts, /AccessibilityInfo\.announceForAccessibility\?\.\(t\(validationKey\)\)/);
  assert.match(contacts, /disabled=\{saving\}[\s\S]*onPress=\{save\}/);

  for (const relativePath of ['src/components/CountryPicker.js', 'src/components/LanguageSelector.js']) {
    assert.match(source(relativePath), /<SafeAreaView accessibilityViewIsModal/);
  }

  const language = source('src/components/LanguageSelector.js');
  assert.match(language, /accessibilityLabel=\{`\$\{t\('languages\.title'\)\}: \$\{languageLabel\(selectedLanguage\)\}`\}/);

  const chat = source('src/components/ChatBubble.js');
  assert.match(chat, /accessibilityState=\{\{ busy: retrying, disabled: retryDisabled \}\}/);
  assert.match(chat, /retry: \{ minHeight: sizes\.touchTarget/);
});

test('remaining legacy app shells and protected detail surfaces use semantic typography and palette tokens', () => {
  for (const relativePath of [
    'app/(auth)/location-permission.js',
    'app/(auth)/notification-permission.js',
    'app/(auth)/tutorial/choose-voice.js',
    'app/(tabs)/_layout.js',
    'app/conversation-history.js',
    'app/excuse-call.js',
    'app/friends.js',
    'app/settings.js',
    'src/components/AppErrorBoundary.js',
    'src/components/AppLoadingState.js'
  ]) {
    const contents = source(relativePath);
    assert.doesNotMatch(contents, /#[0-9a-f]{3,8}\b/i, `${relativePath} must not embed palette values`);
    assert.doesNotMatch(contents, /fontFamily:\s*fonts\.|fontSize:\s*\d+/, `${relativePath} must use typography tokens`);
    assert.match(contents, /typography\./, `${relativePath} must consume typography tokens`);
  }

  const onboarding = source('app/(auth)/onboarding.js');
  assert.doesNotMatch(onboarding, /rgba?\(|#[0-9a-f]{3,8}\b/i);
  assert.match(onboarding, /colors\.surfaceRaised/);
});

test('global fallback, settings, conversation, and onboarding controls expose complete semantics', () => {
  const boundary = source('src/components/AppErrorBoundary.js');
  assert.match(boundary, /accessibilityLiveRegion="assertive"/);
  assert.match(boundary, /<Button[\s\S]*accessibilityLabel=\{this\.props\.retryLabel\}/);

  const settings = source('app/settings.js');
  assert.match(settings, /accessibilityLabel=\{title\}/);
  assert.match(settings, /accessibilityHint=\{subtitle\}/);
  assert.match(settings, /accessibilityState=\{\{ checked: value, disabled \}\}/);
  assert.match(settings, /<Ionicons accessible=\{false\}/);

  const history = source('app/conversation-history.js');
  assert.match(history, /const \[busyAction, setBusyAction\] = useState\(null\)/);
  assert.match(history, /Promise\.allSettled/);
  assert.match(history, /errorKey === 'history\.loadFailed' \? refresh : undefined/);

  assert.match(source('app/excuse-call.js'), /<Image accessible=\{false\}/);
  assert.match(source('app/(auth)/tutorial/choose-voice.js'), /<Image accessible=\{false\}/);

  const progress = source('src/components/OnboardingProgress.js');
  assert.match(progress, /accessibilityValue=\{\{ min: 1, max: safeTotal, now: safeCurrent \}\}/);
  assert.doesNotMatch(progress, /accessibilityLabel=\{`\$\{safeCurrent\}/);

  assert.match(source('app/(tabs)/_layout.js'), /tabBarAllowFontScaling: true/);
  assert.match(source('app/_layout.js'), /name === 'safety-call' \? \{ gestureEnabled: false \}/);
});

test('feedback and native sign-in surfaces remain operable with assistive technology and large text', () => {
  const feedback = source('src/components/InteractionFeedbackModal.js');
  assert.match(feedback, /<SafeAreaView edges=\{\['bottom'\]\}/);
  assert.match(feedback, /<ScrollView/);
  assert.match(feedback, /maxHeight: '100%'/);
  assert.match(feedback, /accessibilityViewIsModal/);
  assert.match(feedback, /AccessibilityInfo\.setAccessibilityFocus/);

  const apple = source('src/components/AppleSignInButton.js');
  assert.match(apple, /accessibilityRole="progressbar"/);
  assert.match(apple, /accessibilityRole="button"/);
  assert.match(apple, /accessibilityState=\{\{ busy: Boolean\(loading\), disabled: Boolean\(disabled \|\| loading\) \}\}/);
});

test('remaining utility screens use semantic palette and typography tokens', () => {
  for (const relativePath of ['app/debug.js', 'app/capybear-tap.js']) {
    const contents = source(relativePath);
    assert.doesNotMatch(contents, /#[0-9a-f]{3,8}\b/i);
    assert.doesNotMatch(contents, /fontFamily:\s*fonts\.|fontSize:\s*\d+/);
    assert.match(contents, /typography\./);
    assert.match(contents, /isRTL/);
  }
});

test('shared controls expose selection only when it is a meaningful state', () => {
  for (const relativePath of ['src/components/Button.js', 'src/components/ActionTile.js']) {
    const contents = source(relativePath);
    assert.doesNotMatch(contents, /selected = false/);
    assert.match(contents, /typeof selected === 'boolean' \? \{ selected \} : \{\}/);
    assert.match(contents, /selected === true && styles\.selected/);
  }
});

test('home quick actions retain a readable width with large text and translated labels', () => {
  const home = source('app/(tabs)/index.js');
  assert.match(home, /quickAction: \{ minWidth: 220, flexBasis: '47%', flexGrow: 1 \}/);
});

test('selection modals move accessibility focus into the modal and restore it to their trigger', () => {
  const phone = source('src/components/GlobalPhoneInput.js');
  const country = source('src/components/CountryPicker.js');
  const language = source('src/components/LanguageSelector.js');

  assert.match(phone, /ref=\{countryButtonRef\}/);
  assert.match(phone, /returnFocusRef=\{countryButtonRef\}/);
  assert.match(country, /const titleRef = useRef\(null\)/);
  assert.match(country, /returnFocusRef\?\.current/);
  assert.match(country, /AccessibilityInfo\.setAccessibilityFocus/);
  assert.match(country, /accessibilityRole="header"[\s\S]*ref=\{titleRef\}/);
  assert.match(language, /ref=\{triggerRef\}/);
  assert.match(language, /const titleRef = useRef\(null\)/);
  assert.match(language, /AccessibilityInfo\.setAccessibilityFocus/);
  assert.match(language, /accessibilityRole="header"[\s\S]*ref=\{titleRef\}/);
});

test('remaining large-text and live-status surfaces expose resilient semantics', () => {
  const excuseCall = source('app/excuse-call.js');
  const medicalProfile = source('app/medical-profile.js');
  const scenarioStatus = source('src/components/ScenarioStatusCard.js');
  const deviceStatus = source('src/components/DeviceStatusCard.js');
  const onboardingProgress = source('src/components/OnboardingProgress.js');

  assert.doesNotMatch(excuseCall, /<Screen scroll=\{false\}/);
  assert.match(medicalProfile, /accessibilityState=\{\{[\s\S]*checked: form\.shareInEmergency,[\s\S]*disabled: Boolean\(busyAction\)/);
  assert.match(scenarioStatus, /accessibilityLiveRegion="polite"/);
  assert.match(deviceStatus, /t\('device\.lastSeen'/);
  assert.doesNotMatch(deviceStatus, /t\('safetyCall\.connected'\) ·/);
  assert.match(onboardingProgress, /accessibilityLabel=\{t\('tutorial\.progressAccessibility'\)\}/);
});
