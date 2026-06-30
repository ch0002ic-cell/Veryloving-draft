//
//  ContactEditView.swift
//  Veryloving
//
//  Add/edit form for an emergency contact.
//

import SwiftUI

struct ContactEditView: View {
    @Environment(\.dismiss) private var dismiss

    private let original: EmergencyContact?
    private let onSave: (EmergencyContact) -> Void

    @State private var name: String
    @State private var phone: String
    @State private var email: String
    @State private var priority: ContactPriority

    init(contact: EmergencyContact?, onSave: @escaping (EmergencyContact) -> Void) {
        self.original = contact
        self.onSave = onSave
        _name = State(initialValue: contact?.name ?? "")
        _phone = State(initialValue: contact?.phone ?? "")
        _email = State(initialValue: contact?.email ?? "")
        _priority = State(initialValue: contact?.priority ?? .primary)
    }

    private var isValid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty &&
        phone.trimmingCharacters(in: .whitespaces).count >= 5
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                        .textContentType(.name)
                    TextField("Phone number", text: $phone)
                        .textContentType(.telephoneNumber)
                        .keyboardType(.phonePad)
                    TextField("Email (optional)", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                }
                Section {
                    Picker("Priority", selection: $priority) {
                        ForEach(ContactPriority.allCases) { Text($0.displayName).tag($0) }
                    }
                } footer: {
                    Text("Primary contacts are alerted first during an SOS.")
                }
            }
            .navigationTitle(original == nil ? "New contact" : "Edit contact")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }.disabled(!isValid)
                }
            }
        }
    }

    private func save() {
        let trimmedEmail = email.trimmingCharacters(in: .whitespaces)
        let contact = EmergencyContact(
            id: original?.id ?? UUID(),
            name: name.trimmingCharacters(in: .whitespaces),
            phone: phone.trimmingCharacters(in: .whitespaces),
            email: trimmedEmail.isEmpty ? nil : trimmedEmail,
            priority: priority,
            sortIndex: original?.sortIndex ?? 0
        )
        onSave(contact)
        dismiss()
    }
}

#Preview {
    ContactEditView(contact: nil) { _ in }
}
