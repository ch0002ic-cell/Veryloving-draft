//
//  APIError.swift
//  Veryloving
//

import Foundation

enum APIError: LocalizedError, Equatable {
    case invalidURL
    case notConnectedToInternet
    case unauthorized                 // 401 — token missing/expired.
    case forbidden                    // 403 — valid token, insufficient permission/tier.
    case notFound                     // 404
    case server(status: Int, message: String?)   // 5xx or other non-2xx.
    case decoding(String)
    case transport(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "The request URL was invalid."
        case .notConnectedToInternet:
            return "You appear to be offline. Please check your connection and try again."
        case .unauthorized:
            return "Your session has expired. Please sign in again."
        case .forbidden:
            return "This feature isn't available on your current plan."
        case .notFound:
            return "We couldn't find what you were looking for."
        case .server(let status, let message):
            return message ?? "The server returned an error (\(status)). Please try again."
        case .decoding(let detail):
            return "We received an unexpected response. (\(detail))"
        case .transport(let detail):
            return detail
        }
    }

    /// Whether a retry could plausibly succeed (used by SOS offline queue / backoff).
    var isRetryable: Bool {
        switch self {
        case .notConnectedToInternet, .transport, .server:
            return true
        default:
            return false
        }
    }
}
