//
//  SignInView.swift
//  Veryloving
//

import SwiftUI

struct SignInView: View {
    @EnvironmentObject private var viewModel: AuthViewModel
    @FocusState private var focused: Field?

    private enum Field { case email, password }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                Text("Welcome back")
                    .font(Theme.Typography.title)
                    .padding(.top, Theme.Spacing.md)

                VStack(spacing: Theme.Spacing.md) {
                    TextField("Email", text: $viewModel.email)
                        .keyboardType(.emailAddress)
                        .textContentType(.username)
                        .focused($focused, equals: .email)
                        .submitLabel(.next)
                        .onSubmit { focused = .password }
                        .brandTextField()

                    SecureField("Password", text: $viewModel.password)
                        .textContentType(.password)
                        .focused($focused, equals: .password)
                        .submitLabel(.go)
                        .onSubmit { Task { await viewModel.signIn() } }
                        .brandTextField()
                }

                Button {
                    focused = nil
                    Task { await viewModel.signIn() }
                } label: {
                    if viewModel.isLoading {
                        ProgressView().tint(.white)
                    } else {
                        Text("Sign in")
                    }
                }
                .buttonStyle(PrimaryButtonStyle(isLoading: viewModel.isLoading))
                .disabled(!viewModel.canSubmitSignIn)

                Button("Continue with Google") { viewModel.signInWithGoogle() }
                    .buttonStyle(SecondaryButtonStyle())

                Spacer(minLength: Theme.Spacing.xl)
            }
            .screenPadding()
        }
        .navigationTitle("Sign in")
        .navigationBarTitleDisplayMode(.inline)
        .scrollDismissesKeyboard(.interactively)
    }
}
