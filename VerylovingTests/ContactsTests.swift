//
//  ContactsTests.swift
//  VerylovingTests
//

import XCTest
@testable import Veryloving

@MainActor
final class ContactsViewModelTests: XCTestCase {

    private func makeSUT() -> (ContactsViewModel, InMemoryContactsRepository) {
        let repo = InMemoryContactsRepository()
        let vm = ContactsViewModel(repository: repo, alerting: MockContactAlerting())
        return (vm, repo)
    }

    func testAddUpdateDelete() {
        let (vm, _) = makeSUT()
        vm.load()
        XCTAssertTrue(vm.contacts.isEmpty)

        vm.save(EmergencyContact(name: "Mom", phone: "+15550100"))
        XCTAssertEqual(vm.contacts.count, 1)

        var edited = vm.contacts[0]
        edited.name = "Mum"
        vm.save(edited)
        XCTAssertEqual(vm.contacts.count, 1, "Editing must not create a duplicate")
        XCTAssertEqual(vm.contacts.first?.name, "Mum")

        vm.save(EmergencyContact(name: "Alex", phone: "+15550142"))
        XCTAssertEqual(vm.contacts.count, 2)

        vm.delete(at: IndexSet(integer: 0))
        XCTAssertEqual(vm.contacts.count, 1)
    }

    func testNewContactGetsAppendedSortIndex() {
        let (vm, _) = makeSUT()
        vm.save(EmergencyContact(name: "A", phone: "+15550001"))
        vm.save(EmergencyContact(name: "B", phone: "+15550002"))
        XCTAssertEqual(vm.contacts.map(\.sortIndex), [0, 1])
    }

    func testTestAlertSucceeds() async {
        let (vm, _) = makeSUT()
        vm.save(EmergencyContact(name: "Mom", phone: "+15550100"))
        await vm.sendTestAlert(to: vm.contacts[0])
        XCTAssertNil(vm.error)
        XCTAssertNil(vm.testingContactID)
    }
}

final class CoreDataContactsRepositoryTests: XCTestCase {

    func testRoundTripAndDelete() throws {
        let persistence = PersistenceController(inMemory: true)
        let repo = CoreDataContactsRepository(context: persistence.container.viewContext)

        XCTAssertTrue(try repo.fetchAll().isEmpty)

        let contact = EmergencyContact(name: "Mom", phone: "+15550100",
                                       email: "mom@x.com", priority: .primary, sortIndex: 0)
        try repo.save(contact)

        let all = try repo.fetchAll()
        XCTAssertEqual(all.count, 1)
        XCTAssertEqual(all.first?.name, "Mom")
        XCTAssertEqual(all.first?.email, "mom@x.com")
        XCTAssertEqual(all.first?.priority, .primary)

        try repo.delete(id: contact.id)
        XCTAssertTrue(try repo.fetchAll().isEmpty)
    }

    func testUpdateInPlaceAndOrdering() throws {
        let persistence = PersistenceController(inMemory: true)
        let repo = CoreDataContactsRepository(context: persistence.container.viewContext)

        var a = EmergencyContact(name: "A", phone: "+1", sortIndex: 0)
        let b = EmergencyContact(name: "B", phone: "+2", sortIndex: 1)
        try repo.save(a); try repo.save(b)

        a.name = "Aaa"
        try repo.save(a)
        XCTAssertEqual(try repo.fetchAll().count, 2)

        // Reverse the order and persist.
        try repo.persistOrder([b, a])
        XCTAssertEqual(try repo.fetchAll().map(\.name), ["B", "Aaa"])
    }
}
