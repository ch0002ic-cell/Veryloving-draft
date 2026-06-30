//
//  LocationService.swift
//  Veryloving
//
//  CoreLocation wrapper for SOS. Provides a one-shot `currentFix` (with timeout +
//  last-known fallback) and continuous updates for the 30-minute post-SOS window.
//  `LiveLocationService` runs CoreLocation on the main run loop; UI consumers read
//  the authorization/last-known publishers. `MockLocationService` drives previews,
//  the simulator demo, and tests.
//

import Foundation
import CoreLocation
import Combine

enum LocationError: LocalizedError {
    case permissionDenied
    case timeout
    case unavailable(String)

    var errorDescription: String? {
        switch self {
        case .permissionDenied:
            return "Location access is off. Enable it in Settings so we can share your location during an SOS."
        case .timeout:
            return "We couldn't get a precise location in time and no recent location is available."
        case .unavailable(let detail):
            return detail
        }
    }
}

protocol LocationProviding: AnyObject {
    var authorizationStatus: CLAuthorizationStatus { get }
    var authorizationPublisher: AnyPublisher<CLAuthorizationStatus, Never> { get }
    var lastKnownFix: LocationFix? { get }

    func requestWhenInUseAuthorization()
    func requestAlwaysAuthorization()

    /// Resolve a current fix, falling back to the last known location on timeout.
    func currentFix(timeout: TimeInterval) async throws -> LocationFix

    /// Continuous updates (used while an SOS is active). Emits each new fix.
    func startContinuousUpdates()
    func stopContinuousUpdates()
    var fixPublisher: AnyPublisher<LocationFix, Never> { get }
}

extension LocationProviding {
    func currentFix() async throws -> LocationFix { try await currentFix(timeout: 8) }
}

// @unchecked Sendable: `pending` is only touched on the main queue (where the
// CLLocationManager is created, so its delegate callbacks also arrive), and
// `_lastKnown` is guarded by `lock`. This lets us dispatch onto main without
// Swift-6 non-Sendable-capture warnings.
final class LiveLocationService: NSObject, LocationProviding, @unchecked Sendable {

    private let manager = CLLocationManager()
    private let lock = NSLock()
    private var _lastKnown: LocationFix?
    private var pending: [UUID: CheckedContinuation<LocationFix, Error>] = [:]   // main-only

    private let authSubject: CurrentValueSubject<CLAuthorizationStatus, Never>
    private let fixSubject = PassthroughSubject<LocationFix, Never>()

    override init() {
        authSubject = CurrentValueSubject(manager.authorizationStatus)
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    var authorizationStatus: CLAuthorizationStatus { manager.authorizationStatus }
    var authorizationPublisher: AnyPublisher<CLAuthorizationStatus, Never> { authSubject.eraseToAnyPublisher() }
    var fixPublisher: AnyPublisher<LocationFix, Never> { fixSubject.eraseToAnyPublisher() }

    var lastKnownFix: LocationFix? {
        lock.lock(); defer { lock.unlock() }
        return _lastKnown
    }

    func requestWhenInUseAuthorization() { manager.requestWhenInUseAuthorization() }
    func requestAlwaysAuthorization() { manager.requestAlwaysAuthorization() }

    func currentFix(timeout: TimeInterval) async throws -> LocationFix {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.main.async {
                let status = self.manager.authorizationStatus
                guard status != .denied && status != .restricted else {
                    continuation.resume(throwing: LocationError.permissionDenied)
                    return
                }
                let id = UUID()
                self.pending[id] = continuation
                self.manager.requestLocation()

                DispatchQueue.main.asyncAfter(deadline: .now() + timeout) {
                    guard let cont = self.pending.removeValue(forKey: id) else { return }
                    if let fallback = self.lastKnownFix {
                        cont.resume(returning: fallback)
                    } else {
                        cont.resume(throwing: LocationError.timeout)
                    }
                }
            }
        }
    }

    func startContinuousUpdates() {
        DispatchQueue.main.async { self.manager.startUpdatingLocation() }
    }

    func stopContinuousUpdates() {
        DispatchQueue.main.async { self.manager.stopUpdatingLocation() }
    }

    private func resolvePending(with fix: LocationFix) {
        let conts = pending
        pending.removeAll()
        conts.values.forEach { $0.resume(returning: fix) }
    }
}

extension LiveLocationService: CLLocationManagerDelegate {

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authSubject.send(manager.authorizationStatus)
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        let fix = LocationFix(location)
        lock.lock(); _lastKnown = fix; lock.unlock()
        resolvePending(with: fix)
        fixSubject.send(fix)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        AppLogger.sos.error("Location error: \(error.localizedDescription)")
        let conts = pending
        pending.removeAll()
        for cont in conts.values {
            if let fallback = lastKnownFix {
                cont.resume(returning: fallback)
            } else {
                cont.resume(throwing: LocationError.unavailable(error.localizedDescription))
            }
        }
    }
}

// MARK: - Mock

final class MockLocationService: LocationProviding {
    private let authSubject = CurrentValueSubject<CLAuthorizationStatus, Never>(.authorizedWhenInUse)
    private let fixSubject = PassthroughSubject<LocationFix, Never>()

    var authorizationStatus: CLAuthorizationStatus { authSubject.value }
    var authorizationPublisher: AnyPublisher<CLAuthorizationStatus, Never> { authSubject.eraseToAnyPublisher() }
    var fixPublisher: AnyPublisher<LocationFix, Never> { fixSubject.eraseToAnyPublisher() }
    private(set) var lastKnownFix: LocationFix? =
        LocationFix(latitude: 37.7749, longitude: -122.4194, accuracyMeters: 10)

    func requestWhenInUseAuthorization() {}
    func requestAlwaysAuthorization() {}
    func startContinuousUpdates() {}
    func stopContinuousUpdates() {}

    func currentFix(timeout: TimeInterval) async throws -> LocationFix {
        try await Task.sleep(nanoseconds: 400_000_000)
        let fix = LocationFix(latitude: 37.7749, longitude: -122.4194, accuracyMeters: 8)
        lastKnownFix = fix
        return fix
    }
}
