import React, { useMemo, useRef, useEffect } from 'react';
import { TimelineSegment } from '../types';

interface TimelineProps {
  segments: TimelineSegment[];
  currentTime: number;
  totalDuration: number;
  zoomLevel: number; // pixels per second
  selectedSegmentId: string | null;
  onSeek: (time: number) => void;
  onSelectSegment: (id: string | null) => void;
}

const Timeline: React.FC<TimelineProps> = ({ 
  segments, 
  currentTime, 
  totalDuration, 
  zoomLevel,
  selectedSegmentId,
  onSeek,
  onSelectSegment
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate segment positions in pixels
  const renderedSegments = useMemo(() => {
    let currentStart = 0;
    return segments.map(seg => {
      const duration = seg.range.end - seg.range.start;
      const width = Math.max(duration * zoomLevel, 2); // Min width 2px visibility
      const left = currentStart * zoomLevel;
      currentStart += duration;
      
      return {
        ...seg,
        left,
        width,
        startTime: currentStart - duration
      };
    });
  }, [segments, zoomLevel]);

  const totalWidth = Math.max(totalDuration * zoomLevel, 100); // Ensure min width

  const handleSeek = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scrollLeft = containerRef.current.scrollLeft;
    const clickX = e.clientX - rect.left + scrollLeft;
    const time = Math.max(0, clickX / zoomLevel);
    onSeek(time);
  };

  return (
    <div className="h-64 border-t border-zinc-800 bg-zinc-900 flex flex-col select-none">
      {/* Time Ruler (Simplified) */}
      <div className="h-6 border-b border-zinc-800 bg-zinc-900/50 relative overflow-hidden flex text-[10px] text-zinc-500 font-mono items-end pb-1 px-2">
         Scale: 1s = {zoomLevel}px
      </div>

      <div 
        ref={containerRef}
        className="flex-1 relative overflow-x-auto overflow-y-hidden custom-scrollbar"
        onClick={(e) => {
            // Deselect if clicking empty space
            if (e.target === e.currentTarget) onSelectSegment(null);
        }}
      >
        <div 
          className="relative h-full bg-zinc-950 min-w-full"
          style={{ width: `${totalWidth}px` }}
        >
            {/* Click Capture Layer for Seek */}
            <div 
                className="absolute inset-0 z-10"
                onMouseDown={handleSeek}
            />

            {/* Playhead Line */}
            <div 
              className="absolute top-0 bottom-0 w-px bg-white z-30 pointer-events-none"
              style={{ left: `${currentTime * zoomLevel}px` }}
            >
              <div className="absolute -top-1 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-white"></div>
            </div>

            {/* Segments Track */}
            <div className="absolute top-8 left-0 right-0 h-24">
              {renderedSegments.map((seg) => (
                <div
                  key={seg.id}
                  className={`
                    absolute top-0 bottom-0 overflow-hidden group rounded-sm cursor-pointer z-20 transition-all border-r border-black/20
                    ${selectedSegmentId === seg.id ? 'ring-2 ring-white z-30' : 'hover:brightness-110'}
                  `}
                  style={{ 
                    left: `${seg.left}px`,
                    width: `${seg.width}px`,
                    backgroundColor: seg.color || '#3f3f46',
                    opacity: seg.isBest ? 1 : 0.65 // Dim duplicate takes slightly
                  }}
                  onClick={(e) => {
                    e.stopPropagation(); 
                    onSelectSegment(seg.id);
                  }}
                  title={`${seg.name} (Score: ${seg.score})`}
                >
                    {/* Inner Content */}
                    <div className="p-2 h-full flex flex-col justify-between relative">
                        {/* Waveform fake visualization */}
                        <div className="absolute inset-0 opacity-10 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNCIgaGVpZ2h0PSI0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxwYXRoIGQ9Ik0wIDNoNHYxSDB6IiBmaWxsPSIjMDAwIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiLz48L3N2Zz4=')]"></div>
                        
                        <div className="flex justify-between items-start z-10 gap-1">
                             <span className="text-[10px] text-white/90 truncate font-medium drop-shadow-md">
                                {seg.name}
                            </span>
                            
                            {/* Score Display */}
                            <span className={`
                                text-[9px] px-1 rounded font-mono
                                ${seg.score >= 90 ? 'bg-green-500/80 text-white' : 'bg-black/40 text-zinc-300'}
                            `}>
                                {seg.score}
                            </span>
                        </div>
                        
                        {/* Best Take Indicator */}
                        {seg.isBest && (
                            <div className="self-end text-yellow-300 text-[10px] drop-shadow-md z-10 font-bold bg-black/40 px-1 rounded-sm border border-yellow-500/30">
                                ★ BEST
                            </div>
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