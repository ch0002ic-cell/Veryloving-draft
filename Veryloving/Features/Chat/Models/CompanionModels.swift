//
//  CompanionModels.swift
//  Veryloving
//
//  AI companion data models ported from the emo_ios prototype (Hume EVI). Kept
//  faithful to the wire format; only namespaced into the Chat feature.
//

import Foundation

// MARK: - Chat transcript

enum Role: String, Codable {
    case user
    case assistant
}

struct EmotionScore: Codable, Equatable {
    let emotion: String
    let score: Double
}

struct ChatEntry: Identifiable, Equatable {
    let id: UUID
    let role: Role
    let timestamp: Date
    let content: String
    let scores: [EmotionScore]

    init(id: UUID = UUID(), role: Role, timestamp: Date = Date(), content: String, scores: [EmotionScore]) {
        self.id = id
        self.role = role
        self.timestamp = timestamp
        self.content = content
        self.scores = scores
    }
}

// MARK: - Hume EVI messages

struct ChatMessage: Codable {
    let role: String
    let content: String
}

struct ProsodyInference: Codable {
    let scores: [String: Double]
}

struct Inference: Codable {
    let prosody: ProsodyInference?
}

enum EVIMessage: Decodable {
    case error(message: String)
    case chatMetadata(metadata: [String: String])
    case audioOutput(data: String)
    case userInterruption
    case assistantMessage(message: ChatMessage, models: Inference)
    case userMessage(message: ChatMessage, models: Inference)
    case unknown

    private enum CodingKeys: String, CodingKey {
        case type, message, data, models
        case chatGroupId = "chat_group_id"
        case chatId = "chat_id"
        case requestId = "request_id"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)

        switch type {
        case "error":
            self = .error(message: try container.decode(String.self, forKey: .message))
        case "chat_metadata":
            var metadata: [String: String] = [:]
            metadata["chat_group_id"] = try container.decodeIfPresent(String.self, forKey: .chatGroupId) ?? ""
            metadata["chat_id"] = try container.decodeIfPresent(String.self, forKey: .chatId) ?? ""
            metadata["request_id"] = try container.decodeIfPresent(String.self, forKey: .requestId) ?? ""
            self = .chatMetadata(metadata: metadata)
        case "audio_output":
            self = .audioOutput(data: try container.decode(String.self, forKey: .data))
        case "user_interruption":
            self = .userInterruption
        case "assistant_message", "user_message":
            let message = try container.decode(ChatMessage.self, forKey: .message)
            let models = try container.decode(Inference.self, forKey: .models)
            self = type == "assistant_message"
                ? .assistantMessage(message: message, models: models)
                : .userMessage(message: message, models: models)
        default:
            self = .unknown
        }
    }
}
