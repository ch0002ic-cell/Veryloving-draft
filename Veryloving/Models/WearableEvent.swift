//
//  WearableEvent.swift
//  Veryloving
//
//  Events the jewelry pushes over its BLE "event" characteristic. The hardware
//  notifies a small binary payload; `WearableEvent.parse` turns it into a typed
//  event. The opcode mapping is a PLACEHOLDER pending the firmware spec
//  (clarification Q2) — but the parse function is pure and unit-tested, so once
//  the real bytes are known only the `Opcode` table needs to change.
//
//  Assumed wire format (1+ bytes):
//    byte[0] = opcode
//    byte[1] = optional argument (e.g. battery percent for .batteryUpdate)
//

import Foundation

enum WearableEvent: Equatable {
    /// 3-second tap → activate the AI companion.
    case aiActivation
    /// 5-second tap → trigger SOS.
    case sosTriggered
    /// Physical button released (used to cancel a hold in progress).
    case buttonReleased
    /// Battery level pushed by the device, 0...100.
    case batteryUpdate(percent: Int)
    /// Recognized opcode we don't act on yet.
    case unknown(opcode: UInt8)

    /// Opcode table — replace values with the real firmware constants.
    private enum Opcode: UInt8 {
        case aiActivation   = 0x01
        case sosTriggered   = 0x02
        case buttonReleased = 0x03
        case batteryUpdate  = 0x04
    }

    /// Pure parser: BLE notification payload → typed event. Returns nil for empty data.
    static func parse(_ data: Data) -> WearableEvent? {
        guard let first = data.first else { return nil }
        guard let opcode = Opcode(rawValue: first) else { return .unknown(opcode: first) }

        switch opcode {
        case .aiActivation:
            return .aiActivation
        case .sosTriggered:
            return .sosTriggered
        case .buttonReleased:
            return .buttonReleased
        case .batteryUpdate:
            let percent = data.count > 1 ? Int(data[data.index(after: data.startIndex)]) : 0
            return .batteryUpdate(percent: min(max(percent, 0), 100))
        }
    }
}
