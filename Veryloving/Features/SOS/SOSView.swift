//
//  SOSView.swift
//  Veryloving
//
//  SOS flow UI driven by SOSViewModel: cancelable countdown → dispatch →
//  confirmation with a live map preview of the shared location. A wearable-
//  triggered SOS skips the countdown.
//

import SwiftUI

struct SOSView: View {
    @StateObject private var viewModel: SOSViewModel
    @Environment(\.dismiss) private var dismiss

    init(viewModel: @autoclosure @escaping () -> SOSViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel())
    }

    var body: some View {
        ZStack {
            Theme.Colors.danger.opacity(0.96).ignoresSafeArea()
            VStack(spacing: Theme.Spacing.lg) {
                Spacer(minLength: Theme.Spacing.lg)
                content
                Spacer(minLength: Theme.Spacing.lg)
                actionButtons
            }
            .padding(Theme.Spacing.xl)
            .foregroundStyle(.white)
        }
        .onAppear { viewModel.begin() }
        .interactiveDismissDisabled()
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.stage {
        case .arming(let seconds):
            VStack(spacing: Theme.Spacing.md) {
                Text("\(seconds)").font(.system(size: 96, weight: .bold, design: .rounded))
                    .accessibilityLabel("Sending SOS in \(seconds) seconds. Cancel below if this is a false alarm.")
                Text("Sending an SOS to your emergency contacts")
                    .font(Theme.Typography.title).multilineTextAlignment(.center)
                Text("Your location will be shared. Cancel now if this is a false alarm.")
                    .font(Theme.Typography.body).multilineTextAlignment(.center).opacity(0.9)
                mapPreview
            }
        case .sending:
            VStack(spacing: Theme.Spacing.md) {
                ProgressView().tint(.white).scaleEffect(1.6)
                Text("Sending alert…").font(Theme.Typography.title)
            }
        case .sent:
            VStack(spacing: Theme.Spacing.md) {
                Image(systemName: "checkmark.circle.fill").font(.system(size: 64))
                Text("Alert sent").font(Theme.Typography.largeTitle)
                Text("\(viewModel.notifiedContacts) contact\(viewModel.notifiedContacts == 1 ? "" : "s") notified with your location. We'll keep sharing it for 30 minutes.")
                    .font(Theme.Typography.body).multilineTextAlignment(.center).opacity(0.9)
                mapPreview
            }
        case .failed(let message):
            VStack(spacing: Theme.Spacing.md) {
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 56))
                Text("Couldn't send alert").font(Theme.Typography.title)
                Text(message).font(Theme.Typography.body).multilineTextAlignment(.center).opacity(0.9)
            }
        }
    }

    @ViewBuilder
    private var mapPreview: some View {
        if let fix = viewModel.fix {
            SOSMapView(coordinate: fix.coordinate)
                .frame(height: 160)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous)
                        .stroke(.white.opacity(0.5), lineWidth: 1)
                )
                .accessibilityLabel("Map showing your current location that will be shared")
        }
    }

    @ViewBuilder
    private var actionButtons: some View {
        switch viewModel.stage {
        case .arming:
            Button("Cancel — I'm safe") {
                viewModel.cancelFalseAlarm()
                Haptics.impact(.rigid)
                dismiss()
            }
            .buttonStyle(SecondaryButtonStyle()).tint(.white)
        case .sending:
            EmptyView()
        case .sent:
            Button("Done") { viewModel.finish(); dismiss() }
                .buttonStyle(SecondaryButtonStyle()).tint(.white)
        case .failed:
            VStack(spacing: Theme.Spacing.sm) {
                Button("Try again") { viewModel.retry() }
                    .buttonStyle(PrimaryButtonStyle())
                Button("Close") { viewModel.finish(); dismiss() }
                    .buttonStyle(SecondaryButtonStyle()).tint(.white)
            }
        }
    }
}

#Preview {
    SOSView(viewModel: SOSViewModel(sosService: MockSOSService(), location: MockLocationService()))
}
