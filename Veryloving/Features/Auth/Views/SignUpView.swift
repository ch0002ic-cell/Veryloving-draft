//
//  SignUpView.swift
//  Veryloving
//

import SwiftUI

struct SignUpView: View {
    @EnvironmentObject private var viewModel: AuthViewModel
    @FocusState private var focused: Field?

    private enum Field { case name, email, password }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                Text("Create your account")
                    .font(Theme.Typography.title)
                    .padding(.top, Theme.Spacing.md)

                VStack(spacing: Theme.Spacing.md) {
                    TextField("Full name", text: $viewModel.displayName)
                        .textContentType(.name)
                        .textInputAutocapitalization(.words)
                        .focused($focused, equals: .name)
                        .submitLabel(.next)
                        .onSubmit { focused = .email }
                        .brandTextField()

                    TextField("Email", text: $viewModel.email)
                        .keyboardType(.emailAddress)
                        .textContentType(.username)
                        .focused($focused, equals: .email)
                        .submitLabel(.next)
                        .onSubmit { focused = .password }
                        .brandTextField()

                    SecureField("Password (min 6 characters)", text: $viewModel.password)
                        .textContentType(.newPassword)
                        .focused($focused, equals: .password)
                        .submitLabel(.go)
                        .onSubmit { Task { await viewModel.register() } }
                        .brandTextField()
                }

                Button {
                    focused = nil
                    Task { await viewModel.register() }
                } label: {
                    if viewModel.isLoading {
                        ProgressView().tint(.white)
                    } else {
                        Text("Create account")
                    }
                }
                .buttonStyle(PrimaryButtonStyle(isLoading: viewModel.isLoading))
                .disabled(!viewModel.canSubmitSignUp)

                Text("Your 7-day free trial of Plus starts after you set up your first device.")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.secondaryText)

                Spacer(minLength: Theme.Spacing.xl)
            }
            .screenPadding()
        }
        .navigationTitle("Sign up")
        .navigationBarTitleDisplayMode(.inline)
        .scrollDismissesKeyboard(.interactively)
    }
}
