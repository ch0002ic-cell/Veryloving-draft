//
//  FeaturePlaceholder.swift
//  Veryloving
//
//  Honest "coming in a later phase" scaffold so unbuilt surfaces still render and
//  navigate. Each placeholder names the phase that delivers it (see the roadmap
//  in README.md) rather than pretending to be finished.
//

import SwiftUI

struct FeaturePlaceholder: View {
    let title: String
    let systemImage: String
    let message: String
    var phase: String

    var body: some View {
        VStack(spacing: Theme.Spacing.md) {
            Image(systemName: systemImage)
                .font(.system(size: 52))
                .foregroundStyle(Theme.Colors.accent)
            Text(title).font(Theme.Typography.title)
            Text(message)
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.secondaryText)
                .multilineTextAlignment(.center)
            Text(phase)
                .font(Theme.Typography.caption)
                .padding(.horizontal, Theme.Spacing.md)
                .padding(.vertical, Theme.Spacing.xs)
                .background(Theme.Colors.secondaryBackground)
                .clipShape(Capsule())
        }
        .screenPadding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
