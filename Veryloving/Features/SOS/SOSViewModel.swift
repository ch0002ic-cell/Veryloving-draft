//
//  SOSViewModel.swift
//  Veryloving
//
//  Orchestrates the SOS flow: cancelable countdown → GPS capture (with last-known
//  fallback) → backend dispatch → confirmation → continuous location sharing for
//  the configured window. A false-alarm cancel during the countdown aborts cleanly.
//

import Foundation
import Combine

@MainActor
final class SOSViewModel: ObservableObject {

    enum Stage: Equatable {
        case arming(secondsRemaining: Int)
        case sending
        case sent
        case failed(String)
    }

    @Published private(set) var stage: Stage
    @Published private(set) var fix: LocationFix?
    @Published private(set) var notifiedContacts = 0

    private let sosService: SOSService
    private let location: LocationProviding
    private let trigger: SOSAlert.Trigger
    private let batteryLevel: Int?
    private let countdownSeconds: Int
    private let analytics: AnalyticsService

    private var countdownTask: Task<Void, Never>?
    private var alertId: String?
    private var cancellables = Set<AnyCancellable>()
    private var stopSharingItem: DispatchWorkItem?

    init(sosService: SOSService,
         location: LocationProviding,
         trigger: SOSAlert.Trigger = .app,
         batteryLevel: Int? = nil,
         countdownSeconds: Int = 5,
         analytics: AnalyticsService = NoopAnalyticsService()) {
        self.sosService = sosService
        self.location = location
        self.trigger = trigger
        self.batteryLevel = batteryLevel
        self.countdownSeconds = countdownSeconds
        self.analytics = analytics
        self.stage = .arming(secondsRemaining: countdownSeconds)
    }

    /// A hardware (wearable) SOS skips the countdown — help is already wanted.
    func begin() {
        analytics.log(.sosTriggered(source: trigger.rawValue))
        location.requestWhenInUseAuthorization()
        // Warm up a location fix in parallel with the countdown.
        Task { self.fix = try? await location.currentFix() }

        if trigger == .wearable {
            Task { await dispatch() }
        } else {
            startCountdown()
        }
    }

    func cancelFalseAlarm() {
        countdownTask?.cancel()
        stopLocationSharing()
        analytics.log(.sosCancelled)
        if let alertId {
            Task { try? await sosService.cancel(alertId: alertId) }
        }
    }

    func retry() { Task { await dispatch() } }

    func finish() { stopLocationSharing() }

    // MARK: - Private

    private func startCountdown() {
        countdownTask = Task { [weak self] in
            guard let self else { return }
            var remaining = self.countdownSeconds
            while remaining > 0 {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                if Task.isCancelled { return }
                remaining -= 1
                self.stage = .arming(secondsRemaining: remaining)
                Haptics.impact(.heavy)
            }
            await self.dispatch()
        }
    }

    private func dispatch() async {
        stage = .sending
        if fix == nil { fix = try? await location.currentFix() }   // ensure best-effort fix

        let alert = SOSAlert(triggeredBy: trigger, location: fix, batteryLevel: batteryLevel)
        do {
            let result = try await sosService.dispatch(alert)
            alertId = result.alertId
            notifiedContacts = result.notifiedContacts
            stage = .sent
            analytics.log(.sosDispatched(notifiedContacts: result.notifiedContacts))
            Haptics.notify(.success)
            startLocationSharing()
        } catch {
            AppLogger.sos.error("SOS dispatch failed: \(error.localizedDescription)")
            stage = .failed(AppError(error).message)
            Haptics.notify(.error)
        }
    }

    private func startLocationSharing() {
        guard let alertId else { return }
        location.startContinuousUpdates()
        location.fixPublisher
            .sink { newFix in
                Task { try? await self.sosService.updateLocation(alertId: alertId, fix: newFix) }
            }
            .store(in: &cancellables)

        // Stop sharing after the configured window (default 30 min).
        let work = DispatchWorkItem { [weak self] in self?.stopLocationSharing() }
        stopSharingItem = work
        DispatchQueue.main.asyncAfter(
            deadline: .now() + AppConfig.current.sosLocationSharingDuration, execute: work
        )
    }

    private func stopLocationSharing() {
        stopSharingItem?.cancel()
        stopSharingItem = nil
        cancellables.removeAll()
        location.stopContinuousUpdates()
    }
}
