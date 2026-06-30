//
//  VerylovingApp.swift
//  Veryloving
//
//  App entry point. Builds the AppEnvironment (composition root), restores any
//  persisted session, and hands off to RootView for routing.
//

import SwiftUI

@main
struct VerylovingApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var environment = AppEnvironment()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(environment)
                .environmentObject(environment.session)
                .environmentObject(environment.notifications)
                .tint(Theme.Colors.accent)
                .task {
                    appDelegate.bind(notifications: environment.notifications,
                                     devices: environment.deviceService)
                    environment.session.bootstrap()
                    await environment.notifications.refreshStatus()
                }
        }
    }
}
