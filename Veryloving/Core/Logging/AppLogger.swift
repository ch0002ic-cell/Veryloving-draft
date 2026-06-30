//
//  AppLogger.swift
//  Veryloving
//
//  Thin wrapper over Apple's unified logging (os.Logger). Categories map to
//  subsystems so logs can be filtered in Console.app and Instruments.
//
//  Migration note: this replaces the prototype's print-based `Logger`
//  (EVIChat/Utils/Logger.swift). os.Logger is privacy-aware and ships with
//  the OS — no third-party dependency.
//

import Foundation
import os

enum LogCategory: String {
    case app
    case auth
    case network
    case bluetooth
    case sos
    case chat
    case notifications
}

/// Namespaced logging facade. Usage: `AppLogger.bluetooth.info("connected")`.
struct AppLogger {

    private let logger: os.Logger

    private init(_ category: LogCategory) {
        self.logger = os.Logger(
            subsystem: Bundle.main.bundleIdentifier ?? "ai.veryloving.app",
            category: category.rawValue
        )
    }

    static let app = AppLogger(.app)
    static let auth = AppLogger(.auth)
    static let network = AppLogger(.network)
    static let bluetooth = AppLogger(.bluetooth)
    static let sos = AppLogger(.sos)
    static let chat = AppLogger(.chat)
    static let notifications = AppLogger(.notifications)

    func debug(_ message: String) { logger.debug("\(message, privacy: .public)") }
    func info(_ message: String) { logger.info("\(message, privacy: .public)") }
    func warning(_ message: String) { logger.warning("\(message, privacy: .public)") }
    func error(_ message: String) { logger.error("\(message, privacy: .public)") }

    /// For payloads that may contain user data (locations, message bodies, tokens).
    /// Redacted in release builds; visible only when attached to a debugger.
    func sensitive(_ message: String) { logger.debug("\(message, privacy: .private)") }
}
