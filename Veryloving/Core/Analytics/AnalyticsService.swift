//
//  AnalyticsService.swift
//  Veryloving
//
//  Analytics abstraction. Features log typed `AnalyticsEvent`s; the concrete sink
//  is swappable. Today we ship `ConsoleAnalyticsService` (DEBUG) / `NoopAnalyticsService`
//  (release). Firebase Analytics + Crashlytics drop in behind this protocol once
//  the SDK + GoogleService-Info.plist are provisioned (clarification Q4) — see the
//  commented `FirebaseAnalyticsService` sketch below. No third-party dependency is
//  added yet, so the build stays clean and TestFlight-ready.
//

import Foundation

/// Strongly-typed events — no stringly-typed names sprinkled across the app.
enum AnalyticsEvent {
    case signedIn(method: String)
    case signedUp(method: String)
    case sosTriggered(source: String)        // "app" | "wearable"
    case sosDispatched(notifiedContacts: Int)
    case sosCancelled
    case devicePaired
    case contactAdded
    case subscriptionStarted(tier: String)
    case companionConnected

    var name: String {
        switch self {
        case .signedIn: return "signed_in"
        case .signedUp: return "signed_up"
        case .sosTriggered: return "sos_triggered"
        case .sosDispatched: return "sos_dispatched"
        case .sosCancelled: return "sos_cancelled"
        case .devicePaired: return "device_paired"
        case .contactAdded: return "contact_added"
        case .subscriptionStarted: return "subscription_started"
        case .companionConnected: return "companion_connected"
        }
    }

    var parameters: [String: String] {
        switch self {
        case .signedIn(let method), .signedUp(let method): return ["method": method]
        case .sosTriggered(let source): return ["source": source]
        case .sosDispatched(let count): return ["notified_contacts": "\(count)"]
        case .subscriptionStarted(let tier): return ["tier": tier]
        case .sosCancelled, .devicePaired, .contactAdded, .companionConnected: return [:]
        }
    }
}

protocol AnalyticsService: AnyObject {
    func log(_ event: AnalyticsEvent)
    /// Stable, non-PII user id for cohorting (e.g. the backend user id).
    func setUserId(_ id: String?)
    /// Record a non-fatal error (Crashlytics `recordError` once integrated).
    func record(_ error: Error)
}

final class ConsoleAnalyticsService: AnalyticsService {
    func log(_ event: AnalyticsEvent) {
        let params = event.parameters.isEmpty ? "" : " \(event.parameters)"
        AppLogger.app.debug("📊 \(event.name)\(params)")
    }
    func setUserId(_ id: String?) { AppLogger.app.debug("📊 userId=\(id ?? "nil")") }
    func record(_ error: Error) { AppLogger.app.error("📊 non-fatal: \(error.localizedDescription)") }
}

final class NoopAnalyticsService: AnalyticsService {
    func log(_ event: AnalyticsEvent) {}
    func setUserId(_ id: String?) {}
    func record(_ error: Error) {}
}

// MARK: - Firebase sketch (enable once the SDK + plist are added)
//
// import FirebaseAnalytics
// import FirebaseCrashlytics
//
// final class FirebaseAnalyticsService: AnalyticsService {
//     func log(_ event: AnalyticsEvent) { Analytics.logEvent(event.name, parameters: event.parameters) }
//     func setUserId(_ id: String?) { Analytics.setUserID(id); Crashlytics.crashlytics().setUserID(id ?? "") }
//     func record(_ error: Error) { Crashlytics.crashlytics().record(error: error) }
// }
//
// Then call `FirebaseApp.configure()` in AppDelegate.didFinishLaunching and switch
// AppEnvironment to FirebaseAnalyticsService in release builds.
