//
//  ChatBubble.swift
//  Veryloving
//

import SwiftUI

struct ChatBubble: View {
    let entry: ChatEntry

    private var isUser: Bool { entry.role == .user }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 40) }
            VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
                Text(entry.content)
                    .font(Theme.Typography.body)
                    .foregroundStyle(isUser ? .white : Theme.Colors.primaryText)
                    .padding(.horizontal, Theme.Spacing.md)
                    .padding(.vertical, Theme.Spacing.sm)
                    .background(isUser ? Theme.Colors.accent : Theme.Colors.secondaryBackground)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous))

                if let top = entry.scores.first {
                    Text("\(top.emotion.capitalized) · \(Int(top.score * 100))%")
                        .font(.caption2)
                        .foregroundStyle(Theme.Colors.secondaryText)
                }
            }
            if !isUser { Spacer(minLength: 40) }
        }
    }
}
