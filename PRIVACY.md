# VeryLoving Privacy Notes

VeryLoving is a personal safety companion. The app requests sensitive permissions only for safety features the user chooses to use.

## Data Used By Core Features

- Account data: name, email, phone verification status, and sign-in provider.
- Location: current location for the safety map, danger zones, quick share, safe-arrival context, and SOS context.
- Audio and conversation content: microphone audio and transcripts are sent to Hume during an online AI companion call. When the custom language model is enabled, Hume sends conversation text, emotional context, and an opaque custom session ID to the VeryLoving CLM service so it can produce a safety-focused response.
- Bluetooth: nearby NorthStar/VL01 wearable identifiers and connection state.
- Notifications: local or remote safety reminders and emergency updates.
- Conversation history: AI companion messages and Hume chat-group references are saved locally on the device. Typed messages created offline are queued locally until the user reconnects to voice AI.
- Diagnostics and usage: native SDK performance, crash, and product interaction data from bundled platform SDKs such as Expo, React Native, Google Sign-In, and Mapbox.

## User Controls

- Settings > Privacy & data > Export my data creates a JSON export containing local profile data, settings, emergency contacts, and saved conversation history.
- Settings > Privacy & data > Delete all local data removes app-scoped local storage, SecureStore auth entries, permission rationale flags, emergency contacts, and conversation history from the device.
- Settings > Offline mode uses bundled companion responses when Hume or the network is unavailable.

The CLM service does not log message text, microphone data, access tokens, or raw custom session IDs. It logs only request counts and a short one-way hash of the opaque session ID for operational diagnostics. Production retention and deletion policies for Hume and the deployed backend must match the public privacy policy and App Store privacy answers.

## App Store Privacy Manifest

The iOS privacy manifest is maintained at `ios/VeryLoving/PrivacyInfo.xcprivacy`. It intentionally declares the app and SDK data collection surfaces instead of claiming that no data is collected.
