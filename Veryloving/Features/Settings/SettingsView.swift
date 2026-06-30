//
//  SettingsView.swift
//  Veryloving
//
//  Account, subscription, security, and emergency-contact entry points. Real
//  account/sign-out wiring; subscription management UI is a Phase-4 placeholder.
//

import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @EnvironmentObject private var session: SessionStore
    @AppStorage("appLockEnabled") private var appLockEnabled = false
    @State private var showSignOutConfirm = false
    @State private var showPaywall = false

    private var user: User? { session.currentUser }

    var body: some View {
        List {
            Section("Account") {
                LabeledContent("Name", value: user?.displayName ?? "—")
                LabeledContent("Email", value: user?.email ?? "—")
            }

            Section("Subscription") {
                LabeledContent("Plan", value: user?.subscriptionTier.displayName ?? "Free")
                Button {
                    showPaywall = true
                } label: {
                    Label("Manage plan", systemImage: "creditcard")
                }
            }

            Section("Safety") {
                NavigationLink {
                    ContactsView(viewModel: environment.makeContactsViewModel())
                } label: {
                    Label("Emergency contacts", systemImage: "person.2")
                }
            }

            Section {
                Toggle(isOn: $appLockEnabled) {
                    Label("App Lock (\(environment.biometrics.availableBiometry.displayName))",
                          systemImage: "faceid")
                }
                .disabled(environment.biometrics.availableBiometry == .none)
            } header: {
                Text("Security")
            } footer: {
                Text("Require \(environment.biometrics.availableBiometry.displayName) each time you open Veryloving.")
            }

            Section {
                Button(role: .destructive) {
                    showSignOutConfirm = true
                } label: {
                    Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                }
            }
        }
        .navigationTitle("Settings")
        .sheet(isPresented: $showPaywall) {
            PaywallView(viewModel: environment.makePaywallViewModel())
        }
        .confirmationDialog("Sign out of Veryloving?",
                            isPresented: $showSignOutConfirm, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { session.signOut() }
            Button("Cancel", role: .cancel) {}
        }
    }
}
