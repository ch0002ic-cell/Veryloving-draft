//
//  EmergencyContact.swift
//  Veryloving
//
//  Plain value type used throughout the app. The CoreData layer (CDContact)
//  maps to/from this so views and view models never touch NSManagedObject.
//

import Foundation

struct EmergencyContact: Identifiable, Equatable, Codable {
    let id: UUID
    var name: String
    var phone: String
    var email: String?
    var priority: ContactPriority
    var sortIndex: Int

    init(id: UUID = UUID(),
         name: String,
         phone: String,
         email: String? = nil,
         priority: ContactPriority = .primary,
         sortIndex: Int = 0) {
        self.id = id
        self.name = name
        self.phone = phone
        self.email = email
        self.priority = priority
        self.sortIndex = sortIndex
    }

    var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        return parts.compactMap { $0.first.map(String.init) }.joined().uppercased()
    }
}

enum ContactPriority: Int16, Codable, CaseIterable, Identifiable, Comparable {
    case primary = 0
    case secondary = 1
    case tertiary = 2

    var id: Int16 { rawValue }

    var displayName: String {
        switch self {
        case .primary: return "Primary"
        case .secondary: return "Secondary"
        case .tertiary: return "Tertiary"
        }
    }

    static func < (lhs: ContactPriority, rhs: ContactPriority) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}
