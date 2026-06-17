"use client";

import { useState } from "react";
import { clientTargetAvatarProxyPath } from "@/lib/instagram-dashboard/target-avatar-projection";

const AVPAL = [
  ["#f58529", "#dd2a7b"], ["#8a3ab9", "#cd486b"], ["#5a6cf5", "#e8a030"], ["#fbbf24", "#dd2a7b"],
  ["#34d399", "#5a6cf5"], ["#dd2a7b", "#fbbf24"], ["#e8a030", "#8a3ab9"], ["#5851db", "#e1306c"],
];

function avatarPalette(username: string) {
  return AVPAL[username.charCodeAt(0) % AVPAL.length];
}

type TargetAvatarProps = {
  accountId: string;
  targetId?: string | null;
  username: string;
  avatarAvailable?: boolean;
  size?: number;
  className?: string;
};

export default function TargetAvatar({
  accountId,
  targetId,
  username,
  avatarAvailable = false,
  size = 32,
  className = "",
}: TargetAvatarProps) {
  const [failed, setFailed] = useState(false);
  const normalizedUsername = username.replace(/^@+/, "");
  const [from, to] = avatarPalette(normalizedUsername || "?");
  const initial = (normalizedUsername || "?").charAt(0).toUpperCase();
  const proxySrc = avatarAvailable && targetId
    ? clientTargetAvatarProxyPath(accountId, targetId)
    : null;

  if (proxySrc && !failed) {
    return (
      <span
        className={`cd-tg2-av cd-tg2-av-img${className ? ` ${className}` : ""}`}
        style={{ width: size, height: size, minWidth: size }}
      >
        <img
          src={proxySrc}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  return (
    <span
      className={`cd-tg2-av${className ? ` ${className}` : ""}`}
      style={{ background: `linear-gradient(135deg,${from},${to})`, width: size, height: size, minWidth: size }}
    >
      <i>{initial}</i>
    </span>
  );
}
