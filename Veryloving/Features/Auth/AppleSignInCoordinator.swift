//
//  AppleSignInCoordinator.swift
//  Veryloving
//
//  Bridges ASAuthorizationController's delegate API into async/await and returns
//  the identity token the backend exchanges for a session
//  (POST /v1/auth/apple). Requires the "Sign in with Apple" capability
//  (see Veryloving.entitlements).
//

import AuthenticationServices
import UIKit

@MainActor
final class AppleSignInCoordinator: NSObject {

    struct Credential {
        let identityToken: String
        let fullName: String?
    }

    enum AppleSignInError: LocalizedError {
        case cancelled
        case missingToken
        case failed(String)

        var errorDescription: String? {
            switch self {
            case .cancelled: return "Sign in with Apple was cancelled."
            case .missingToken: return "Apple didn't return an identity token. Please try again."
            case .failed(let reason): return reason
            }
        }
    }

    private var continuation: CheckedContinuation<Credential, Error>?

    /// Nonisolated so it can be used as a default argument / constructed off the
    /// main actor. Touches no isolated state beyond the implicit nil continuation.
    nonisolated override init() { super.init() }

    func signIn() async throws -> Credential {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    private func finish(_ result: Result<Credential, Error>) {
        continuation?.resume(with: result)
        continuation = nil
    }
}

extension AppleSignInCoordinator: ASAuthorizationControllerDelegate {

    func authorizationController(controller: ASAuthorizationController,
                                 didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let token = String(data: tokenData, encoding: .utf8) else {
            finish(.failure(AppleSignInError.missingToken))
            return
        }
        let nameComponents = credential.fullName
        let fullName = [nameComponents?.givenName, nameComponents?.familyName]
            .compactMap { $0 }
            .joined(separator: " ")
        finish(.success(Credential(identityToken: token, fullName: fullName.isEmpty ? nil : fullName)))
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            finish(.failure(AppleSignInError.cancelled))
        } else {
            finish(.failure(AppleSignInError.failed(error.localizedDescription)))
        }
    }
}

extension AppleSignInCoordinator: ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        return scene?.keyWindow ?? ASPresentationAnchor()
    }
}
