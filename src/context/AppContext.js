import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { storage } from '../services/storage';
import { voiceProfiles } from '../mocks/voiceProfiles';
import { DEFAULT_SETTINGS, loadSettings, mergeSettings, persistSettings } from '../services/settings-store';

const AppContext = createContext(null);
const CONTACTS_KEY = 'veryloving.emergencyContacts';
const DEFAULT_CONTACTS = [];

export function AppProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const [contacts, setContacts] = useState(DEFAULT_CONTACTS);
  const contactsRef = useRef(DEFAULT_CONTACTS);
  const [device, setDevice] = useState({ connected: false, name: 'NorthStar VL01', battery: 82 });
  const [friends, setFriends] = useState([{ id: 'grace', name: 'Grace', status: 'Guardian' }]);

  useEffect(() => {
    (async () => {
      const savedSettings = await loadSettings();
      settingsRef.current = savedSettings;
      setSettings(savedSettings);
      const savedContacts = await storage.getJSON(CONTACTS_KEY, DEFAULT_CONTACTS);
      contactsRef.current = savedContacts;
      setContacts(savedContacts);
    })();
  }, []);

  const updateSettings = useCallback(async (patch) => {
    const next = mergeSettings(settingsRef.current, patch);
    settingsRef.current = next;
    setSettings(next);
    await persistSettings(next);
    return next;
  }, []);

  const addContact = useCallback(async (contact) => {
    const nextContact = { id: Date.now().toString(), ...contact };
    const next = [...contactsRef.current, nextContact];
    contactsRef.current = next;
    setContacts(next);
    await storage.setJSON(CONTACTS_KEY, next);
    return nextContact;
  }, []);

  const removeContact = useCallback(async (contactId) => {
    const next = contactsRef.current.filter((contact) => contact.id !== contactId);
    contactsRef.current = next;
    setContacts(next);
    await storage.setJSON(CONTACTS_KEY, next);
    return next;
  }, []);

  const resetLocalState = useCallback(() => {
    settingsRef.current = DEFAULT_SETTINGS;
    contactsRef.current = DEFAULT_CONTACTS;
    setSettings(DEFAULT_SETTINGS);
    setContacts(DEFAULT_CONTACTS);
    setDevice({ connected: false, name: 'NorthStar VL01', battery: 82 });
    setFriends([{ id: 'grace', name: 'Grace', status: 'Guardian' }]);
  }, []);

  const selectedVoice = voiceProfiles.find((profile) => profile.id === settings.selectedVoiceId) || voiceProfiles[0];

  const value = useMemo(() => ({ settings, updateSettings, contacts, addContact, removeContact, device, setDevice, friends, setFriends, selectedVoice, resetLocalState }), [settings, updateSettings, contacts, addContact, removeContact, device, friends, selectedVoice, resetLocalState]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppState must be used inside AppProvider');
  return context;
}
