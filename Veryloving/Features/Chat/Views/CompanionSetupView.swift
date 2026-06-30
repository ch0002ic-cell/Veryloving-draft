//
//  CompanionSetupView.swift
//  Veryloving
//
//  Collects the Hume EVI API key + optional config id and stores them in the
//  Keychain (never in code/UserDefaults). In production these would be provisioned
//  via the backend (proxied WebSocket) rather than entered by the user.
//

import SwiftUI

struct CompanionSetupView: View {
    @ObservedObject var viewModel: CompanionViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var apiKey = ""
    @State private var configId = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Hume API key", text: $apiKey)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Config ID (optional)", text: $configId)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } footer: {
                    Text("Stored securely in the Keychain on this device.")
                }
            }
            .navigationTitle("Companion setup")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        viewModel.saveCredentials(apiKey: apiKey.trimmingCharacters(in: .whitespaces),
                                                  configId: configId.trimmingCharacters(in: .whitespaces))
                        dismiss()
                    }
                    .disabled(apiKey.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}
