import { sanitizeSystemNavigationPath } from '../src/utils/navigation-intent';

export function redirectSystemPath({ path, initial }) {
  try {
    return sanitizeSystemNavigationPath(path, { initial });
  } catch {
    // Expo Router warns that exceptions here can crash cold launch. Fail to
    // the root on launch and ignore an unsafe link while the app is running.
    return initial ? '/' : null;
  }
}
