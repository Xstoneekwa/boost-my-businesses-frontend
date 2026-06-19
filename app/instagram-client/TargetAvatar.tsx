"use client";

import { useEffect, useState } from "react";
import { clientTargetAvatarImagePath } from "@/lib/instagram-client/client-target-avatar-path";

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
  avatarUrl?: string | null;
  avatarAvailable?: boolean;
  size?: number;
  className?: string;
  variant?: "target" | "ai";
};

export default function TargetAvatar({
  accountId,
  targetId,
  username,
  avatarUrl = null,
  avatarAvailable,
  size = 32,
  className = "",
  variant = "target",
}: TargetAvatarProps) {
  const [failed, setFailed] = useState(false);
  const normalizedUsername = username.replace(/^@+/, "");
  const [from, to] = avatarPalette(normalizedUsername || "?");
  const initial = (normalizedUsername || "?").charAt(0).toUpperCase();
  const shouldUseProxy = avatarAvailable !== false;
  const proxySrc = shouldUseProxy
    ? clientTargetAvatarImagePath(accountId, {
      targetId,
      username: normalizedUsername,
      avatarAvailable: avatarAvailable ?? Boolean(avatarUrl),
    }) ?? (avatarUrl?.startsWith("/api/") ? avatarUrl : null)
    : null;
  const baseClass = variant === "ai" ? "cd-ai-av" : "cd-tg2-av";
  const imageClass = variant === "ai" ? "cd-ai-av-img" : "cd-tg2-av-img";

  useEffect(() => {
    setFailed(false);
  }, [proxySrc, normalizedUsername]);

  if (proxySrc && !failed) {
    return (
      <span
        className={`${baseClass} ${imageClass}${className ? ` ${className}` : ""}`}
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
      className={`${baseClass}${className ? ` ${className}` : ""}`}
      style={{ background: `linear-gradient(135deg,${from},${to})`, width: size, height: size, minWidth: size }}
    >
      <i>{initial}</i>
    </span>
  );
}

export function AiCandidateAvatar({
  accountId,
  username,
  avatarUrl,
  avatarAvailable,
  size = 40,
}: {
  accountId: string;
  username: string;
  avatarUrl?: string | null;
  avatarAvailable?: boolean;
  size?: number;
}) {
  return (
    <TargetAvatar
      accountId={accountId}
      username={username}
      avatarUrl={avatarUrl}
      avatarAvailable={avatarAvailable}
      size={size}
      variant="ai"
    />
  );
}
