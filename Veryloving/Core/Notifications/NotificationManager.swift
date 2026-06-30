//
//  NotificationManager.swift
//  Veryloving
//
//  Owns notification authorization, category/action registration, and routing of
//  taps into the app. APNs token delivery lives in AppDelegate (which forwards the
//  token to DeviceService); this type owns everything else.
//

import Foundation
import UserNotifications
import UIKit

/// Where a tapped notification should take the user.
enum NotificationRoute: Equatable {
    case sos
    case contacts
    case companion
}

@MainActor
final class NotificationManager: ObservableObject {

    @Published private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
    /// Set when a notification is tapped; the UI observes and navigates, then clears it.
    @Published var pendingRoute: NotificationRoute?

    private let center = UNUserNotificationCenter.current()

    // Category / action identifiers.
    enum Category {
        static let sos = "SOS_ALERT"
        static let batteryLow = "BATTERY_LOW"
        static let checkIn = "SAFETY_CHECKIN"
        static let companion = "COMPANION_PROMPT"
    }
    enum Action {
        static let markSafe = "MARK_SAFE"
        static let callEmergency = "CALL_EMERGENCY"
        static let imSafe = "IM_SAFE"
    }

    /// Register the actionable categories. Call once at launch.
    func registerCategories() {
        let markSafe = UNNotificationAction(identifier: Action.markSafe, title: "I'm safe",
                                            options: [.foreground])
        let callEmergency = UNNotificationAction(identifier: Action.callEmergency, title: "Open SOS",
                                                 options: [.foreground, .destructive])
        let imSafe = UNNotificationAction(identifier: Action.imSafe, title: "I'm safe", options: [])

        let sos = UNNotificationCategory(identifier: Category.sos,
                                         actions: [callEmergency, markSafe],
                                         intentIdentifiers: [], options: [.customDismissAction])
        let checkIn = UNNotificationCategory(identifier: Category.checkIn,
                                             actions: [imSafe], intentIdentifiers: [], options: [])
        let battery = UNNotificationCategory(identifier: Category.batteryLow,
                                             actions: [], intentIdentifiers: [], options: [])
        let companion = UNNotificationCategory(identifier: Category.companion,
                                               actions: [], intentIdentifiers: [], options: [])

        center.setNotificationCategories([sos, checkIn, battery, companion])
    }

    func refreshStatus() async {
        authorizationStatus = await center.notificationSettings().authorizationStatus
    }

    /// Request permission; on grant, register for remote (APNs) notifications.
    @discardableResult
    func requestAuthorization() async -> Bool {
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
            await refreshStatus()
            if granted {
                UIApplication.shared.registerForRemoteNotifications()
            }
            AppLogger.notifications.info("Notification permission granted: \(granted)")
            return granted
        } catch {
            AppLogger.notifications.error("Authorization failed: \(error.localizedDescription)")
            return false
        }
    }

    /// Map a tapped notification (or its action) to a route.
    func handle(_ response: UNNotificationResponse) {
        let category = response.notification.request.content.categoryIdentifier
        switch (category, response.actionIdentifier) {
        case (Category.sos, _):
            pendingRoute = .sos
        case (Category.checkIn, _):
            pendingRoute = .sos
        case (Category.companion, _):
            pendingRoute = .companion
        case (Category.batteryLow, _):
            pendingRoute = .contacts
        default:
            break
        }
    }
}

import UIKit
