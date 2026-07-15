'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  LTR_DIRECTION,
  RTL_DIRECTION,
  localeDirection,
  normalizeLocaleDirection,
  shouldReloadForLocaleDirection
} = require('../src/services/locale-direction');

test('locale direction names are strict and deterministic', () => {
  assert.equal(localeDirection(false), LTR_DIRECTION);
  assert.equal(localeDirection(true), RTL_DIRECTION);
  assert.equal(normalizeLocaleDirection('ltr'), LTR_DIRECTION);
  assert.equal(normalizeLocaleDirection('rtl'), RTL_DIRECTION);
  assert.equal(normalizeLocaleDirection('RTL'), null);
  assert.equal(normalizeLocaleDirection(null), null);
});

test('the first direction change follows the native bridge snapshot', () => {
  assert.equal(shouldReloadForLocaleDirection({
    desiredDirection: RTL_DIRECTION,
    nativeIsRTL: false,
    recordedDirection: null
  }), true);
  assert.equal(shouldReloadForLocaleDirection({
    desiredDirection: LTR_DIRECTION,
    nativeIsRTL: false,
    recordedDirection: null
  }), false);
});

test('a recorded target suppresses duplicate bridge reloads with stale isRTL', () => {
  assert.equal(shouldReloadForLocaleDirection({
    desiredDirection: RTL_DIRECTION,
    nativeIsRTL: false,
    recordedDirection: RTL_DIRECTION
  }), false);
  assert.equal(shouldReloadForLocaleDirection({
    desiredDirection: LTR_DIRECTION,
    nativeIsRTL: true,
    recordedDirection: LTR_DIRECTION
  }), false);
});

test('an opposite recorded target forces one reload even when isRTL is stale', () => {
  assert.equal(shouldReloadForLocaleDirection({
    desiredDirection: LTR_DIRECTION,
    nativeIsRTL: false,
    recordedDirection: RTL_DIRECTION
  }), true);
  assert.equal(shouldReloadForLocaleDirection({
    desiredDirection: RTL_DIRECTION,
    nativeIsRTL: true,
    recordedDirection: LTR_DIRECTION
  }), true);
  assert.throws(() => shouldReloadForLocaleDirection({
    desiredDirection: 'invalid',
    nativeIsRTL: false,
    recordedDirection: null
  }), /valid locale direction/i);
});
