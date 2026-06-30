//
//  BluetoothManager.swift
//  Veryloving
//
//  Live CoreBluetooth implementation of `WearableService`. Discovers the
//  Veryloving jewelry by its advertised service UUID, connects, subscribes to
//  the event + battery characteristics, and republishes everything as Combine
//  streams. Includes bounded auto-reconnect.
//
//  Concurrency: the whole manager runs on a dedicated serial queue (CoreBluetooth
//  best practice — keeps BLE work off the main thread). All mutable state and all
//  delegate callbacks share that one queue, so there are no data races and the
//  delegate conformances stay `nonisolated` (Swift 6 clean). UI consumers
//  subscribe to the publishers and hop to main themselves (see WearableViewModel,
//  which applies `.receive(on: .main)`).
//
//  ⚠️ Service/characteristic UUIDs come from AppConfig and are PLACEHOLDERS until
//  the firmware team provides the real values (clarification Q2).
//

import Foundation
import Combine
import CoreBluetooth

final class BluetoothManager: NSObject, WearableService {

    // MARK: Published streams (read from any thread; values are only *sent* from `queue`)

    private let stateSubject = CurrentValueSubject<BluetoothState, Never>(.unknown)
    private let devicesSubject = CurrentValueSubject<[WearableDevice], Never>([])
    private let connectedSubject = CurrentValueSubject<WearableDevice?, Never>(nil)
    private let events = PassthroughSubject<WearableEvent, Never>()

    var statePublisher: AnyPublisher<BluetoothState, Never> { stateSubject.eraseToAnyPublisher() }
    var devicesPublisher: AnyPublisher<[WearableDevice], Never> { devicesSubject.eraseToAnyPublisher() }
    var connectedDevicePublisher: AnyPublisher<WearableDevice?, Never> { connectedSubject.eraseToAnyPublisher() }
    var eventsPublisher: AnyPublisher<WearableEvent, Never> { events.eraseToAnyPublisher() }

    // MARK: CoreBluetooth state (only ever touched on `queue`)

    /// Serial queue that owns all CoreBluetooth interaction and mutable state.
    private let queue = DispatchQueue(label: "ai.veryloving.bluetooth")

    private var central: CBCentralManager?
    private var discoveredPeripherals: [UUID: CBPeripheral] = [:]
    private var activePeripheral: CBPeripheral?
    private var wantsToScan = false

    // Reconnection
    private var reconnectAttempts = 0
    private let maxReconnectAttempts = 5

    // UUIDs (immutable)
    private let serviceUUID: CBUUID
    private let eventCharUUID: CBUUID
    private let batteryServiceUUID: CBUUID
    private let batteryCharUUID: CBUUID

    override init() {
        let config = AppConfig.current
        serviceUUID = CBUUID(string: config.bleServiceUUID)
        eventCharUUID = CBUUID(string: config.bleEventCharacteristicUUID)
        batteryServiceUUID = CBUUID(string: config.batteryServiceUUID)
        batteryCharUUID = CBUUID(string: config.batteryLevelCharacteristicUUID)
        super.init()
    }

    // MARK: WearableService — public intents hop onto `queue`

    func startScanning() {
        queue.async { [weak self] in
            guard let self else { return }
            // Creating the central is what triggers the system Bluetooth prompt, so
            // we defer it until the user actually starts pairing.
            if self.central == nil {
                self.wantsToScan = true
                self.central = CBCentralManager(delegate: self, queue: self.queue)
                return
            }
            self.beginScanIfReady()
        }
    }

    func stopScanning() {
        queue.async { [weak self] in
            self?.wantsToScan = false
            self?.central?.stopScan()
        }
    }

    func connect(_ device: WearableDevice) {
        queue.async { [weak self] in
            guard let self else { return }
            guard let peripheral = self.discoveredPeripherals[device.id] else {
                AppLogger.bluetooth.warning("connect() called for unknown peripheral \(device.id)")
                return
            }
            self.wantsToScan = false
            self.central?.stopScan()
            self.reconnectAttempts = 0
            self.activePeripheral = peripheral
            peripheral.delegate = self
            self.updateConnected(from: device, state: .connecting)
            self.central?.connect(peripheral, options: nil)
        }
    }

    func disconnect() {
        queue.async { [weak self] in
            guard let self else { return }
            self.wantsToScan = false
            if let peripheral = self.activePeripheral {
                self.central?.cancelPeripheralConnection(peripheral)
            }
            self.activePeripheral = nil
            self.connectedSubject.send(nil)
        }
    }

    // MARK: Helpers (always invoked on `queue`)

    private func beginScanIfReady() {
        guard let central, central.state == .poweredOn else { return }
        devicesSubject.send([])
        discoveredPeripherals.removeAll()
        AppLogger.bluetooth.info("Scanning for Veryloving devices…")
        // Filtering by serviceUUID means only our jewelry shows up. Pass nil here
        // during bring-up if you need to see all advertisers.
        central.scanForPeripherals(withServices: [serviceUUID],
                                   options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    }

    private func upsertDiscovered(_ device: WearableDevice) {
        var list = devicesSubject.value
        if let index = list.firstIndex(where: { $0.id == device.id }) {
            list[index] = device
        } else {
            list.append(device)
        }
        devicesSubject.send(list)
    }

    private func updateConnected(from device: WearableDevice, state: WearableDevice.ConnectionState) {
        var updated = device
        updated.connectionState = state
        connectedSubject.send(updated)
    }

    private func mutateConnected(_ transform: (inout WearableDevice) -> Void) {
        guard var device = connectedSubject.value else { return }
        transform(&device)
        connectedSubject.send(device)
    }

    private func attemptReconnect() {
        guard let peripheral = activePeripheral, reconnectAttempts < maxReconnectAttempts else {
            AppLogger.bluetooth.warning("Giving up reconnect after \(self.reconnectAttempts) attempts.")
            connectedSubject.send(nil)
            activePeripheral = nil
            return
        }
        reconnectAttempts += 1
        mutateConnected { $0.connectionState = .reconnecting }
        AppLogger.bluetooth.info("Reconnect attempt \(self.reconnectAttempts)/\(self.maxReconnectAttempts)")
        central?.connect(peripheral, options: nil)
    }
}

// MARK: - CBCentralManagerDelegate (callbacks arrive on `queue`)

extension BluetoothManager: CBCentralManagerDelegate {

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        let mapped: BluetoothState
        switch central.state {
        case .poweredOn: mapped = .poweredOn
        case .poweredOff: mapped = .poweredOff
        case .unauthorized: mapped = .unauthorized
        case .unsupported: mapped = .unsupported
        default: mapped = .unknown
        }
        stateSubject.send(mapped)
        AppLogger.bluetooth.info("Central state: \(mapped)")

        if central.state == .poweredOn, wantsToScan {
            beginScanIfReady()
        }
    }

    func centralManager(_ central: CBCentralManager,
                        didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any],
                        rssi RSSI: NSNumber) {
        discoveredPeripherals[peripheral.identifier] = peripheral
        let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String)
            ?? peripheral.name
            ?? "Veryloving device"
        upsertDiscovered(
            WearableDevice(id: peripheral.identifier, name: name,
                           rssi: RSSI.intValue, batteryLevel: nil,
                           connectionState: .disconnected)
        )
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        AppLogger.bluetooth.info("Connected to \(peripheral.identifier)")
        reconnectAttempts = 0
        mutateConnected { $0.connectionState = .connected }
        peripheral.discoverServices([serviceUUID, batteryServiceUUID])
    }

    func centralManager(_ central: CBCentralManager,
                        didFailToConnect peripheral: CBPeripheral, error: Error?) {
        AppLogger.bluetooth.error("Failed to connect: \(error?.localizedDescription ?? "unknown")")
        attemptReconnect()
    }

    func centralManager(_ central: CBCentralManager,
                        didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        AppLogger.bluetooth.warning("Disconnected: \(error?.localizedDescription ?? "clean")")
        if error != nil {
            attemptReconnect()          // unexpected drop → try to recover
        } else {
            connectedSubject.send(nil)  // user-initiated disconnect
            activePeripheral = nil
        }
    }
}

// MARK: - CBPeripheralDelegate (callbacks arrive on `queue`)

extension BluetoothManager: CBPeripheralDelegate {

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard error == nil, let services = peripheral.services else { return }
        for service in services {
            peripheral.discoverCharacteristics(nil, for: service)
        }
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard error == nil, let characteristics = service.characteristics else { return }
        for characteristic in characteristics {
            switch characteristic.uuid {
            case eventCharUUID:
                peripheral.setNotifyValue(true, for: characteristic)   // SOS / AI taps
            case batteryCharUUID:
                peripheral.setNotifyValue(true, for: characteristic)
                peripheral.readValue(for: characteristic)              // initial battery read
            default:
                break
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard error == nil, let data = characteristic.value else { return }

        switch characteristic.uuid {
        case batteryCharUUID:
            let percent = Int(data.first ?? 0)
            mutateConnected { $0.batteryLevel = percent }
            events.send(.batteryUpdate(percent: percent))

        case eventCharUUID:
            guard let event = WearableEvent.parse(data) else { return }
            AppLogger.bluetooth.info("Wearable event: \(String(describing: event))")
            if case .batteryUpdate(let percent) = event {
                mutateConnected { $0.batteryLevel = percent }
            }
            events.send(event)

        default:
            break
        }
    }
}
