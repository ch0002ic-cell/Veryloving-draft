//
//  RootView.swift
//  Veryloving
//
//  Top-level router. Switches between launch / auth / onboarding / home based on
//  the SessionStore phase and whether onboarding has been completed.
//

import SwiftUI

struct RootView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @EnvironmentObject private var session: SessionStore
    @AppStorage("didCompleteOnboarding") private var didOnboard = false

    var body: some View {
        ZStack {
            switch session.phase {
            case .initializing:
                LaunchView()
            case .unauthenticated:
                AuthFlowView(viewModel: environment.makeAuthViewModel())
                    .transition(.opacity)
            case .authenticated(let user):
                if didOnboard {
                    HomeView()
                        .appLock(biometrics: environment.biometrics)
                        .transition(.opacity)
                } else {
                    OnboardingView(userName: user.firstName) { didOnboard = true }
                        .transition(.move(edge: .trailing))
                }
            }
        }
        .animation(.easeInOut, value: session.phase)
    }
}

/// Brand splash shown while the session is being restored.
struct LaunchView: View {
    var body: some View {
        ZStack {
            Theme.Colors.brand.ignoresSafeArea()
            VStack(spacing: Theme.Spacing.md) {
                Image(systemName: "sparkles")
                    .font(.system(size: 56))
                    .foregroundStyle(Theme.Colors.accent)
                Text("Veryloving")
                    .font(Theme.Typography.largeTitle)
                    .foregroundStyle(.white)
            }
        }
    }
}
