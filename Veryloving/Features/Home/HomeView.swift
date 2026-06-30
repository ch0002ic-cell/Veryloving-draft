//
//  HomeView.swift
//  Veryloving
//
//  Main authenticated shell: a tab bar across the core surfaces. SOS lives on the
//  home tab as the primary action; the companion, devices, and settings get their
//  own tabs.
//

import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @EnvironmentObject private var notifications: NotificationManager
    @State private var selection: Tab = .guardian

    private enum Tab { case guardian, companion, devices, settings }

    var body: some View {
        TabView(selection: $selection) {
            NavigationStack {
                GuardianHomeView(wearable: environment.wearableViewModel)
            }
            .tabItem { Label("Guardian", systemImage: "shield.lefthalf.filled") }
            .tag(Tab.guardian)

            NavigationStack {
                CompanionTabView()
            }
            .tabItem { Label("Companion", systemImage: "waveform") }
            .tag(Tab.companion)

            NavigationStack {
                DevicePairingView(viewModel: environment.wearableViewModel)
            }
            .tabItem { Label("Devices", systemImage: "circle.hexagongrid") }
            .tag(Tab.devices)

            NavigationStack {
                SettingsView()
            }
            .tabItem { Label("Settings", systemImage: "gearshape") }
            .tag(Tab.settings)
        }
        .onChange(of: notifications.pendingRoute) { route in
            guard let route else { return }
            switch route {
            case .sos, .contacts: selection = .guardian
            case .companion: selection = .companion
            }
            notifications.pendingRoute = nil
        }
    }
}

#Preview {
    HomeView()
        .environmentObject(AppEnvironment())
        .environmentObject(NotificationManager())
        .environmentObject(SessionStore(secureStore: KeychainStore(),
                                        authService: MockAuthService(),
                                        tokenProvider: TokenProvider()))
}
