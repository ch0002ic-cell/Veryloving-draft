//
//  AppDelegate.swift
//  Veryloving
//
//  App lifecycle + push-notification plumbing. SwiftUI owns the UI; the delegate
//  exists for APNs (UIApplication can only deliver the device token here) and as
//  the UNUserNotificationCenter delegate. It forwards work to the injected
//  NotificationManager + DeviceService (wired by VerylovingApp at launch).
//

import UIKit
import UserNotifications

final class AppDelegate: NSObject, UIApplicationDelegate {

    private weak var notifications: NotificationManager?
    private weak var devices: DeviceService?

    /// Wired from VerylovingApp once the AppEnvironment exists.
    func bind(notifications: NotificationManager, devices: DeviceService) {
        self.notifications = notifications
        self.devices = devices
    }

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        AppLogger.notifications.sensitive("APNs token: \(token)")
        Task { await devices?.uploadPushToken(token) }
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        AppLogger.notifications.error("APNs registration failed: \(error.localizedDescription)")
    }
}

extension AppDelegate: UNUserNotificationCenterDelegate {
    // Show alerts even when foregrounded — SOS alerts must never be missed.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification) async
    -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse) async {
        AppLogger.notifications.info("Notification action: \(response.actionIdentifier)")
        await MainActor.run { notifications?.handle(response) }
    }
}
