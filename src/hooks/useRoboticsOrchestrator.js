import { useEffect, useMemo, useRef } from 'react';
import { useAppState } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { bleService } from '../services/ble-runtime';
import humeEVIService from '../services/websocket/hume-evi';
import { RoboticsCommandQueue, priorityForRobotAction } from '../services/robotics-command-queue';
import { verifyRobotActionEnvelopeWithRefresh } from '../services/robotics-auth';
import {
  decodeRoboticsTelemetry,
  ROBOTICS_SERVICE_UUID,
  ROBOTICS_TELEMETRY_CHARACTERISTIC_UUID
} from '../services/robotics-telemetry';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

export function useRoboticsOrchestrator() {
  const { accessToken } = useAuth();
  const {
    device,
    robotActionEnvelope,
    clearRobotActionEnvelope,
    setRoboticsError,
    updateRobotEntity,
    removeRobotEntity
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
    if (!config.roboticsMockMode || !device.id || device.connected !== true) return undefined;
    let active = true;
    let unsubscribe;
    let invalidTelemetryLogged = false;
    bleService.subscribeToNotifications(
      device.id,
      ROBOTICS_SERVICE_UUID,
      ROBOTICS_TELEMETRY_CHARACTERISTIC_UUID,
      (base64Value) => {
        if (!active) return;
        try {
          const telemetry = decodeRoboticsTelemetry(base64Value);
          if (!updateRobotEntity(device.id, telemetry)) throw new Error('Robot telemetry fields are invalid.');
          invalidTelemetryLogged = false;
        } catch (error) {
          if (invalidTelemetryLogged) return;
          invalidTelemetryLogged = true;
          logger.warn('[RoboticsOrchestrator] rejected invalid telemetry', {
            errorCode: error?.code || error?.name || 'ROBOT_TELEMETRY_INVALID'
          });
        }
      }
    ).then((remove) => {
      if (!active) remove?.();
      else unsubscribe = remove;
    }).catch((error) => {
      if (!active) return;
      logger.warn('[RoboticsOrchestrator] telemetry subscription failed', {
        errorCode: error?.code || error?.name || 'ROBOT_TELEMETRY_SUBSCRIBE_FAILED'
      });
    });
    return () => {
      active = false;
      unsubscribe?.();
      removeRobotEntity(device.id);
    };
  }, [device.connected, device.id, removeRobotEntity, updateRobotEntity]);

  useEffect(() => {
    if (!robotActionEnvelope) return;
    if (processingTokensRef.current.has(robotActionEnvelope.token)) return;
    processingTokensRef.current.add(robotActionEnvelope.token);
    let active = true;
    verifyRobotActionEnvelopeWithRefresh(robotActionEnvelope, {
      accessToken,
      apiBaseUrl: config.apiBaseUrl,
      loggerImpl: logger
    }).then((verified) => {
      if (!active || !verified) {
        logger.warn('[RoboticsOrchestrator] rejected unsigned or invalid action');
        if (active) {
          setRoboticsError({
            message: 'Robot action could not be verified. Please retry.',
            errorCode: 'ROBOT_ACTION_INVALID',
            receivedAt: Date.now()
          });
        }
        return;
      }
      const { action, expiresAt } = verified;
      setRoboticsError(null);
      const parameters = action.parameters && typeof action.parameters === 'object' ? action.parameters : {};
      const command = {
        ...(Number.isFinite(parameters.latitude) ? { latitude: parameters.latitude } : {}),
        ...(Number.isFinite(parameters.longitude) ? { longitude: parameters.longitude } : {}),
        ...(Number.isFinite(parameters.speed) ? { speed: parameters.speed } : {}),
        ...(typeof parameters.reason === 'string' ? { reason: parameters.reason.slice(0, 120) } : {}),
        id: action.id,
        name: action.name
      };
      queue.enqueue(command, {
        priority: priorityForRobotAction(action),
        expiresAt
      }).then((result) => {
        humeEVIService.sendRobotActionResult(action, result);
      }, (error) => {
        humeEVIService.sendRobotActionFailure(action, error);
        logger.warn('[RoboticsOrchestrator] queued action failed', {
          errorCode: error?.code || error?.name || 'ROBOT_ACTION_FAILED'
        });
      });
    }).catch((error) => {
      logger.warn('[RoboticsOrchestrator] action failed', {
        errorCode: error?.code || error?.name || 'ROBOT_ACTION_FAILED'
      });
      if (active) {
        setRoboticsError({
          message: 'Robot action could not be verified. Please retry.',
          errorCode: error?.code || 'ROBOT_ACTION_VERIFY_FAILED',
          receivedAt: Date.now()
        });
      }
    }).finally(() => {
      processingTokensRef.current.delete(robotActionEnvelope.token);
      clearRobotActionEnvelope(robotActionEnvelope);
    });
    return () => { active = false; };
  }, [accessToken, clearRobotActionEnvelope, queue, robotActionEnvelope, setRoboticsError]);

  useEffect(() => () => queue.clear(), [queue]);
  return queue;
}
