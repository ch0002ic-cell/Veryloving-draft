# VeryLoving Privacy Notes

VeryLoving is a personal safety companion. The app requests sensitive permissions only for safety features the user chooses to use.

## Data Used By Core Features

- Account data: name, email, phone verification status, and sign-in provider.
- Location: current location for the safety map, danger zones, quick share, safe-arrival context, and SOS context. The most recent valid live coordinate is retained locally for no more than 24 hours so the app can show a timestamped, explicitly stale fallback. A bounded native Mapbox tile pack around the last live location may remain until it is replaced, sign-out, or local-data deletion.
- Audio and conversation content: microphone audio and transcripts are sent to Hume during an online AI companion call. When the custom language model is enabled, Hume sends conversation text, emotional context, and an opaque custom session ID to the VeryLoving CLM service so it can produce a safety-focused response.
- Bluetooth: nearby NorthStar/VL01 wearable identifiers and connection state.
- Notifications: local or remote safety reminders and emergency updates.
- Conversation history: AI companion messages and Hume chat-group references are saved locally on the device. Typed messages created offline are queued locally until the user reconnects to voice AI.
- Emergency and wearable fallback data: emergency contacts, the time and non-PII outcome of the last SOS attempt, and the last paired NorthStar identifier/reconnect state are stored locally. A `dialer_opened` outcome means only that the phone dialer opened; it does not confirm that a call connected or that emergency services were dispatched.
- Diagnostics and usage: native SDK performance, crash, and product interaction data from bundled platform SDKs such as Expo, React Native, Google Sign-In, and Mapbox.

## User Controls

- Settings > Privacy & data > Export my data creates a JSON export containing local profile data, settings, emergency contacts, and saved conversation history.
- Settings > Privacy & data > Delete all local data drains tracked writes, removes app-scoped local storage and SecureStore auth entries, and attempts to purge cached voice files and every app-owned Mapbox offline pack. A native artifact failure cannot prevent credential and PII deletion, but the app warns that cleanup was incomplete. It retains only opaque pack identifiers or an enumeration-needed flag outside the user-data namespace so a later native cleanup attempt can be verified; legacy pack names that encoded coordinates are never copied into this retry record.
- Settings > Offline mode uses bundled companion responses when Hume or the network is unavailable.

The CLM service does not log message text, microphone data, access tokens, or raw custom session IDs. It logs only request counts and a short one-way hash of the opaque session ID for operational diagnostics. Production retention and deletion policies for Hume and the deployed backend must match the public privacy policy and App Store privacy answers.

AsyncStorage records are currently plaintext and device-scoped rather than encrypted and account-bound. That includes cached location, emergency contacts, conversation data, and wearable metadata. Per-account encryption and migration testing remain a P1 stop-ship gate in `LAUNCH_CHECKLIST.md`; these local fallbacks do not make the current build production-ready.

## App Store Privacy Manifest

The iOS privacy manifest is generated from `app.config.js`. It intentionally declares the app and SDK data collection surfaces instead of claiming that no data is collected.
