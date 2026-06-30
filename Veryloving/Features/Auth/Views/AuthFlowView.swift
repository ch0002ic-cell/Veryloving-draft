//
//  AuthFlowView.swift
//  Veryloving
//
//  Entry point for the unauthenticated experience. Owns the AuthViewModel and a
//  NavigationStack so Welcome → Sign In / Sign Up share one view model.
//

import SwiftUI

enum AuthRoute: Hashable {
    case signIn
    case signUp
}

struct AuthFlowView: View {
    @StateObject private var viewModel: AuthViewModel
    @State private var path: [AuthRoute] = []

    init(viewModel: @autoclosure @escaping () -> AuthViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel())
    }

    var body: some View {
        NavigationStack(path: $path) {
            WelcomeView(path: $path)
                .navigationDestination(for: AuthRoute.self) { route in
                    switch route {
                    case .signIn: SignInView()
                    case .signUp: SignUpView()
                    }
                }
        }
        .environmentObject(viewModel)
        .tint(Theme.Colors.accent)
        .errorAlert($viewModel.error)
    }
}

// MARK: - Shared field styling

struct BrandTextFieldStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(Theme.Spacing.md)
            .background(Theme.Colors.secondaryBackground)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous))
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
    }
}

extension View {
    func brandTextField() -> some View { modifier(BrandTextFieldStyle()) }
}

/// "Continue with Apple" styled button wired to the coordinator-based flow.
struct AppleSignInButton: View {
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: Theme.Spacing.sm) {
                Image(systemName: "apple.logo")
                Text("Continue with Apple").font(Theme.Typography.headline)
            }
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(Color.primary)
            .foregroundStyle(Color(.systemBackground))
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous))
        }
    }
}
