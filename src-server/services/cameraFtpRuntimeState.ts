let pendingActiveEventId = "";
const lifecycleReservations = new Map<string, string>();

export function getPendingCameraFtpEventId(): string {
  return pendingActiveEventId;
}

export function setPendingCameraFtpEventId(eventId: string): void {
  const normalized = eventId.trim();
  const lifecycleOperation = lifecycleReservations.get(normalized);
  if (lifecycleOperation) {
    throw {
      code: "FTP_EVENT_NOT_ALLOWED",
      message: `该活动正在执行${lifecycleOperation}，完成前不能切换为 FTP 接收活动。`
    };
  }
  pendingActiveEventId = normalized;
}

export function clearPendingCameraFtpEventId(eventId?: string): void {
  if (!eventId || pendingActiveEventId === eventId) pendingActiveEventId = "";
}

export function reserveCameraFtpEventLifecycle(eventId: string, operation: string): () => void {
  const normalized = eventId.trim();
  if (!normalized) return () => undefined;
  if (pendingActiveEventId === normalized) {
    throw {
      code: "FTP_EVENT_NOT_ALLOWED",
      message: "该活动正在切换为 FTP 接收活动，当前生命周期操作已取消。"
    };
  }
  if (lifecycleReservations.has(normalized)) {
    throw {
      code: "EVENT_OPERATION_IN_PROGRESS",
      message: `该活动已有${lifecycleReservations.get(normalized)}正在执行。`
    };
  }
  lifecycleReservations.set(normalized, operation);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (lifecycleReservations.get(normalized) === operation) lifecycleReservations.delete(normalized);
  };
}
