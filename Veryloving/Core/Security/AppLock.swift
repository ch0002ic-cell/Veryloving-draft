//
//  AppLock.swift
//  Veryloving
//
//  Biometric app lock. When enabled (Settings → Security), the authenticated app
//  is covered by a lock screen on launch and whenever it returns from the
//  background, requiring Face ID / Touch ID to reveal.
//

import SwiftUI

struct AppLockModifier: ViewModifier {
    let biometrics: BiometricAuthenticating

    @AppStorage("appLockEnabled") private var enabled = false
    @Environment(\.scenePhase) private var scenePhase
    @State private var isLocked = false
    @State private var authenticating = false

    func body(content: Content) -> some View {
        content
            .overlay {
                if enabled && isLocked { lockScreen }
            }
            .onAppear {
                if enabled { isLocked = true; Task { await unlock() } }
            }
            .onChange(of: scenePhase) { phase in
                guard enabled else { return }
                switch phase {
                case .background:
                    isLocked = true
                case .active:
                    if isLocked && !authenticating { Task { await unlock() } }
                default:
                    break
                }
            }
    }

    private var lockScreen: some View {
        ZStack {
            Theme.Colors.brand.ignoresSafeArea()
            VStack(spacing: Theme.Spacing.lg) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 52))
                    .foregroundStyle(Theme.Colors.accent)
                Text("Veryloving is locked")
                    .font(Theme.Typography.title)
                    .foregroundStyle(.white)
                Button("Unlock") { Task { await unlock() } }
                    .buttonStyle(SecondaryButtonStyle())
                    .tint(.white)
                    .frame(maxWidth: 200)
            }
        }
        .transition(.opacity)
    }

    private func unlock() async {
        guard !authenticating else { return }
        authenticating = true
        defer { authenticating = false }
        do {
            try await biometrics.authenticate(reason: "Unlock Veryloving")
            withAnimation { isLocked = false }
        } catch {
            // Stay locked; the user can retry with the Unlock button.
        }
    }
}

extension View {
    func appLock(biometrics: BiometricAuthenticating) -> some View {
        modifier(AppLockModifier(biometrics: biometrics))
    }
}
