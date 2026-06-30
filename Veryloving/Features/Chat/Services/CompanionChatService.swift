//
//  CompanionChatService.swift
//  Veryloving
//
//  Ported from emo_ios ChatService. Builds the transcript from EVI messages and
//  extracts the top emotion (prosody) scores.
//

import Foundation

final class CompanionChatService: CompanionChatProtocol {

    weak var delegate: CompanionChatDelegate?
    private(set) var messages: [ChatEntry] = []

    func process(_ message: EVIMessage) {
        switch message {
        case .assistantMessage(let chatMessage, let models),
             .userMessage(let chatMessage, let models):
            let entry = ChatEntry(
                role: chatMessage.role == "assistant" ? .assistant : .user,
                content: chatMessage.content,
                scores: topEmotions(from: models)
            )
            messages.append(entry)
            delegate?.chat(self, didUpdate: messages)

        case .error(let errorMessage):
            AppLogger.chat.error("Companion error: \(errorMessage)")
            delegate?.chat(self, didEncounterError:
                NSError(domain: "Companion", code: -1,
                        userInfo: [NSLocalizedDescriptionKey: errorMessage]))
        default:
            break
        }
    }

    /// Optimistic echo so the user's text appears instantly (server echo is deduped on role+content).
    func appendLocalUserMessage(_ text: String) {
        messages.append(ChatEntry(role: .user, content: text, scores: []))
        delegate?.chat(self, didUpdate: messages)
    }

    func clear() {
        messages.removeAll()
        delegate?.chat(self, didUpdate: messages)
    }

    private func topEmotions(from models: Inference) -> [EmotionScore] {
        guard let scores = models.prosody?.scores else { return [] }
        return scores.map { EmotionScore(emotion: $0.key, score: $0.value) }
            .sorted { $0.score > $1.score }
            .prefix(3)
            .map { $0 }
    }
}
