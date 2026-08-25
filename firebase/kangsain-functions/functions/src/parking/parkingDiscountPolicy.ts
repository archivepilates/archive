export const PARKING_DISCOUNT_UNIT_HOURS = 2;
export const PARKING_MAX_AUTO_DISCOUNT_HOURS = 4;
export const STAFF_REQUIRED_DISCOUNT_HOURS = 4;
export const PARKING_APPLY_AFTER_START_MINUTES = 30;

export type ParkingDiscountPolicyInput = {
  ownerType?: string;
  memberId?: string;
  staffId?: string;
  staffName?: string;
  requestedDiscountHours?: number | string;
  maxAutoDiscountHours?: number | string;
  discountUnitHours?: number | string;
};

export type ParkingDiscountPolicy = {
  policy: "staff_fixed_4h" | "standard";
  requestedDiscountHours: number;
  maxAutoDiscountHours: number;
  discountUnitHours: number;
};

function boundedDiscountHours(value: unknown, fallback: number, max: number): number {
  const numberValue = Number(value || fallback);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return fallback;
  return Math.min(Math.ceil(numberValue), max);
}

function isStaffParkingJob(job: ParkingDiscountPolicyInput): boolean {
  const ownerType = String(job.ownerType || "")
    .trim()
    .toLowerCase();
  if (ownerType) return ownerType === "staff";
  return Boolean(job.staffId || job.staffName) && !job.memberId;
}

export function resolveParkingDiscountPolicy(job: ParkingDiscountPolicyInput): ParkingDiscountPolicy {
  if (isStaffParkingJob(job)) {
    return {
      policy: "staff_fixed_4h",
      requestedDiscountHours: STAFF_REQUIRED_DISCOUNT_HOURS,
      maxAutoDiscountHours: STAFF_REQUIRED_DISCOUNT_HOURS,
      discountUnitHours: PARKING_DISCOUNT_UNIT_HOURS,
    };
  }

  const maxAutoDiscountHours = boundedDiscountHours(
    job.maxAutoDiscountHours,
    PARKING_MAX_AUTO_DISCOUNT_HOURS,
    PARKING_MAX_AUTO_DISCOUNT_HOURS,
  );
  return {
    policy: "standard",
    requestedDiscountHours: boundedDiscountHours(job.requestedDiscountHours, 2, maxAutoDiscountHours),
    maxAutoDiscountHours,
    discountUnitHours: boundedDiscountHours(job.discountUnitHours, PARKING_DISCOUNT_UNIT_HOURS, maxAutoDiscountHours),
  };
}
