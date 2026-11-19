/** Keep queue changes outside React state updaters so StrictMode cannot duplicate answer effects. */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  addTrickyWord,
  removeTrickyWord,
  TRICKY_WORDS_STORAGE_KEY,
} from "@/lib/trickyWords";
import {
  readTrickyWordsStorage,
  writeTrickyWordsStorage,
} from "@/lib/trickyWordsStorage";
import type { TrickyWordsList } from "@/lib/trickyWords";
import type { ExerciseSnapshot } from "@/types";

export function useTrickyWords() {
  const [initial] = useState(() => readTrickyWordsStorage());
  const [list, setList] = useState(initial.list);
  const [warning, setWarning] = useState(initial.warning);
  const listRef = useRef(initial.list);
  const memoryOnly = useRef(!initial.persisted);

  const refresh = useCallback(() => {
    if (memoryOnly.current) return listRef.current;
    const read = readTrickyWordsStorage();
    if (read.persisted) {
      listRef.current = read.list;
      setList(read.list);
    } else {
      memoryOnly.current = true;
      setWarning(read.warning);
    }
    return listRef.current;
  }, []);

  const update = useCallback(
    (change: (current: TrickyWordsList) => TrickyWordsList) => {
      if (memoryOnly.current) {
        // A failed-storage visit stays in memory until reload. Do not later replace
        // another tab's newer persisted queue with our potentially divergent copy.
        const next = change(listRef.current);
        listRef.current = next;
        setList(next);
        return next;
      }
      const current = readTrickyWordsStorage();
      const base = current.persisted ? current.list : listRef.current;
      if (!current.persisted) {
        const next = change(base);
        listRef.current = next;
        memoryOnly.current = true;
        setList(next);
        setWarning(current.warning);
        return next;
      }
      const next = change(base);
      const result = writeTrickyWordsStorage(next);
      listRef.current = result.list;
      memoryOnly.current = !result.persisted;
      setList(result.list);
      setWarning(result.warning);
      return result.list;
    },
    []
  );

  const recordFirstAnswer = useCallback(
    (exercise: ExerciseSnapshot, index: number) => {
      const question = exercise.questions[index];
      const progress = exercise.questionProgress[index];
      if (!question || progress.attemptedOptions.length !== 1) return;
      if (exercise.kind === "tricky-words") {
        if (progress.firstAttemptCorrect)
          update(current => removeTrickyWord(current, question.id));
      } else if (!progress.firstAttemptCorrect) {
        update(current =>
          addTrickyWord(current, question, {
            releaseVersion: exercise.releaseVersion,
            collectionLabel: exercise.selection.collectionLabel,
            cefrLevel: exercise.selection.cefrLevel,
          })
        );
      }
    },
    [update]
  );

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === TRICKY_WORDS_STORAGE_KEY || event.key === null)
        refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  return { list, warning, refresh, recordFirstAnswer };
}
