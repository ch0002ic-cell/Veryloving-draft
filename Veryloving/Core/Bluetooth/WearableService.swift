//
//  WearableService.swift
//  Veryloving
//
//  Abstraction over the jewelry's BLE connection so the UI/view models depend on
//  a protocol (testable, previewable) rather than CoreBluetooth directly.
//  `BluetoothManager` is the live implementation; `MockWearableService` drives
//  SwiftUI previews and the simulator (where CoreBluetooth has no radio).
//

import Foundation
import Combine

/// High-level Bluetooth radio/authorization state for the UI.
enum BluetoothState: Equatable {
    case unknown
    case unsupported
    case unauthorized
    case poweredOff
    case poweredOn

    var isReady: Bool { self == .poweredOn }

    var userMessage: String? {
        switch self {
        case .poweredOn, .unknown: return nil
        case .unsupported: return "This device doesn't support Bluetooth Low Energy."
        case .unauthorized: return "Bluetooth permission is needed to connect your jewelry. Enable it in Settings."
        case .poweredOff: return "Bluetooth is off. Turn it on to connect your jewelry."
        }
    }
}

protocol WearableService: AnyObject {
    var statePublisher: AnyPublisher<BluetoothState, Never> { get }
    var devicesPublisher: AnyPublisher<[WearableDevice], Never> { get }
    var connectedDevicePublisher: AnyPublisher<WearableDevice?, Never> { get }
    /// Events pushed by the jewelry (SOS, AI activation, battery).
    var eventsPublisher: AnyPublisher<WearableEvent, Never> { get }

    func startScanning()
    func stopScanning()
    func connect(_ device: WearableDevice)
    func disconnect()
}

// MARK: - Mock (previews, simulator, demo)

/// Simulates discovery → connection → a battery read and an optional SOS event.
final class MockWearableService: WearableService {
    private let stateSubject = CurrentValueSubject<BluetoothState, Never>(.poweredOn)
    private let devicesSubject = CurrentValueSubject<[WearableDevice], Never>([])
    private let connectedSubject = CurrentValueSubject<WearableDevice?, Never>(nil)
    private let events = PassthroughSubject<WearableEvent, Never>()

    var statePublisher: AnyPublisher<BluetoothState, Never> { stateSubject.eraseToAnyPublisher() }
    var devicesPublisher: AnyPublisher<[WearableDevice], Never> { devicesSubject.eraseToAnyPublisher() }
    var connectedDevicePublisher: AnyPublisher<WearableDevice?, Never> { connectedSubject.eraseToAnyPublisher() }
    var eventsPublisher: AnyPublisher<WearableEvent, Never> { events.eraseToAnyPublisher() }

    func startScanning() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            self.devicesSubject.send([
                WearableDevice(id: UUID(), name: "Veryloving Pendant", rssi: -52,
                               batteryLevel: nil, connectionState: .disconnected),
                WearableDevice(id: UUID(), name: "Veryloving Bracelet", rssi: -74,
                               batteryLevel: nil, connectionState: .disconnected)
            ])
        }
    }

    func stopScanning() {}

    func connect(_ device: WearableDevice) {
        var connecting = device
        connecting.connectionState = .connecting
        connectedSubject.send(connecting)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            var connected = device
            connected.connectionState = .connected
            connected.batteryLevel = 87
            self.connectedSubject.send(connected)
            self.events.send(.batteryUpdate(percent: 87))
        }
    }

    func disconnect() {
        connectedSubject.send(nil)
    }

    /// Test hook: simulate a hardware SOS press.
    func simulateSOS() { events.send(.sosTriggered) }
}
