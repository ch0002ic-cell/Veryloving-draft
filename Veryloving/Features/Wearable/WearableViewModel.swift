//
//  WearableViewModel.swift
//  Veryloving
//
//  Observes a `WearableService` and exposes pairing/connection state + intents
//  to the SwiftUI layer. Depends on the protocol (not CoreBluetooth) so it works
//  with `MockWearableService` in previews and the simulator.
//

import Foundation
import Combine

@MainActor
final class WearableViewModel: ObservableObject {

    @Published private(set) var bluetoothState: BluetoothState = .unknown
    @Published private(set) var devices: [WearableDevice] = []
    @Published private(set) var connectedDevice: WearableDevice?
    @Published private(set) var isScanning = false
    /// Most recent event from the jewelry; the app shell observes this to react
    /// to hardware SOS / AI-activation taps.
    @Published private(set) var lastEvent: WearableEvent?

    private let service: WearableService
    private let analytics: AnalyticsService
    private var cancellables = Set<AnyCancellable>()

    init(service: WearableService, analytics: AnalyticsService = NoopAnalyticsService()) {
        self.service = service
        self.analytics = analytics

        service.statePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.bluetoothState = $0 }
            .store(in: &cancellables)

        service.devicesPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.devices = $0 }
            .store(in: &cancellables)

        service.connectedDevicePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] device in
                guard let self else { return }
                let wasConnected = self.connectedDevice?.isConnected == true
                self.connectedDevice = device
                if device?.isConnected == true {
                    self.isScanning = false   // stop the scanning UI once paired
                    if !wasConnected { self.analytics.log(.devicePaired) }
                }
            }
            .store(in: &cancellables)

        service.eventsPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                self?.lastEvent = event
                // Tactile confirmation for user-initiated taps, but not for
                // passive battery telemetry.
                if case .batteryUpdate = event { return }
                Haptics.impact(.light)
            }
            .store(in: &cancellables)
    }

    var hasPairedDevice: Bool { connectedDevice != nil }

    func startPairing() {
        guard !isScanning else { return }
        isScanning = true
        service.startScanning()
    }

    func stopScanning() {
        isScanning = false
        service.stopScanning()
    }

    func connect(_ device: WearableDevice) {
        Haptics.selection()
        service.connect(device)
    }

    func disconnect() {
        service.disconnect()
    }
}
