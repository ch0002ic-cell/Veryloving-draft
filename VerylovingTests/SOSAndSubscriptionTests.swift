//
//  SOSAndSubscriptionTests.swift
//  VerylovingTests
//

import XCTest
@testable import Veryloving

@MainActor
final class SOSViewModelTests: XCTestCase {

    /// Poll until the view model reaches `.sent`/`.failed` (mock dispatch is async).
    private func waitForStage(_ vm: SOSViewModel,
                              timeout: TimeInterval = 3,
                              until: (SOSViewModel.Stage) -> Bool) async {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if until(vm.stage) { return }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
    }

    func testWearableTriggerDispatchesWithoutCountdown() async {
        let vm = SOSViewModel(sosService: MockSOSService(),
                              location: MockLocationService(), trigger: .wearable)
        vm.begin()
        await waitForStage(vm) { $0 == .sent }
        XCTAssertEqual(vm.stage, .sent)
        XCTAssertEqual(vm.notifiedContacts, 3)
        XCTAssertNotNil(vm.fix, "A location fix should be captured for the alert")
    }

    func testDispatchFailureSurfacesFailedStage() async {
        let service = MockSOSService()
        service.shouldFail = true
        let vm = SOSViewModel(sosService: service, location: MockLocationService(), trigger: .wearable)
        vm.begin()
        await waitForStage(vm) { if case .failed = $0 { return true } else { return false } }
        if case .failed = vm.stage {} else { XCTFail("Expected .failed, got \(vm.stage)") }
    }

    func testAppTriggerStartsCountdown() {
        let vm = SOSViewModel(sosService: MockSOSService(),
                              location: MockLocationService(), trigger: .app, countdownSeconds: 5)
        vm.begin()
        XCTAssertEqual(vm.stage, .arming(secondsRemaining: 5))
    }
}

@MainActor
final class PaywallViewModelTests: XCTestCase {

    func testLoadProducts() async {
        let vm = PaywallViewModel(service: MockSubscriptionService())
        await vm.load()
        XCTAssertEqual(vm.products.count, 2)
        XCTAssertEqual(vm.products.map(\.tier), [.plus, .pro])
    }

    func testPurchaseEntitlesTier() async {
        let service = MockSubscriptionService()
        let vm = PaywallViewModel(service: service)
        await vm.load()
        let pro = try! XCTUnwrap(vm.products.first { $0.tier == .pro })
        await vm.purchase(pro)
        XCTAssertTrue(vm.didPurchase)
        XCTAssertEqual(service.entitledTier, .pro)
    }
}

final class FeatureGatingTests: XCTestCase {
    func testGatingMatrix() {
        XCTAssertTrue(Feature.basicSOS.isAvailable(for: .free))
        XCTAssertFalse(Feature.aiCompanion.isAvailable(for: .free))
        XCTAssertTrue(Feature.aiCompanion.isAvailable(for: .plus))
        XCTAssertFalse(Feature.satelliteSOS.isAvailable(for: .plus))
        XCTAssertTrue(Feature.satelliteSOS.isAvailable(for: .pro))
        XCTAssertTrue(Feature.familyMonitoring.isAvailable(for: .pro))
    }
}
