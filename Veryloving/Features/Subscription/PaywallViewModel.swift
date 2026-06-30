//
//  PaywallViewModel.swift
//  Veryloving
//

import Foundation

@MainActor
final class PaywallViewModel: ObservableObject {

    @Published private(set) var products: [SubscriptionProduct] = []
    @Published private(set) var isLoading = false
    @Published private(set) var purchasingID: String?
    @Published private(set) var didPurchase = false
    @Published var error: AppError?

    private let service: SubscriptionService
    private let analytics: AnalyticsService

    init(service: SubscriptionService, analytics: AnalyticsService = NoopAnalyticsService()) {
        self.service = service
        self.analytics = analytics
    }

    var currentTier: SubscriptionTier { service.entitledTier }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            products = try await service.loadProducts()
        } catch {
            self.error = AppError(error)
        }
    }

    func purchase(_ product: SubscriptionProduct) async {
        purchasingID = product.id
        defer { purchasingID = nil }
        do {
            if try await service.purchase(product) {
                analytics.log(.subscriptionStarted(tier: product.tier.rawValue))
                Haptics.notify(.success)
                didPurchase = true
            }
        } catch {
            self.error = AppError(error)
        }
    }

    func restore() async {
        do {
            try await service.restore()
            if service.entitledTier != .free { didPurchase = true }
        } catch {
            self.error = AppError(error)
        }
    }
}
