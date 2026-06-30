//
//  BiometricAuthenticator.swift
//  Veryloving
//
//  Face ID / Touch ID gate for unlocking the app and protecting sensitive
//  flows (viewing emergency contacts, changing SOS settings). Uses
//  LocalAuthentication — no third-party dependency.
//

import Foundation
import LocalAuthentication

enum BiometryKind {
    case none
    case touchID
    case faceID
    case opticID

    var displayName: String {
        switch self {
        case .none: return "Passcode"
        case .touchID: return "Touch ID"
        case .faceID: return "Face ID"
        case .opticID: return "Optic ID"
        }
    }
}

enum BiometricError: LocalizedError {
    case unavailable
    case cancelled
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .unavailable: return "Biometric authentication isn't available on this device."
        case .cancelled: return "Authentication was cancelled."
        case .failed(let reason): return reason
        }
    }
}

protocol BiometricAuthenticating {
    var availableBiometry: BiometryKind { get }
    /// Throws BiometricError on cancel/failure; returns on success.
    func authenticate(reason: String) async throws
}

final class BiometricAuthenticator: BiometricAuthenticating {

    var availableBiometry: BiometryKind {
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) else {
            return .none
        }
        switch context.biometryType {
        case .touchID: return .touchID
        case .faceID: return .faceID
        case .opticID: return .opticID
        default: return .none
        }
    }

    func authenticate(reason: String) async throws {
        let context = LAContext()
        context.localizedFallbackTitle = "Use Passcode"

        var policyError: NSError?
        // Allow passcode fallback so the user is never locked out if biometrics fail.
        let policy: LAPolicy = .deviceOwnerAuthentication
        guard context.canEvaluatePolicy(policy, error: &policyError) else {
            throw BiometricError.unavailable
        }

        do {
            let success = try await context.evaluatePolicy(policy, localizedReason: reason)
            if !success { throw BiometricError.failed("Authentication did not succeed.") }
        } catch let error as LAError {
            switch error.code {
            case .userCancel, .appCancel, .systemCancel:
                throw BiometricError.cancelled
            default:
                throw BiometricError.failed(error.localizedDescription)
            }
        }
    }
}
