'use strict';

const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
  colors,
  layout,
  motion,
  radii,
  shadows,
  sizes,
  spacing,
  tones,
  typography
} = require('../src/constants/theme');

const ROOT = process.cwd();
const source = (relativePath) => readFileSync(path.resolve(ROOT, relativePath), 'utf8');
const sourceFiles = (relativeDirectory) => readdirSync(path.resolve(ROOT, relativeDirectory), {
  recursive: true,
  withFileTypes: true
}).filter((entry) => entry.isFile() && /\.[jt]sx?$/.test(entry.name)).map((entry) => path.join(
  entry.parentPath || entry.path,
  entry.name
));

test('design tokens expose semantic, type, size, depth, motion, and layout foundations', () => {
  assert.equal(colors.textPrimary, colors.ink);
  assert.equal(colors.textSecondary, colors.inkSoft);
  assert.equal(colors.surfaceCanvas, colors.cream);
  assert.equal(colors.surfaceRaised, colors.paper);
  assert.equal(colors.actionDanger, colors.redAccessible);
  assert.equal(tones.danger.foreground, colors.redAccessible);
  assert.equal(tones.warning.background, colors.goldSoft);
  assert.equal(typography.bodyLarge.fontSize, 16);
  assert.ok(typography.bodyLarge.lineHeight > typography.bodyLarge.fontSize);
  assert.ok(typography.displayLarge.fontSize > typography.titleLarge.fontSize);
  assert.equal(sizes.touchTarget, 44);
  assert.ok(sizes.control >= sizes.touchTarget);
  assert.ok(radii.xl > radii.md);
  assert.ok(radii.pill > radii.xl);
  assert.ok(shadows.raised.shadowOpacity > shadows.subtle.shadowOpacity);
  assert.ok(motion.durationFast < motion.durationEmphasis);
  assert.equal(layout.contentMaxWidth, 720);
  assert.ok(spacing.xxl > spacing.xl);
});

test('every mobile screen and shared component keeps palette, typography, and spacing in tokens', () => {
  const files = [...sourceFiles('app'), ...sourceFiles('src/components')];
  const rawPalette = /\b(?:color|backgroundColor|borderColor|shadowColor|textShadowColor|tintColor)\s*:\s*['"]#[0-9a-f]{3,8}\b/i;
  const rawTypography = /\b(?:fontSize|lineHeight|letterSpacing)\s*:\s*\d+(?:\.\d+)?\b/;
  const rawSpacing = /\b(?:padding|paddingTop|paddingBottom|paddingLeft|paddingRight|paddingHorizontal|paddingVertical|margin|marginTop|marginBottom|marginLeft|marginRight|marginHorizontal|marginVertical|gap|rowGap|columnGap)\s*:\s*\d+(?:\.\d+)?\b/;
  const violations = [];
  for (const file of files) {
    const contents = readFileSync(file, 'utf8');
    if (rawPalette.test(contents)) violations.push(`${path.relative(ROOT, file)}: raw palette`);
    if (rawTypography.test(contents)) violations.push(`${path.relative(ROOT, file)}: raw typography`);
    if (rawSpacing.test(contents)) violations.push(`${path.relative(ROOT, file)}: raw spacing`);
  }
  assert.deepEqual(violations, []);
});

test('shared button keeps legacy variants while exposing richer accessible states', () => {
  const button = source('src/components/Button.js');
  for (const variant of ['primary', 'orange', 'danger', 'ghost', 'secondary', 'success']) {
    assert.match(button, new RegExp(`${variant}:`));
  }
  assert.match(button, /const resolvedVariant = variantPalette\[variant\] \? variant : 'primary'/);
  assert.match(button, /accessibilityLabel=\{accessibilityLabel \|\| title\}/);
  assert.match(button, /accessibilityHint=\{accessibilityHint\}/);
  assert.match(button, /loadingLabel/);
  assert.match(button, /iconPosition === 'trailing'/);
});

test('cards remain backward compatible and can carry semantics and surface variants', () => {
  const card = source('src/components/Card.js');
  assert.match(card, /export function Card\(\{ children, style, variant = 'default', padding = 'md', \.\.\.viewProps \}\)/);
  assert.match(card, /<View \{\.\.\.viewProps\}/);
  for (const variant of ['default', 'flat', 'raised', 'tinted', 'critical']) {
    assert.match(card, new RegExp(`${variant}:`));
  }
});

test('headers identify headings and keep decorative brand art silent', () => {
  const header = source('src/components/Header.js');
  assert.match(header, /<Image accessible=\{false\}/);
  assert.match(header, /<Text accessibilityRole="header"/);
  assert.match(header, /eyebrow/);
  assert.match(header, /trailing/);
});

test('feedback supports warning and dismiss without weakening announcement semantics', () => {
  const feedback = source('src/components/FeedbackBanner.js');
  assert.match(feedback, /warning: \{/);
  assert.match(feedback, /dismissLabel/);
  assert.match(feedback, /onDismiss/);
  assert.match(feedback, /accessibilityRole="button"/);
  assert.match(feedback, /accessibilityLiveRegion=\{tone === 'error' \? 'assertive' : 'polite'\}/);
});

test('snackbar rerenders do not postpone an active auto-dismiss timer', () => {
  const snackbar = source('src/components/Snackbar.js');
  assert.match(snackbar, /const dismissRef = useRef\(onDismiss\)/);
  assert.match(snackbar, /dismissRef\.current = onDismiss/);
  assert.match(snackbar, /setTimeout\(\(\) => dismissRef\.current\?\.\(\), duration\)/);
  assert.match(snackbar, /\[canDismiss, duration, message\]/);
  assert.doesNotMatch(snackbar, /\[duration, message, onDismiss\]/);
});

test('text field owns labels, validation, disabled state, focus, and RTL presentation', () => {
  const field = source('src/components/TextField.js');
  assert.match(field, /forwardRef/);
  assert.match(field, /aria-invalid=\{hasError\}/);
  assert.match(field, /aria-required=\{required\}/);
  assert.match(field, /accessibilityLabel=\{accessibilityLabel \|\| label\}/);
  assert.match(field, /accessibilityState=\{\{ disabled: !isEditable \}\}/);
  assert.match(field, /placeholderTextColor=\{colors\.textSecondary\}/);
  assert.match(field, /accessibilityRole="alert"/);
  assert.match(field, /focused && styles\.focused/);
  assert.match(field, /isRTL && styles\.rtlRow/);
});

test('skeletons stop animation and honor the operating-system motion preference', () => {
  const skeleton = source('src/components/Skeleton.js');
  assert.match(skeleton, /AccessibilityInfo\.isReduceMotionEnabled\(\)/);
  assert.match(skeleton, /reduceMotionChanged/);
  assert.match(skeleton, /if \(reduceMotion\)/);
  assert.match(skeleton, /pulse\.stop\(\)/);
  assert.match(skeleton, /accessible=\{false\}/);
  assert.match(skeleton, /accessibilityRole="progressbar"/);
});

test('shared empty-state motion and safe-area offsets consume design tokens', () => {
  const emptyState = source('src/components/EmptyState.js');
  assert.match(emptyState, /FadeIn\.duration\(motion\.durationEmphasis\)/);
  assert.doesNotMatch(emptyState, /FadeIn\.duration\(\d+\)/);

  const map = source('app/(tabs)/map.js');
  assert.match(map, /insets\.top \+ spacing\.mdSm/);
  assert.match(map, /insets\.bottom \+ spacing\.md/);
  assert.doesNotMatch(map, /insets\.(?:top|bottom) \+ \d+/);
});

test('action tiles provide labelled, disabled, RTL-aware navigation targets', () => {
  const tile = source('src/components/ActionTile.js');
  assert.match(tile, /accessibilityRole="button"/);
  assert.match(tile, /accessibilityState=\{\{[\s\S]*disabled,[\s\S]*typeof selected === 'boolean'[\s\S]*\}\}/);
  assert.match(tile, /accessibilityHint=\{accessibilityHint \|\| description\}/);
  assert.match(tile, /isRTL && styles\.rtlRow/);
  assert.match(tile, /name=\{isRTL \? 'chevron-back' : 'chevron-forward'\}/);
});

test('status pills wrap long localized labels within their parent surface', () => {
  const pill = source('src/components/StatusPill.js');
  assert.match(pill, /maxWidth: '100%'/);
  assert.match(pill, /text: \{ flexShrink: 1/);
  assert.match(pill, /icon: \{ flexShrink: 0 \}/);
});
