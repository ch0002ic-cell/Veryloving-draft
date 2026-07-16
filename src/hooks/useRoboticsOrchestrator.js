import { useEffect, useMemo, useRef } from 'react';
import { useAppState } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { bleService } from '../services/ble-runtime';
import { RoboticsCommandQueue, priorityForRobotAction } from '../services/robotics-command-queue';
import { verifyRobotActionEnvelope, verifyRobotActionWithGateway } from '../services/robotics-auth';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

export function useRoboticsOrchestrator() {
  const { accessToken } = useAuth();
  const {
    device,
    robotActionEnvelope,
    clearRobotActionEnvelope,
    setRoboticsError
  } = useAppState();
  const processingTokensRef = useRef(new Set());
  const queue = useMemo(() => new RoboticsCommandQueue({
    driver: bleService,
    deviceId: null,
    connectionReady: false
  }), []);

  useEffect(() => {
    queue.setDevice(device.id);
    const driverReady = !config.roboticsMockMode || bleService.isDeviceConnected?.(device.id) === true;
    queue.setConnectionReady(device.connected === true && driverReady);
  }, [device.connected, device.id, queue]);

  useEffect(() => {
    const remove = bleService.addConnectionStateListener?.((state, context) => {
      if (state === 'connected' && context?.deviceId === device.id) {
        queue.setConnectionReady(true, { deviceId: device.id });
      } else if (state === 'disconnected') {
        queue.setConnectionReady(false);
      }
    });
    return () => remove?.();
  }, [device.id, queue]);

  useEffect(() => queue.addFailureListener((failure) => {
    setRoboticsError({
      message: failure.message,
      errorCode: failure.errorCode,
      receivedAt: Date.now()
    });
  }), [queue, setRoboticsError]);

  useEffect(() => {
    if (!robotActionEnvelope) return;
    if (processingTokensRef.current.has(robotActionEnvelope.token)) return;
    processingTokensRef.current.add(robotActionEnvelope.token);
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
      const parameters = action.parameters && typeof action.parameters === 'object' ? action.parameters : {};
      const command = {
        ...(Number.isFinite(parameters.latitude) ? { latitude: parameters.latitude } : {}),
        ...(Number.isFinite(parameters.longitude) ? { longitude: parameters.longitude } : {}),
        ...(Number.isFinite(parameters.speed) ? { speed: parameters.speed } : {}),
        ...(typeof parameters.reason === 'string' ? { reason: parameters.reason.slice(0, 120) } : {}),
        id: action.id,
        name: action.name
      };
      queue.enqueue(command, { priority: priorityForRobotAction(action) }).catch((error) => {
        logger.warn('[RoboticsOrchestrator] queued action failed', {
          errorCode: error?.code || error?.name || 'ROBOT_ACTION_FAILED'
        });
      });
    }).catch((error) => logger.warn('[RoboticsOrchestrator] action failed', {
      errorCode: error?.code || error?.name || 'ROBOT_ACTION_FAILED'
    })).finally(() => {
      processingTokensRef.current.delete(robotActionEnvelope.token);
      clearRobotActionEnvelope(robotActionEnvelope);
    });
    return () => { active = false; };
  }, [accessToken, clearRobotActionEnvelope, queue, robotActionEnvelope]);

  useEffect(() => () => queue.clear(), [queue]);
  return queue;
}
