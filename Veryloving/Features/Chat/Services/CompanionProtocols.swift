//
//  CompanionProtocols.swift
//  Veryloving
//
//  Service protocols for the AI companion, ported from emo_ios. Protocol +
//  delegate design preserved so the WebSocket/Audio/Chat services stay mockable.
//

import Foundation

// MARK: WebSocket

protocol CompanionWebSocketDelegate: AnyObject {
    func webSocket(_ service: CompanionWebSocketProtocol, didReceive message: EVIMessage)
    func webSocket(_ service: CompanionWebSocketProtocol, didChangeConnected connected: Bool)
    func webSocket(_ service: CompanionWebSocketProtocol, didEncounterError error: Error)
}

protocol CompanionWebSocketProtocol: AnyObject {
    var delegate: CompanionWebSocketDelegate? { get set }
    var isConnected: Bool { get }
    func connect()
    func disconnect()
    func send(_ message: String)
}

// MARK: Audio

protocol CompanionAudioDelegate: AnyObject {
    func audio(_ service: CompanionAudioProtocol, didCapture base64: String)
    func audio(_ service: CompanionAudioProtocol, didEncounterError error: Error)
}

protocol CompanionAudioProtocol: AnyObject {
    var delegate: CompanionAudioDelegate? { get set }
    var isRunning: Bool { get }
    var isMuted: Bool { get set }
    func start() throws
    func stop()
    func playAudio(_ base64Data: String)
    func handleInterruption()
}

// MARK: Chat

protocol CompanionChatDelegate: AnyObject {
    func chat(_ service: CompanionChatProtocol, didUpdate messages: [ChatEntry])
    func chat(_ service: CompanionChatProtocol, didEncounterError error: Error)
}

protocol CompanionChatProtocol: AnyObject {
    var delegate: CompanionChatDelegate? { get set }
    var messages: [ChatEntry] { get }
    func process(_ message: EVIMessage)
    func appendLocalUserMessage(_ text: String)
    func clear()
}
