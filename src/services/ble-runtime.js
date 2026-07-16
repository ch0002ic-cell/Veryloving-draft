const mockMode = process.env.EXPO_PUBLIC_ROBOTICS_MOCK_MODE === 'true';

// The production BLE module already loads its native dependency lazily. This
// runtime boundary keeps its exact implementation as the default while making
// simulator builds resolve the WebSocket-backed contract instead.
const runtime = mockMode
  ? require('./robotics-mock-driver')
  : require('./ble');

export const bleService = runtime.bleService;
export const roboticsMockMode = mockMode;
