import type { ContactSyncJobDoc, StaffDoc } from "../types/models";

const PROTECTED_STAFF_CONTACTS = [
  { name: "김기효", phone: "01086488585", role: "owner" },
  { name: "김민지", phone: "01075594765", role: "instructor" },
  { name: "김아영", phone: "01032510242", role: "instructor" },
  { name: "배민진", phone: "01044033249", role: "owner" },
  { name: "이초림", phone: "01040381248", role: "instructor" },
  { name: "정은영", phone: "01040180513", role: "staff" },
] as const;

export interface ActiveStaffContactIndex {
  phones: ReadonlySet<string>;
  names: ReadonlySet<string>;
}

export function buildActiveStaffContactIndex(
  staffs: Array<Pick<StaffDoc, "name" | "phone" | "active">>,
): ActiveStaffContactIndex {
  const phones = new Set<string>();
  const names = new Set<string>();
  staffs
    .filter((staff) => staff.active)
    .forEach((staff) => {
      const phone = normalizePhoneDigits(staff.phone || "");
      const name = normalizeName(staff.name || "");
      if (phone) phones.add(phone);
      if (name) names.add(name);
    });
  return { phones, names };
}

export function isProtectedStaffContact(
  input: { name?: string; phone?: string },
  activeStaffs?: ActiveStaffContactIndex,
): boolean {
  const phone = normalizePhoneDigits(input.phone || "");
  const name = normalizeName(input.name || "");
  if (activeStaffs) {
    if (phone) return activeStaffs.phones.has(phone);
    return Boolean(name && activeStaffs.names.has(name));
  }
  if (phone) {
    return PROTECTED_STAFF_CONTACTS.some((contact) => phone === contact.phone);
  }
  if (!name) return false;
  return PROTECTED_STAFF_CONTACTS.some((contact) => name === normalizeName(contact.name));
}

export function shouldSkipProtectedStaffContactJob(
  job: ContactSyncJobDoc,
  activeStaffs?: ActiveStaffContactIndex,
): boolean {
  if (job.sourceReason === "staff_profile_refresh") return false;
  return isProtectedStaffContact({ name: job.memberName, phone: job.memberPhone }, activeStaffs);
}

export function shouldPreserveExistingContactName(name: string): boolean {
  return / 회원(?: \d{6})?$| 강사님$|대표|원장|부원장|스탭|스텝|STAFF|오너/i.test(name);
}

function normalizePhoneDigits(value: string): string {
  let digits = String(value || "").replace(/\D+/g, "");
  if (digits.startsWith("82") && digits.length >= 11) digits = `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith("10")) digits = `0${digits}`;
  return digits;
}

function normalizeName(value: string): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}
