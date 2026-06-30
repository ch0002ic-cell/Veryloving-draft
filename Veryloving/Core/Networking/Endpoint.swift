//
//  Endpoint.swift
//  Veryloving
//
//  Declarative description of a backend request. Concrete endpoints live next
//  to the feature that owns them (e.g. AuthService defines /auth/* endpoints).
//  See docs/BACKEND_API.md for the full contract these map to.
//

import Foundation

enum HTTPMethod: String {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case patch = "PATCH"
    case delete = "DELETE"
}

struct Endpoint {
    let path: String                       // e.g. "/v1/auth/login"
    var method: HTTPMethod = .get
    var queryItems: [URLQueryItem] = []
    var body: Data? = nil
    var requiresAuth: Bool = true
    var additionalHeaders: [String: String] = [:]

    /// Convenience for JSON bodies.
    static func json<T: Encodable>(
        _ path: String,
        method: HTTPMethod,
        body: T,
        requiresAuth: Bool = true
    ) -> Endpoint {
        let data = try? JSONEncoder.api.encode(body)
        return Endpoint(
            path: path,
            method: method,
            body: data,
            requiresAuth: requiresAuth,
            additionalHeaders: ["Content-Type": "application/json"]
        )
    }
}

extension JSONEncoder {
    /// Shared encoder: snake_case keys + ISO8601 dates to match the backend contract.
    static let api: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()
}

extension JSONDecoder {
    static let api: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}
