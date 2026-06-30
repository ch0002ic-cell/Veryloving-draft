//
//  OfflineSOSQueue.swift
//  Veryloving
//
//  Durable on-disk queue of SOS alerts that failed to dispatch (e.g. offline).
//  Persisted as JSON so a queued alert survives an app kill and is re-sent once
//  connectivity returns. Thread-safe (file access guarded by a lock).
//

import Foundation

struct QueuedSOS: Codable, Identifiable, Equatable {
    let id: UUID
    let alert: SOSAlert
    let queuedAt: Date

    init(id: UUID = UUID(), alert: SOSAlert, queuedAt: Date = Date()) {
        self.id = id
        self.alert = alert
        self.queuedAt = queuedAt
    }
}

final class OfflineSOSQueue: @unchecked Sendable {

    private let fileURL: URL
    private let lock = NSLock()

    init(fileURL: URL = OfflineSOSQueue.defaultURL) {
        self.fileURL = fileURL
    }

    static var defaultURL: URL {
        let base = (try? FileManager.default.url(for: .applicationSupportDirectory,
                                                 in: .userDomainMask,
                                                 appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("sos_queue.json")
    }

    func enqueue(_ alert: SOSAlert) {
        lock.lock(); defer { lock.unlock() }
        var items = load()
        items.append(QueuedSOS(alert: alert))
        save(items)
        AppLogger.sos.info("SOS queued offline (\(items.count) pending).")
    }

    func pending() -> [QueuedSOS] {
        lock.lock(); defer { lock.unlock() }
        return load()
    }

    func remove(id: UUID) {
        lock.lock(); defer { lock.unlock() }
        save(load().filter { $0.id != id })
    }

    func clear() {
        lock.lock(); defer { lock.unlock() }
        try? FileManager.default.removeItem(at: fileURL)
    }

    // MARK: Persistence (callers hold the lock)

    private func load() -> [QueuedSOS] {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        return (try? JSONDecoder.api.decode([QueuedSOS].self, from: data)) ?? []
    }

    private func save(_ items: [QueuedSOS]) {
        guard let data = try? JSONEncoder.api.encode(items) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }
}
