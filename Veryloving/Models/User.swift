//
//  User.swift
//  Veryloving
//

import Foundation

struct User: Codable, Identifiable, Equatable {
    let id: String
    var email: String
    var displayName: String?
    var subscriptionTier: SubscriptionTier
    var createdAt: Date

    var firstName: String {
        displayName?.split(separator: " ").first.map(String.init) ?? "there"
    }
}

/// Subscription tiers gate features across the app. See Feature.isAvailable(for:).
enum SubscriptionTier: String, Codable, CaseIterable {
    case free
    case plus
    case pro

    var displayName: String {
        switch self {
        case .free: return "Free"
        case .plus: return "Plus"
        case .pro: return "Pro"
        }
    }

    var monthlyPriceDescription: String {
        switch self {
        case .free: return "Free"
        case .plus: return "$9.99/mo"
        case .pro: return "$19.99/mo"
        }
    }

    /// Ordering for "highest entitlement wins" when resolving StoreKit transactions.
    var rank: Int {
        switch self {
        case .free: return 0
        case .plus: return 1
        case .pro: return 2
        }
    }
}

/// Single place that encodes the feature-gating matrix from the spec.
enum Feature {
    case basicSOS
    case aiCompanion
    case satelliteSOS
    case familyMonitoring

    func isAvailable(for tier: SubscriptionTier) -> Bool {
        switch self {
        case .basicSOS:
            return true                                  // all tiers
        case .aiCompanion:
            return tier == .plus || tier == .pro
        case .satelliteSOS, .familyMonitoring:
            return tier == .pro
        }
    }
}
