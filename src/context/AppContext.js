import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { storage } from '../services/storage';
import { voiceProfiles } from '../mocks/voiceProfiles';
import { DEFAULT_SETTINGS, loadSettings, mergeSettings, persistSettings } from '../services/settings-store';

const AppContext = createContext(null);
const CONTACTS_KEY = 'veryloving.emergencyContacts';
const DEFAULT_CONTACTS = [{ id: '1', name: 'Mom', phone: '+1 555 0100' }];

export function AppProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const [contacts, setContacts] = useState(DEFAULT_CONTACTS);
  const [device, setDevice] = useState({ connected: false, name: 'NorthStar VL01', battery: 82 });
  const [friends, setFriends] = useState([{ id: 'grace', name: 'Grace', status: 'Guardian' }]);

  useEffect(() => {
    (async () => {
      const savedSettings = await loadSettings();
      settingsRef.current = savedSettings;
      setSettings(savedSettings);
      setContacts(await storage.getJSON(CONTACTS_KEY, DEFAULT_CONTACTS));
    })();
  }, []);

  const updateSettings = useCallback(async (patch) => {
    const next = mergeSettings(settingsRef.current, patch);
    settingsRef.current = next;
    setSettings(next);
    await persistSettings(next);
    return next;
  }, []);

  const addContact = async (contact) => {
    const next = [...contacts, { id: Date.now().toString(), ...contact }];
    setContacts(next);
    await storage.setJSON(CONTACTS_KEY, next);
  };

  const resetLocalState = useCallback(() => {
    settingsRef.current = DEFAULT_SETTINGS;
    setSettings(DEFAULT_SETTINGS);
    setContacts(DEFAULT_CONTACTS);
    setDevice({ connected: false, name: 'NorthStar VL01', battery: 82 });
    setFriends([{ id: 'grace', name: 'Grace', status: 'Guardian' }]);
  }, []);

  const selectedVoice = voiceProfiles.find((profile) => profile.id === settings.selectedVoiceId) || voiceProfiles[0];

  const value = useMemo(() => ({ settings, updateSettings, contacts, addContact, device, setDevice, friends, setFriends, selectedVoice, resetLocalState }), [settings, updateSettings, contacts, device, friends, selectedVoice, resetLocalState]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppState must be used inside AppProvider');
  return context;
}
