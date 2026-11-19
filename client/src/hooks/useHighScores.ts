/** Compact browser-local top ten, recorded only by the explicit Finish transition. */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  addHighScore,
  createHighScore,
  HIGH_SCORES_STORAGE_KEY,
  rankForSession,
} from "@/lib/highScores";
import {
  readHighScoresStorage,
  writeHighScoresStorage,
} from "@/lib/highScoresStorage";
import type { ExerciseSnapshot } from "@/types";

export interface HighScoreOutcome {
  rank: number | null;
  persisted: boolean;
}

export function useHighScores() {
  const [initial] = useState(() => readHighScoresStorage());
  const [list, setList] = useState(initial.list);
  const [warning, setWarning] = useState(initial.warning);
  const listRef = useRef(initial.list);
  const memoryOnly = useRef(!initial.persisted);
  const recordedSessions = useRef(new Set<string>());

  const refresh = useCallback(() => {
    if (memoryOnly.current) return listRef.current;
    const read = readHighScoresStorage();
    if (read.persisted) {
      listRef.current = read.list;
      setList(read.list);
    } else {
      memoryOnly.current = true;
      setWarning(read.warning);
    }
    return listRef.current;
  }, []);

  const recordCompleted = useCallback(
    (exercise: ExerciseSnapshot): HighScoreOutcome => {
      const entry = createHighScore(exercise);
      if (!entry || recordedSessions.current.has(exercise.sessionId)) {
        return { rank: null, persisted: !memoryOnly.current };
      }
      recordedSessions.current.add(exercise.sessionId);

      let base = listRef.current;
      if (!memoryOnly.current) {
        const read = readHighScoresStorage();
        if (read.persisted) base = read.list;
        else {
          memoryOnly.current = true;
          setWarning(read.warning);
        }
      }
      // Another render/tab may already have recorded this exact session.
      if (
        base.entries.some(existing => existing.sessionId === entry.sessionId)
      ) {
        listRef.current = base;
        setList(base);
        return { rank: null, persisted: !memoryOnly.current };
      }
      const next = addHighScore(base, entry);
      if (memoryOnly.current) {
        listRef.current = next;
        setList(next);
        return {
          rank: rankForSession(next, entry.sessionId),
          persisted: false,
        };
      }
      const saved = writeHighScoresStorage(next);
      listRef.current = saved.list;
      memoryOnly.current = !saved.persisted;
      setList(saved.list);
      setWarning(saved.warning);
      return {
        rank: rankForSession(saved.list, entry.sessionId),
        persisted: saved.persisted,
      };
    },
    []
  );

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === HIGH_SCORES_STORAGE_KEY || event.key === null)
        refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  return { list, warning, refresh, recordCompleted };
}
