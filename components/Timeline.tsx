import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { TimelineSegment } from '../types';

interface TimelineProps {
  segments: TimelineSegment[];
  currentTime: number;
  totalDuration: number;
  zoomLevel: number;
  selectedSegmentId: string | null;
  onSeek: (time: number) => void;
  onSelectSegment: (id: string | null) => void;
  onReorderSegments: (fromIndex: number, toIndex: number) => void;
  onResizeStart: () => void;
  onResizeSegment: (id: string, newStart: number, newEnd: number) => void;
  onResizeEnd: () => void;
  onToggleMute?: (id: string) => void;
}

// Minimum pixel movement before resize triggers
const MIN_RESIZE_DELTA = 3;

const Timeline: React.FC<TimelineProps> = ({
  segments,
  currentTime,
  totalDuration,
  zoomLevel,
  selectedSegmentId,
  onSeek,
  onSelectSegment,
  onReorderSegments,
  onResizeStart,
  onResizeSegment,
  onResizeEnd,
  onToggleMute
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
    type: 'move' | 'resize-left' | 'resize-right' | null;
    segmentId: string | null;
    startX: number;
    originalLeft: number;
    originalWidth: number;
    segmentIndex: number;
    resizeCommitted: boolean; // true once actual resize has begun
    originalStart: number;
    originalEnd: number;
  } | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  // Calculate segment positions - split segments with cuts into visual slices
  const renderedSegments = useMemo(() => {
    let currentLeft = 0;
    const result: Array<{
      id: string;
      segmentId: string;
      clipId: string;
      left: number;
      width: number;
      index: number;
      duration: number;
      range: { start: number; end: number };
      isBest: boolean;
      color: string;
      name: string;
      isCutPortion: boolean; // true if this slice is a cut (grayed out) portion
      isMuted: boolean; // true if the segment audio is muted
    }> = [];

    segments.forEach((seg, index) => {
      if (!seg.cuts || seg.cuts.length === 0) {
        // No cuts - render as single segment
        const duration = seg.range.end - seg.range.start;
        const width = Math.max(duration * zoomLevel, 20);
        result.push({
          id: `${seg.id}-full`,
          segmentId: seg.id,
          clipId: seg.clipId,
          left: currentLeft,
          width,
          index,
          duration,
          range: seg.range,
          isBest: seg.isBest,
          color: seg.color,
          name: seg.name,
          isCutPortion: false,
          isMuted: !!seg.isMuted
        });
        currentLeft += width;
      } else {
        // Has cuts - split into slices (normal parts + cut parts)
        const sortedCuts = [...seg.cuts].sort((a, b) => a.start - b.start);
        let currentTime = seg.range.start;
        let sliceIndex = 0;

        for (const cut of sortedCuts) {
          // Add normal portion before cut
          if (cut.start > currentTime) {
            const sliceDuration = cut.start - currentTime;
            const width = Math.max(sliceDuration * zoomLevel, 5);
            result.push({
              id: `${seg.id}-${sliceIndex}`,
              segmentId: seg.id,
              clipId: seg.clipId,
              left: currentLeft,
              width,
              index,
              duration: sliceDuration,
              range: { start: currentTime, end: cut.start },
              isBest: seg.isBest,
              color: seg.color,
              name: seg.name,
              isCutPortion: false,
              isMuted: !!seg.isMuted
            });
            currentLeft += width;
            sliceIndex++;
          }

          // Add the cut portion (grayed out)
          const cutDuration = cut.end - cut.start;
          const cutWidth = Math.max(cutDuration * zoomLevel, 5);
          result.push({
            id: `${seg.id}-cut-${sliceIndex}`,
            segmentId: seg.id,
            clipId: seg.clipId,
            left: currentLeft,
            width: cutWidth,
            index,
            duration: cutDuration,
            range: { start: cut.start, end: cut.end },
            isBest: seg.isBest,
            color: seg.color,
            name: seg.name,
            isCutPortion: true, // This is a cut portion
            isMuted: !!seg.isMuted
          });
          currentLeft += cutWidth;
          sliceIndex++;
          currentTime = cut.end;
        }

        // Add normal portion after last cut
        if (currentTime < seg.range.end) {
          const sliceDuration = seg.range.end - currentTime;
          const width = Math.max(sliceDuration * zoomLevel, 5);
          result.push({
            id: `${seg.id}-${sliceIndex}`,
            segmentId: seg.id,
            clipId: seg.clipId,
            left: currentLeft,
            width,
            index,
            duration: sliceDuration,
            range: { start: currentTime, end: seg.range.end },
            isBest: seg.isBest,
            color: seg.color,
            name: seg.name,
            isCutPortion: false,
            isMuted: !!seg.isMuted
          });
          currentLeft += width;
        }
      }
    });

    return result;
  }, [segments, zoomLevel]);

  const totalWidth = Math.max(totalDuration * zoomLevel, 100);

  // Debug: log when segments with cuts change
  useEffect(() => {
    const segsWithCuts = segments.filter(s => s.cuts && s.cuts.length > 0);
    if (segsWithCuts.length > 0) {
      console.log(`[Timeline] ${segsWithCuts.length} segments have cuts:`, segsWithCuts.map(s => ({
        id: s.id,
        cuts: s.cuts
      })));
    }
  }, [segments]);

  // Handle seek
  const handleSeek = (e: React.MouseEvent) => {
    if (dragState) return;
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scrollLeft = containerRef.current.scrollLeft;
    const clickX = e.clientX - rect.left + scrollLeft;
    const time = Math.max(0, clickX / zoomLevel);
    onSeek(time);
  };

  // Drag start for move
  const handleDragStart = useCallback((e: React.MouseEvent, seg: typeof renderedSegments[0]) => {
    e.stopPropagation();
    e.preventDefault();

    setDragState({
      type: 'move',
      segmentId: seg.id,
      startX: e.clientX,
      originalLeft: seg.left,
      originalWidth: seg.width,
      segmentIndex: seg.index,
      resizeCommitted: false,
      originalStart: seg.range.start,
      originalEnd: seg.range.end
    });
    onSelectSegment(seg.id);
  }, [onSelectSegment]);

  // Resize start (local handler)
  const handleResizeStartLocal = useCallback((e: React.MouseEvent, seg: typeof renderedSegments[0], side: 'left' | 'right') => {
    e.stopPropagation();
    e.preventDefault();

    setDragState({
      type: side === 'left' ? 'resize-left' : 'resize-right',
      segmentId: seg.id,
      startX: e.clientX,
      originalLeft: seg.left,
      originalWidth: seg.width,
      segmentIndex: seg.index,
      resizeCommitted: false,
      originalStart: seg.range.start,
      originalEnd: seg.range.end
    });
    onSelectSegment(seg.id);
  }, [onSelectSegment]);

  // Handle mouse move
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState || !containerRef.current) return;

    const deltaX = e.clientX - dragState.startX;
    const deltaTime = deltaX / zoomLevel;

    if (dragState.type === 'move') {
      // Calculate which position to drop at
      const currentX = e.clientX - containerRef.current.getBoundingClientRect().left + containerRef.current.scrollLeft;
      let accumulatedWidth = 0;
      let targetIndex = renderedSegments.length;

      for (let i = 0; i < renderedSegments.length; i++) {
        const midpoint = accumulatedWidth + renderedSegments[i].width / 2;
        if (currentX < midpoint) {
          targetIndex = i;
          break;
        }
        accumulatedWidth += renderedSegments[i].width;
      }

      // Adjust for dragging from original position
      if (targetIndex > dragState.segmentIndex) {
        targetIndex = Math.max(0, targetIndex);
      }

      setDropTargetIndex(targetIndex !== dragState.segmentIndex ? targetIndex : null);
    }
  }, [dragState, zoomLevel, renderedSegments]);

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    if (!dragState) return;

    if (dragState.type === 'move' && dropTargetIndex !== null) {
      onReorderSegments(dragState.segmentIndex, dropTargetIndex);
    } else if (dragState.type === 'resize-left' || dragState.type === 'resize-right') {
      // Commit resize to history if actual resize happened
      if (dragState.resizeCommitted) {
        onResizeEnd();
      }
    }

    setDragState(null);
    setDropTargetIndex(null);
  }, [dragState, dropTargetIndex, onReorderSegments, onResizeEnd]);

  // Handle resize drag
  const handleResizeDrag = useCallback((e: MouseEvent) => {
    if (!dragState || (dragState.type !== 'resize-left' && dragState.type !== 'resize-right')) return;

    const deltaX = e.clientX - dragState.startX;

    // Check minimum movement threshold for smoother feel
    if (Math.abs(deltaX) < MIN_RESIZE_DELTA && !dragState.resizeCommitted) {
      return;
    }

    // Call onResizeStart only once when actual resize begins
    if (!dragState.resizeCommitted) {
      onResizeStart();
      setDragState(prev => prev ? { ...prev, resizeCommitted: true } : null);
    }

    const deltaTime = deltaX / zoomLevel;

    if (dragState.type === 'resize-left') {
      const newStart = Math.max(0, dragState.originalStart + deltaTime);
      if (newStart < dragState.originalEnd - 0.1) {
        onResizeSegment(dragState.segmentId!, newStart, dragState.originalEnd);
      }
    } else {
      const newEnd = Math.max(dragState.originalStart + 0.1, dragState.originalEnd + deltaTime);
      onResizeSegment(dragState.segmentId!, dragState.originalStart, newEnd);
    }
  }, [dragState, zoomLevel, onResizeSegment, onResizeStart]);

  // Global mouse events for drag
  React.useEffect(() => {
    if (dragState) {
      const handleGlobalMove = (e: MouseEvent) => {
        if (dragState.type === 'resize-left' || dragState.type === 'resize-right') {
          handleResizeDrag(e);
        }
      };
      const handleGlobalUp = () => handleMouseUp();

      window.addEventListener('mousemove', handleGlobalMove);
      window.addEventListener('mouseup', handleGlobalUp);

      return () => {
        window.removeEventListener('mousemove', handleGlobalMove);
        window.removeEventListener('mouseup', handleGlobalUp);
      };
    }
  }, [dragState, handleMouseUp, handleResizeDrag]);

  return (
    <div className="h-64 border-t border-zinc-800 bg-zinc-900 flex flex-col select-none">
      {/* Time Ruler */}
      <div className="h-6 border-b border-zinc-800 bg-zinc-900/50 relative overflow-hidden flex text-[10px] text-zinc-500 font-mono items-end pb-1 px-2">
         Scale: 1s = {zoomLevel}px
      </div>

      <div
        ref={containerRef}
        className="flex-1 relative overflow-x-auto overflow-y-hidden custom-scrollbar"
        onClick={(e) => {
            if (e.target === e.currentTarget) onSelectSegment(null);
        }}
        onMouseMove={dragState?.type === 'move' ? handleMouseMove : undefined}
        onMouseUp={dragState?.type === 'move' ? handleMouseUp : undefined}
        onMouseLeave={dragState?.type === 'move' ? handleMouseUp : undefined}
      >
        <div
          className="relative h-full bg-zinc-950 min-w-full"
          style={{ width: `${totalWidth}px` }}
        >
            {/* Click Layer for Seek */}
            <div
                className="absolute inset-0 z-10"
                onMouseDown={handleSeek}
            />

            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-px bg-white z-30 pointer-events-none"
              style={{ left: `${currentTime * zoomLevel}px` }}
            >
              <div className="absolute -top-1 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-white"></div>
            </div>

            {/* Drop Indicator */}
            {dropTargetIndex !== null && (
              <div
                className="absolute top-8 bottom-8 w-1 bg-blue-500 z-40 rounded"
                style={{
                  left: dropTargetIndex === 0 ? 0 :
                    renderedSegments.slice(0, dropTargetIndex).reduce((sum, s) => sum + s.width, 0) - 2
                }}
              />
            )}

            {/* Segments Track */}
            <div className="absolute top-8 left-0 right-0 h-24">
              {renderedSegments.map((seg) => (
                <div
                  key={seg.id}
                  className={`
                    absolute top-0 bottom-0 overflow-hidden group rounded-sm z-20 transition-shadow
                    ${selectedSegmentId === seg.id ? 'ring-2 ring-white z-30' : 'hover:brightness-110'}
                    ${dragState?.segmentId === seg.id && dragState.type === 'move' ? 'opacity-50' : ''}
                  `}
                  style={{
                    left: `${seg.left}px`,
                    width: `${seg.width}px`,
                    backgroundColor: seg.color || '#3f3f46',
                    opacity: seg.isBest ? 1 : 0.65,
                    filter: seg.isCutPortion ? 'brightness(0.4)' : seg.isMuted ? 'saturate(0.3) brightness(0.7)' : 'none',
                    cursor: dragState ? 'grabbing' : 'grab'
                  }}
                  onMouseDown={(e) => handleDragStart(e, seg)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!dragState) onSelectSegment(seg.id);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (onToggleMute) onToggleMute(seg.segmentId);
                  }}
                  title={seg.isMuted ? `[已剪切] ${seg.name}` : seg.isCutPortion ? `[已剪切] ${seg.name}` : seg.name}
                >
                    {/* Left Resize Handle - only for non-cut portions */}
                    {!seg.isCutPortion && (
                      <div
                        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/30 z-40 group-hover:bg-white/10"
                        onMouseDown={(e) => handleResizeStartLocal(e, seg, 'left')}
                      />
                    )}

                    {/* Right Resize Handle - only for non-cut portions */}
                    {!seg.isCutPortion && (
                      <div
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/30 z-40 group-hover:bg-white/10"
                        onMouseDown={(e) => handleResizeStartLocal(e, seg, 'right')}
                      />
                    )}

                    {/* Content */}
                    <div className="p-2 h-full flex flex-col justify-start relative pointer-events-none">
                        {seg.isCutPortion ? (
                          <>
                            {/* Strikethrough line for cut portions */}
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="w-full h-0.5 bg-zinc-500"></div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="absolute inset-0 opacity-10 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNCIgaGVpZ2h0PSI0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxwYXRoIGQ9Ik0wIDNoNHYxSDB6IiBmaWxsPSIjMDAwIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiLz48L3N2Zz4=')]"></div>
                            <div className="flex items-center gap-1 z-10">
                              {seg.isMuted && (
                                <svg className="w-3 h-3 text-zinc-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z"/>
                                </svg>
                              )}
                              <span className="text-[10px] text-white/90 truncate font-medium drop-shadow-md">
                                  {seg.name}
                              </span>
                            </div>
                          </>
                        )}
                    </div>
                </div>
              ))}

              {renderedSegments.length === 0 && (
                <div className="absolute left-4 top-4 text-zinc-600 text-sm italic pointer-events-none">
                   Drag clips here or use "Smart Cut"
                </div>
              )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default Timeline;
