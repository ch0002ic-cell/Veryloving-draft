import { RobotAdapterError } from './AdapterErrors';
import { RestRobotAdapter, type RestRobotAdapterOptions } from './RestRobotAdapter';

/**
 * Yongyida cloud adapter for a provisional Veryloving-owned bridge contract.
 *
 * The paths and operation identifiers below are not represented as Yongyida
 * public APIs. The bridge is the contract boundary where approved Yongyida
 * cloud API/SDK calls will be implemented after partner documentation and
 * credentials are supplied.
 */
export class YongyidaAdapter extends RestRobotAdapter {
  protected readonly contractPrefix = 'v1/veryloving/yongyida-cloud';

  constructor(options: RestRobotAdapterOptions) {
    super('yongyida', options);
  }

  protected translateOperation(operation: string): string {
    const operations: Readonly<Record<string, string>> = {
      send_medication_reminder: 'VL_SEND_MEDICATION_REMINDER',
      activate_fall_alert: 'VL_ACTIVATE_FALL_ALERT',
      execute_safety_check: 'VL_EXECUTE_SAFETY_CHECK',
      play_soothing_audio: 'VL_PLAY_SOOTHING_AUDIO',
      start_two_way_voice_call: 'VL_START_TWO_WAY_VOICE_CALL',
      emergency_stop: 'VL_EMERGENCY_STOP',
      activate_alarm: 'VL_ACTIVATE_ALARM',
      set_config: 'VL_SET_CONFIG'
    };
    const translated = operations[operation];
    if (!translated) {
      throw new RobotAdapterError('ADAPTER_REQUEST_INVALID', 'Robot operation is unsupported');
    }
    return translated;
  }
}

