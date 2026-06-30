//
//  Phase3Tests.swift
//  VerylovingTests
//
//  Token refresh, offline SOS resilience, and analytics mapping.
//

import XCTest
@testable import Veryloving

// MARK: - Helpers

private func demoAuthResponse() -> AuthResponse {
    AuthResponse(
        user: User(id: "u1", email: "demo@veryloving.ai", displayName: "Demo",
                   subscriptionTier: .free, createdAt: Date()),
        accessToken: "access", refreshToken: "refresh", expiresIn: 3600
    )
}

private final class StubAuthService: AuthService {
    var refreshError: Error?
    func signIn(email: String, password: String) async throws -> AuthResponse { demoAuthResponse() }
    func register(email: String, password: String, displayName: String) async throws -> AuthResponse { demoAuthResponse() }
    func signInWithApple(identityToken: String, fullName: String?) async throws -> AuthResponse { demoAuthResponse() }
    func refresh(refreshToken: String) async throws -> AuthResponse {
        if let refreshError { throw refreshError }
        return demoAuthResponse()
    }
}

private struct StubError: Error {}

private final class FlakySOSService: SOSService {
    var failuresRemaining: Int
    private(set) var dispatchCount = 0
    init(failuresRemaining: Int) { self.failuresRemaining = failuresRemaining }

    func dispatch(_ alert: SOSAlert) async throws -> SOSDispatchResult {
        dispatchCount += 1
        if failuresRemaining > 0 {
            failuresRemaining -= 1
            throw APIError.notConnectedToInternet
        }
        return SOSDispatchResult(alertId: "ok", notifiedContacts: 1)
    }
    func updateLocation(alertId: String, fix: LocationFix) async throws {}
    func cancel(alertId: String) async throws {}
    func sendTestAlert(to contact: EmergencyContact) async throws {}
}

// MARK: - Token refresh

@MainActor
final class SessionRefreshTests: XCTestCase {

    func testRefreshSucceedsWhenTokenPresent() async {
        let store = InMemorySecureStore()
        try? store.setString("refresh-abc", for: .refreshToken)
        let session = SessionStore(secureStore: store, authService: MockAuthService(), tokenProvider: TokenProvider())
        session.bootstrap()

        let ok = await session.refreshSession()

        XCTAssertTrue(ok)
        XCTAssertNotNil(session.currentUser)
    }

    func testRefreshWithoutTokenReturnsFalse() async {
        let session = SessionStore(secureStore: InMemorySecureStore(),
                                   authService: MockAuthService(), tokenProvider: TokenProvider())
        let ok = await session.refreshSession()
        XCTAssertFalse(ok)
    }

    func testRefreshFailureSignsOut() async {
        let store = InMemorySecureStore()
        try? store.setString("refresh-abc", for: .refreshToken)
        let stub = StubAuthService()
        let session = SessionStore(secureStore: store, authService: stub, tokenProvider: TokenProvider())
        session.establish(demoAuthResponse())          // start authenticated
        stub.refreshError = StubError()

        let ok = await session.refreshSession()

        XCTAssertFalse(ok)
        XCTAssertEqual(session.phase, .unauthenticated)
    }
}

// MARK: - Offline SOS

final class OfflineSOSQueueTests: XCTestCase {

    private func makeQueue() -> OfflineSOSQueue {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("sos-test-\(UUID().uuidString).json")
        return OfflineSOSQueue(fileURL: url)
    }

    private let alert = SOSAlert(triggeredBy: .app, location: nil, batteryLevel: nil)

    func testEnqueuePersistsAndRemoves() {
        let queue = makeQueue()
        defer { queue.clear() }

        queue.enqueue(alert)
        queue.enqueue(alert)
        XCTAssertEqual(queue.pending().count, 2)

        let first = queue.pending().first!
        queue.remove(id: first.id)
        XCTAssertEqual(queue.pending().count, 1)

        queue.clear()
        XCTAssertTrue(queue.pending().isEmpty)
    }
}

final class ResilientSOSServiceTests: XCTestCase {

    func testFailedDispatchQueuesThenFlushes() async {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("sos-resilient-\(UUID().uuidString).json")
        let queue = OfflineSOSQueue(fileURL: url)
        defer { queue.clear() }

        let base = FlakySOSService(failuresRemaining: 1)         // first dispatch fails
        let service = ResilientSOSService(base: base, queue: queue, reachability: MockReachability())
        let alert = SOSAlert(triggeredBy: .app, location: nil, batteryLevel: nil)

        // 1) Offline failure → queued + friendly error.
        do {
            _ = try await service.dispatch(alert)
            XCTFail("Expected SOSError.queuedOffline")
        } catch let error as SOSError {
            XCTAssertEqual(error, .queuedOffline)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
        XCTAssertEqual(queue.pending().count, 1)

        // 2) Flush now that the base will succeed.
        await service.flush()
        XCTAssertTrue(queue.pending().isEmpty)
    }
}

// MARK: - Analytics mapping

final class AnalyticsEventTests: XCTestCase {

    func testEventNames() {
        XCTAssertEqual(AnalyticsEvent.sosTriggered(source: "app").name, "sos_triggered")
        XCTAssertEqual(AnalyticsEvent.subscriptionStarted(tier: "pro").name, "subscription_started")
        XCTAssertEqual(AnalyticsEvent.devicePaired.name, "device_paired")
    }

    func testEventParameters() {
        XCTAssertEqual(AnalyticsEvent.sosTriggered(source: "wearable").parameters, ["source": "wearable"])
        XCTAssertEqual(AnalyticsEvent.sosDispatched(notifiedContacts: 3).parameters, ["notified_contacts": "3"])
        XCTAssertEqual(AnalyticsEvent.subscriptionStarted(tier: "plus").parameters, ["tier": "plus"])
        XCTAssertTrue(AnalyticsEvent.sosCancelled.parameters.isEmpty)
    }
}
