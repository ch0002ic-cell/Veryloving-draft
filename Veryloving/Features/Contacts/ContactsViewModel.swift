//
//  ContactsViewModel.swift
//  Veryloving
//

import Foundation

@MainActor
final class ContactsViewModel: ObservableObject {

    @Published private(set) var contacts: [EmergencyContact] = []
    @Published var error: AppError?
    @Published private(set) var testingContactID: UUID?

    private let repository: ContactsRepository
    private let alerting: ContactAlerting
    private let analytics: AnalyticsService

    init(repository: ContactsRepository,
         alerting: ContactAlerting,
         analytics: AnalyticsService = NoopAnalyticsService()) {
        self.repository = repository
        self.alerting = alerting
        self.analytics = analytics
    }

    func load() {
        do {
            contacts = try repository.fetchAll()
        } catch {
            self.error = AppError(error)
        }
    }

    /// Insert or update. New contacts are appended at the end of the order.
    func save(_ contact: EmergencyContact) {
        var toSave = contact
        let isNew = !contacts.contains(where: { $0.id == contact.id })
        if isNew { toSave.sortIndex = contacts.count }
        do {
            try repository.save(toSave)
            if isNew { analytics.log(.contactAdded) }
            load()
        } catch {
            self.error = AppError(error)
        }
    }

    func delete(at offsets: IndexSet) {
        let ids = offsets.map { contacts[$0].id }
        do {
            for id in ids { try repository.delete(id: id) }
            load()
        } catch {
            self.error = AppError(error)
        }
    }

    func move(from source: IndexSet, to destination: Int) {
        contacts.move(fromOffsets: source, toOffset: destination)
        do {
            try repository.persistOrder(contacts)
            load()
        } catch {
            self.error = AppError(error)
        }
    }

    func sendTestAlert(to contact: EmergencyContact) async {
        testingContactID = contact.id
        defer { testingContactID = nil }
        do {
            try await alerting.sendTestAlert(to: contact)
        } catch {
            self.error = AppError(title: "Test alert failed", message: AppError(error).message)
        }
    }
}
