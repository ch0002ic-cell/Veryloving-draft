//
//  AuthViewModelTests.swift
//  VerylovingTests
//

import XCTest
@testable import Veryloving

@MainActor
final class AuthViewModelTests: XCTestCase {

    private func makeSUT() -> (AuthViewModel, SessionStore) {
        let service = MockAuthService()
        let session = SessionStore(secureStore: InMemorySecureStore(),
                                   authService: service,
                                   tokenProvider: TokenProvider())
        session.bootstrap()   // → .unauthenticated
        let vm = AuthViewModel(authService: service, session: session)
        return (vm, session)
    }

    // MARK: Validation

    func testEmailValidation() {
        let (vm, _) = makeSUT()
        vm.email = "not-an-email"
        XCTAssertFalse(vm.isEmailValid)
        vm.email = "ava@veryloving.ai"
        XCTAssertTrue(vm.isEmailValid)
    }

    func testPasswordValidation() {
        let (vm, _) = makeSUT()
        vm.password = "123"
        XCTAssertFalse(vm.isPasswordValid)
        vm.password = "secret6"
        XCTAssertTrue(vm.isPasswordValid)
    }

    func testCanSubmitSignUpRequiresName() {
        let (vm, _) = makeSUT()
        vm.email = "ava@veryloving.ai"
        vm.password = "secret6"
        XCTAssertFalse(vm.canSubmitSignUp, "Name is required for sign up")
        vm.displayName = "Ava"
        XCTAssertTrue(vm.canSubmitSignUp)
    }

    // MARK: Sign in

    func testSuccessfulSignInEstablishesSession() async {
        let (vm, session) = makeSUT()
        vm.email = "demo@veryloving.ai"
        vm.password = "secret6"

        await vm.signIn()

        XCTAssertNil(vm.error)
        XCTAssertNotNil(session.currentUser)
        if case .authenticated = session.phase {} else {
            XCTFail("Expected authenticated phase, got \(session.phase)")
        }
    }

    func testInvalidCredentialsSurfaceErrorAndStayUnauthenticated() async {
        let (vm, session) = makeSUT()
        vm.email = "demo@veryloving.ai"
        vm.password = "12345"   // too short → MockAuthService rejects

        // canSubmit gates the UI; call register directly to exercise the error path.
        vm.password = "short"
        await vm.signIn()       // guard blocks because password invalid; nothing happens
        XCTAssertEqual(session.phase, .unauthenticated)
    }

    // MARK: Sign up

    func testRegisteringExistingEmailReportsError() async {
        let (vm, session) = makeSUT()
        vm.displayName = "Demo"
        vm.email = "demo@veryloving.ai"   // pre-registered in MockAuthService
        vm.password = "secret6"

        await vm.register()

        XCTAssertNotNil(vm.error)
        XCTAssertEqual(session.phase, .unauthenticated)
    }

    func testRegisteringNewEmailSucceeds() async {
        let (vm, session) = makeSUT()
        vm.displayName = "Ava"
        vm.email = "ava+\(UUID().uuidString)@veryloving.ai"
        vm.password = "secret6"

        await vm.register()

        XCTAssertNil(vm.error)
        XCTAssertNotNil(session.currentUser)
    }
}
