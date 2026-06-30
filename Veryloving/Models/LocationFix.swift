//
//  LocationFix.swift
//  Veryloving
//
//  A captured GPS position. Codable so it can be persisted (last-known fallback)
//  and serialized into the SOS payload.
//

import Foundation
import CoreLocation

struct LocationFix: Codable, Equatable {
    let latitude: Double
    let longitude: Double
    let accuracyMeters: Double
    let capturedAt: Date

    init(latitude: Double, longitude: Double, accuracyMeters: Double, capturedAt: Date = Date()) {
        self.latitude = latitude
        self.longitude = longitude
        self.accuracyMeters = accuracyMeters
        self.capturedAt = capturedAt
    }

    init(_ location: CLLocation) {
        self.latitude = location.coordinate.latitude
        self.longitude = location.coordinate.longitude
        self.accuracyMeters = location.horizontalAccuracy
        self.capturedAt = location.timestamp
    }

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    /// Universal maps link included in SOS SMS so contacts can open the location.
    var mapsLink: URL {
        URL(string: "https://maps.apple.com/?ll=\(latitude),\(longitude)&q=SOS")!
    }

    /// How stale this fix is, for "last known" UI.
    var age: TimeInterval { Date().timeIntervalSince(capturedAt) }
}
