//
//  CDContact.swift
//  Veryloving
//
//  Manual NSManagedObject subclass for the CDContact entity (model uses
//  codeGenerationType="manual"). Maps to/from the value-type EmergencyContact so
//  the rest of the app never imports CoreData.
//

import Foundation
import CoreData

@objc(CDContact)
final class CDContact: NSManagedObject {

    @nonobjc class func fetchRequest() -> NSFetchRequest<CDContact> {
        NSFetchRequest<CDContact>(entityName: "CDContact")
    }

    @NSManaged var id: UUID?
    @NSManaged var name: String?
    @NSManaged var phone: String?
    @NSManaged var email: String?
    @NSManaged var priorityRaw: Int16
    @NSManaged var sortIndex: Int16
    @NSManaged var createdAt: Date?
}

extension CDContact {
    /// Copy a value-type contact into this managed object.
    func apply(_ contact: EmergencyContact) {
        id = contact.id
        name = contact.name
        phone = contact.phone
        email = contact.email
        priorityRaw = contact.priority.rawValue
        sortIndex = Int16(contact.sortIndex)
        if createdAt == nil { createdAt = Date() }
    }

    /// Map back to the value type. Returns nil for rows missing required fields.
    var asValue: EmergencyContact? {
        guard let id, let name, let phone else { return nil }
        return EmergencyContact(
            id: id,
            name: name,
            phone: phone,
            email: email,
            priority: ContactPriority(rawValue: priorityRaw) ?? .primary,
            sortIndex: Int(sortIndex)
        )
    }
}
