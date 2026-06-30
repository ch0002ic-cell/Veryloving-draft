//
//  SubscriptionService.swift
//  Veryloving
//
//  StoreKit 2 subscriptions. `StoreKitSubscriptionService` fetches products,
//  purchases, restores, and resolves the entitled tier from current entitlements
//  (listening for async Transaction.updates). `MockSubscriptionService` drives the
//  demo/previews. Server-side receipt validation (POST /v1/subscription/validate)
//  is the authoritative source in production — see docs/BACKEND_API.md §Subscription.
//
//  The intended RevenueCat integration also slots behind this protocol.
//

import Foundation
import StoreKit
import Combine

struct SubscriptionProduct: Identifiable, Equatable {
    let id: String
    let tier: SubscriptionTier
    let displayName: String
    let priceText: String
    let hasIntroTrial: Bool
}

enum SubscriptionError: LocalizedError {
    case productUnavailable
    case verificationFailed

    var errorDescription: String? {
        switch self {
        case .productUnavailable: return "This plan isn't available right now. Please try again later."
        case .verificationFailed: return "We couldn't verify your purchase with the App Store."
        }
    }
}

protocol SubscriptionService: AnyObject {
    var entitledTier: SubscriptionTier { get }
    var tierPublisher: AnyPublisher<SubscriptionTier, Never> { get }
    func loadProducts() async throws -> [SubscriptionProduct]
    /// Returns true if the purchase completed and the user is now entitled.
    func purchase(_ product: SubscriptionProduct) async throws -> Bool
    func restore() async throws
}

// MARK: - StoreKit 2

final class StoreKitSubscriptionService: SubscriptionService {

    static let plusProductID = "ai.veryloving.plus.monthly"
    static let proProductID = "ai.veryloving.pro.monthly"
    static let productIDs = [plusProductID, proProductID]

    private let tierSubject = CurrentValueSubject<SubscriptionTier, Never>(.free)
    private var updatesTask: Task<Void, Never>?

    init() {
        updatesTask = listenForTransactions()
        Task { await refreshEntitlements() }
    }

    deinit { updatesTask?.cancel() }

    var entitledTier: SubscriptionTier { tierSubject.value }
    var tierPublisher: AnyPublisher<SubscriptionTier, Never> { tierSubject.eraseToAnyPublisher() }

    func loadProducts() async throws -> [SubscriptionProduct] {
        let products = try await Product.products(for: Self.productIDs)
        return products
            .map { product in
                SubscriptionProduct(
                    id: product.id,
                    tier: Self.tier(for: product.id),
                    displayName: product.displayName,
                    priceText: "\(product.displayPrice)/mo",
                    hasIntroTrial: product.subscription?.introductoryOffer != nil
                )
            }
            .sorted { $0.tier.rank < $1.tier.rank }
    }

    func purchase(_ product: SubscriptionProduct) async throws -> Bool {
        guard let storeProduct = try await Product.products(for: [product.id]).first else {
            throw SubscriptionError.productUnavailable
        }
        let result = try await storeProduct.purchase()
        switch result {
        case .success(let verification):
            let transaction = try Self.checkVerified(verification)
            await transaction.finish()
            await refreshEntitlements()
            return true
        case .userCancelled, .pending:
            return false
        @unknown default:
            return false
        }
    }

    func restore() async throws {
        try await AppStore.sync()
        await refreshEntitlements()
    }

    // MARK: Private

    private func refreshEntitlements() async {
        var highest: SubscriptionTier = .free
        for await result in Transaction.currentEntitlements {
            guard let transaction = try? Self.checkVerified(result) else { continue }
            let tier = Self.tier(for: transaction.productID)
            if tier.rank > highest.rank { highest = tier }
        }
        tierSubject.send(highest)
    }

    private func listenForTransactions() -> Task<Void, Never> {
        Task.detached { [weak self] in
            for await update in Transaction.updates {
                guard let self, let transaction = try? Self.checkVerified(update) else { continue }
                await transaction.finish()
                await self.refreshEntitlements()
            }
        }
    }

    private static func tier(for productID: String) -> SubscriptionTier {
        productID == proProductID ? .pro : .plus
    }

    private static func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified:
            throw SubscriptionError.verificationFailed
        case .verified(let safe):
            return safe
        }
    }
}

// MARK: - Mock

final class MockSubscriptionService: SubscriptionService {
    private let tierSubject = CurrentValueSubject<SubscriptionTier, Never>(.free)

    var entitledTier: SubscriptionTier { tierSubject.value }
    var tierPublisher: AnyPublisher<SubscriptionTier, Never> { tierSubject.eraseToAnyPublisher() }

    func loadProducts() async throws -> [SubscriptionProduct] {
        try await Task.sleep(nanoseconds: 400_000_000)
        return [
            SubscriptionProduct(id: "mock.plus", tier: .plus, displayName: "Veryloving Plus",
                                priceText: "$9.99/mo", hasIntroTrial: true),
            SubscriptionProduct(id: "mock.pro", tier: .pro, displayName: "Veryloving Pro",
                                priceText: "$19.99/mo", hasIntroTrial: true)
        ]
    }

    func purchase(_ product: SubscriptionProduct) async throws -> Bool {
        try await Task.sleep(nanoseconds: 800_000_000)
        tierSubject.send(product.tier)
        return true
    }

    func restore() async throws {
        try await Task.sleep(nanoseconds: 300_000_000)
    }
}
