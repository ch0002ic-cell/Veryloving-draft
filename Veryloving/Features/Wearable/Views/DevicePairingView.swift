//
//  DevicePairingView.swift
//  Veryloving
//
//  Scan-and-pair flow. Shows radio state, a live list of discovered jewelry, and
//  routes to the device detail once connected.
//

import SwiftUI

struct DevicePairingView: View {
    @ObservedObject var viewModel: WearableViewModel

    var body: some View {
        List {
            if let message = viewModel.bluetoothState.userMessage {
                Section {
                    Label(message, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(Theme.Colors.danger)
                }
            }

            if let connected = viewModel.connectedDevice {
                Section("Connected") {
                    NavigationLink {
                        DeviceDetailView(viewModel: viewModel)
                    } label: {
                        DeviceRow(device: connected)
                    }
                }
            }

            Section {
                if viewModel.devices.isEmpty {
                    HStack(spacing: Theme.Spacing.md) {
                        if viewModel.isScanning { ProgressView() }
                        Text(viewModel.isScanning ? "Searching for your jewelry…" : "No devices found yet.")
                            .foregroundStyle(Theme.Colors.secondaryText)
                    }
                } else {
                    ForEach(viewModel.devices) { device in
                        Button { viewModel.connect(device) } label: {
                            DeviceRow(device: device)
                        }
                        .disabled(viewModel.connectedDevice?.id == device.id)
                    }
                }
            } header: {
                Text("Available devices")
            } footer: {
                Text("Hold your Veryloving jewelry close and make sure it's powered on.")
            }
        }
        .navigationTitle("Pair device")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                if viewModel.isScanning {
                    Button("Stop") { viewModel.stopScanning() }
                } else {
                    Button("Scan") { viewModel.startPairing() }
                        .disabled(!viewModel.bluetoothState.isReady && viewModel.bluetoothState != .unknown)
                }
            }
        }
        .onAppear { viewModel.startPairing() }
        .onDisappear { viewModel.stopScanning() }
    }
}

private struct DeviceRow: View {
    let device: WearableDevice

    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            Image(systemName: "circle.hexagongrid.fill")
                .font(.title2)
                .foregroundStyle(Theme.Colors.accent)

            VStack(alignment: .leading, spacing: 2) {
                Text(device.name).font(Theme.Typography.headline)
                Text(statusText)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.secondaryText)
            }

            Spacer()

            switch device.connectionState {
            case .connecting, .reconnecting:
                ProgressView()
            case .connected:
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.Colors.success)
            case .disconnected:
                signalIcon
            }
        }
        .contentShape(Rectangle())
    }

    private var statusText: String {
        switch device.connectionState {
        case .connected: return "Connected · \(device.batteryDescription)"
        case .connecting: return "Connecting…"
        case .reconnecting: return "Reconnecting…"
        case .disconnected: return "Tap to connect"
        }
    }

    private var signalIcon: some View {
        let symbol: String
        switch device.signalStrength {
        case .strong: symbol = "wifi"
        case .fair: symbol = "wifi.exclamationmark"
        case .weak, .unknown: symbol = "wifi.slash"
        }
        return Image(systemName: symbol).foregroundStyle(Theme.Colors.secondaryText)
    }
}

#Preview {
    NavigationStack {
        DevicePairingView(viewModel: WearableViewModel(service: MockWearableService()))
    }
}
