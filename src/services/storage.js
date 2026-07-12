import AsyncStorage from '@react-native-async-storage/async-storage';

export const storage = {
  async keys() {
    return AsyncStorage.getAllKeys();
  },
  async getJSON(key, fallback) {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
  },
  async getRaw(key) {
    return AsyncStorage.getItem(key);
  },
  async setJSON(key, value) {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  },
  async remove(key) {
    await AsyncStorage.removeItem(key);
  },
  async removeMany(keys) {
    if (!keys.length) return;
    await AsyncStorage.multiRemove(keys);
  }
};
