import type { StaffDoc } from "../types/models";
import { refs } from "./refs";

export async function upsertStaff(staff: StaffDoc): Promise<void> {
  const current = (await refs.staff(staff.staffId).get()).data();
  await refs.staff(staff.staffId).set(
    {
      ...staff,
      uid: current?.uid || staff.uid,
      email: current?.email || staff.email,
      phone: current?.phone || staff.phone,
      phoneLast4: current?.phoneLast4 || staff.phoneLast4,
      role: current && ["owner", "manager"].includes(current.role) ? current.role : staff.role,
      createdAt: current?.createdAt || staff.createdAt,
    },
    { merge: true },
  );
}

export async function getStaffById(staffId: string): Promise<StaffDoc | null> {
  const snap = await refs.staff(staffId).get();
  return snap.exists ? snap.data() || null : null;
}

export async function getStaffByUid(uid: string): Promise<StaffDoc | null> {
  const snap = await refs.staffs().where("uid", "==", uid).limit(1).get();
  return snap.empty ? null : snap.docs[0].data();
}

export async function getStaffByEmail(email: string): Promise<StaffDoc | null> {
  const snap = await refs.staffs().where("email", "==", email).limit(1).get();
  return snap.empty ? null : snap.docs[0].data();
}

export async function getStaffByPhone(phone: string): Promise<StaffDoc | null> {
  const snap = await refs.staffs().where("phone", "==", phone).where("active", "==", true).limit(1).get();
  return snap.empty ? null : snap.docs[0].data();
}

export async function getActiveStaffs(studioId: string): Promise<StaffDoc[]> {
  const snap = await refs.staffs().where("studioId", "==", studioId).where("active", "==", true).get();
  return snap.docs.map((doc) => doc.data());
}
