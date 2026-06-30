//
//  AppEnvironment.swift
//  Veryloving
//
//  Composition root / dependency-injection container. Builds the object graph
//  once and hands shared instances to the view layer. This is the single place
//  that decides "real vs. mock" for each subsystem, keeping that policy out of
//  the features themselves.
//

import Foundation
import SwiftUI
import Combine

@MainActor
final class AppEnvironment: ObservableObject {

    let session: SessionStore
    let wearableViewModel: WearableViewModel
    let biometrics: BiometricAuthenticating
    let notifications: NotificationManager
    let deviceService: DeviceService

    let contactsRepository: ContactsRepository
    let locationService: LocationProviding
    let sosService: SOSService
    let subscriptionService: SubscriptionService
    let reachability: ReachabilitySignal
    let analytics: AnalyticsService

    private let secureStore: SecureStore
    private let authService: AuthService
    private let persistence: PersistenceController
    private var cancellables = Set<AnyCancellable>()

    /// Created on first use (Companion tab) so the audio engine isn't spun up at launch.
    lazy var companionViewModel = CompanionViewModel(secureStore: secureStore, analytics: analytics)

    init() {
        let config = AppConfig.current
        let keychain = KeychainStore()
        let tokenProvider = TokenProvider()
        let apiClient = URLSessionAPIClient(tokenProvider: tokenProvider)
        self.secureStore = keychain
        self.persistence = PersistenceController.shared

        #if DEBUG
        let analytics: AnalyticsService = ConsoleAnalyticsService()
        #else
        let analytics: AnalyticsService = NoopAnalyticsService()
        #endif
        self.analytics = analytics

        // Auth/network/SOS/subscriptions: mock until a backend URL is configured.
        let authService: AuthService = config.useMockServices
            ? MockAuthService()
            : RemoteAuthService(client: apiClient)
        self.authService = authService
        let session = SessionStore(secureStore: keychain,
                                   authService: authService,
                                   tokenProvider: tokenProvider,
                                   analytics: analytics)
        self.session = session
        apiClient.setTokenRefresher(session)   // auto-refresh on 401

        let reachability = ReachabilityMonitor()
        self.reachability = reachability
        if config.useMockServices {
            self.sosService = MockSOSService()
        } else {
            // Live SOS gets offline-queue resilience: failed dispatches persist and
            // auto-retry when connectivity returns.
            self.sosService = ResilientSOSService(base: RemoteSOSService(client: apiClient),
                                                  queue: OfflineSOSQueue(),
                                                  reachability: reachability)
        }
        self.subscriptionService = config.useMockServices
            ? MockSubscriptionService()
            : StoreKitSubscriptionService()

        self.contactsRepository = CoreDataContactsRepository(context: persistence.container.viewContext)

        // Bluetooth + Location: no simulator radio/GPS reliability, so mock there;
        // real hardware uses the live implementations (neither needs a backend).
        #if targetEnvironment(simulator)
        self.wearableViewModel = WearableViewModel(service: MockWearableService(), analytics: analytics)
        self.locationService = MockLocationService()
        #else
        self.wearableViewModel = WearableViewModel(service: BluetoothManager(), analytics: analytics)
        self.locationService = LiveLocationService()
        #endif

        self.biometrics = BiometricAuthenticator()

        self.notifications = NotificationManager()
        self.deviceService = config.useMockServices ? NoopDeviceService() : RemoteDeviceService(client: apiClient)
        notifications.registerCategories()

        // Subscription tier is the source of truth for feature gating: propagate it
        // into the session so the whole app reacts to upgrades.
        subscriptionService.tierPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak session] tier in session?.updateSubscriptionTier(tier) }
            .store(in: &cancellables)

        if config.useMockServices {
            AppLogger.app.info("Running with MOCK services (no backend configured).")
        }
    }

    // MARK: Factories

    func makeAuthViewModel() -> AuthViewModel {
        AuthViewModel(authService: authService, session: session, analytics: analytics)
    }

    func makeContactsViewModel() -> ContactsViewModel {
        ContactsViewModel(repository: contactsRepository, alerting: sosService, analytics: analytics)
    }

    func makeSOSViewModel(trigger: SOSAlert.Trigger, batteryLevel: Int?) -> SOSViewModel {
        SOSViewModel(sosService: sosService, location: locationService,
                     trigger: trigger, batteryLevel: batteryLevel, analytics: analytics)
    }

    func makePaywallViewModel() -> PaywallViewModel {
        PaywallViewModel(service: subscriptionService, analytics: analytics)
    }
}
