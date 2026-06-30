//
//  CompanionViewModel.swift
//  Veryloving
//
//  Ported/modernized from emo_ios EVIChatViewModel. Coordinates the WebSocket,
//  audio, and chat services and adds text input on top of the prototype's
//  voice-only flow. The Hume API key/config come from the Keychain.
//

import Foundation

@MainActor
final class CompanionViewModel: ObservableObject {

    @Published private(set) var isConnected = false
    @Published var isMuted = false
    @Published private(set) var messages: [ChatEntry] = []
    @Published var draft = ""
    @Published private(set) var hasAPIKey: Bool
    @Published var error: AppError?

    private let secureStore: SecureStore
    private let audio: CompanionAudioProtocol
    private let chat: CompanionChatProtocol
    private let analytics: AnalyticsService
    private var webSocket: CompanionWebSocketProtocol?

    init(secureStore: SecureStore,
         audio: CompanionAudioProtocol = CompanionAudioService(),
         chat: CompanionChatProtocol = CompanionChatService(),
         analytics: AnalyticsService = NoopAnalyticsService()) {
        self.secureStore = secureStore
        self.audio = audio
        self.chat = chat
        self.analytics = analytics
        self.hasAPIKey = ((try? secureStore.string(for: .humeApiKey)) ?? "").isEmpty == false
        audio.delegate = self
        chat.delegate = self
    }

    // MARK: Intents

    func toggleConnection() { isConnected ? disconnect() : connect() }

    func connect() {
        guard let apiKey = try? secureStore.string(for: .humeApiKey), !apiKey.isEmpty else {
            error = AppError(CompanionWebSocketError.missingAPIKey)
            return
        }
        let configId = (try? secureStore.string(for: .humeConfigId)) ?? ""
        let ws = CompanionWebSocketService(apiKey: apiKey, configId: configId)
        ws.delegate = self
        webSocket = ws
        do { try audio.start() } catch { self.error = AppError(error) }
        ws.connect()
        analytics.log(.companionConnected)
    }

    func disconnect() {
        audio.stop()
        webSocket?.disconnect()
        webSocket = nil
    }

    func toggleMute() {
        isMuted.toggle()
        audio.isMuted = isMuted
    }

    func sendText() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        chat.appendLocalUserMessage(text)
        sendJSON(["type": "user_input", "text": text])
    }

    func clearTranscript() { chat.clear() }

    func saveCredentials(apiKey: String, configId: String) {
        try? secureStore.setString(apiKey, for: .humeApiKey)
        try? secureStore.setString(configId, for: .humeConfigId)
        hasAPIKey = !apiKey.isEmpty
    }

    // MARK: Helpers

    private func sendJSON(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        webSocket?.send(json)
    }

    fileprivate func handle(_ message: EVIMessage) {
        switch message {
        case .audioOutput(let base64):
            audio.playAudio(base64)
        case .error(let message):
            self.error = AppError(message: message)
        default:
            chat.process(message)
        }
    }
}

// Delegate callbacks arrive off the main actor; hop back on before touching state.

extension CompanionViewModel: CompanionWebSocketDelegate {
    nonisolated func webSocket(_ service: CompanionWebSocketProtocol, didReceive message: EVIMessage) {
        Task { @MainActor in self.handle(message) }
    }
    nonisolated func webSocket(_ service: CompanionWebSocketProtocol, didChangeConnected connected: Bool) {
        Task { @MainActor in self.isConnected = connected }
    }
    nonisolated func webSocket(_ service: CompanionWebSocketProtocol, didEncounterError error: Error) {
        Task { @MainActor in self.error = AppError(error) }
    }
}

extension CompanionViewModel: CompanionAudioDelegate {
    nonisolated func audio(_ service: CompanionAudioProtocol, didCapture base64: String) {
        Task { @MainActor in self.sendJSON(["type": "audio_input", "data": base64]) }
    }
    nonisolated func audio(_ service: CompanionAudioProtocol, didEncounterError error: Error) {
        Task { @MainActor in self.error = AppError(error) }
    }
}

extension CompanionViewModel: CompanionChatDelegate {
    nonisolated func chat(_ service: CompanionChatProtocol, didUpdate messages: [ChatEntry]) {
        Task { @MainActor in self.messages = messages }
    }
    nonisolated func chat(_ service: CompanionChatProtocol, didEncounterError error: Error) {
        Task { @MainActor in self.error = AppError(error) }
    }
}
