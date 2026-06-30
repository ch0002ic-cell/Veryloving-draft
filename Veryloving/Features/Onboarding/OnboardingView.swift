//
//  OnboardingView.swift
//  Veryloving
//
//  First-run flow shown right after sign-up. Mirrors the onboarding spec
//  (brand story → pairing → contacts → SOS demo → permissions → trial). The
//  permission/biometric/paywall steps are interactive and wired to the real
//  subsystems; the informational steps set context. Calls `onComplete` to enter.
//

import SwiftUI

struct OnboardingView: View {
    let userName: String
    let onComplete: () -> Void

    @EnvironmentObject private var environment: AppEnvironment
    @EnvironmentObject private var notifications: NotificationManager
    @AppStorage("appLockEnabled") private var appLockEnabled = false

    @State private var page = 0
    @State private var showPaywall = false
    @State private var busy = false

    private var steps: [Step] {
        [
            Step(icon: "sparkles", title: "Welcome, \(userName)",
                 body: "Veryloving pairs luxury jewelry with an always-on guardian and an empathic AI companion."),
            Step(icon: "circle.hexagongrid.fill", title: "Pair your jewelry",
                 body: "Connect over Bluetooth to receive SOS triggers, battery status, and companion activation."),
            Step(icon: "person.2.fill", title: "Add your circle",
                 body: "Choose the people we alert — with your location — the moment you need help."),
            Step(icon: "bell.badge.fill", title: "Stay alerted",
                 body: "Allow notifications so we can reach you and your contacts during an emergency.",
                 actionTitle: "Enable notifications",
                 action: { await requestPush() }),
            Step(icon: "faceid", title: "Lock it down",
                 body: "Protect your account and contacts with \(environment.biometrics.availableBiometry.displayName).",
                 actionTitle: environment.biometrics.availableBiometry == .none ? nil : "Enable App Lock",
                 action: { await enableAppLock() }),
            Step(icon: "gift.fill", title: "Your 7-day trial",
                 body: "Plus unlocks the AI Companion alongside SOS. Cancel anytime before it ends.",
                 actionTitle: "See plans",
                 action: { showPaywall = true })
        ]
    }

    var body: some View {
        VStack {
            TabView(selection: $page) {
                ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                    stepView(step).tag(index)
                }
            }
            .tabViewStyle(.page)
            .indexViewStyle(.page(backgroundDisplayMode: .always))

            Button(page == steps.count - 1 ? "Start using Veryloving" : "Continue") {
                if page == steps.count - 1 {
                    Haptics.notify(.success)
                    onComplete()
                } else {
                    withAnimation { page += 1 }
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .screenPadding()
            .padding(.bottom, Theme.Spacing.lg)
        }
        .sheet(isPresented: $showPaywall) {
            PaywallView(viewModel: environment.makePaywallViewModel())
        }
    }

    // MARK: Actions

    private func requestPush() async {
        busy = true; defer { busy = false }
        await notifications.requestAuthorization()
        withAnimation { advance() }
    }

    private func enableAppLock() async {
        busy = true; defer { busy = false }
        do {
            try await environment.biometrics.authenticate(reason: "Enable App Lock for Veryloving")
            appLockEnabled = true
            withAnimation { advance() }
        } catch {
            // User declined biometrics — leave App Lock off, just continue.
            withAnimation { advance() }
        }
    }

    private func advance() {
        if page < steps.count - 1 { page += 1 }
    }

    // MARK: Step

    private struct Step: Identifiable {
        let id = UUID()
        let icon: String
        let title: String
        let body: String
        var actionTitle: String? = nil
        var action: (() async -> Void)? = nil
    }

    private func stepView(_ step: Step) -> some View {
        VStack(spacing: Theme.Spacing.lg) {
            Spacer()
            Image(systemName: step.icon)
                .font(.system(size: 72))
                .foregroundStyle(Theme.Colors.accent)
                .accessibilityHidden(true)
            Text(step.title)
                .font(Theme.Typography.largeTitle)
                .multilineTextAlignment(.center)
            Text(step.body)
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.secondaryText)
                .multilineTextAlignment(.center)
            if let actionTitle = step.actionTitle, let action = step.action {
                Button(actionTitle) { Task { await action() } }
                    .buttonStyle(SecondaryButtonStyle())
                    .frame(maxWidth: 260)
                    .disabled(busy)
                    .padding(.top, Theme.Spacing.sm)
            }
            Spacer()
        }
        .screenPadding()
    }
}
