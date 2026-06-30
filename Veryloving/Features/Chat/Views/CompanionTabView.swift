//
//  CompanionTabView.swift
//  Veryloving
//
//  Subscription gate for the AI companion: entitled users (Plus/Pro) get the live
//  chat; everyone else sees an upsell that opens the paywall.
//

import SwiftUI

struct CompanionTabView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @EnvironmentObject private var session: SessionStore
    @State private var showPaywall = false

    private var entitled: Bool {
        guard let tier = session.currentUser?.subscriptionTier else { return false }
        return Feature.aiCompanion.isAvailable(for: tier)
    }

    var body: some View {
        Group {
            if entitled {
                CompanionView(viewModel: environment.companionViewModel)
            } else {
                upsell
            }
        }
        .sheet(isPresented: $showPaywall) {
            PaywallView(viewModel: environment.makePaywallViewModel())
        }
    }

    private var upsell: some View {
        VStack(spacing: Theme.Spacing.md) {
            Image(systemName: "waveform.badge.mic")
                .font(.system(size: 52)).foregroundStyle(Theme.Colors.accent)
            Text("Meet your AI Companion").font(Theme.Typography.title)
            Text("Empathic voice conversations that remember you. Available on Plus and Pro.")
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.secondaryText)
                .multilineTextAlignment(.center)
            Button("Start free trial") { showPaywall = true }
                .buttonStyle(PrimaryButtonStyle())
                .frame(maxWidth: 260)
                .padding(.top, Theme.Spacing.sm)
        }
        .screenPadding()
        .navigationTitle("Companion")
    }
}
