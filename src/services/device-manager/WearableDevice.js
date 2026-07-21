import { bleService } from '../ble';
import { BaseDevice, DEVICE_TYPES } from './BaseDevice';

export class WearableDevice extends BaseDevice {
  constructor({ deviceId, name, nativeDevice, bleClient = bleService } = {}) {
    super({ deviceId, deviceType: DEVICE_TYPES.wearable, name });
    this.nativeDevice = nativeDevice || { id: deviceId, name };
    this.bleClient = bleClient;
    this.removeBLEHandler = null;
  }

  async connect(options) {
    const connected = await this.bleClient.connect(this.nativeDevice, options);
    this.setStatus({ ...connected, online: true, connectionState: 'connected' });
    return this.getStatus();
  }

  async reconnect(options) {
    const connected = await this.bleClient.reconnectWithBackoff(this.nativeDevice, options);
    this.setStatus({ ...connected, online: true, connectionState: 'connected' });
    return this.getStatus();
  }

  async disconnect() {
    await this.bleClient.disconnect(this.deviceId);
    return this.setStatus({ online: false, connected: false, connectionState: 'disconnected' });
  }

  sendCommand(command) {
    const payload = typeof command === 'string' ? command : command?.payload;
    const stop = typeof command === 'object' && [command.action, command.type, command.command]
      .some((value) => typeof value === 'string' && value.toLowerCase() === 'stop');
    const priority = stop ? 'critical' : command?.priority || 'standard';
    return this.enqueueCommand(async () => {
      await this.bleClient.writeCommand(this.deviceId, payload, { withResponse: command?.withResponse !== false });
      return { accepted: true, deviceId: this.deviceId };
    }, { priority, bypass: stop });
  }

  ensureBLETelemetryBridge() {
    if (this.removeBLEHandler || this.disposed) return;
    const registerHandler = this.bleClient.addEventHandler || this.bleClient.setEventHandler;
    if (typeof registerHandler !== 'function') return;
    this.removeBLEHandler = (this.bleClient.addEventHandler || this.bleClient.setEventHandler).call(this.bleClient, {
      onBattery: (deviceId, battery) => deviceId === this.deviceId && this.emitTelemetry({ type: 'battery', battery }),
      onStatus: (deviceId, value) => deviceId === this.deviceId && this.emitTelemetry({ type: 'status', value }),
      onEvent: (deviceId, value) => deviceId === this.deviceId && this.emitTelemetry({ type: 'event', value }),
      onDisconnected: (deviceId) => {
        if (deviceId !== this.deviceId) return;
        this.setStatus({ online: false, connected: false, connectionState: 'disconnected' });
        this.emitTelemetry({ type: 'connection', online: false });
      }
    });
  }

  onTelemetry(callback) {
    const unsubscribe = super.onTelemetry(callback);
    this.ensureBLETelemetryBridge();
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      unsubscribe();
      if (this.telemetryListeners.size === 0) {
        this.removeBLEHandler?.();
        this.removeBLEHandler = null;
      }
    };
  }

  dispose() {
    if (this.disposed) return;
    super.dispose();
    this.removeBLEHandler?.();
    this.removeBLEHandler = null;
    this.bleClient.disconnect?.(this.deviceId).catch?.(() => {});
  }

  static scan(onDevice, options) { return bleService.scanForDevices(onDevice, options); }
  static stopScan(reason) { return bleService.stopScan(reason); }
}

export const wearableBLE = Object.freeze({
  scanForDevices: WearableDevice.scan,
  stopScan: WearableDevice.stopScan,
  connect: (device, options) => bleService.connect(device, options),
  reconnect: (device, options) => bleService.reconnectWithBackoff(device, options),
  disconnect: (deviceId) => bleService.disconnect(deviceId),
  setEventHandler: (handler) => bleService.setEventHandler(handler),
  addEventHandler: (handler) => bleService.addEventHandler(handler),
  sendCommand: (deviceId, payload, options) => bleService.writeCommand(deviceId, payload, options)
});
