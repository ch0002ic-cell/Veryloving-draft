import { useEffect, useMemo } from 'react';
import { useAppState } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { bleService } from '../services/ble-runtime';
import { RoboticsCommandQueue, priorityForRobotAction } from '../services/robotics-command-queue';
import { verifyRobotActionEnvelope, verifyRobotActionWithGateway } from '../services/robotics-auth';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

export function useRoboticsOrchestrator() {
  const { accessToken } = useAuth();
  const { device, robotActionEnvelope, clearRobotActionEnvelope } = useAppState();
  const queue = useMemo(() => new RoboticsCommandQueue({ driver: bleService, deviceId: device.id }), []);

  useEffect(() => {
    queue.setDevice(device.id);
  }, [device.id, queue]);

  useEffect(() => {
    if (!robotActionEnvelope) return;
    let active = true;
    verifyRobotActionEnvelope(robotActionEnvelope, {
      accessToken,
      verifySignature: (token) => verifyRobotActionWithGateway(token, {
        accessToken,
        apiBaseUrl: config.apiBaseUrl
      })
    }).then((action) => {
      if (!active || !action) {
        logger.warn('[RoboticsOrchestrator] rejected unsigned or invalid action');
        return;
      }
      return queue.enqueue({ name: action.name, ...action.parameters }, { priority: priorityForRobotAction(action) });
    }).catch((error) => logger.warn('[RoboticsOrchestrator] action failed', {
      errorCode: error?.code || error?.name || 'ROBOT_ACTION_FAILED'
    })).finally(() => clearRobotActionEnvelope(robotActionEnvelope));
    return () => { active = false; };
  }, [accessToken, clearRobotActionEnvelope, queue, robotActionEnvelope]);

  useEffect(() => () => queue.clear(), [queue]);
  return queue;
}
