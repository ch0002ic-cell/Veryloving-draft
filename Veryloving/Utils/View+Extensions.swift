//
//  View+Extensions.swift
//  Veryloving
//

import SwiftUI

extension View {
    /// Standard screen padding used by feature views.
    func screenPadding() -> some View {
        padding(.horizontal, Theme.Spacing.lg)
    }

    /// Bind an optional error to an alert. Pass any LocalizedError.
    func errorAlert(_ error: Binding<AppError?>) -> some View {
        let isPresented = Binding<Bool>(
            get: { error.wrappedValue != nil },
            set: { if !$0 { error.wrappedValue = nil } }
        )
        return alert(
            error.wrappedValue?.title ?? "Something went wrong",
            isPresented: isPresented,
            presenting: error.wrappedValue
        ) { _ in
            Button("OK", role: .cancel) { error.wrappedValue = nil }
        } message: { value in
            Text(value.message)
        }
    }
}

/// Lightweight, presentable error wrapper for view models.
struct AppError: Identifiable, Equatable {
    let id = UUID()
    let title: String
    let message: String

    init(title: String = "Something went wrong", message: String) {
        self.title = title
        self.message = message
    }

    init(_ error: Error) {
        self.title = "Something went wrong"
        self.message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}
