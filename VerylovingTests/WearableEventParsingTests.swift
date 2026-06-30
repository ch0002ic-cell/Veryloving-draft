//
//  WearableEventParsingTests.swift
//  VerylovingTests
//
//  The BLE event parser is pure, so it's fully unit-testable without hardware.
//  When the real firmware opcodes arrive, update WearableEvent.Opcode and these
//  expectations together.
//

import XCTest
@testable import Veryloving

final class WearableEventParsingTests: XCTestCase {

    func testEmptyDataReturnsNil() {
        XCTAssertNil(WearableEvent.parse(Data()))
    }

    func testAIActivationOpcode() {
        XCTAssertEqual(WearableEvent.parse(Data([0x01])), .aiActivation)
    }

    func testSOSOpcode() {
        XCTAssertEqual(WearableEvent.parse(Data([0x02])), .sosTriggered)
    }

    func testButtonReleasedOpcode() {
        XCTAssertEqual(WearableEvent.parse(Data([0x03])), .buttonReleased)
    }

    func testBatteryUpdateWithArgument() {
        XCTAssertEqual(WearableEvent.parse(Data([0x04, 87])), .batteryUpdate(percent: 87))
    }

    func testBatteryUpdateClampsAbove100() {
        XCTAssertEqual(WearableEvent.parse(Data([0x04, 0xFF])), .batteryUpdate(percent: 100))
    }

    func testBatteryUpdateWithoutArgumentDefaultsToZero() {
        XCTAssertEqual(WearableEvent.parse(Data([0x04])), .batteryUpdate(percent: 0))
    }

    func testUnknownOpcodeIsPreserved() {
        XCTAssertEqual(WearableEvent.parse(Data([0x7F])), .unknown(opcode: 0x7F))
    }

    func testExtraTrailingBytesAreIgnored() {
        // Opcode + battery + junk should still parse cleanly.
        XCTAssertEqual(WearableEvent.parse(Data([0x04, 42, 0x00, 0x99])), .batteryUpdate(percent: 42))
    }
}
