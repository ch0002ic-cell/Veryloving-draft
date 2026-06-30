//
//  SOSMapView.swift
//  Veryloving
//
//  Lightweight, non-interactive map preview of a coordinate. Wraps MKMapView
//  (UIViewRepresentable) to stay clean on iOS 16 — the SwiftUI `Map { Marker }`
//  builder is iOS 17+, and the iOS 16 `Map(coordinateRegion:)` API is deprecated.
//

import SwiftUI
import MapKit

struct SOSMapView: UIViewRepresentable {
    let coordinate: CLLocationCoordinate2D

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.isUserInteractionEnabled = false
        map.showsUserLocation = false
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        let region = MKCoordinateRegion(center: coordinate,
                                        latitudinalMeters: 500, longitudinalMeters: 500)
        map.setRegion(region, animated: false)
        map.removeAnnotations(map.annotations)
        let pin = MKPointAnnotation()
        pin.coordinate = coordinate
        pin.title = "Your location"
        map.addAnnotation(pin)
    }
}
