import { DEFAULT_MANAGER_STAFF_ID, DEFAULT_STUDIO_ID } from "../config/constants";
import { refs } from "../firestore/refs";
import { saveRawMirrorBatch } from "../firestore/rawMirrorRepository";
import { ManagerClient } from "../studiomate/managerClient";
import type { StaffRole } from "../types/models";
import { nowTimestamp, todayKst } from "../utils/date";

export async function syncManagerStaffs(input?: { studioId?: string; managerStaffId?: string }): Promise<{ staffs: number }> {
  const studioId = input?.studioId || DEFAULT_STUDIO_ID;
  const managerStaffId = input?.managerStaffId || DEFAULT_MANAGER_STAFF_ID;
  const client = new ManagerClient(studioId, managerStaffId);
  const rows = await client.getStaffs();
  await saveRawMirrorBatch({
    studioId,
    dataset: "managerStaffs",
    sourcePath: "/api/staff",
    records: rows,
    mirrorDate: todayKst(),
  });
  const now = nowTimestamp();

  await Promise.all(
    rows
      .filter((row) => row?.id && row?.name)
      .map(async (row) => {
        const staffId = stringValue(row.id);
        const phone = digitsOnly(row.mobile ?? row.contact_infos?.find?.((item: any) => item?.is_representative)?.contact);
        const current = (await refs.staff(staffId).get()).data();
        const managerRole = roleFromManager(row.role);
        const color = colorValue(
          row.color ??
            row.colour ??
            row.theme_color ??
            row.background_color ??
            row.profile?.color ??
            row.profile?.theme_color,
        );
        await refs.staff(staffId).set(
          {
            staffId,
            studioId,
            name: stringValue(row.name),
            phone: phone || current?.phone || "",
            phoneLast4: phone ? phone.slice(-4) : current?.phoneLast4 || "",
            color: color || current?.color || "",
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

function colorValue(value: unknown): string {
  const text = stringValue(value);
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
  }
  const hex = text.match(/[0-9a-f]{6}/i)?.[0];
  return hex ? `#${hex}` : "";
}
