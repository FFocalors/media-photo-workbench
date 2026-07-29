import { useEffect, useMemo, useRef, useState } from "react";

const RETRY_DELAYS_MS = [500, 1000, 2000];

function withRetryParam(src: string, attempt: number): string {
  if (attempt <= 0) return src;

  try {
    const url = new URL(src, window.location.origin);
    url.searchParams.set("retry", String(attempt));
    return url.toString();
  } catch {
    const separator = src.includes("?") ? "&" : "?";
    return `${src}${separator}retry=${attempt}`;
  }
}

export function RetryableImage({
  src,
  alt,
  className,
  loading,
  draggable
}: {
  src: string;
  alt: string;
  className?: string;
  /** Native lazy loading — used by the mobile photo wall so off-screen thumbs
      only load as they approach the viewport. Omit on desktop (unchanged). */
  loading?: "lazy" | "eager";
  draggable?: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const retryTimer = useRef<number | null>(null);

  useEffect(() => {
    setAttempt(0);
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }

    return () => {
      if (retryTimer.current !== null) {
        window.clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
    };
  }, [src]);

  const displaySrc = useMemo(() => withRetryParam(src, attempt), [attempt, src]);

  const handleError = () => {
    if (attempt >= RETRY_DELAYS_MS.length || retryTimer.current !== null) return;

    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = null;
      setAttempt((current) => current + 1);
    }, RETRY_DELAYS_MS[attempt]);
  };

  return (
    <img
      alt={alt}
      className={className}
      decoding="async"
      draggable={draggable}
      loading={loading}
      onError={handleError}
      src={displaySrc}
    />
  );
}
