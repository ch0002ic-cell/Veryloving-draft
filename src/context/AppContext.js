import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
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
import { forgetPairedDevice } from '../services/paired-device-removal';
import { lockAndDrainLocalUserDataMutations } from '../services/local-mutation-coordinator';
import { useAuth } from './AuthContext';
import { config } from '../utils/config';
import {
  createEmergencyContact,
  deleteEmergencyContact,
  fetchEmergencyContacts
} from '../services/safety-api';
import { createAuthenticationNonce } from '../utils/session-token';
import { loadEmergencyContactCache, persistEmergencyContactCache } from '../services/emergency-contact-store';
import { editEmergencyContact } from '../services/emergency-contact-edit';
import { withTimeout } from '../utils/async';

const AppContext = createContext(null);
const DEFAULT_CONTACTS = [];
const DEFAULT_FRIENDS = [];

export function AppProvider({ children }) {
  const { accessToken, loading: authLoading, user } = useAuth();
  const activeAccountIdRef = useRef(user?.id || null);
  activeAccountIdRef.current = user?.id || null;
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const settingsMutationQueueRef = useRef(Promise.resolve());
  const [contacts, setContacts] = useState(DEFAULT_CONTACTS);
  const contactsRef = useRef(DEFAULT_CONTACTS);
  const contactsMutationQueueRef = useRef(Promise.resolve());
  const localMutationsLockedRef = useRef(false);
  const [device, setDeviceState] = useState(DEFAULT_DEVICE);
  const [deviceTelemetry, setDeviceTelemetry] = useState({ status: null, event: null });
  const deviceRef = useRef(DEFAULT_DEVICE);
  const deviceMutationQueueRef = useRef(Promise.resolve());
  const deviceGenerationRef = useRef(0);
  const deviceAccountIdRef = useRef(null);
  const reconnectInFlightRef = useRef(null);
  const [friends, setFriends] = useState(DEFAULT_FRIENDS);
  const [localStateHydrated, setLocalStateHydrated] = useState(false);
  const [settingsAccountId, setSettingsAccountId] = useState(undefined);
  const [contactsAccountId, setContactsAccountId] = useState(null);
  const expectedSettingsAccountId = user?.id || null;
  const isHydrated = localStateHydrated
    && !authLoading
    && settingsAccountId === expectedSettingsAccountId
    && (!user?.id || contactsAccountId === user.id);

  useEffect(() => {
    if (authLoading) return undefined;
    let active = true;
    const accountId = user?.id || null;
    setLocalStateHydrated(false);
    withTimeout(loadSettings(), 8000, 'Settings restoration timed out.').then((savedSettings) => {
      if (!active) return;
      settingsRef.current = savedSettings;
      setSettings(savedSettings);
    }).catch((error) => {
      logger.warn('[AppState] Could not restore local settings', error);
      if (!active) return;
      // Never retain an in-memory previous-account preference snapshot when
      // the newly established account boundary cannot be read.
      settingsRef.current = DEFAULT_SETTINGS;
      setSettings(DEFAULT_SETTINGS);
    }).finally(() => {
      if (active) {
        setSettingsAccountId(accountId);
        setLocalStateHydrated(true);
      }
    });
    return () => {
      active = false;
    };
  }, [authLoading, user?.id]);

  useEffect(() => {
    if (authLoading || !localStateHydrated) return undefined;
    let active = true;
    if (!user?.id) {
      const pairedDeviceId = deviceRef.current.id;
      deviceGenerationRef.current += 1;
      deviceAccountIdRef.current = null;
      contactsRef.current = DEFAULT_CONTACTS;
      deviceRef.current = DEFAULT_DEVICE;
      setContacts(DEFAULT_CONTACTS);
      setDeviceState(DEFAULT_DEVICE);
      setDeviceTelemetry({ status: null, event: null });
      setFriends(DEFAULT_FRIENDS);
      setContactsAccountId(null);
      if (pairedDeviceId) bleService.disconnect(pairedDeviceId).catch(() => {});
      return () => { active = false; };
    }

    const accountId = user.id;
    if (deviceAccountIdRef.current !== accountId) {
      const previousDeviceId = deviceRef.current.id;
      deviceGenerationRef.current += 1;
      const restoreGeneration = deviceGenerationRef.current;
      deviceAccountIdRef.current = accountId;
      deviceRef.current = DEFAULT_DEVICE;
      setDeviceState(DEFAULT_DEVICE);
      setDeviceTelemetry({ status: null, event: null });
      if (previousDeviceId) bleService.disconnect(previousDeviceId).catch(() => {});
      withTimeout(loadPairedDevice(accountId), 8000, 'Paired-device restoration timed out.').then((savedDevice) => {
        if (
          deviceAccountIdRef.current !== accountId
          || deviceGenerationRef.current !== restoreGeneration
        ) return;
        deviceRef.current = savedDevice;
        setDeviceState(savedDevice);
      }).catch((error) => logger.warn('[AppState] Could not restore the account-bound paired device', {
        errorCode: error?.code || error?.name || 'DEVICE_RESTORE_FAILED'
      }));
    }
    setContactsAccountId(null);
    const operation = contactsMutationQueueRef.current.catch(() => {}).then(async () => {
      let cachedContacts = DEFAULT_CONTACTS;
      try {
        cachedContacts = await withTimeout(
          loadEmergencyContactCache(accountId),
          8000,
          'Emergency-contact restoration timed out.'
        );
      } catch (error) {
        logger.warn('[AppState] Could not load the secure emergency-contact cache', {
          errorCode: error?.code || error?.name || 'CONTACT_CACHE_LOAD_FAILED'
        });
      }
      if (!active) return;

      // The secure account-bound cache is sufficient for offline safety UI.
      // Render it immediately; remote reconciliation continues serially in
      // the background and cannot block protected navigation or BLE restore.
      contactsRef.current = cachedContacts;
      setContacts(cachedContacts);
      setContactsAccountId(accountId);

      let nextContacts = cachedContacts;
      if (config.safetyBackendEnabled && accessToken) {
        try {
          const remoteContacts = await fetchEmergencyContacts(accessToken);
          const remotePhones = new Set(remoteContacts.map((contact) => contact.phone));
          const migratedContacts = [];
          const pendingLocalContacts = [];
          for (const contact of cachedContacts) {
            if (remotePhones.has(contact.phone)) continue;
            try {
              const migrated = await createEmergencyContact({
                name: contact.name,
                phone: contact.phone,
                countryCode: contact.countryCode
              }, accessToken);
              migratedContacts.push(migrated);
              remotePhones.add(migrated.phone);
            } catch (error) {
              pendingLocalContacts.push({ ...contact, syncStatus: 'pending' });
              logger.warn('[AppState] Emergency-contact migration is pending', {
                errorCode: error?.code || error?.name || 'CONTACT_MIGRATION_FAILED'
              });
            }
          }
          nextContacts = [...remoteContacts, ...migratedContacts, ...pendingLocalContacts];
        } catch (error) {
          logger.warn('[AppState] Could not refresh emergency contacts', {
            errorCode: error?.code || error?.name || 'CONTACT_SYNC_FAILED'
          });
        }
      }
      if (!active) return;
      contactsRef.current = nextContacts;
      setContacts(nextContacts);
      await persistEmergencyContactCache(accountId, nextContacts);
    });
    contactsMutationQueueRef.current = operation.then(() => undefined, () => undefined);
    operation.catch((error) => logger.warn('[AppState] Could not reconcile emergency contacts', {
      errorCode: error?.code || error?.name || 'CONTACT_RECONCILIATION_FAILED'
    })).finally(() => {
      if (active) setContactsAccountId(accountId);
    });
    return () => {
      active = false;
    };
  }, [accessToken, authLoading, localStateHydrated, user?.id]);

  const setDevice = useCallback(async (nextValue) => {
    if (localMutationsLockedRef.current) throw new Error('Local data is being cleared.');
    const operation = deviceMutationQueueRef.current.catch(() => {}).then(async () => {
      const previous = deviceRef.current;
      const candidate = typeof nextValue === 'function' ? nextValue(previous) : nextValue;
      const next = normalizePairedDevice(candidate?.id
        ? { ...candidate, accountId: candidate.accountId || user?.id }
        : candidate);
      if (next.id && (!user?.id || next.accountId !== user.id)) {
        throw new Error('The paired device is not bound to the active account.');
      }
      deviceGenerationRef.current += 1;
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
  }, [user?.id]);

  useEffect(() => bleService.setEventHandler({
    onBattery: (deviceId, battery) => {
      if (deviceRef.current.id !== deviceId) return;
      const next = { ...deviceRef.current, battery };
      deviceRef.current = next;
      setDeviceState(next);
    },
    onStatus: (deviceId, value) => {
      if (deviceRef.current.id !== deviceId) return;
      setDeviceTelemetry((current) => ({
        ...current,
        status: { value: typeof value === 'string' ? value.slice(0, 1024) : null, receivedAt: Date.now() }
      }));
    },
    onEvent: (deviceId, value) => {
      if (deviceRef.current.id !== deviceId) return;
      setDeviceTelemetry((current) => ({
        ...current,
        event: { value: typeof value === 'string' ? value.slice(0, 1024) : null, receivedAt: Date.now() }
      }));
    },
    onDisconnected: (deviceId, nativeError) => {
      const current = deviceRef.current;
      if (current.id !== deviceId) return;
      setDevice({
        ...current,
        battery: null,
        connected: false,
        connectionState: current.autoReconnect ? 'reconnecting' : 'disconnected',
        lastErrorCode: nativeError?.errorCode ? 'BLE_DISCONNECTED' : null
      }).catch((error) => logger.warn('[AppState] Could not persist device disconnect state', {
        errorCode: error?.code || error?.name || 'DEVICE_STATE_UPDATE_FAILED'
      }));
    },
    onConnectionDegraded: (deviceId, nativeError) => {
      const current = deviceRef.current;
      if (current.id !== deviceId) return;
      setDevice({
        ...current,
        battery: null,
        connected: false,
        connectionState: current.autoReconnect ? 'reconnecting' : 'disconnected',
        lastErrorCode: nativeError?.errorCode ? 'BLE_GATT_MONITOR_FAILED' : 'BLE_CONNECTION_DEGRADED'
      }).catch((error) => logger.warn('[AppState] Could not persist degraded BLE state', {
        errorCode: error?.code || error?.name || 'DEVICE_STATE_UPDATE_FAILED'
      }));
    },
    onRestored: (restoredDevices) => {
      const current = deviceRef.current;
      if (!current.id || !restoredDevices.some((restored) => restored.id === current.id)) return;
      setDevice({
        ...current,
        connected: false,
        connectionState: 'reconnecting',
        autoReconnect: true,
        lastErrorCode: null
      }).catch((error) => logger.warn('[AppState] Could not reattach a restored BLE session', {
        errorCode: error?.code || error?.name || 'DEVICE_STATE_UPDATE_FAILED'
      }));
    }
  }), [setDevice]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const current = deviceRef.current;
      if (nextState !== 'active' || !current.id || !current.autoReconnect || current.connected) return;
      setDevice({ ...current, connectionState: 'reconnecting', lastErrorCode: null }).catch((error) => {
        logger.warn('[AppState] Could not schedule foreground device reconnect', {
          errorCode: error?.code || error?.name || 'DEVICE_STATE_UPDATE_FAILED'
        });
      });
    });
    return () => subscription.remove();
  }, [setDevice]);

  useEffect(() => {
    if (
      !isHydrated
      || !device.id
      || device.connectionState !== 'reconnecting'
      || reconnectInFlightRef.current?.deviceId === device.id
    ) return undefined;

    const deviceSnapshot = device;
    const reconnectGeneration = deviceGenerationRef.current;
    const reconnectRequest = { deviceId: device.id, generation: reconnectGeneration };
    reconnectInFlightRef.current = reconnectRequest;
    bleService.reconnect(deviceSnapshot).then((connectedDevice) => {
      if (reconnectGeneration !== deviceGenerationRef.current || deviceRef.current.id !== deviceSnapshot.id) {
        return bleService.disconnect(connectedDevice?.id).catch((error) => {
          logger.warn('[AppState] Stale device reconnect cleanup failed', {
            errorCode: error?.code || 'BLE_DISCONNECT_FAILED',
            nativeErrorCode: error?.nativeErrorCode,
            hasDeviceId: Boolean(connectedDevice?.id)
          });
        });
      }
      return setDevice(connectedDevice);
    }).catch((error) => {
      if (reconnectGeneration !== deviceGenerationRef.current || deviceRef.current.id !== deviceSnapshot.id) return;
      logger.warn('[AppState] Remembered device could not reconnect', {
        errorCode: error?.code || 'BLE_RECONNECT_FAILED',
        nativeErrorCode: error?.nativeErrorCode,
        hasDeviceId: true
      });
      return setDevice({
        ...deviceSnapshot,
        connected: false,
        connectionState: 'disconnected',
        autoReconnect: true,
        lastErrorCode: error?.code || 'BLE_RECONNECT_FAILED'
      }).catch((persistError) => logger.warn('[AppState] Could not persist device reconnect state', {
        errorCode: persistError?.code || persistError?.name || 'DEVICE_STATE_PERSIST_FAILED'
      }));
    }).finally(() => {
      if (reconnectInFlightRef.current === reconnectRequest) reconnectInFlightRef.current = null;
    });
    return undefined;
  }, [device, isHydrated, setDevice]);

  const reconnectPairedDevice = useCallback(async () => {
    if (localMutationsLockedRef.current) throw new Error('Local data is being cleared.');
    const current = deviceRef.current;
    if (!current.id) throw new Error('No paired device is available to reconnect.');
    if (current.connected || current.connectionState === 'reconnecting') return current;
    return setDevice({
      ...current,
      connected: false,
      connectionState: 'reconnecting',
      autoReconnect: true,
      lastErrorCode: null
    });
  }, [setDevice]);

  const removePairedDevice = useCallback(async () => {
    if (localMutationsLockedRef.current) throw new Error('Local data is being cleared.');
    const rememberedDevice = deviceRef.current;

    // Invalidate any reconnect already in flight before clearing state. Its
    // completion handler will disconnect the stale native connection instead
    // of writing the removed device back into storage.
    deviceGenerationRef.current += 1;

    let result;
    try {
      result = await forgetPairedDevice(rememberedDevice, {
        clearRememberedDevice: () => setDevice(DEFAULT_DEVICE),
        disconnectNativeDevice: (deviceId) => bleService.disconnect(deviceId)
      });
    } catch (error) {
      throw error;
    }

    if (!result.nativeDisconnected) {
      logger.warn('[AppState] Removed device but native disconnect failed', {
        errorCode: result.disconnectError?.code || 'BLE_DISCONNECT_FAILED',
        nativeErrorCode: result.disconnectError?.nativeErrorCode,
        hasDeviceId: Boolean(rememberedDevice.id)
      });
    }
    return result;
  }, [setDevice]);

  const updateSettings = useCallback(async (patch) => {
    if (localMutationsLockedRef.current) throw new Error('Local data is being cleared.');
    const operation = settingsMutationQueueRef.current.catch(() => {}).then(async () => {
      const previous = settingsRef.current;
      const next = mergeSettings(previous, patch);
      await persistSettings(next);
      settingsRef.current = next;
      setSettings(next);
      return next;
    });
    settingsMutationQueueRef.current = operation.then(() => undefined, () => undefined);
    return operation;
  }, []);

  const addContact = useCallback(async (contact) => {
    if (localMutationsLockedRef.current) throw new Error('Local data is being cleared.');
    if (!user?.id) throw new Error('An authenticated account is required.');
    const operation = contactsMutationQueueRef.current.catch(() => {}).then(async () => {
      const syncRemote = config.safetyBackendEnabled && Boolean(accessToken);
      const nextContact = syncRemote
        ? await createEmergencyContact(contact, accessToken)
        : { id: createAuthenticationNonce(), ...contact };
      const previous = contactsRef.current;
      const next = [...previous, nextContact];
      contactsRef.current = next;
      setContacts(next);
      try {
        await persistEmergencyContactCache(user.id, next);
        return nextContact;
      } catch (error) {
        if (syncRemote) {
          logger.warn('[AppState] Server contact was saved but its secure offline cache could not be updated', {
            errorCode: error?.code || error?.name || 'CONTACT_CACHE_WRITE_FAILED'
          });
          return nextContact;
        }
        contactsRef.current = previous;
        setContacts(previous);
        throw error;
      }
    });
    contactsMutationQueueRef.current = operation.then(() => undefined, () => undefined);
    return operation.then((nextContact) => nextContact);
  }, [accessToken, user?.id]);

  const removeContact = useCallback(async (contactId) => {
    if (localMutationsLockedRef.current) throw new Error('Local data is being cleared.');
    if (!user?.id) throw new Error('An authenticated account is required.');
    const operation = contactsMutationQueueRef.current.catch(() => {}).then(async () => {
      const previous = contactsRef.current;
      const remoteContact = /^contact_[A-Za-z0-9_-]{24}$/.test(contactId);
      const syncRemote = config.safetyBackendEnabled && Boolean(accessToken);
      if (syncRemote && remoteContact) {
        await deleteEmergencyContact(contactId, accessToken);
      }
      const next = previous.filter((contact) => contact.id !== contactId);
      contactsRef.current = next;
      setContacts(next);
      try {
        await persistEmergencyContactCache(user.id, next);
        return next;
      } catch (error) {
        if (syncRemote) {
          logger.warn('[AppState] Server contact was removed but its secure offline cache could not be updated', {
            errorCode: error?.code || error?.name || 'CONTACT_CACHE_WRITE_FAILED'
          });
          return next;
        }
        contactsRef.current = previous;
        setContacts(previous);
        throw error;
      }
    });
    contactsMutationQueueRef.current = operation.then(() => undefined, () => undefined);
    return operation;
  }, [accessToken, user?.id]);

  const updateContact = useCallback(async (contactId, edit) => {
    if (localMutationsLockedRef.current) throw new Error('Local data is being cleared.');
    if (!user?.id) throw new Error('An authenticated account is required.');
    const accountId = user.id;
    const operation = contactsMutationQueueRef.current.catch(() => {}).then(async () => {
      try {
        const result = await editEmergencyContact({
          accessToken,
          accountId,
          contactId,
          contacts: contactsRef.current,
          edit,
          isAccountActive: () => activeAccountIdRef.current === accountId
        });
        if (activeAccountIdRef.current !== accountId) {
          const error = new Error('The authenticated account changed during the contact update.');
          error.code = 'CONTACT_ACCOUNT_CHANGED';
          throw error;
        }
        contactsRef.current = result.contacts;
        setContacts(result.contacts);
        if (result.cacheWarning) {
          logger.warn('[AppState] Server contact was updated but its secure offline cache could not be refreshed', {
            errorCode: 'CONTACT_CACHE_WRITE_FAILED'
          });
        }
        return result.contact;
      } catch (error) {
        if (Array.isArray(error?.latestContacts) && activeAccountIdRef.current === accountId) {
          contactsRef.current = error.latestContacts;
          setContacts(error.latestContacts);
        }
        throw error;
      }
    });
    contactsMutationQueueRef.current = operation.then(() => undefined, () => undefined);
    return operation;
  }, [accessToken, user?.id]);

  const resetLocalState = useCallback(({ language = DEFAULT_SETTINGS.language } = {}) => {
    const pairedDeviceId = deviceRef.current.id;
    deviceGenerationRef.current += 1;
    const nextSettings = mergeSettings(DEFAULT_SETTINGS, { language });
    settingsRef.current = nextSettings;
    contactsRef.current = DEFAULT_CONTACTS;
    deviceRef.current = DEFAULT_DEVICE;
    setSettings(nextSettings);
    setContacts(DEFAULT_CONTACTS);
    setDeviceState(DEFAULT_DEVICE);
    setDeviceTelemetry({ status: null, event: null });
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

  const value = useMemo(() => ({ settings, updateSettings, contacts, addContact, updateContact, removeContact, device, deviceTelemetry, setDevice, reconnectPairedDevice, removePairedDevice, friends, setFriends, selectedVoice, resetLocalState, lockAndFlushLocalMutations, isHydrated }), [settings, updateSettings, contacts, addContact, updateContact, removeContact, device, deviceTelemetry, setDevice, reconnectPairedDevice, removePairedDevice, friends, selectedVoice, resetLocalState, lockAndFlushLocalMutations, isHydrated]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppState must be used inside AppProvider');
  return context;
}
