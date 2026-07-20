import { afterEach, describe, expect, test } from '@jest/globals';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';

import { AdapterFactory } from '../../src/adapters/AdapterFactory';
import {
  createManufacturerMockServer,
  type ManufacturerMockLogEntry,
  type ManufacturerMockServer
} from '../../mocks/ManufacturerMockServer';

// These production gateway modules remain CommonJS while their adapter HAL is
// compiled from TypeScript.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ActionGateway } = require('../../action-gateway.cjs') as {
  readonly ActionGateway: new (options: Record<string, unknown>) => {
    registerSession(
      accountId: string,
      channel: unknown,
      devices: readonly Readonly<Record<string, unknown>>[]
    ): () => void;
    route(accountId: string, action: Readonly<Record<string, unknown>>): Promise<{
      readonly status: string;
      readonly action_id: string;
    }>;
    waitForActionOutcome(
      accountId: string,
      actionId: string,
      options?: Readonly<{ timeoutMs?: number }>
    ): Promise<Readonly<Record<string, unknown>>>;
    waitForDeliveries(): Promise<void>;
  };
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RobotAdapterRuntime } = require('../../robot-adapter-runtime.cjs') as {
  readonly RobotAdapterRuntime: new (options: Record<string, unknown>) => {
    authenticateCallback(adapterId: string, credential: string): boolean;
    deliverSignedAction(
      adapterId: string,
      signedAction: Readonly<Record<string, unknown>>,
      options?: Readonly<Record<string, unknown>>
    ): Promise<Readonly<Record<string, unknown>>>;
    getDeviceStatus(adapterId: string, manufacturerDeviceId: string): Promise<Readonly<Record<string, unknown>>>;
  };
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createHandler } = require('../../clm-server.cjs') as {
  readonly createHandler: (options: Record<string, unknown>) => (
    request: IncomingMessage,
    response: ServerResponse
  ) => Promise<void>;
};

const ACCOUNT_ID = 'account-async-ack-integration';
const APP_ROBOT_ID = 'home-robot-async-ack';
const MANUFACTURER_DEVICE_ID = 'manufacturer-device-private-async-ack';
const ADAPTER_ID = 'yongyida-cloud';
const BINDING_EPOCH = 23;
const CALLBACK_CREDENTIAL = 'mock-yongyida-callback-secret';
const MANUFACTURER_API_KEY = 'mock-server-only-api-key';

async function listenLoopback(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
  const port = (server.address() as AddressInfo).port;
  return `http://127.0.0.1:${port}`;
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server?.listening) return;
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function waitForCallbackLog(logs: readonly ManufacturerMockLogEntry[]): Promise<void> {
  const deadline = Date.now() + 500;
  while (!logs.some(({ event }) => event === 'manufacturer_mock.ack_callback')) {
    if (Date.now() >= deadline) throw new Error('Manufacturer ACK callback log was not recorded');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('manufacturer async ACK integration', () => {
  let manufacturer: ManufacturerMockServer | undefined;
  let callbackServer: Server | undefined;
  let gateway: InstanceType<typeof ActionGateway> | undefined;

  afterEach(async () => {
    await manufacturer?.stop();
    await gateway?.waitForDeliveries();
    await closeServer(callbackServer);
    manufacturer = undefined;
    gateway = undefined;
    callbackServer = undefined;
  });

  test('camera action traverses ActionGateway, real HAL adapter, mock bridge, and authenticated ACK callback', async () => {
    const keyPair = generateKeyPairSync('ed25519');
    const signingPrivateKey = keyPair.privateKey.export({ format: 'pem', type: 'pkcs8' });
    const logs: ManufacturerMockLogEntry[] = [];
    let callbackHandler: (request: IncomingMessage, response: ServerResponse) => void = (_request, response) => {
      response.writeHead(503, { 'Cache-Control': 'no-store' });
      response.end();
    };
    callbackServer = createServer((request, response) => callbackHandler(request, response));
    const callbackOrigin = await listenLoopback(callbackServer);

    manufacturer = createManufacturerMockServer({
      environment: 'test',
      port: 0,
      latencyMinMs: 0,
      latencyMaxMs: 0,
      failureRate: 0,
      signedActionPublicKey: createPublicKey(signingPrivateKey),
      asyncAckCallbackUrl: `${callbackOrigin}/v1/manufacturer/robot/ack`,
      asyncAckCallbackCredentials: { [ADAPTER_ID]: CALLBACK_CREDENTIAL },
      asyncAckDelayMs: 25,
      asyncAckTimeoutMs: 500,
      maxAsyncAckRequestBytes: 512,
      maxAsyncAckResponseBytes: 0,
      log: (entry) => logs.push(entry)
    });
    const { baseUrl: manufacturerBaseUrl } = await manufacturer.start();

    const runtime = new RobotAdapterRuntime({
      configurations: [{
        vendor: 'yongyida',
        adapterId: ADAPTER_ID,
        baseUrl: manufacturerBaseUrl,
        apiKey: MANUFACTURER_API_KEY,
        callbackApiKey: CALLBACK_CREDENTIAL,
        pairingVerifyURL: '',
        resetURL: '',
        privacyExportURL: '',
        privacyDeleteURL: '',
        timeoutMs: 500,
        maxAttempts: 1,
        retryBaseDelayMs: 0,
        retryMaxDelayMs: 0,
        allowInsecureHttp: true
      }],
      factoryClass: AdapterFactory,
      fetchImpl: globalThis.fetch,
      logger: { log: () => undefined },
      now: Date.now
    });

    gateway = new ActionGateway({
      signingPrivateKey,
      robotAdapterRuntime: runtime,
      retries: 1,
      retryDelayMs: 0,
      requestTimeoutMs: 500,
      robotAckTimeoutMs: 1_000,
      resolveRobotBinding: async () => ({
        active: true,
        state: 'active',
        manufacturerDeviceId: MANUFACTURER_DEVICE_ID,
        adapterId: ADAPTER_ID,
        bindingEpoch: BINDING_EPOCH
      }),
      isRobotBindingActive: async () => true,
      logger: { error: () => undefined, warn: () => undefined, info: () => undefined }
    });
    gateway.registerSession(ACCOUNT_ID, { readyState: 1, send: () => undefined }, [{
      device_id: APP_ROBOT_ID,
      device_type: 'home_robot',
      online: true
    }]);

    callbackHandler = createHandler({
      nodeEnv: 'test',
      actionGateway: gateway,
      robotAdapterRuntime: runtime,
      logger: { error: () => undefined, warn: () => undefined, info: () => undefined }
    });

    const cameraSession = 'camera-session_exact-opaque-e2e';
    const startedAt = performance.now();
    const accepted = await gateway.route(ACCOUNT_ID, {
      action: 'share_camera_view',
      device_type: 'home_robot',
      device_id: APP_ROBOT_ID,
      idempotency_key: 'camera-async-ack-e2e-001',
      parameters: { session_id: cameraSession }
    });
    expect(accepted.status).toBe('accepted');

    const outcome = await gateway.waitForActionOutcome(ACCOUNT_ID, accepted.action_id, { timeoutMs: 1_500 });
    expect(outcome).toEqual({
      status: 'delivered',
      action_id: accepted.action_id,
      camera_ready: true,
      camera_session_ref: cameraSession
    });
    expect(performance.now() - startedAt).toBeLessThan(500);

    expect(manufacturer.getCommandRecords()).toEqual([
      expect.objectContaining({
        deviceId: MANUFACTURER_DEVICE_ID,
        command: 'share_camera_view'
      })
    ]);
    await waitForCallbackLog(logs);
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'manufacturer_mock.request',
        route: '/v1/veryloving/yongyida-cloud/{operation}',
        statusCode: 202
      }),
      expect.objectContaining({
        event: 'manufacturer_mock.ack_callback',
        route: '/v1/manufacturer/robot/ack',
        statusCode: 204
      })
    ]));
    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain(CALLBACK_CREDENTIAL);
    expect(serializedLogs).not.toContain(MANUFACTURER_DEVICE_ID);
    expect(serializedLogs).not.toContain(cameraSession);
    expect(serializedLogs).not.toContain(accepted.action_id);
  });
});
