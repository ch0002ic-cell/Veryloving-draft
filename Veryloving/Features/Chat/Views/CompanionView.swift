//
//  CompanionView.swift
//  Veryloving
//
//  AI companion chat: transcript + text input, with voice (connect/mute) when a
//  Hume key is configured. Ported UX from the emo_ios prototype, restyled.
//

import SwiftUI

struct CompanionView: View {
    @ObservedObject var viewModel: CompanionViewModel
    @State private var showSetup = false

    var body: some View {
        VStack(spacing: 0) {
            transcript
            inputBar
        }
        .navigationTitle("Companion")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button(viewModel.isConnected ? "Disconnect" : "Connect voice",
                           systemImage: viewModel.isConnected ? "stop.circle" : "waveform") {
                        viewModel.toggleConnection()
                    }
                    Button("Clear conversation", systemImage: "trash", role: .destructive) {
                        viewModel.clearTranscript()
                    }
                    Button("Companion setup", systemImage: "key") { showSetup = true }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $showSetup) { CompanionSetupView(viewModel: viewModel) }
        .errorAlert($viewModel.error)
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: Theme.Spacing.sm) {
                    if viewModel.messages.isEmpty {
                        emptyState.padding(.top, Theme.Spacing.xxl)
                    }
                    ForEach(viewModel.messages) { entry in
                        ChatBubble(entry: entry).id(entry.id)
                    }
                }
                .padding(Theme.Spacing.md)
            }
            .onChange(of: viewModel.messages.count) { _ in
                if let last = viewModel.messages.last {
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: Theme.Spacing.sm) {
            Image(systemName: "waveform.circle")
                .font(.system(size: 48)).foregroundStyle(Theme.Colors.accent)
            Text(viewModel.hasAPIKey ? "Say hello to your companion" : "Add your Hume key to begin")
                .font(Theme.Typography.headline)
            Text(viewModel.isConnected
                 ? "Voice is on — just start talking, or type below."
                 : "Type a message, or connect voice from the menu.")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.secondaryText)
                .multilineTextAlignment(.center)
            if !viewModel.hasAPIKey {
                Button("Add Hume key") { showSetup = true }
                    .buttonStyle(SecondaryButtonStyle())
                    .padding(.top, Theme.Spacing.sm)
                    .frame(maxWidth: 220)
            }
        }
        .screenPadding()
    }

    private var inputBar: some View {
        HStack(spacing: Theme.Spacing.sm) {
            if viewModel.isConnected {
                Button { viewModel.toggleMute() } label: {
                    Image(systemName: viewModel.isMuted ? "mic.slash.fill" : "mic.fill")
                        .foregroundStyle(viewModel.isMuted ? Theme.Colors.danger : Theme.Colors.accent)
                        .frame(width: 36, height: 36)
                }
                .accessibilityLabel(viewModel.isMuted ? "Unmute microphone" : "Mute microphone")
            }
            TextField("Message", text: $viewModel.draft, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...4)
                .onSubmit { viewModel.sendText() }
            Button { viewModel.sendText() } label: {
                Image(systemName: "arrow.up.circle.fill").font(.title2)
            }
            .disabled(viewModel.draft.trimmingCharacters(in: .whitespaces).isEmpty)
            .accessibilityLabel("Send message")
        }
        .padding(Theme.Spacing.sm)
        .background(.bar)
    }
}
