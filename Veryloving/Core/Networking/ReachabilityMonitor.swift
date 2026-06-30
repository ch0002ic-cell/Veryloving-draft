//
//  ReachabilityMonitor.swift
//  Veryloving
//
//  Network reachability via NWPathMonitor. Drives the offline SOS queue: when
//  connectivity returns, queued alerts are flushed. Abstracted behind
//  `ReachabilitySignal` so tests can simulate going on/offline.
//

import Foundation
import Network
import Combine

protocol ReachabilitySignal: AnyObject {
    var isOnline: Bool { get }
    var onlinePublisher: AnyPublisher<Bool, Never> { get }
}

final class ReachabilityMonitor: ReachabilitySignal, @unchecked Sendable {
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "ai.veryloving.reachability")
    private let subject = CurrentValueSubject<Bool, Never>(true)

    var isOnline: Bool { subject.value }
    var onlinePublisher: AnyPublisher<Bool, Never> {
        subject.removeDuplicates().eraseToAnyPublisher()
    }

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            self?.subject.send(path.status == .satisfied)
        }
        monitor.start(queue: queue)
    }

    deinit { monitor.cancel() }
}

/// Test double: flip reachability on demand.
final class MockReachability: ReachabilitySignal {
    private let subject: CurrentValueSubject<Bool, Never>
    init(online: Bool = true) { subject = CurrentValueSubject(online) }
    var isOnline: Bool { subject.value }
    var onlinePublisher: AnyPublisher<Bool, Never> { subject.eraseToAnyPublisher() }
    func set(online: Bool) { subject.send(online) }
}
