'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  androidBluetoothPermissions,
  getAndroidBluetoothPermissions,
  hasGrantedAndroidBluetoothPermissions
} = require('../src/services/ble-permissions');

test('Android BLE requests location only on API 30 and lower', () => {
  assert.deepEqual(
    getAndroidBluetoothPermissions(30),
    [androidBluetoothPermissions.fineLocation]
  );
});

test('Android BLE requests nearby-device permissions on API 31 and higher', () => {
  const expected = [
    androidBluetoothPermissions.scan,
    androidBluetoothPermissions.connect
  ];
  assert.deepEqual(getAndroidBluetoothPermissions(31), expected);
  assert.deepEqual(getAndroidBluetoothPermissions('36'), expected);
});

test('Android BLE continues only when every runtime permission is granted', () => {
  const permissions = getAndroidBluetoothPermissions(36);
  assert.equal(hasGrantedAndroidBluetoothPermissions({
    [androidBluetoothPermissions.scan]: 'granted',
    [androidBluetoothPermissions.connect]: 'granted'
  }, permissions), true);
  assert.equal(hasGrantedAndroidBluetoothPermissions({
    [androidBluetoothPermissions.scan]: 'granted',
    [androidBluetoothPermissions.connect]: 'denied'
  }, permissions), false);
});
