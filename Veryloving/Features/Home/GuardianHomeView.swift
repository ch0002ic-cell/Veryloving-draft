//
//  GuardianHomeView.swift
//  Veryloving
//
//  The home tab: a greeting, the device-status card, and the primary SOS action.
//  Also listens for a hardware SOS event from the jewelry and escalates to the
//  SOS flow automatically.
//

import SwiftUI

struct GuardianHomeView: View {
    @ObservedObject var wearable: WearableViewModel
    @EnvironmentObject private var environment: AppEnvironment
    @EnvironmentObject private var session: SessionStore
    @State private var showSOS = false
    @State private var sosTrigger: SOSAlert.Trigger = .app

    var body: some View {
        ScrollView {
            VStack(spacing: Theme.Spacing.xl) {
                deviceStatusCard
                sosButton
                Text("Hold the button, or press your jewelry for 5 seconds, to alert your emergency contacts.")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.secondaryText)
                    .multilineTextAlignment(.center)
            }
            .screenPadding()
            .padding(.vertical, Theme.Spacing.lg)
        }
        .navigationTitle(greeting)
        .fullScreenCover(isPresented: $showSOS) {
            SOSView(viewModel: environment.makeSOSViewModel(
                trigger: sosTrigger,
                batteryLevel: wearable.connectedDevice?.batteryLevel
            ))
        }
        .onChange(of: wearable.lastEvent) { event in
            // Hardware 5-second tap → escalate immediately (skips the countdown).
            if event == .sosTriggered {
                sosTrigger = .wearable
                showSOS = true
            }
        }
    }

    private var greeting: String {
        "Hi, \(session.currentUser?.firstName ?? "there")"
    }

    private var deviceStatusCard: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Label("Your jewelry", systemImage: "circle.hexagongrid.fill")
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.Colors.accent)

            if let device = wearable.connectedDevice, device.isConnected {
                Text("\(device.name) · Connected")
                Text("Battery \(device.batteryDescription)")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.secondaryText)
            } else {
                Text("Not connected")
                    .foregroundStyle(Theme.Colors.secondaryText)
                NavigationLink("Pair a device") {
                    DevicePairingView(viewModel: wearable)
                }
                .font(Theme.Typography.caption)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Theme.Spacing.lg)
        .background(Theme.Colors.secondaryBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.large, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(deviceStatusAccessibilityLabel)
    }

    private var deviceStatusAccessibilityLabel: String {
        if let device = wearable.connectedDevice, device.isConnected {
            return "Your jewelry \(device.name) is connected. Battery \(device.batteryDescription)."
        }
        return "Your jewelry is not connected. Double tap to pair a device."
    }

    private var sosButton: some View {
        Button {
            Haptics.notify(.warning)
            sosTrigger = .app
            showSOS = true
        } label: {
            VStack(spacing: Theme.Spacing.sm) {
                Image(systemName: "exclamationmark.shield.fill").font(.system(size: 44))
                Text("SOS").font(.system(size: 28, weight: .bold))
            }
            .foregroundStyle(.white)
            .frame(width: 200, height: 200)
            .background(Theme.Colors.danger)
            .clipShape(Circle())
            .shadow(color: Theme.Colors.danger.opacity(0.4), radius: 20, y: 8)
        }
        .accessibilityLabel("Trigger SOS alert")
        .accessibilityHint("Sends an emergency alert with your location to your contacts")
        .accessibilityAddTraits(.isButton)
    }
}

#Preview {
    NavigationStack {
        GuardianHomeView(wearable: WearableViewModel(service: MockWearableService()))
            .environmentObject(AppEnvironment())
            .environmentObject(SessionStore(secureStore: KeychainStore(),
                                            authService: MockAuthService(),
                                            tokenProvider: TokenProvider()))
    }
}
