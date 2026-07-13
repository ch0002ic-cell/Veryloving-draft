export const BLE_ERROR_CODES = Object.freeze({
  unavailable: 'BLE_UNAVAILABLE',
  notReady: 'BLE_NOT_READY',
  poweredOff: 'BLE_POWERED_OFF',
  permissionDenied: 'BLE_PERMISSION_DENIED',
  permissionRequestFailed: 'BLE_PERMISSION_REQUEST_FAILED',
  noDevices: 'BLE_NO_DEVICES',
  scanStartFailed: 'BLE_SCAN_START_FAILED',
  scanFailed: 'BLE_SCAN_FAILED',
  invalidDevice: 'BLE_INVALID_DEVICE',
  connectTimeout: 'BLE_CONNECT_TIMEOUT',
  connectFailed: 'BLE_CONNECT_FAILED',
  protocolNotConfigured: 'BLE_PROTOCOL_NOT_CONFIGURED',
  incompatibleDevice: 'BLE_INCOMPATIBLE_DEVICE',
  disconnectFailed: 'BLE_DISCONNECT_FAILED'
});

const NATIVE_BLE_ERROR_CODES = Object.freeze({
  bluetoothUnsupported: 100,
  bluetoothUnauthorized: 101,
  bluetoothPoweredOff: 102
});

export class BLEOperationError extends Error {
  constructor(code, message, { nativeErrorCode, phase } = {}) {
    super(message);
    this.name = 'BLEOperationError';
    this.code = code;
    this.nativeErrorCode = nativeErrorCode;
    this.phase = phase;
  }
}

export function errorCodeForBluetoothState(state) {
  switch (state) {
    case 'PoweredOn':
      return null;
    case 'PoweredOff':
      return BLE_ERROR_CODES.poweredOff;
    case 'Unauthorized':
      return BLE_ERROR_CODES.permissionDenied;
    case 'Unsupported':
      return BLE_ERROR_CODES.unavailable;
    case 'Unknown':
    case 'Resetting':
      return BLE_ERROR_CODES.notReady;
    default:
      return BLE_ERROR_CODES.notReady;
  }
}

export function classifyNativeBLEError(error, phase = 'scan') {
  if (typeof error?.code === 'string' && error.code.startsWith('BLE_')) return error.code;
  const nativeErrorCode = Number(error?.errorCode);
  if (nativeErrorCode === NATIVE_BLE_ERROR_CODES.bluetoothUnsupported) return BLE_ERROR_CODES.unavailable;
  if (nativeErrorCode === NATIVE_BLE_ERROR_CODES.bluetoothUnauthorized) return BLE_ERROR_CODES.permissionDenied;
  if (nativeErrorCode === NATIVE_BLE_ERROR_CODES.bluetoothPoweredOff) return BLE_ERROR_CODES.poweredOff;
  if (error?.code === 'TIMEOUT') return BLE_ERROR_CODES.connectTimeout;
  if (phase === 'connect') return BLE_ERROR_CODES.connectFailed;
  if (phase === 'disconnect') return BLE_ERROR_CODES.disconnectFailed;
  return BLE_ERROR_CODES.scanFailed;
}
