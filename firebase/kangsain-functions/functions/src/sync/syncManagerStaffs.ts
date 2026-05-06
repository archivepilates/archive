import { DEFAULT_MANAGER_STAFF_ID, DEFAULT_STUDIO_ID } from "../config/constants";
import { refs } from "../firestore/refs";
import { ManagerClient } from "../studiomate/managerClient";
import type { StaffRole } from "../types/models";
import { nowTimestamp } from "../utils/date";

export async function syncManagerStaffs(input?: { studioId?: string; managerStaffId?: string }): Promise<{ staffs: number }> {
  const studioId = input?.studioId || DEFAULT_STUDIO_ID;
  const managerStaffId = input?.managerStaffId || DEFAULT_MANAGER_STAFF_ID;
  const client = new ManagerClient(studioId, managerStaffId);
  const rows = await client.getStaffs();
  const now = nowTimestamp();

  await Promise.all(
    rows
      .filter((row) => row?.id && row?.name)
      .map(async (row) => {
        const staffId = stringValue(row.id);
        const phone = digitsOnly(row.mobile ?? row.contact_infos?.find?.((item: any) => item?.is_representative)?.contact);
        const current = (await refs.staff(staffId).get()).data();
        const managerRole = roleFromManager(row.role);
        await refs.staff(staffId).set(
          {
            staffId,
            studioId,
            name: stringValue(row.name),
            phone: phone || current?.phone || "",
            phoneLast4: phone ? phone.slice(-4) : current?.phoneLast4 || "",
            role: current?.role === "instructor" && managerRole === "owner" ? "instructor" : managerRole,
            active: !row.deleted_at,
            studiomateStaffId: staffId,
            visibleLectureStaffNames: current?.visibleLectureStaffNames?.length
              ? current.visibleLectureStaffNames
              : [stringValue(row.name)],
            createdAt: current?.createdAt || now,
            updatedAt: now,
          },
          { merge: true },
        );
      }),
  );

  return { staffs: rows.length };
}

function roleFromManager(role: unknown): StaffRole {
  const text = stringValue(role);
  if (/오너|owner/i.test(text)) return "owner";
  if (/매니저|관리|manager/i.test(text)) return "manager";
  if (/강사|instructor|staff/i.test(text)) return "instructor";
  return "viewer";
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function digitsOnly(value: unknown): string {
  return stringValue(value).replace(/\D/g, "");
}
