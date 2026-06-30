//
//  AppConfig.swift
//  Veryloving
//
//  Single source of truth for environment configuration. Contains NO secrets —
//  only public endpoints, identifiers, and feature flags. Secrets (API keys,
//  tokens) live in the Keychain and are injected at runtime.
//
//  Values can be overridden per-build via Info.plist keys (populated from an
//  xcconfig that is git-ignored), falling back to the defaults below.
//

import Foundation

struct AppConfig {

    static let current = AppConfig()

    // MARK: Backend

    /// REST API base URL. Override with `VL_API_BASE_URL` in Info.plist for staging/prod.
    let apiBaseURL: URL

    /// Hume EVI WebSocket endpoint (carried over from the prototype).
    let humeWebSocketURL = URL(string: "wss://api.hume.ai/v0/evi/chat")!

    /// When true, the app runs against in-memory mock services so the full UX is
    /// demoable without a backend. Flip to false once `apiBaseURL` points at a
    /// real server. Defaults to true until a backend exists (see README).
    let useMockServices: Bool

    // MARK: Bluetooth (Veryloving jewelry)
    //
    // ⚠️ PLACEHOLDER UUIDs — replace with the real values from the firmware team
    // (clarification Q2). They are isolated here so a single edit updates the app.
    // The protocol assumed: a custom GATT service exposing an "event" characteristic
    // that notifies a 1-byte opcode, plus the standard Battery Service (0x180F).

    let bleServiceUUID = "A1B2C3D4-0001-1000-8000-00805F9B34FB"
    let bleEventCharacteristicUUID = "A1B2C3D4-0002-1000-8000-00805F9B34FB"
    let bleFirmwareCharacteristicUUID = "A1B2C3D4-0003-1000-8000-00805F9B34FB"
    /// Standard Bluetooth SIG Battery Service / Battery Level characteristic.
    let batteryServiceUUID = "180F"
    let batteryLevelCharacteristicUUID = "2A19"

    // MARK: SOS

    /// How long the app keeps sharing location after an SOS is triggered.
    let sosLocationSharingDuration: TimeInterval = 30 * 60

    private init() {
        let plist = Bundle.main.infoDictionary

        // VL_API_BASE_URL is composed as "$(VL_API_SCHEME)://$(VL_API_HOST)". When
        // the host is unset it resolves to e.g. "https://" (nil host) → use mocks.
        if let urlString = plist?["VL_API_BASE_URL"] as? String,
           let url = URL(string: urlString),
           let host = url.host, !host.isEmpty {
            self.apiBaseURL = url
            self.useMockServices = false
        } else {
            // No backend configured yet — use a documented placeholder and mocks.
            self.apiBaseURL = URL(string: "https://api.veryloving.ai")!
            self.useMockServices = true
        }
    }
}
