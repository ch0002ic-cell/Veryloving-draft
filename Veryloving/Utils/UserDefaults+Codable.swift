//
//  UserDefaults+Codable.swift
//  Veryloving
//
//  Carried over from the prototype: store/retrieve Codable values in
//  UserDefaults. Use this ONLY for non-sensitive preferences. Anything secret
//  (tokens, keys) belongs in KeychainStore.
//

import Foundation

extension UserDefaults {
    func save<T: Encodable>(_ value: T, forKey key: String) {
        if let data = try? JSONEncoder().encode(value) {
            set(data, forKey: key)
        }
    }

    func object<T: Decodable>(_ type: T.Type, forKey key: String) -> T? {
        guard let data = data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}
