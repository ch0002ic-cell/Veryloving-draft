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
        /placeholderTextColor=\{colors\.inkSoft\}/,
        `${path.relative(ROOT, absolutePath)} must colour each placeholder`
      );
    }
  }
});

test('protected detail screens expose visible, localized back navigation', () => {
  for (const relativePath of [
    'app/settings.js',
    'app/voices.js',
    'app/friends.js',
    'app/emergency-contacts.js',
    'app/device-management.js',
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

test('shared screen content is never hidden behind an entrance animation', () => {
  const screen = source('src/components/Screen.js');
  assert.doesNotMatch(screen, /entering=/);
  assert.doesNotMatch(screen, /FadeInDown|SCREEN_ENTERING/);
  assert.match(screen, /<View style=\{\[styles\.content/);
});
