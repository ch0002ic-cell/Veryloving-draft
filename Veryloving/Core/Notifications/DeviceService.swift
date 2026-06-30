//
//  DeviceService.swift
//  Veryloving
//
//  Uploads the APNs device token to the backend so it can route SOS / safety
//  pushes to this device (docs/BACKEND_API.md §Devices). `NoopDeviceService` is
//  used until a backend is configured.
//

import Foundation

protocol DeviceService: AnyObject {
    func uploadPushToken(_ token: String) async
}

private struct PushTokenBody: Encodable {
    let apnsToken: String
    let environment: String
}

final class RemoteDeviceService: DeviceService {
    private let client: APIClient
    init(client: APIClient) { self.client = client }

    func uploadPushToken(_ token: String) async {
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        do {
            try await client.send(.json("/v1/devices/push-token", method: .post,
                                        body: PushTokenBody(apnsToken: token, environment: environment)))
            AppLogger.notifications.info("Uploaded APNs token.")
        } catch {
            // Non-fatal: retried on next launch / token refresh.
            AppLogger.notifications.warning("Push token upload failed: \(error.localizedDescription)")
        }
    }
}

final class NoopDeviceService: DeviceService {
    func uploadPushToken(_ token: String) async {
        AppLogger.notifications.debug("NoopDeviceService: would upload token (no backend).")
    }
}
