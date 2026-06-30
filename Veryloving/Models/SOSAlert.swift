//
//  SOSAlert.swift
//  Veryloving
//

import Foundation

/// Payload posted to the backend, which fans out SMS + push to contacts.
struct SOSAlert: Codable, Equatable {
    enum Trigger: String, Codable { case app, wearable }

    let triggeredBy: Trigger
    let location: LocationFix?
    let batteryLevel: Int?
}

/// Backend response for a dispatched alert.
struct SOSDispatchResult: Codable, Equatable {
    let alertId: String
    let notifiedContacts: Int
}
