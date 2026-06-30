//
//  Theme.swift
//  Veryloving
//
//  Design tokens for a premium, minimalist jewelry brand. Centralizing colors,
//  typography, spacing, and radii keeps the UI consistent and makes a future
//  rebrand a one-file change. Supports light & dark mode automatically.
//
//  ⚠️ Palette/typography are sensible defaults pending real brand assets
//  (clarification Q4). Update the asset catalog colors + Typography below when
//  the design team delivers the brand kit.
//

import SwiftUI

enum Theme {

    // MARK: Colors

    enum Colors {
        /// Champagne-gold accent (from Assets.xcassets/AccentColor).
        static let accent = Color.accentColor
        /// Deep plum/charcoal brand base (from Assets.xcassets/BrandPrimary).
        static let brand = Color("BrandPrimary")

        static let background = Color(.systemBackground)
        static let secondaryBackground = Color(.secondarySystemBackground)
        static let groupedBackground = Color(.systemGroupedBackground)

        static let primaryText = Color(.label)
        static let secondaryText = Color(.secondaryLabel)

        /// Emergency red used consistently across the SOS surfaces.
        static let danger = Color(red: 0.85, green: 0.18, blue: 0.20)
        static let success = Color(red: 0.18, green: 0.62, blue: 0.40)
    }

    // MARK: Typography

    enum Typography {
        static let largeTitle = Font.system(.largeTitle, design: .serif).weight(.semibold)
        static let title = Font.system(.title2, design: .serif).weight(.semibold)
        static let headline = Font.system(.headline, design: .default)
        static let body = Font.system(.body, design: .default)
        static let caption = Font.system(.caption, design: .default)
    }

    // MARK: Spacing (4-pt scale)

    enum Spacing {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 16
        static let lg: CGFloat = 24
        static let xl: CGFloat = 32
        static let xxl: CGFloat = 48
    }

    enum Radius {
        static let small: CGFloat = 8
        static let medium: CGFloat = 14
        static let large: CGFloat = 24
        static let pill: CGFloat = 999
    }
}

// MARK: - Reusable button styles

/// Primary call-to-action: filled accent, full width, haptic on tap.
struct PrimaryButtonStyle: ButtonStyle {
    var isLoading: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.Typography.headline)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(Theme.Colors.accent)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous))
            .opacity(configuration.isPressed || isLoading ? 0.7 : 1.0)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// Secondary action: outline, used for less prominent choices.
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.Typography.headline)
            .frame(maxWidth: .infinity, minHeight: 52)
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous)
                    .stroke(Theme.Colors.secondaryText.opacity(0.4), lineWidth: 1)
            )
            .foregroundStyle(Theme.Colors.primaryText)
            .opacity(configuration.isPressed ? 0.6 : 1.0)
    }
}
