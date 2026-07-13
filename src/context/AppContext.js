import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { storage } from '../services/storage';
import { voiceProfiles } from '../mocks/voiceProfiles';
import { DEFAULT_SETTINGS, loadSettings, mergeSettings, persistSettings } from '../services/settings-store';
import { logger } from '../utils/logger';
import { bleService } from '../services/ble';
import {
  DEFAULT_DEVICE,
  loadPairedDevice,
  normalizePairedDevice,
  persistPairedDevice
} from '../services/paired-device-store';
import { lockAndDrainLocalUserDataMutations } from '../services/local-mutation-coordinator';

const AppContext = createContext(null);
const CONTACTS_KEY = 'veryloving.emergencyContacts';
const DEFAULT_CONTACTS = [];
const DEFAULT_FRIENDS = [];

export function AppProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const settingsMutationQueueRef = useRef(Promise.resolve());
  const [contacts, setContacts] = useState(DEFAULT_CONTACTS);
  const contactsRef = useRef(DEFAULT_CONTACTS);
  const contactsMutationQueueRef = useRef(Promise.resolve());
  const localMutationsLockedRef = useRef(false);
  const [device, setDeviceState] = useState(DEFAULT_DEVICE);
  const deviceRef = useRef(DEFAULT_DEVICE);
  const deviceMutationQueueRef = useRef(Promise.resolve());
  const reconnectAttemptedRef = useRef(null);
  const [friends, setFriends] = useState(DEFAULT_FRIENDS);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      loadSettings(),
      storage.getJSON(CONTACTS_KEY, DEFAULT_CONTACTS),
      loadPairedDevice()
    ]).then(([savedSettings, storedContacts, savedDevice]) => {
      if (!active) return;
      const savedContacts = Array.isArray(storedContacts) ? storedContacts : DEFAULT_CONTACTS;
      settingsRef.current = savedSettings;
      contactsRef.current = savedContacts;
      deviceRef.current = savedDevice;
      setSettings(savedSettings);
      setContacts(savedContacts);
      setDeviceState(savedDevice);
    }).catch((error) => {
      logger.warn('[AppState] Could not restore local settings', error);
    }).finally(() => {
      if (active) setIsHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const setDevice = useCallback(async (nextValue) => {
    if (localMutationsLockedRef.current) throw new Error('Local data is being cleared.');
    const operation = deviceMutationQueueRef.current.catch(() => {}).then(async () => {
      const previous = deviceRef.current;
      const candidate = typeof nextValue === 'function' ? nextValue(previous) : nextValue;
      const next = normalizePairedDevice(candidate);
      deviceRef.current = next;
      setDeviceState(next);
      try {
        await persistPairedDevice(next);
        return next;
      } catch (error) {
        if (deviceRef.current === next) {
          deviceRef.current = previous;
          setDeviceState(previous);
        }
        throw error;
      }
    });
    deviceMutationQueueRef.current = operation.then(() => undefined, () => undefined);
    return operation;
  }, []);

  useEffect(() => {
    if (
      !isHydrated
      || !device.id
      || device.connectionState !== 'reconnecting'
      || reconnectAttemptedRef.current === device.id
    ) return undefined;

    reconnectAttemptedRef.current = device.id;
    let active = true;
    bleService.reconnect(device).then((connectedDevice) => {
      if (!active) return;
      return setDevice(connectedDevice);
    }).catch((error) => {
      if (!active) return;
      logger.warn('[AppState] Remembered device could not reconnect', {
        errorCode: error?.code || 'BLE_RECONNECT_FAILED',
        nativeErrorCode: error?.nativeErrorCode,
        hasDeviceId: true
      });
      setDevice({
        ...device,
        connected: false,
        connectionState: 'disconnected',
        autoReconnect: true,
        lastErrorCode: error?.code || 'BLE_RECONNECT_FAILED'
      }).catch((persistError) => logger.warn('[AppState] Could not persist device reconnect state', {
        errorCode: persistError?.code || persistError?.name || 'DEVICE_STATE_PERSIST_FAILED'
      }));
    });
    return () => {
      active = false;
      if (reconnectAttemptedRef.current === device.id) reconnectAttemptedRef.current = null;
    };
  }, [device, isHydrated, setDevice]);

  const updateSettings = useCallback(async (patch) => {
    if (localMutationsLockedRef.current) throw new Error('Local data is being cleared.');
    const operation = settingsMutationQueueRef.current.catch(() => {}).then(async () => {
      const previous = settingsRef.current;
      const next = mergeSettings(previous, patch);
      settingsRef.current = next;
      setSettings(next);
      try {
        await persistSettings(next);
        return next;
      } catch (error) {
        settingsRef.current = previous;
        setSettings(previous);
        throw error;
      }
    });
    settingsMutationQueueRef.current = operation.then(() => undefined, () => undefined);
    return operation;
  }, []);

  const addContact = useCallback(async (contact) => {
    if (localMutationsLockedRef.current) throw new Error('Local data is being cleared.');
    const nextContact = { id: Date.now().toString(), ...contact };
    const operation = contactsMutationQueueRef.current.catch(() => {}).then(async () => {
      const previous = contactsRef.current;
      const next = [...previous, nextContact];
      contactsRef.current = next;
      setContacts(next);
      try {
        await storage.setJSON(CONTACTS_KEY, next);
        return nextContact;
      } catch (error) {
        contactsRef.current = previous;
        setContacts(previous);
        throw error;
      }
    });
    contactsMutationQueueRef.current = operation.then(() => undefined, () => undefined);
    return operation;
  }, []);

  const removeContact = useCallback(async (contactId) => {
    if (localMutationsLockedRef.current) throw new Error('Local data is being cleared.');
    const operation = contactsMutationQueueRef.current.catch(() => {}).then(async () => {
      const previous = contactsRef.current;
      const next = previous.filter((contact) => contact.id !== contactId);
      contactsRef.current = next;
      setContacts(next);
      try {
        await storage.setJSON(CONTACTS_KEY, next);
        return next;
      } catch (error) {
        contactsRef.current = previous;
        setContacts(previous);
        throw error;
      }
    });
    contactsMutationQueueRef.current = operation.then(() => undefined, () => undefined);
    return operation;
  }, []);

  const resetLocalState = useCallback(() => {
    const pairedDeviceId = deviceRef.current.id;
    settingsRef.current = DEFAULT_SETTINGS;
    contactsRef.current = DEFAULT_CONTACTS;
    deviceRef.current = DEFAULT_DEVICE;
    reconnectAttemptedRef.current = null;
    setSettings(DEFAULT_SETTINGS);
    setContacts(DEFAULT_CONTACTS);
    setDeviceState(DEFAULT_DEVICE);
    setFriends(DEFAULT_FRIENDS);
    if (pairedDeviceId) {
      bleService.disconnect(pairedDeviceId).catch((error) => logger.warn('[AppState] Device cleanup failed', {
        errorCode: error?.code || 'BLE_DISCONNECT_FAILED',
        nativeErrorCode: error?.nativeErrorCode,
        hasDeviceId: true
      }));
    }
  }, []);

  const lockAndFlushLocalMutations = useCallback(async () => {
    if (localMutationsLockedRef.current) throw new Error('Local data cleanup is already running.');
    localMutationsLockedRef.current = true;
    let releaseServiceMutations;
    try {
      await Promise.all([
        settingsMutationQueueRef.current.catch(() => {}),
        contactsMutationQueueRef.current.catch(() => {}),
        deviceMutationQueueRef.current.catch(() => {})
      ]);
      releaseServiceMutations = await lockAndDrainLocalUserDataMutations();
    } catch (error) {
      localMutationsLockedRef.current = false;
      releaseServiceMutations?.();
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseServiceMutations?.();
      localMutationsLockedRef.current = false;
    };
  }, []);

  const selectedVoice = voiceProfiles.find((profile) => profile.id === settings.selectedVoiceId) || voiceProfiles[0];

  const value = useMemo(() => ({ settings, updateSettings, contacts, addContact, removeContact, device, setDevice, friends, setFriends, selectedVoice, resetLocalState, lockAndFlushLocalMutations, isHydrated }), [settings, updateSettings, contacts, addContact, removeContact, device, setDevice, friends, selectedVoice, resetLocalState, lockAndFlushLocalMutations, isHydrated]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppState must be used inside AppProvider');
  return context;
}
