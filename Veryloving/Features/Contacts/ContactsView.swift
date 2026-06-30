//
//  ContactsView.swift
//  Veryloving
//
//  Emergency contacts: list with priority, drag-to-reorder, swipe-to-delete,
//  add/edit sheet, and a per-contact test alert.
//

import SwiftUI

struct ContactsView: View {
    @StateObject private var viewModel: ContactsViewModel
    @State private var editing: EditTarget?

    init(viewModel: @autoclosure @escaping () -> ContactsViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel())
    }

    private enum EditTarget: Identifiable {
        case new
        case existing(EmergencyContact)
        var id: String {
            switch self {
            case .new: return "new"
            case .existing(let c): return c.id.uuidString
            }
        }
    }

    var body: some View {
        Group {
            if viewModel.contacts.isEmpty {
                emptyState
            } else {
                list
            }
        }
        .navigationTitle("Contacts")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { editing = .new } label: { Image(systemName: "plus") }
            }
            ToolbarItem(placement: .navigationBarLeading) {
                if !viewModel.contacts.isEmpty { EditButton() }
            }
        }
        .sheet(item: $editing) { target in
            switch target {
            case .new:
                ContactEditView(contact: nil) { viewModel.save($0) }
            case .existing(let contact):
                ContactEditView(contact: contact) { viewModel.save($0) }
            }
        }
        .onAppear { viewModel.load() }
        .errorAlert($viewModel.error)
    }

    private var list: some View {
        List {
            Section {
                ForEach(viewModel.contacts) { contact in
                    ContactRow(contact: contact,
                               isTesting: viewModel.testingContactID == contact.id) {
                        Task { await viewModel.sendTestAlert(to: contact) }
                    }
                    .contentShape(Rectangle())
                    .onTapGesture { editing = .existing(contact) }
                }
                .onDelete { viewModel.delete(at: $0) }
                .onMove { viewModel.move(from: $0, to: $1) }
            } footer: {
                Text("We alert contacts in this order during an SOS. Drag to reorder.")
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: Theme.Spacing.md) {
            Image(systemName: "person.2.badge.gearshape")
                .font(.system(size: 52))
                .foregroundStyle(Theme.Colors.accent)
            Text("No emergency contacts yet").font(Theme.Typography.title)
            Text("Add the people we should alert — with your location — when you trigger an SOS.")
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.secondaryText)
                .multilineTextAlignment(.center)
            Button("Add contact") { editing = .new }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.top, Theme.Spacing.sm)
        }
        .screenPadding()
    }
}

private struct ContactRow: View {
    let contact: EmergencyContact
    let isTesting: Bool
    let onTest: () -> Void

    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            ZStack {
                Circle().fill(Theme.Colors.accent.opacity(0.15)).frame(width: 44, height: 44)
                Text(contact.initials).font(.caption).foregroundStyle(Theme.Colors.accent)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(contact.name).font(Theme.Typography.headline)
                Text(contact.phone).font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.secondaryText)
            }
            Spacer()
            Text(contact.priority.displayName)
                .font(.caption2)
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(Theme.Colors.secondaryBackground)
                .clipShape(Capsule())
            Button(action: onTest) {
                if isTesting { ProgressView() }
                else { Image(systemName: "bell.badge").foregroundStyle(Theme.Colors.accent) }
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Send test alert to \(contact.name)")
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    NavigationStack {
        ContactsView(viewModel: ContactsViewModel(
            repository: InMemoryContactsRepository(seed: [
                EmergencyContact(name: "Mom", phone: "+1 555 0100", priority: .primary, sortIndex: 0),
                EmergencyContact(name: "Alex Lee", phone: "+1 555 0142", priority: .secondary, sortIndex: 1)
            ]),
            alerting: MockContactAlerting()
        ))
    }
}
