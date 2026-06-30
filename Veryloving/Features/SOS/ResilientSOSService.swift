//
//  ResilientSOSService.swift
//  Veryloving
//
//  Decorates a live SOSService with offline resilience: a dispatch that fails for
//  a retryable reason (offline / transient / 5xx) is persisted to the
//  OfflineSOSQueue and re-sent automatically when connectivity returns. Wraps the
//  RemoteSOSService in production (see AppEnvironment).
//

import Foundation
import Combine

enum SOSError: LocalizedError {
    case queuedOffline

    var errorDescription: String? {
        switch self {
        case .queuedOffline:
            return "You're offline. We've saved your SOS and will send it the moment you're back online."
        }
    }
}

final class ResilientSOSService: SOSService, @unchecked Sendable {

    private let base: SOSService
    private let queue: OfflineSOSQueue
    private let reachability: ReachabilitySignal
    private var cancellable: AnyCancellable?

    init(base: SOSService, queue: OfflineSOSQueue, reachability: ReachabilitySignal) {
        self.base = base
        self.queue = queue
        self.reachability = reachability
        // Flush whenever we transition back online.
        cancellable = reachability.onlinePublisher
            .filter { $0 }
            .sink { [weak self] _ in Task { await self?.flush() } }
    }

    func dispatch(_ alert: SOSAlert) async throws -> SOSDispatchResult {
        do {
            return try await base.dispatch(alert)
        } catch let error as APIError where error.isRetryable {
            queue.enqueue(alert)
            throw SOSError.queuedOffline
        }
    }

    /// Re-send everything in the queue; remove each on success.
    func flush() async {
        for item in queue.pending() {
            if (try? await base.dispatch(item.alert)) != nil {
                queue.remove(id: item.id)
                AppLogger.sos.info("Flushed queued SOS \(item.id).")
            }
        }
    }

    func updateLocation(alertId: String, fix: LocationFix) async throws {
        try await base.updateLocation(alertId: alertId, fix: fix)
    }

    func cancel(alertId: String) async throws {
        try await base.cancel(alertId: alertId)
    }

    func sendTestAlert(to contact: EmergencyContact) async throws {
        try await base.sendTestAlert(to: contact)
    }
}
