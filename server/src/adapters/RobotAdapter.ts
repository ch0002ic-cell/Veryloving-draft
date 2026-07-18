/**
 * Vendor-neutral server-side contract for Product 2 robot integrations.
 *
 * These types describe Veryloving's abstraction. They do not represent a
 * published Yongyida or Jiangzhi API. Vendor adapters translate this contract
 * to a provisional Veryloving-owned cloud or Android edge bridge until the
 * manufacturers approve their final protocols.
 */

export type RobotVendor = 'yongyida' | 'jiangzhi';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };

export interface RobotCredentials {
  /** Account-bound manufacturer device identifier. Never written to logs. */
  readonly deviceId: string;
  /** Optional one-time bootstrap claim. It is discarded after initialization. */
  readonly pairingToken?: string;
}

export interface Medication {
  readonly id: string;
  readonly name: string;
  readonly dosage?: string;
  readonly instructions?: string;
  readonly scheduledAt?: string;
  /** Stable caller-generated identifier; reused across transport retries. */
  readonly requestId?: string;
}

export interface User {
  readonly id: string;
  readonly preferredLanguage?: string;
}

export type CommandState = 'accepted' | 'completed' | 'rejected';

export interface CommandResult {
  readonly success: boolean;
  readonly commandId: string;
  readonly state: CommandState;
  readonly acceptedAt?: string;
}

export type VitalSignKind =
  | 'blood_pressure_systolic'
  | 'blood_pressure_diastolic'
  | 'blood_glucose'
  | 'heart_rate'
  | 'oxygen_saturation'
  | 'respiratory_rate'
  | 'temperature';

export interface VitalSign {
  readonly kind: VitalSignKind;
  readonly value: number;
  readonly unit: string;
  readonly observedAt: string;
  readonly quality?: 'good' | 'uncertain' | 'poor';
}

export interface SafetyFinding {
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'critical';
}

export interface SafetyReport {
  readonly commandId: string;
  readonly accepted: boolean;
  readonly findings: readonly SafetyFinding[];
}

export interface CallStatus {
  readonly commandId: string;
  readonly state: 'accepted' | 'ringing' | 'connected' | 'ended' | 'failed';
}

export interface BatteryInfo {
  readonly percentage: number;
  readonly charging: boolean;
  readonly observedAt: string;
}

export interface DeviceStatus {
  readonly online: boolean;
  readonly state: 'online' | 'offline' | 'degraded' | 'busy';
  readonly observedAt: string;
  readonly firmwareVersion?: string;
}

export interface RobotLocation {
  readonly longitude: number;
  readonly latitude: number;
  /** Vendor-attested capture time as Unix epoch milliseconds. */
  readonly capturedAt: number;
}

export type NavigationCoordinate = readonly [longitude: number, latitude: number];

export interface RobotNavigationPath {
  readonly coordinates: readonly NavigationCoordinate[];
  /** Vendor-attested capture time for the complete path as Unix epoch milliseconds. */
  readonly capturedAt: number;
}

export interface IndoorPosition {
  readonly mapId?: string;
  readonly floorId?: string;
  readonly roomId?: string;
  readonly xMeters?: number;
  readonly yMeters?: number;
  readonly confidence?: number;
  readonly capturedAt: number;
}

export interface RobotSafetyEvent {
  readonly eventType: 'fall';
  readonly eventId: string;
  readonly occurredAt: number;
  readonly confidence?: number;
}

export interface MedicationAcknowledgement {
  readonly reminderId: string;
  readonly receiptId: string;
  readonly deliveredAt: number;
}

/**
 * One bounded, point-in-time telemetry response from a provisional vendor
 * bridge. Status is mandatory; capabilities unsupported by a robot SKU are
 * omitted rather than filled with invented data.
 */
export interface RobotTelemetrySnapshot {
  readonly status: DeviceStatus;
  readonly battery?: BatteryInfo;
  readonly vitals?: readonly VitalSign[];
  readonly location?: RobotLocation;
  readonly navigationPath?: RobotNavigationPath;
  readonly indoorPosition?: IndoorPosition;
  readonly safetyEvents?: readonly RobotSafetyEvent[];
  readonly medicationAcknowledgements?: readonly MedicationAcknowledgement[];
}

export interface RobotConfig {
  readonly values: Readonly<Record<string, JsonValue>>;
  readonly requestId?: string;
}

export interface SignedRobotActionEnvelope {
  readonly version: 2;
  readonly id: string;
  readonly issued_at: number;
  readonly expires_at: number;
  readonly action: string;
  readonly device_type: 'home_robot';
  readonly adapter_id: string;
  readonly contract_version: 'vl-robot-action/2';
  /** Private Veryloving device identity used by account/session routing. */
  readonly device_id: string;
  /** Server-resolved manufacturer identity used only at the bridge boundary. */
  readonly manufacturer_device_id: string;
  /** Monotonically increasing account-binding generation; old epochs are fenced after reset. */
  readonly binding_epoch: number;
  readonly parameters: Readonly<Record<string, JsonValue>>;
  readonly idempotency_key?: string;
}

/** The ActionGateway-produced object is forwarded without reconstruction. */
export interface SignedRobotAction {
  readonly envelope: SignedRobotActionEnvelope;
  readonly payload: string;
  readonly signature: string;
  readonly algorithm: 'Ed25519';
}

export interface SignedActionDeliveryResult {
  readonly status: 'accepted' | 'acknowledged';
  readonly statusCode: number;
  readonly acknowledged: boolean;
}

export interface RobotAdapter {
  /** Immutable deployment identity; multiple vendor adapters may coexist. */
  readonly adapterId: string;
  readonly vendor: RobotVendor;

  initialize(credentials: RobotCredentials): Promise<void>;

  sendMedicationReminder(medication: Medication, user: User): Promise<CommandResult>;
  activateFallAlert(location: string): Promise<CommandResult>;
  streamVitals(): Promise<AsyncIterable<VitalSign>>;
  executeSafetyCheck(area: string): Promise<SafetyReport>;
  playSoothingAudio(audioId: string, volume: number): Promise<CommandResult>;
  startTwoWayVoiceCall(contactId: string): Promise<CallStatus>;
  getBatteryStatus(): Promise<BatteryInfo>;
  getDeviceStatus(): Promise<DeviceStatus>;
  getTelemetrySnapshot(): Promise<RobotTelemetrySnapshot>;

  emergencyStop(): Promise<CommandResult>;
  activateAlarm(): Promise<CommandResult>;
  setConfig(config: RobotConfig): Promise<CommandResult>;

  /**
   * Forward an already-signed ActionGateway payload without re-signing it.
   * The initialized manufacturer device ID must match manufacturer_device_id;
   * device_id remains the private Veryloving account/session identity.
   */
  deliverSignedAction(action: SignedRobotAction): Promise<SignedActionDeliveryResult>;
}
