import type { AppRole } from "./types";

export const ROLE_LABELS: Record<AppRole, string> = {
  member: "Member",
  qa: "QA Tester",
  leadqa: "QA Lead",
  dev: "Developer",
};

export const BUG_STAFF_ROLES: AppRole[] = ["qa", "leadqa", "dev"];

export function isBugStaff(role: AppRole | null | undefined): boolean {
  return role !== undefined && role !== null && BUG_STAFF_ROLES.includes(role);
}
