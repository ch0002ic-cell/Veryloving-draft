//
//  CompanionWebSocketService.swift
//  Veryloving
//
//  Ported from emo_ios WebSocketService. Connects to Hume EVI over
//  URLSessionWebSocketTask. The API key/config come from the Keychain (never
//  hardcoded — fixing the prototype's hardcoded-key security gap). Reconnects with
//  exponential backoff and keepalive pings.
//

import Foundation

enum CompanionWebSocketError: LocalizedError {
    case invalidURL
    case missingAPIKey
    case connectionFailed

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid companion server URL."
        case .missingAPIKey: return "Add your Hume API key to start a conversation."
        case .connectionFailed: return "Couldn't reach the companion. Please try again."
        }
    }
}

final class CompanionWebSocketService: NSObject, CompanionWebSocketProtocol {

    weak var delegate: CompanionWebSocketDelegate?
    private(set) var isConnected = false

    private var webSocketTask: URLSessionWebSocketTask?
    private let apiKey: String
    private let configId: String
    private let baseURL: URL

    private var reconnectAttempts = 0
    private let maxReconnectAttempts = 5
    private let reconnectDelay: TimeInterval = 2.0

    init(apiKey: String, configId: String, baseURL: URL = AppConfig.current.humeWebSocketURL) {
        self.apiKey = apiKey
        self.configId = configId
        self.baseURL = baseURL
        super.init()
    }

    func connect() {
        guard !apiKey.isEmpty else {
            delegate?.webSocket(self, didEncounterError: CompanionWebSocketError.missingAPIKey)
            return
        }
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            delegate?.webSocket(self, didEncounterError: CompanionWebSocketError.invalidURL)
            return
        }
        var query = [URLQueryItem(name: "api_key", value: apiKey)]
        if !configId.isEmpty { query.append(URLQueryItem(name: "config_id", value: configId)) }
        components.queryItems = query

        guard let url = components.url else {
            delegate?.webSocket(self, didEncounterError: CompanionWebSocketError.invalidURL)
            return
        }

        let session = URLSession(configuration: .default)
        webSocketTask = session.webSocketTask(with: url)
        webSocketTask?.resume()

        sendSessionSettings()
        isConnected = true
        delegate?.webSocket(self, didChangeConnected: true)
    }

    func disconnect() {
        webSocketTask?.cancel()
        webSocketTask = nil
        isConnected = false
        delegate?.webSocket(self, didChangeConnected: false)
    }

    func send(_ message: String) {
        webSocketTask?.send(.string(message)) { [weak self] error in
            if let error {
                AppLogger.chat.error("Send failed: \(error.localizedDescription)")
                self?.handleConnectionFailure()
            }
        }
    }

    private func sendSessionSettings() {
        let settings: [String: Any] = [
            "type": "session_settings",
            "audio": ["encoding": "linear16", "sample_rate": 48000, "channels": 1]
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: settings),
              let json = String(data: data, encoding: .utf8) else { return }
        send(json)
        DispatchQueue.main.async {
            self.receiveMessage()
            self.schedulePing()
        }
    }

    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                if case .string(let text) = message { self.handleMessage(text) }
                self.receiveMessage()
            case .failure(let error):
                self.delegate?.webSocket(self, didEncounterError: error)
                self.handleConnectionFailure()
            }
        }
    }

    private func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8) else { return }
        do {
            let message = try JSONDecoder().decode(EVIMessage.self, from: data)
            delegate?.webSocket(self, didReceive: message)
        } catch {
            delegate?.webSocket(self, didEncounterError: error)
        }
    }

    private func schedulePing() {
        guard isConnected else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            guard let self, self.isConnected else { return }
            self.webSocketTask?.sendPing { [weak self] error in
                if error != nil { self?.handleConnectionFailure() } else { self?.schedulePing() }
            }
        }
    }

    private func handleConnectionFailure() {
        isConnected = false
        delegate?.webSocket(self, didChangeConnected: false)

        guard reconnectAttempts < maxReconnectAttempts else {
            delegate?.webSocket(self, didEncounterError: CompanionWebSocketError.connectionFailed)
            return
        }
        reconnectAttempts += 1
        let delay = reconnectDelay * pow(2, Double(reconnectAttempts - 1))
        AppLogger.chat.info("Companion reconnect \(self.reconnectAttempts)/\(self.maxReconnectAttempts) in \(delay)s")
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            self?.connect()
        }
    }
}
