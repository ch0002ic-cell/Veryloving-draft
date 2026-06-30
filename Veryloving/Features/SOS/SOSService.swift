//
//  SOSService.swift
//  Veryloving
//
//  Dispatch boundary for SOS. `RemoteSOSService` posts to the backend
//  (docs/BACKEND_API.md §SOS), which performs the SMS/push fan-out.
//  `MockSOSService` simulates the round trip for previews / the demo.
//  Conforms to `ContactAlerting` so the same backend powers the per-contact
//  "test alert".
//

import Foundation

protocol SOSService: ContactAlerting {
    func dispatch(_ alert: SOSAlert) async throws -> SOSDispatchResult
    func updateLocation(alertId: String, fix: LocationFix) async throws
    func cancel(alertId: String) async throws
}

// MARK: Request bodies

private struct LocationBody: Encodable {
    let lat: Double, lng: Double, accuracyM: Double, capturedAt: Date
    init(_ fix: LocationFix) {
        lat = fix.latitude; lng = fix.longitude
        accuracyM = fix.accuracyMeters; capturedAt = fix.capturedAt
    }
}
private struct DispatchBody: Encodable {
    let triggeredBy: String
    let location: LocationBody?
    let batteryLevel: Int?
}

final class RemoteSOSService: SOSService {
    private let client: APIClient
    init(client: APIClient) { self.client = client }

    func dispatch(_ alert: SOSAlert) async throws -> SOSDispatchResult {
        let body = DispatchBody(
            triggeredBy: alert.triggeredBy.rawValue,
            location: alert.location.map(LocationBody.init),
            batteryLevel: alert.batteryLevel
        )
        return try await client.send(
            .json("/v1/sos", method: .post, body: body),
            decoding: SOSDispatchResult.self
        )
    }

    func updateLocation(alertId: String, fix: LocationFix) async throws {
        try await client.send(.json("/v1/sos/\(alertId)/location", method: .post, body: LocationBody(fix)))
    }

    func cancel(alertId: String) async throws {
        try await client.send(Endpoint(path: "/v1/sos/\(alertId)/cancel", method: .post))
    }

    func sendTestAlert(to contact: EmergencyContact) async throws {
        try await client.send(Endpoint(path: "/v1/contacts/\(contact.id.uuidString)/test-alert", method: .post))
    }
}

// MARK: Mock

final class MockSOSService: SOSService {
    /// Set true to exercise the failure/offline-queue UX in the demo.
    var shouldFail = false

    func dispatch(_ alert: SOSAlert) async throws -> SOSDispatchResult {
        try await Task.sleep(nanoseconds: 1_000_000_000)
        if shouldFail { throw APIError.notConnectedToInternet }
        AppLogger.sos.info("MOCK SOS dispatched (trigger: \(alert.triggeredBy.rawValue))")
        return SOSDispatchResult(alertId: "mock-\(UUID().uuidString)", notifiedContacts: 3)
    }

    func updateLocation(alertId: String, fix: LocationFix) async throws {
        AppLogger.sos.debug("MOCK location update for \(alertId)")
    }

    func cancel(alertId: String) async throws {
        AppLogger.sos.info("MOCK SOS cancelled: \(alertId)")
    }

    func sendTestAlert(to contact: EmergencyContact) async throws {
        try await Task.sleep(nanoseconds: 700_000_000)
        AppLogger.sos.info("MOCK test alert sent to \(contact.name)")
    }
}
