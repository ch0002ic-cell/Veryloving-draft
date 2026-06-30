//
//  PaywallView.swift
//  Veryloving
//
//  Subscription paywall: plan cards with the feature matrix, 7-day trial copy,
//  purchase + restore. On success it dismisses; AppEnvironment propagates the new
//  tier into the session (feature gating updates app-wide).
//

import SwiftUI

struct PaywallView: View {
    @StateObject private var viewModel: PaywallViewModel
    @Environment(\.dismiss) private var dismiss

    init(viewModel: @autoclosure @escaping () -> PaywallViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel())
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.Spacing.lg) {
                    header

                    if viewModel.isLoading && viewModel.products.isEmpty {
                        ProgressView().padding(.top, Theme.Spacing.xl)
                    } else if viewModel.products.isEmpty {
                        Text("Plans are unavailable right now. Please try again later.")
                            .font(Theme.Typography.body)
                            .foregroundStyle(Theme.Colors.secondaryText)
                            .multilineTextAlignment(.center)
                            .padding(.top, Theme.Spacing.xl)
                    } else {
                        ForEach(viewModel.products) { product in
                            PlanCard(
                                product: product,
                                isCurrent: viewModel.currentTier == product.tier,
                                isPurchasing: viewModel.purchasingID == product.id
                            ) {
                                Task { await viewModel.purchase(product) }
                            }
                        }
                    }

                    Button("Restore purchases") { Task { await viewModel.restore() } }
                        .font(Theme.Typography.caption)

                    Text("Plans renew monthly until cancelled. Cancel anytime in Settings. Your free trial converts automatically.")
                        .font(.caption2)
                        .foregroundStyle(Theme.Colors.secondaryText)
                        .multilineTextAlignment(.center)
                }
                .screenPadding()
                .padding(.vertical, Theme.Spacing.lg)
            }
            .navigationTitle("Upgrade")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .task { await viewModel.load() }
            .onChange(of: viewModel.didPurchase) { purchased in
                if purchased { dismiss() }
            }
            .errorAlert($viewModel.error)
        }
    }

    private var header: some View {
        VStack(spacing: Theme.Spacing.sm) {
            Image(systemName: "sparkles").font(.system(size: 44)).foregroundStyle(Theme.Colors.accent)
            Text("Unlock your full Guardian").font(Theme.Typography.title)
            Text("Start with a 7-day free trial.")
                .font(Theme.Typography.body).foregroundStyle(Theme.Colors.secondaryText)
        }
    }
}

private struct PlanCard: View {
    let product: SubscriptionProduct
    let isCurrent: Bool
    let isPurchasing: Bool
    let onSubscribe: () -> Void

    private var features: [String] {
        switch product.tier {
        case .pro: return ["AI Companion", "One-touch SOS", "Satellite SOS", "Family Monitoring"]
        case .plus: return ["AI Companion", "One-touch SOS"]
        case .free: return ["One-touch SOS"]
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack {
                Text(product.displayName).font(Theme.Typography.headline)
                Spacer()
                Text(product.priceText).font(Theme.Typography.headline).foregroundStyle(Theme.Colors.accent)
            }
            ForEach(features, id: \.self) { feature in
                Label(feature, systemImage: "checkmark.circle.fill")
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.primaryText)
            }
            Button(action: onSubscribe) {
                if isPurchasing { ProgressView().tint(.white) }
                else { Text(isCurrent ? "Current plan" : (product.hasIntroTrial ? "Start free trial" : "Subscribe")) }
            }
            .buttonStyle(PrimaryButtonStyle(isLoading: isPurchasing))
            .disabled(isCurrent || isPurchasing)
        }
        .padding(Theme.Spacing.lg)
        .background(Theme.Colors.secondaryBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.large, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.large, style: .continuous)
                .stroke(isCurrent ? Theme.Colors.accent : .clear, lineWidth: 2)
        )
    }
}

#Preview {
    PaywallView(viewModel: PaywallViewModel(service: MockSubscriptionService()))
}
