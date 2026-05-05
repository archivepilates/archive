import type { StaffDoc } from "../types/models";
import { refs } from "./refs";

export async function upsertStaff(staff: StaffDoc): Promise<void> {
  await refs.staff(staff.staffId).set(staff, { merge: true });
}

export async function getStaffByUid(uid: string): Promise<StaffDoc | null> {
  const snap = await refs.staffs().where("uid", "==", uid).limit(1).get();
  return snap.empty ? null : snap.docs[0].data();
}

export async function getActiveStaffs(studioId: string): Promise<StaffDoc[]> {
  const snap = await refs.staffs().where("studioId", "==", studioId).where("active", "==", true).get();
  return snap.docs.map((doc) => doc.data());
}
