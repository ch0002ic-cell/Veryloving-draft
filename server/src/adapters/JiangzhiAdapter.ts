import { RobotAdapterError } from './AdapterErrors';
import { RestRobotAdapter, type RestRobotAdapterOptions } from './RestRobotAdapter';

/**
 * Jiangzhi Android edge-bridge adapter.
 *
 * Production commands are sent to a Veryloving-managed Android Service/API on
 * the robot. ADB is deliberately excluded from the runtime path: it is an
 * insecure development/provisioning tool, not an authentication or command
 * transport. These provisional operation names must be mapped to approved
 * Jiangzhi/Kangyang Harbor SDK calls inside the signed edge application.
 */
export class JiangzhiAdapter extends RestRobotAdapter {
  protected readonly contractPrefix = 'v1/veryloving/jiangzhi-edge';

  constructor(options: RestRobotAdapterOptions) {
    super('jiangzhi', options);
  }

  protected translateOperation(operation: string): string {
    const operations: Readonly<Record<string, string>> = {
      send_medication_reminder: 'vl.edge.medication.remind',
      activate_fall_alert: 'vl.edge.safety.fall_alert',
      execute_safety_check: 'vl.edge.safety.check',
      play_soothing_audio: 'vl.edge.media.soothing_audio',
      start_two_way_voice_call: 'vl.edge.communication.two_way_call',
      emergency_stop: 'vl.edge.motion.emergency_stop',
      activate_alarm: 'vl.edge.safety.alarm',
      set_config: 'vl.edge.configuration.apply'
    };
    const translated = operations[operation];
    if (!translated) {
      throw new RobotAdapterError('ADAPTER_REQUEST_INVALID', 'Robot operation is unsupported');
    }
    return translated;
  }
}

