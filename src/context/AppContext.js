import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { storage } from '../services/storage';
import { voiceProfiles } from '../mocks/voiceProfiles';
import { DEFAULT_SETTINGS, loadSettings, mergeSettings, persistSettings } from '../services/settings-store';
import { logger } from '../utils/logger';

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
  const [device, setDevice] = useState({ connected: false, name: 'NorthStar VL01', battery: 82 });
  const [friends, setFriends] = useState(DEFAULT_FRIENDS);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      loadSettings(),
      storage.getJSON(CONTACTS_KEY, DEFAULT_CONTACTS)
    ]).then(([savedSettings, storedContacts]) => {
      if (!active) return;
      const savedContacts = Array.isArray(storedContacts) ? storedContacts : DEFAULT_CONTACTS;
      settingsRef.current = savedSettings;
      contactsRef.current = savedContacts;
      setSettings(savedSettings);
      setContacts(savedContacts);
    }).catch((error) => {
      logger.warn('[AppState] Could not restore local settings', error);
    }).finally(() => {
      if (active) setIsHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

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
    settingsRef.current = DEFAULT_SETTINGS;
    contactsRef.current = DEFAULT_CONTACTS;
    setSettings(DEFAULT_SETTINGS);
    setContacts(DEFAULT_CONTACTS);
    setDevice({ connected: false, name: 'NorthStar VL01', battery: 82 });
    setFriends(DEFAULT_FRIENDS);
  }, []);

  const lockAndFlushLocalMutations = useCallback(async () => {
    if (localMutationsLockedRef.current) throw new Error('Local data cleanup is already running.');
    localMutationsLockedRef.current = true;
    await Promise.all([
      settingsMutationQueueRef.current.catch(() => {}),
      contactsMutationQueueRef.current.catch(() => {})
    ]);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      localMutationsLockedRef.current = false;
    };
  }, []);

  const selectedVoice = voiceProfiles.find((profile) => profile.id === settings.selectedVoiceId) || voiceProfiles[0];

  const value = useMemo(() => ({ settings, updateSettings, contacts, addContact, removeContact, device, setDevice, friends, setFriends, selectedVoice, resetLocalState, lockAndFlushLocalMutations, isHydrated }), [settings, updateSettings, contacts, addContact, removeContact, device, friends, selectedVoice, resetLocalState, lockAndFlushLocalMutations, isHydrated]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppState must be used inside AppProvider');
  return context;
}
