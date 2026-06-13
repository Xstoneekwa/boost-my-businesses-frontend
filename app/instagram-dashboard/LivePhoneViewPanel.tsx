"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  requestLiveViewToken,
  stopLiveView,
  type LiveViewSessionSafe,
} from "./live-view-client";
import { buildLiveViewFrameUrl, liveViewPanelMessage } from "./live-view-frame-data";

type LivePhoneViewPanelProps = {
  accountId: string;
  username: string;
  session: LiveViewSessionSafe;
  onClose: () => void;
  onSessionChange: (session: LiveViewSessionSafe | null) => void;
  onRefresh: () => Promise<void>;
};

const SCREENSHOT_POLL_MS = 2000;

export default function LivePhoneViewPanel({
  accountId,
  username,
  session,
  onClose,
  onSessionChange,
  onRefresh,
}: LivePhoneViewPanelProps) {
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [position, setPosition] = useState({ left: 96, top: 96 });
  const [size, setSize] = useState({ width: 420, height: 620 });
  const [message, setMessage] = useState(() =>
    liveViewPanelMessage({
      status: session.status,
      streamTransport: session.stream_transport,
      failureReason: session.failure_reason,
    }),
  );
  const [isBusy, setIsBusy] = useState(false);
  const [frameTick, setFrameTick] = useState(0);

  const isScreenshotPolling =
    session.status === "active" && session.stream_transport === "screenshot_polling";
  const showScreenshotStream = isScreenshotPolling && Boolean(session.live_view_session_id);
  const frameUrl = showScreenshotStream
    ? buildLiveViewFrameUrl({
        accountId,
        liveViewSessionId: session.live_view_session_id,
        cacheBuster: frameTick,
      })
    : null;

  useEffect(() => {
    setMessage(liveViewPanelMessage({
      status: session.status,
      streamTransport: session.stream_transport,
      failureReason: session.failure_reason,
    }));
  }, [session.failure_reason, session.status, session.stream_transport]);

  useEffect(() => {
    if (!showScreenshotStream) return undefined;
    const timer = window.setInterval(() => {
      setFrameTick((current) => current + 1);
    }, SCREENSHOT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [showScreenshotStream, session.live_view_session_id]);

  async function handleReconnect() {
    if (!session.live_view_session_id) return;
    if (session.stream_transport === "screenshot_polling") {
      setFrameTick((current) => current + 1);
      return;
    }
    setIsBusy(true);
    try {
      await requestLiveViewToken(session.live_view_session_id);
      setMessage("Stream token ready. LV-Web-2B will attach the WebRTC player here.");
    } catch (error) {
      if (error instanceof Error && error.name === "livekit_not_configured") {
        setMessage("LiveKit is not configured yet. Session foundation is ready.");
        return;
      }
      setMessage(error instanceof Error ? error.message : "Could not reconnect live view.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleClose() {
    setIsBusy(true);
    try {
      await stopLiveView({ accountId, liveViewSessionId: session.live_view_session_id });
      onSessionChange(null);
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not stop live view.");
    } finally {
      setIsBusy(false);
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest("[data-live-view-no-drag='true']")) return;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: position.left,
      top: position.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    if (!dragRef.current) return;
    setPosition({
      left: Math.max(12, dragRef.current.left + event.clientX - dragRef.current.x),
      top: Math.max(12, dragRef.current.top + event.clientY - dragRef.current.y),
    });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const title = [
    username || session.username,
    session.device_label || "Phone",
    session.clone_label || session.package_label || "clone",
  ].join(" · ");

  return (
    <section
      className="ig-live-view-panel"
      role="dialog"
      aria-modal="false"
      aria-label={`Live phone view for ${username}`}
      style={{
        left: position.left,
        top: position.top,
        width: size.width,
        height: size.height,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <header className="ig-live-view-panel-header">
        <div>
          <span>Live Phone View</span>
          <h3>{title}</h3>
          <p>Status: {session.status}</p>
        </div>
        <div className="ig-live-view-panel-actions" data-live-view-no-drag="true">
          <button type="button" onClick={() => void onRefresh()} disabled={isBusy}>Refresh</button>
          {session.stream_transport !== "screenshot_polling" ? (
            <button type="button" onClick={() => void handleReconnect()} disabled={isBusy}>Reconnect</button>
          ) : null}
          <button type="button" onClick={() => void handleClose()} disabled={isBusy}>Close</button>
        </div>
      </header>

      {showScreenshotStream && frameUrl ? (
        <div className="ig-live-view-stream" aria-label="Live phone screenshot stream">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={frameUrl}
            alt={`Live view for ${username}`}
            draggable={false}
            style={{ pointerEvents: "none", userSelect: "none", width: "100%", height: "auto" }}
          />
        </div>
      ) : (
        <div className="ig-live-view-placeholder">
          <strong>{message}</strong>
          <small>
            {session.stream_transport === "screenshot_polling"
              ? "View-only screenshot polling. No interactive controls are enabled."
              : "No video stream or interactive controls are enabled in LV-Web-1B."}
          </small>
          {session.run_active_at_start ? (
            <em>Run active - view only. Manual control can disrupt automation.</em>
          ) : null}
        </div>
      )}

      <span
        className="ig-live-view-resize"
        data-live-view-no-drag="true"
        onPointerDown={(event) => {
          const startX = event.clientX;
          const startY = event.clientY;
          const startWidth = size.width;
          const startHeight = size.height;
          function onMove(moveEvent: PointerEvent) {
            setSize({
              width: Math.max(320, startWidth + moveEvent.clientX - startX),
              height: Math.max(420, startHeight + moveEvent.clientY - startY),
            });
          }
          function onUp() {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
          }
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        }}
      />
    </section>
  );
}
