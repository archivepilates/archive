import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMembershipContractMemberProfilePatch,
  membershipContractFallbackAliasIds,
} from "./studiomate-membership-contract-member-profile.mjs";

test("builds a canonical numeric StudioMate member profile from verified contract identity", () => {
  assert.deepEqual(
    buildMembershipContractMemberProfilePatch(
      {
        memberId: "5009368",
        name: " 김기효 테스트 ",
        phone: "010-2924-4425",
        memberGrade: "VIP",
        birthday: "1990-01-01",
        gender: "M",
      },
      "5330",
    ),
    {
      memberId: "5009368",
      studioId: "5330",
      name: "김기효 테스트",
      normalizedName: "김기효테스트",
      phone: "01029244425",
      phoneLast4: "4425",
      memberGrade: "VIP",
      birthDate: "1990-01-01",
      gender: "M",
      source: "studiomate_native_contract",
      identityVerified: true,
    },
  );
});

test("rejects incomplete or temporary member identity", () => {
  for (const member of [
    null,
    { memberId: "excel_1", name: "Member", phone: "01012345678" },
    { memberId: "1", name: "", phone: "01012345678" },
    { memberId: "1", name: "Member", phone: "invalid" },
  ]) {
    assert.throws(() => buildMembershipContractMemberProfilePatch(member, "5330"));
  }
});

test("links only exact same-identity Excel fallback profiles", () => {
  const canonical = buildMembershipContractMemberProfilePatch(
    { memberId: "5009368", name: "Member", phone: "01012345678" },
    "5330",
  );
  assert.deepEqual(
    membershipContractFallbackAliasIds(
      [
        { id: "5009368", data: canonical },
        {
          id: "excel_old",
          data: { studioId: "5330", name: " Member ", phone: "010-1234-5678" },
        },
      ],
      canonical,
    ),
    ["excel_old"],
  );
  for (const row of [
    { id: "other_numeric", data: { studioId: "5330", name: "Member", phone: "01012345678" } },
    { id: "excel_other", data: { studioId: "5330", name: "Other", phone: "01012345678" } },
    { id: "excel_other", data: { studioId: "9999", name: "Member", phone: "01012345678" } },
  ]) {
    assert.throws(() => membershipContractFallbackAliasIds([row], canonical));
  }
});
