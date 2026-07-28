function shortRequestId(requestId: string) {
  return requestId ? requestId.slice(0, 8) : "";
}

export function runStartSuccessPayload({
  accountId,
  requestId,
  requestStatus,
  requestedRunType,
  idempotent = false,
}: {
  accountId: string;
  requestId: string;
  requestStatus: string;
  requestedRunType: string;
  idempotent?: boolean;
}) {
  return {
    started: !idempotent,
    idempotent,
    message: idempotent
      ? `Manual run already requested (${shortRequestId(requestId)} · ${requestStatus}).`
      : `Run request ${shortRequestId(requestId)} queued (${requestStatus}).`,
    account_id: accountId,
    request_id: requestId,
    status: requestStatus,
    requested_run_type: requestedRunType,
  };
}
