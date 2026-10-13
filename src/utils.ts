import type { CarePlan, Resident } from "./model";
export function localDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function localMonth(date = new Date()) {
  return localDate(date).slice(0, 7);
}
export function monthLabel(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return month || "未登録";
  const [y, m] = month.split("-");
  return `${y}年${Number(m)}月`;
}
export function wareki(value: string) {
  if (!value) return "未登録";
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(value)) return value;
  const [y, m, d] = value.split("-").map(Number);
  const parts = new Intl.DateTimeFormat("ja-JP-u-ca-japanese", {
    era: "long",
    year: "numeric",
    month: "numeric",
    ...(d ? { day: "numeric" as const } : {}),
    timeZone: "Asia/Tokyo",
  }).formatToParts(new Date(Date.UTC(y, m - 1, d || 1)));
  const part = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const year = part("year") === "1" ? "元" : part("year");
  return `${part("era")}${year}年${part("month")}月${d ? `${part("day")}日` : ""}`;
}
export function dateLabel(value: string) {
  return value ? value.replaceAll("-", "/") : "—";
}
export function exceedsCertification(resident: Resident) {
  return (
    !!resident.planEndMonth &&
    !!resident.certificationExpiryMonth &&
    resident.planEndMonth >= resident.certificationExpiryMonth
  );
}
export function compareRoom(a: Resident, b: Resident) {
  return (
    a.room.localeCompare(b.room, "ja", { numeric: true }) ||
    a.chartNumber.localeCompare(b.chartNumber, "ja", { numeric: true })
  );
}
export function periodFor(resident: Resident, plan?: CarePlan) {
  return (
    plan?.effectivePeriodText ||
    `${monthLabel(resident.planStartMonth)} ～ ${monthLabel(resident.planEndMonth)}`
  );
}
export function blankResident(): Resident {
  return {
    id: "",
    chartNumber: "",
    room: "",
    name: "",
    insurer: "",
    careLevel: "",
    creationMonth: localMonth(),
    planStartMonth: "",
    planEndMonth: "",
    certificationExpiryMonth: "",
    admissionDate: "",
    admissionNote: "",
    physicalIndependence: "",
    cognitiveIndependence: "",
    restraint: false,
    careManager: "",
    notes: "",
    status: "active",
    revision: 0,
    updatedAt: "",
  };
}
export function blankPlan(
  residentId = "",
  targetMonth = localMonth(),
): CarePlan {
  return {
    id: "",
    residentId,
    targetMonth,
    creator: "",
    creationDate: "",
    printDate: "",
    meetingDate: "",
    careManager: "",
    effectivePeriodText: "",
    periodStartDate: "",
    periodEndDate: "",
    restraint: false,
    consentStatus: "未送付",
    meetingRound: 1,
    notes: "",
    revision: 0,
    updatedAt: "",
  };
}
