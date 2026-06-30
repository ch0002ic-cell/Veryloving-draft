//
//  CompanionTests.swift
//  VerylovingTests
//

import XCTest
@testable import Veryloving

private final class ChatDelegateSpy: CompanionChatDelegate {
    var lastMessages: [ChatEntry] = []
    var errorCount = 0
    func chat(_ service: CompanionChatProtocol, didUpdate messages: [ChatEntry]) { lastMessages = messages }
    func chat(_ service: CompanionChatProtocol, didEncounterError error: Error) { errorCount += 1 }
}

final class CompanionChatServiceTests: XCTestCase {

    func testProcessAppendsAndExtractsTopEmotions() {
        let service = CompanionChatService()
        let spy = ChatDelegateSpy()
        service.delegate = spy

        let message = EVIMessage.assistantMessage(
            message: ChatMessage(role: "assistant", content: "I'm here for you."),
            models: Inference(prosody: ProsodyInference(scores: ["calm": 0.4, "joy": 0.9, "fear": 0.1]))
        )
        service.process(message)

        XCTAssertEqual(service.messages.count, 1)
        XCTAssertEqual(service.messages.first?.role, .assistant)
        XCTAssertEqual(service.messages.first?.content, "I'm here for you.")
        XCTAssertEqual(service.messages.first?.scores.first?.emotion, "joy", "Highest score first")
        XCTAssertEqual(spy.lastMessages.count, 1)
    }

    func testLocalEchoAndClear() {
        let service = CompanionChatService()
        service.appendLocalUserMessage("Hello")
        XCTAssertEqual(service.messages.count, 1)
        XCTAssertEqual(service.messages.first?.role, .user)

        service.clear()
        XCTAssertTrue(service.messages.isEmpty)
    }

    func testDecodeAssistantMessage() throws {
        let json = #"""
        {"type":"assistant_message","message":{"role":"assistant","content":"Hi"},"models":{"prosody":{"scores":{"joy":0.8}}}}
        """#
        let message = try JSONDecoder().decode(EVIMessage.self, from: Data(json.utf8))
        guard case .assistantMessage(let chatMessage, let models) = message else {
            return XCTFail("Expected assistantMessage, got \(message)")
        }
        XCTAssertEqual(chatMessage.content, "Hi")
        XCTAssertEqual(models.prosody?.scores["joy"], 0.8)
    }

    func testDecodeErrorMessage() throws {
        let json = #"{"type":"error","message":"boom"}"#
        let message = try JSONDecoder().decode(EVIMessage.self, from: Data(json.utf8))
        guard case .error(let text) = message else { return XCTFail("Expected error") }
        XCTAssertEqual(text, "boom")
    }
}
