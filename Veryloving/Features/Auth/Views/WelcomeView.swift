//
//  WelcomeView.swift
//  Veryloving
//
//  Brand-forward first screen: the hero, the value proposition, and the two
//  primary paths (create account / sign in) plus social sign-in.
//

import SwiftUI

struct WelcomeView: View {
    @Binding var path: [AuthRoute]
    @EnvironmentObject private var viewModel: AuthViewModel

    var body: some View {
        VStack(spacing: Theme.Spacing.xl) {
            Spacer()

            VStack(spacing: Theme.Spacing.md) {
                Image(systemName: "sparkles")
                    .font(.system(size: 56))
                    .foregroundStyle(Theme.Colors.accent)
                    .accessibilityHidden(true)

                Text("Veryloving")
                    .font(Theme.Typography.largeTitle)

                Text("Your guardian, beautifully worn.\nProtection and presence, always with you.")
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.secondaryText)
                    .multilineTextAlignment(.center)
            }

            Spacer()

            VStack(spacing: Theme.Spacing.md) {
                Button("Create account") { path.append(.signUp) }
                    .buttonStyle(PrimaryButtonStyle())

                AppleSignInButton {
                    Task { await viewModel.signInWithApple() }
                }

                Button("I already have an account") { path.append(.signIn) }
                    .buttonStyle(SecondaryButtonStyle())
            }

            Text("By continuing you agree to our Terms and Privacy Policy.")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.secondaryText)
                .multilineTextAlignment(.center)
        }
        .screenPadding()
        .padding(.bottom, Theme.Spacing.lg)
        .navigationBarTitleDisplayMode(.inline)
    }
}

#Preview {
    let session = SessionStore(secureStore: KeychainStore(), authService: MockAuthService(), tokenProvider: TokenProvider())
    return AuthFlowView(viewModel: AuthViewModel(authService: MockAuthService(), session: session))
}
