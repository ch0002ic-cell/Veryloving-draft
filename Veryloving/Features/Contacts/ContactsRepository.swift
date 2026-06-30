//
//  ContactsRepository.swift
//  Veryloving
//
//  Persistence boundary for emergency contacts. `CoreDataContactsRepository` is
//  the live store; `InMemoryContactsRepository` backs previews. Both are covered
//  by tests (the CoreData one via an in-memory store).
//

import Foundation
import CoreData

protocol ContactsRepository: AnyObject {
    func fetchAll() throws -> [EmergencyContact]
    func save(_ contact: EmergencyContact) throws       // insert or update by id
    func delete(id: UUID) throws
    func persistOrder(_ contacts: [EmergencyContact]) throws
}

/// Sends a non-emergency test alert to a single contact (so users can confirm
/// their setup works). Implemented by the SOS layer; mocked elsewhere.
protocol ContactAlerting: AnyObject {
    func sendTestAlert(to contact: EmergencyContact) async throws
}

final class CoreDataContactsRepository: ContactsRepository {

    private let context: NSManagedObjectContext

    init(context: NSManagedObjectContext) {
        self.context = context
    }

    func fetchAll() throws -> [EmergencyContact] {
        let request = CDContact.fetchRequest()
        request.sortDescriptors = [
            NSSortDescriptor(key: "sortIndex", ascending: true),
            NSSortDescriptor(key: "priorityRaw", ascending: true)
        ]
        return try context.fetch(request).compactMap(\.asValue)
    }

    func save(_ contact: EmergencyContact) throws {
        let managed = try existing(id: contact.id) ?? CDContact(context: context)
        managed.apply(contact)
        try saveIfNeeded()
    }

    func delete(id: UUID) throws {
        if let managed = try existing(id: id) {
            context.delete(managed)
            try saveIfNeeded()
        }
    }

    func persistOrder(_ contacts: [EmergencyContact]) throws {
        for (index, contact) in contacts.enumerated() {
            if let managed = try existing(id: contact.id) {
                managed.sortIndex = Int16(index)
            }
        }
        try saveIfNeeded()
    }

    private func existing(id: UUID) throws -> CDContact? {
        let request = CDContact.fetchRequest()
        request.predicate = NSPredicate(format: "id == %@", id as CVarArg)
        request.fetchLimit = 1
        return try context.fetch(request).first
    }

    private func saveIfNeeded() throws {
        guard context.hasChanges else { return }
        try context.save()
    }
}

/// Simple array-backed repository for previews.
final class InMemoryContactsRepository: ContactsRepository {
    private var storage: [EmergencyContact]

    init(seed: [EmergencyContact] = []) { storage = seed }

    func fetchAll() throws -> [EmergencyContact] {
        storage.sorted { ($0.sortIndex, $0.priority) < ($1.sortIndex, $1.priority) }
    }
    func save(_ contact: EmergencyContact) throws {
        if let index = storage.firstIndex(where: { $0.id == contact.id }) {
            storage[index] = contact
        } else {
            storage.append(contact)
        }
    }
    func delete(id: UUID) throws { storage.removeAll { $0.id == id } }
    func persistOrder(_ contacts: [EmergencyContact]) throws {
        for (index, contact) in contacts.enumerated() {
            if let i = storage.firstIndex(where: { $0.id == contact.id }) {
                storage[i].sortIndex = index
            }
        }
    }
}

/// Default mock alerting used until the SOS backend is wired.
final class MockContactAlerting: ContactAlerting {
    func sendTestAlert(to contact: EmergencyContact) async throws {
        try await Task.sleep(nanoseconds: 700_000_000)
    }
}
