//
//  PersistenceController.swift
//  Veryloving
//
//  CoreData stack with the model defined IN CODE (no .xcdatamodeld / momc). This
//  keeps the schema in one reviewable Swift file, avoids a binary model artifact,
//  and stays fully under test control. The model is authored CloudKit-compatible
//  (all attributes optional / defaulted) so swapping NSPersistentContainer →
//  NSPersistentCloudKitContainer + the iCloud entitlement is a one-liner later.
//

import Foundation
import CoreData

final class PersistenceController {

    static let shared = PersistenceController()

    let container: NSPersistentContainer

    /// Built once: CoreData warns if two models claim the same NSManagedObject subclass.
    private static let model: NSManagedObjectModel = {
        let model = NSManagedObjectModel()

        let entity = NSEntityDescription()
        entity.name = "CDContact"
        entity.managedObjectClassName = "CDContact"   // matches @objc(CDContact)

        func attribute(_ name: String,
                       _ type: NSAttributeType,
                       defaultValue: Any? = nil) -> NSAttributeDescription {
            let attribute = NSAttributeDescription()
            attribute.name = name
            attribute.attributeType = type
            attribute.isOptional = true                // CloudKit-compatible
            if let defaultValue { attribute.defaultValue = defaultValue }
            return attribute
        }

        entity.properties = [
            attribute("id", .UUIDAttributeType),
            attribute("name", .stringAttributeType),
            attribute("phone", .stringAttributeType),
            attribute("email", .stringAttributeType),
            attribute("priorityRaw", .integer16AttributeType, defaultValue: 0),
            attribute("sortIndex", .integer16AttributeType, defaultValue: 0),
            attribute("createdAt", .dateAttributeType)
        ]

        model.entities = [entity]
        return model
    }()

    init(inMemory: Bool = false) {
        container = NSPersistentContainer(name: "Veryloving", managedObjectModel: Self.model)

        if inMemory {
            container.persistentStoreDescriptions.first?.url = URL(fileURLWithPath: "/dev/null")
        }

        container.loadPersistentStores { _, error in
            if let error {
                AppLogger.app.error("CoreData store load failed: \(error.localizedDescription)")
                assertionFailure("CoreData store failed to load: \(error)")
            }
        }
        container.viewContext.automaticallyMergesChangesFromParent = true
        container.viewContext.mergePolicy = NSMergeByPropertyObjectTrumpMergePolicy
    }

    /// In-memory stack for previews/tests.
    static var preview: PersistenceController { PersistenceController(inMemory: true) }
}
