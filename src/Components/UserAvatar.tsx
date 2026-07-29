import { useEffect, useState } from "react";
import "./UserAvatar.css";

interface UserAvatarProps {
  avatarUrl: string | null;
  displayName: string;
  size?: number;
  className?: string;
}

function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

export default function UserAvatar({
  avatarUrl,
  displayName,
  size = 34,
  className = "",
}: UserAvatarProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [avatarUrl]);

  const classes = ["user-avatar", className].filter(Boolean).join(" ");
  const style = { width: size, height: size, minWidth: size };

  if (avatarUrl && !failed) {
    return (
      <span className={classes} style={style} aria-hidden="true">
        <img
          src={avatarUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  return (
    <span className={`${classes} user-avatar-fallback`} style={style} aria-hidden="true">
      {initials(displayName)}
    </span>
  );
}
