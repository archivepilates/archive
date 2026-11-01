import Testing
import Foundation
@testable import MacUnlockKit

struct GuardTests {
    let locked = Session(host: "host", uid: 501, id: "session", locked: true, lockTime: "100")
    func ready() -> State { State(version: 1, host: "host", uid: 501, unlockedSession: "session", blocked: false, attempt: nil) }
    @Test func readySession() throws { try gate(locked, ready()) }
    @Test func wrongHost() { var s = ready(); s = State(version:1, host:"other", uid:s.uid, unlockedSession:s.unlockedSession, blocked:false, attempt:nil); #expect(throws: Stop.self) { try gate(locked,s) } }
    @Test func wrongUser() { #expect(throws: Stop.self) { try gate(locked, State(version:1,host:"host",uid:502,unlockedSession:"session",blocked:false,attempt:nil)) } }
    @Test func missingEpoch() { #expect(throws: Stop.self) { try gate(Session(host:"host",uid:501,id:"session",locked:true,lockTime:nil),ready()) } }
    @Test func unobservedSession() { var s=ready(); s.unlockedSession="old"; #expect(throws: Stop.self) { try gate(locked,s) } }
    @Test func interruptedAttemptBlocked() { var s=ready(); s.blocked=true; #expect(throws: Stop.self) { try gate(locked,s) } }
    @Test func consumedEpochEvenWithoutBlockedFlag() { var s=ready(); s.attempt=Attempt(epoch:locked.epoch!,phase:"reserved",at:"test"); #expect(throws: Stop.self) { try gate(locked,s) } }
    @Test func successfulPreviousEpochAllowsNewLock() throws { var s=ready(); s.attempt=Attempt(epoch:"session:99",phase:"unlocked_verified",at:"test"); try gate(locked,s) }
    @Test func failedPreviousEpochRemainsBlocked() { var s=ready(); s.blocked=true; s.attempt=Attempt(epoch:"session:99",phase:"unverified_no_retry",at:"test"); #expect(throws: Stop.self) { try gate(locked,s) } }
    @Test func unlockedIsNotDispatchable() { #expect(throws: Stop.self) { try gate(Session(host:"host",uid:501,id:"session",locked:false,lockTime:nil),ready()) } }
    @Test func lowercaseKeyMapping() throws { let keys=try strokes(Data("az".utf8)); #expect(keys.map(\.code) == [0,6]); #expect(keys.map(\.shift) == [false,false]) }
    @Test func uppercaseKeyMapping() throws { let keys=try strokes(Data("AZ".utf8)); #expect(keys.map(\.code) == [0,6]); #expect(keys.map(\.shift) == [true,true]) }
    @Test func printableASCII() throws { #expect(try strokes(Data((32...126).map(UInt8.init))).count == 95) }
    @Test func emptyRejected() { #expect(throws: Stop.self) { try strokes(Data()) } }
    @Test func controlRejected() { #expect(throws: Stop.self) { try strokes(Data([10])) } }
    @Test func nonASCIIRejected() { #expect(throws: Stop.self) { try strokes(Data([0xC3,0xA9])) } }
    @Test func oversizeRejected() { #expect(throws: Stop.self) { try strokes(Data(repeating:97,count:129)) } }
    @Test func stateRoundtrip() throws { let s=ready(); let copy=try JSONDecoder().decode(State.self,from:JSONEncoder().encode(s)); #expect(copy.host == s.host); #expect(copy.unlockedSession == s.unlockedSession) }
}
