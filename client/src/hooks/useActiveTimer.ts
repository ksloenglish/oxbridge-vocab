/** Oxbridge Ledger: active-visible-time timer with centisecond display and resumable persistence commits. */
import { useCallback, useEffect, useRef, useState } from "react";

export function useActiveTimer(
  active: boolean,
  initialMs: number,
  onCommit: (elapsedMs: number) => void,
  sessionKey: string | null,
) {
  const baseMsRef = useRef(initialMs);
  const startedAtRef = useRef<number | null>(null);
  const lastPersistedRef = useRef(initialMs);
  const onCommitRef = useRef(onCommit);
  const [displayMs, setDisplayMs] = useState(initialMs);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    baseMsRef.current = initialMs;
    startedAtRef.current = null;
    lastPersistedRef.current = initialMs;
    setDisplayMs(initialMs);
  }, [sessionKey]);

  useEffect(() => {
    if (!active) {
      baseMsRef.current = initialMs;
      lastPersistedRef.current = initialMs;
      setDisplayMs(initialMs);
    }
  }, [active, initialMs]);

  const currentValue = useCallback(() => {
    if (startedAtRef.current === null) return baseMsRef.current;
    return baseMsRef.current + performance.now() - startedAtRef.current;
  }, []);

  const commit = useCallback(() => {
    const value = currentValue();
    baseMsRef.current = value;
    startedAtRef.current = null;
    lastPersistedRef.current = value;
    setDisplayMs(value);
    onCommitRef.current(value);
    return value;
  }, [currentValue]);

  useEffect(() => {
    if (!active) return;

    const start = () => {
      if (
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        startedAtRef.current === null
      ) {
        startedAtRef.current = performance.now();
      }
    };
    const pause = () => {
      if (startedAtRef.current !== null) commit();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") start();
      else pause();
    };

    start();
    const interval = window.setInterval(() => {
      const value = currentValue();
      setDisplayMs(value);
      if (value - lastPersistedRef.current >= 1000) {
        lastPersistedRef.current = value;
        onCommitRef.current(value);
      }
    }, 37);

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", start);
    window.addEventListener("blur", pause);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", start);
      window.removeEventListener("blur", pause);
      pause();
    };
  }, [active, commit, currentValue, sessionKey]);

  return { elapsedMs: displayMs, commit };
}
