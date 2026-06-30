//
//  APIClient.swift
//  Veryloving
//
//  async/await REST client built on URLSession. Replaces the Alamofire spec —
//  URLSession covers our needs (JSON, auth headers, typed errors) with zero
//  dependencies and first-class TLS 1.3. Swap in Alamofire later behind this
//  same `APIClient` protocol if richer features (multipart, retriers) are needed.
//

import Foundation

protocol APIClient {
    /// Send a request and decode a JSON response body into `T`.
    func send<T: Decodable>(_ endpoint: Endpoint, decoding type: T.Type) async throws -> T
    /// Send a request that returns no meaningful body (e.g. 204).
    @discardableResult
    func send(_ endpoint: Endpoint) async throws -> Data
}

/// Supplies the current bearer token for authenticated requests. Implemented by
/// the session layer so the client stays decoupled from auth storage.
protocol AuthTokenProviding: AnyObject {
    func currentAccessToken() -> String?
}

/// Refreshes the session when the client hits a 401. Returns true if a new token
/// is now available (so the request can be retried). Implemented by SessionStore.
@MainActor
protocol SessionRefreshing: AnyObject {
    func refreshSession() async -> Bool
}

final class URLSessionAPIClient: APIClient {

    private let baseURL: URL
    private let session: URLSession
    private weak var tokenProvider: AuthTokenProviding?
    private weak var tokenRefresher: SessionRefreshing?

    init(baseURL: URL = AppConfig.current.apiBaseURL,
         session: URLSession = .shared,
         tokenProvider: AuthTokenProviding? = nil) {
        self.baseURL = baseURL
        self.session = session
        self.tokenProvider = tokenProvider
    }

    func setTokenProvider(_ provider: AuthTokenProviding) {
        self.tokenProvider = provider
    }

    /// Wire the session that can refresh an expired access token on a 401.
    func setTokenRefresher(_ refresher: SessionRefreshing) {
        self.tokenRefresher = refresher
    }

    func send<T: Decodable>(_ endpoint: Endpoint, decoding type: T.Type) async throws -> T {
        let data = try await send(endpoint)
        do {
            return try JSONDecoder.api.decode(T.self, from: data)
        } catch {
            throw APIError.decoding("\(T.self): \(error.localizedDescription)")
        }
    }

    @discardableResult
    func send(_ endpoint: Endpoint) async throws -> Data {
        try await send(endpoint, allowRefresh: true)
    }

    private func send(_ endpoint: Endpoint, allowRefresh: Bool) async throws -> Data {
        let request = try makeRequest(for: endpoint)
        AppLogger.network.debug("→ \(endpoint.method.rawValue) \(endpoint.path)")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let urlError as URLError where urlError.code == .notConnectedToInternet {
            throw APIError.notConnectedToInternet
        } catch {
            throw APIError.transport(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.transport("Non-HTTP response.")
        }
        AppLogger.network.debug("← \(http.statusCode) \(endpoint.path)")

        switch http.statusCode {
        case 200...299:
            return data
        case 401:
            // Try a single refresh+retry before surfacing the failure.
            if endpoint.requiresAuth, allowRefresh,
               let refresher = tokenRefresher, await refresher.refreshSession() {
                AppLogger.network.info("Refreshed session; retrying \(endpoint.path)")
                return try await send(endpoint, allowRefresh: false)
            }
            throw APIError.unauthorized
        case 403:
            throw APIError.forbidden
        case 404:
            throw APIError.notFound
        default:
            throw APIError.server(status: http.statusCode, message: Self.serverMessage(from: data))
        }
    }

    // MARK: - Request building

    private func makeRequest(for endpoint: Endpoint) throws -> URLRequest {
        guard var components = URLComponents(
            url: baseURL.appendingPathComponent(endpoint.path),
            resolvingAgainstBaseURL: false
        ) else {
            throw APIError.invalidURL
        }
        if !endpoint.queryItems.isEmpty {
            components.queryItems = endpoint.queryItems
        }
        guard let url = components.url else { throw APIError.invalidURL }

        var request = URLRequest(url: url)
        request.httpMethod = endpoint.method.rawValue
        request.httpBody = endpoint.body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        endpoint.additionalHeaders.forEach { request.setValue($1, forHTTPHeaderField: $0) }

        if endpoint.requiresAuth {
            guard let token = tokenProvider?.currentAccessToken() else {
                throw APIError.unauthorized
            }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    /// Best-effort extraction of `{ "message": "..." }` or `{ "error": "..." }`.
    private static func serverMessage(from data: Data) -> String? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return object["message"] as? String ?? object["error"] as? String
    }
}
