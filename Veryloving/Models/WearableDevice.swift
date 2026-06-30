//
//  WearableDevice.swift
//  Veryloving
//

import Foundation

/// A discovered or connected Veryloving jewelry device.
struct WearableDevice: Identifiable, Equatable {
    /// CoreBluetooth peripheral identifier (stable per device/app install).
    let id: UUID
    var name: String
    var rssi: Int?
    var batteryLevel: Int?          // 0...100, nil until read.
    var connectionState: ConnectionState

    enum ConnectionState: String, Equatable {
        case disconnected
        case connecting
        case connected
        case reconnecting
    }

    var isConnected: Bool { connectionState == .connected }

    var batteryDescription: String {
        guard let batteryLevel else { return "—" }
        return "\(batteryLevel)%"
    }

    /// Signal-strength bucket for the UI, derived from RSSI.
    var signalStrength: SignalStrength {
        guard let rssi else { return .unknown }
        switch rssi {
        case ..<(-90): return .weak
        case -90 ..< -70: return .fair
        default: return .strong
        }
    }

    enum SignalStrength { case unknown, weak, fair, strong }
}
