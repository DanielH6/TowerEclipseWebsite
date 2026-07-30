import type { AppRole } from "../types";
import { ROLE_LABELS } from "../roles";
import "./RoleBadge.css";

export default function RoleBadge({
  role,
  label,
  account = false,
}: {
  role: AppRole;
  label?: string;
  account?: boolean;
}) {
  return (
    <span
      className={`role-badge${account ? " role-badge--account" : ""}`}
      data-role={role}
    >
      {label ?? ROLE_LABELS[role]}
    </span>
  );
}
