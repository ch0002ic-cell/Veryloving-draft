//
//  DeviceDetailView.swift
//  Veryloving
//
//  Connected-device management: status, battery, and actions (firmware update,
//  disconnect). Firmware update is stubbed pending the OTA protocol.
//

import SwiftUI

struct DeviceDetailView: View {
    @ObservedObject var viewModel: WearableViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Group {
            if let device = viewModel.connectedDevice {
                List {
                    Section {
                        HStack {
                            Label("Status", systemImage: "dot.radiowaves.left.and.right")
                            Spacer()
                            Text(device.connectionState.rawValue.capitalized)
                                .foregroundStyle(device.isConnected ? Theme.Colors.success : Theme.Colors.secondaryText)
                        }
                        HStack {
                            Label("Battery", systemImage: batterySymbol(for: device.batteryLevel))
                            Spacer()
                            Text(device.batteryDescription).foregroundStyle(Theme.Colors.secondaryText)
                        }
                    } header: {
                        Text(device.name)
                    }

                    Section {
                        Button {
                            // TODO: implement OTA firmware update via the firmware characteristic.
                        } label: {
                            Label("Check for firmware update", systemImage: "arrow.triangle.2.circlepath")
                        }
                        .disabled(true)
                    } footer: {
                        Text("Firmware updates will be available once your device reports its version.")
                    }

                    Section {
                        Button(role: .destructive) {
                            viewModel.disconnect()
                            dismiss()
                        } label: {
                            Label("Disconnect", systemImage: "xmark.circle")
                        }
                    }
                }
            } else {
                VStack(spacing: Theme.Spacing.md) {
                    Image(systemName: "circle.hexagongrid")
                        .font(.system(size: 44))
                        .foregroundStyle(Theme.Colors.secondaryText)
                    Text("No device connected").font(Theme.Typography.headline)
                    Text("Pair a Veryloving device to see its details here.")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.secondaryText)
                        .multilineTextAlignment(.center)
                }
                .screenPadding()
            }
        }
        .navigationTitle("Device")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func batterySymbol(for level: Int?) -> String {
        guard let level else { return "battery.0percent" }
        switch level {
        case ..<15: return "battery.25percent"
        case 15..<60: return "battery.50percent"
        case 60..<90: return "battery.75percent"
        default: return "battery.100percent"
        }
    }
}

#Preview {
    NavigationStack {
        DeviceDetailView(viewModel: {
            let vm = WearableViewModel(service: MockWearableService())
            return vm
        }())
    }
}
