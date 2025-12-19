import { useState, useCallback } from 'react';
import { TimelineSegment } from '../types';

interface HistoryState {
  past: TimelineSegment[][];
  present: TimelineSegment[];
  future: TimelineSegment[][];
}

export const useTimelineHistory = (initialState: TimelineSegment[]) => {
  const [history, setHistory] = useState<HistoryState>({
    past: [],
    present: initialState,
    future: []
  });

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const pushState = useCallback((newState: TimelineSegment[]) => {
    setHistory(curr => ({
      past: [...curr.past, curr.present],
      present: newState,
      future: [] // Clear future on new action
    }));
  }, []);

  const undo = useCallback(() => {
    setHistory(curr => {
      if (curr.past.length === 0) return curr;
      const previous = curr.past[curr.past.length - 1];
      const newPast = curr.past.slice(0, -1);
      return {
        past: newPast,
        present: previous,
        future: [curr.present, ...curr.future]
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory(curr => {
      if (curr.future.length === 0) return curr;
      const next = curr.future[0];
      const newFuture = curr.future.slice(1);
      return {
        past: [...curr.past, curr.present],
        present: next,
        future: newFuture
      };
    });
  }, []);

  // Special setter that acts like setState but pushes to history
  const setSegments = useCallback((
    newStateOrUpdater: TimelineSegment[] | ((prev: TimelineSegment[]) => TimelineSegment[])
  ) => {
    setHistory(curr => {
      const newState = typeof newStateOrUpdater === 'function' 
        ? newStateOrUpdater(curr.present) 
        : newStateOrUpdater;
      
      return {
        past: [...curr.past, curr.present],
        present: newState,
        future: []
      };
    });
  }, []);

  return {
    segments: history.present,
    setSegments,
    undo,
    redo,
    canUndo,
    canRedo,
    pushState // For manual pushes if needed
  };
};