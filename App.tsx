import React, { useState, useRef, useEffect, useCallback } from 'react';
import MediaPool from './components/MediaPool';
import Timeline from './components/Timeline';
import { VideoDisplay } from './components/Player';
import Button from './components/Button';
import { VideoClip, ProcessingStatus, TimelineSegment, AnalysisProgress } from './types';
import { analyzeClipsWithGemini } from './services/geminiService';
import { GROUP_COLORS } from './constants';
import { useTimelineHistory } from './hooks/useTimelineHistory';

// Simple ID gen
const generateId = () => Math.random().toString(36).substr(2, 9);

export default function App() {
  // --- State ---
  const [clips, setClips] = useState<VideoClip[]>([]);
  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [previewClipId, setPreviewClipId] = useState<string | null>(null); // For raw media pool preview
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress>({ percent: 0, message: '' });
  
  // Timeline State managed by History Hook
  const { 
    segments: timelineSegments, 
    setSegments: setTimelineSegments, 
    undo, 
    redo, 
    canUndo, 
    canRedo 
  } = useTimelineHistory([]);

  // Editor State
  const [timelineTime, setTimelineTime] = useState(0); 
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(20); // pixels per second
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number>();

  // --- Helpers ---
  const totalDuration = timelineSegments.reduce((acc, seg) => acc + (seg.range.end - seg.range.start), 0);

  // Format Time Helper
  const formatTime = (seconds: number) => {
    const date = new Date(Math.max(0, seconds * 1000));
    const mm = date.getUTCMinutes().toString().padStart(2, '0');
    const ss = date.getUTCSeconds().toString().padStart(2, '0');
    const ms = Math.floor(date.getUTCMilliseconds() / 10).toString().padStart(2, '0');
    return `${mm}:${ss}.${ms}`;
  };

  // --- Handlers: Editing ---

  const handleDelete = useCallback(() => {
    if (!selectedSegmentId) return;
    setTimelineSegments(prev => prev.filter(seg => seg.id !== selectedSegmentId));
    setSelectedSegmentId(null);
  }, [selectedSegmentId, setTimelineSegments]);

  const handleSplit = useCallback(() => {
    // 1. Find segment under playhead
    let accumulatedTime = 0;
    const splitTargetIndex = timelineSegments.findIndex(seg => {
      const duration = seg.range.end - seg.range.start;
      const isTarget = timelineTime >= accumulatedTime && timelineTime < accumulatedTime + duration;
      accumulatedTime += duration;
      return isTarget;
    });

    if (splitTargetIndex === -1) return;

    const originalSeg = timelineSegments[splitTargetIndex];
    // Re-calculate start time of this segment
    const segmentStartTime = timelineSegments.slice(0, splitTargetIndex).reduce((acc, s) => acc + (s.range.end - s.range.start), 0);
    const offset = timelineTime - segmentStartTime;
    
    // Safety check: don't split if too close to edges (< 0.1s)
    if (offset < 0.1 || offset > (originalSeg.range.end - originalSeg.range.start - 0.1)) return;

    const splitPoint = originalSeg.range.start + offset;

    const newSeg1: TimelineSegment = { ...originalSeg, id: generateId(), range: { ...originalSeg.range, end: splitPoint } };
    const newSeg2: TimelineSegment = { ...originalSeg, id: generateId(), range: { ...originalSeg.range, start: splitPoint } };

    const newSegments = [...timelineSegments];
    newSegments.splice(splitTargetIndex, 1, newSeg1, newSeg2);
    
    setTimelineSegments(newSegments);
    // Select the second part after split
    setSelectedSegmentId(newSeg2.id);

  }, [timelineSegments, timelineTime, setTimelineSegments]);

  // --- Handlers: Playback & Upload ---

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newClips: VideoClip[] = Array.from(e.target.files).map((item) => {
        const file = item as File;
        return {
          id: generateId(),
          file,
          url: URL.createObjectURL(file),
          name: file.name,
          duration: 0,
          status: 'loading' as const
        };
      });
      setClips(prev => [...prev, ...newClips]);
    }
  };

  useEffect(() => {
    clips.forEach(clip => {
      if (clip.status === 'loading' && clip.duration === 0) {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
          setClips(prev => prev.map(c => c.id === clip.id ? { ...c, duration: video.duration, status: 'ready' as const } : c));
        };
        video.onerror = () => {
          setClips(prev => prev.map(c => c.id === clip.id ? { ...c, status: 'error' as const } : c));
        };
        video.src = clip.url;
      }
    });
  }, [clips]);

  // Check if all clips are ready (not loading)
  const allClipsReady = clips.length > 0 && clips.every(clip => clip.status !== 'loading');

  const handleAnalyze = async () => {
    if (clips.length === 0) return;
    setStatus(ProcessingStatus.ANALYZING);
    setAnalysisProgress({ percent: 0, message: 'Preparing videos...' });

    // Progress callback from service - show actual stage info
    const stages: Record<string, number> = {
      'Uploading': 20,
      'Waiting': 40,
      'File status': 50,
      'AI analyzing': 70,
      'Encoding': 30,
    };

    const updateProgress = (message: string) => {
      // Find matching stage for percent estimate
      let percent = 10;
      for (const [key, value] of Object.entries(stages)) {
        if (message.includes(key)) {
          percent = value;
          break;
        }
      }
      setAnalysisProgress({ percent, message });
    };

    try {
      const analyses = await analyzeClipsWithGemini(clips, updateProgress);
      setAnalysisProgress({ percent: 95, message: 'Building timeline...' });

      const groupColors: Record<string, string> = {};
      let colorIndex = 0;

      const updatedClips = clips.map(clip => {
        const analysis = analyses[clip.id];
        if (!analysis) return clip;
        
        // Assign color based on first segment's group if available, or just a default
        analysis.segments.forEach(seg => {
             if (!groupColors[seg.groupId]) {
                 groupColors[seg.groupId] = GROUP_COLORS[colorIndex % GROUP_COLORS.length];
                 colorIndex++;
             }
        });

        return {
          ...clip,
          analysis: analysis,
          status: 'done' as const
        };
      });

      setClips(updatedClips);

      // Auto-Cut Logic:
      // Keep ALL segments with exact timestamps (no padding to avoid overlap)
      const newSegments: TimelineSegment[] = [];

      console.log('\n=== Building Timeline ===');
      console.log(`Clips with analysis: ${updatedClips.filter(c => c.analysis).length}/${updatedClips.length}`);

      updatedClips.forEach(clip => {
          if (!clip.analysis) {
              console.log(`⚠️ Clip "${clip.name}" (id=${clip.id}) has NO analysis`);
              return;
          }

          console.log(`\n📹 Clip: ${clip.name}`);
          console.log(`   ID: ${clip.id}`);
          console.log(`   Duration: ${clip.duration}s`);
          console.log(`   Segments: ${clip.analysis.segments.length}`);

          const sortedSegments = [...clip.analysis.segments].sort((a, b) => a.start - b.start);

          sortedSegments.forEach((seg, idx) => {
              console.log(`   [${idx}] ${seg.start.toFixed(1)}s-${seg.end.toFixed(1)}s | group=${seg.groupId} | best=${seg.isBest} | "${seg.text.substring(0, 30)}..."`);

              newSegments.push({
                  id: generateId(),
                  clipId: clip.id,
                  range: { start: seg.start, end: seg.end },
                  isBest: seg.isBest,
                  score: seg.score,
                  color: groupColors[seg.groupId] || '#ccc',
                  name: clip.name,
                  transcript: seg.text
              });
          });
      });

      const totalDur = newSegments.reduce((acc, s) => acc + (s.range.end - s.range.start), 0);
      console.log(`\n=== Timeline Result ===`);
      console.log(`Total segments: ${newSegments.length}`);
      console.log(`Total duration: ${totalDur.toFixed(1)}s`);

      setTimelineSegments(newSegments);
      setAnalysisProgress({ percent: 100, message: 'Complete!' });
      setStatus(ProcessingStatus.COMPLETED);
    } catch (err: any) {
      console.error(err);
      setAnalysisProgress({ percent: 0, message: '' });
      setStatus(ProcessingStatus.ERROR);
      alert("Analysis failed: " + (err?.message || err));
    }
  };

  // Toggle Play Logic
  const togglePlay = useCallback(() => {
    if (isPlaying) {
        setIsPlaying(false);
    } else {
        // If in timeline mode and at end, restart
        if (!previewClipId && timelineTime >= totalDuration && totalDuration > 0) {
            setTimelineTime(0);
        }
        setIsPlaying(true);
    }
  }, [isPlaying, timelineTime, totalDuration, previewClipId]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
            if (canRedo) redo();
        } else {
            if (canUndo) undo();
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
          handleDelete();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
          handleSplit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, undo, redo, canUndo, canRedo, handleDelete, handleSplit]);


  // Timeline Sync Loop (Only active for Timeline Mode)
  useEffect(() => {
    if (isPlaying && !previewClipId) {
        let lastTimestamp = performance.now();
        const tick = (now: number) => {
            const delta = (now - lastTimestamp) / 1000;
            lastTimestamp = now;
            setTimelineTime(prev => {
                const next = prev + delta;
                if (next >= totalDuration) {
                    setIsPlaying(false);
                    return totalDuration;
                }
                return next;
            });
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
    } else {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
    }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isPlaying, totalDuration, previewClipId]);


  // Video Source Sync
  const getCurrentSegmentAndOffset = useCallback((time: number) => {
      let accumulated = 0;
      for (const seg of timelineSegments) {
          const duration = seg.range.end - seg.range.start;
          if (time >= accumulated && time < accumulated + duration) {
              return { segment: seg, offset: time - accumulated };
          }
          accumulated += duration;
      }
      return null;
  }, [timelineSegments]);

  const timelineData = getCurrentSegmentAndOffset(timelineTime);
  const activeClip = previewClipId 
    ? clips.find(c => c.id === previewClipId) 
    : (timelineData ? clips.find(c => c.id === timelineData.segment.clipId) : null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (previewClipId) {
        // --- PREVIEW MODE ---
        if (activeClip && video.getAttribute('src') !== activeClip.url) {
            video.src = activeClip.url;
            video.currentTime = 0;
            // Don't auto play on switch, wait for user
            setIsPlaying(false);
        }
        
        // Handle Playback State
        if (isPlaying && video.paused) {
            video.play().catch(e => console.log("Play interrupted", e));
        } else if (!isPlaying && !video.paused) {
            video.pause();
        }

        // Optional: Sync back ended state
        video.onended = () => setIsPlaying(false);

    } else if (timelineData && activeClip) {
        // --- TIMELINE MODE ---
        const desiredTime = timelineData.segment.range.start + timelineData.offset;
        
        if (video.getAttribute('src') !== activeClip.url) {
            video.src = activeClip.url;
            video.currentTime = desiredTime;
            if (isPlaying) video.play().catch(() => {});
        } else {
             // Sync drift
             if (Math.abs(video.currentTime - desiredTime) > 0.3) {
                 video.currentTime = desiredTime;
             }
             if (isPlaying && video.paused) video.play().catch(() => {});
             if (!isPlaying && !video.paused) video.pause();
        }
        
        video.onended = null; // Timeline handles ending via RAF loop
    } else {
        // Nothing
        if (!activeClip) video.src = "";
    }
  }, [timelineData, activeClip, isPlaying, previewClipId]);

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
      
      {/* 1. Header */}
      <header className="h-12 border-b border-zinc-800 flex items-center px-4 justify-between bg-zinc-900 shrink-0">
         <div className="flex items-center gap-3">
             <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-purple-600 rounded-md shadow-lg"></div>
             <h1 className="font-bold text-sm tracking-wide text-zinc-100">CursorCut AI</h1>
         </div>
         <div className="flex items-center gap-2">
             <Button variant="secondary" size="sm" className="text-xs">Export Video</Button>
         </div>
      </header>

      {/* 2. Main Workspace */}
      <div className="flex-1 flex overflow-hidden">
         
         {/* Sidebar: Media Pool */}
         <MediaPool
            clips={clips}
            onUpload={handleUpload}
            onAnalyze={handleAnalyze}
            isProcessing={status === ProcessingStatus.ANALYZING}
            allClipsReady={allClipsReady}
            analysisProgress={analysisProgress}
            selectedClipId={previewClipId}
            onSelectClip={(id) => {
                setPreviewClipId(id);
                setIsPlaying(false);
            }}
         />

         {/* Center: Stage & Timeline */}
         <div className="flex-1 flex flex-col min-w-0 bg-zinc-950">
            
            {/* Viewer Stage */}
            <div className="flex-1 flex items-center justify-center p-4 relative" onClick={() => setPreviewClipId(null)}>
                <div className="aspect-video w-full max-w-4xl max-h-full bg-black shadow-2xl ring-1 ring-zinc-800 rounded-lg overflow-hidden relative group">
                   <VideoDisplay ref={videoRef} src={activeClip?.url} onUpload={handleUpload} />
                   
                   {/* Info Overlay */}
                   {activeClip?.analysis && !previewClipId && timelineData?.segment && (
                       <div className="absolute top-4 left-4 max-w-md pointer-events-none">
                           <div className="backdrop-blur-md bg-black/60 border border-white/10 rounded-lg p-3 shadow-lg">
                               <div className="flex items-center gap-2 mb-1">
                                   <div className="w-2 h-2 rounded-full animate-pulse" style={{background: timelineData.segment.color}}></div>
                                   <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider">AI Transcript</span>
                                   <span className="text-[9px] text-zinc-500 ml-auto">
                                     Source: {timelineData.segment.range.start.toFixed(1)}s - {timelineData.segment.range.end.toFixed(1)}s
                                   </span>
                               </div>
                               {timelineData.segment.transcript && (
                                 <p className="text-sm text-white font-medium leading-relaxed">
                                     "{timelineData.segment.transcript}"
                                 </p>
                               )}
                           </div>
                       </div>
                   )}
                   
                   {/* Preview Indicator */}
                   {previewClipId && (
                       <div className="absolute top-4 right-4 bg-blue-600 text-white text-[10px] px-2 py-1 rounded font-bold uppercase tracking-wider shadow">
                           Preview Mode
                       </div>
                   )}
                </div>
            </div>

            {/* Toolbar */}
            <div className="h-12 bg-zinc-900 border-t border-zinc-800 flex items-center justify-between px-4 shrink-0 select-none">
                
                {/* Left: Undo/Redo */}
                <div className="flex items-center gap-1">
                    <button 
                        onClick={undo} disabled={!canUndo}
                        className="p-2 text-zinc-400 hover:text-white disabled:opacity-30 hover:bg-zinc-800 rounded transition"
                        title="Undo (Ctrl+Z)"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>
                    </button>
                    <button 
                        onClick={redo} disabled={!canRedo}
                        className="p-2 text-zinc-400 hover:text-white disabled:opacity-30 hover:bg-zinc-800 rounded transition"
                        title="Redo (Ctrl+Shift+Z)"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13"/></svg>
                    </button>
                </div>

                {/* Center: Playback & Time */}
                <div className="flex items-center gap-4 bg-zinc-950/50 rounded-full px-4 py-1.5 border border-zinc-800">
                    <span className="font-mono text-xs text-zinc-500 w-16 text-right">
                        {previewClipId ? '--:--' : formatTime(timelineTime)}
                    </span>
                    
                    <button 
                        onClick={togglePlay}
                        className="text-white hover:text-blue-400 transition transform active:scale-95"
                    >
                        {isPlaying ? (
                             <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                        ) : (
                             <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                        )}
                    </button>
                    
                    <span className="font-mono text-xs text-zinc-600 w-16">
                        {previewClipId ? '--:--' : formatTime(totalDuration)}
                    </span>
                </div>

                {/* Right: Tools & Zoom */}
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1 border-r border-zinc-800 pr-4">
                        <button 
                            onClick={handleSplit}
                            className="p-2 text-zinc-400 hover:text-blue-400 hover:bg-zinc-800 rounded transition"
                            title="Split (Ctrl+B)"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>
                        </button>
                        <button 
                            onClick={handleDelete}
                            disabled={!selectedSegmentId}
                            className="p-2 text-zinc-400 hover:text-red-400 disabled:opacity-30 hover:bg-zinc-800 rounded transition"
                            title="Delete (Backspace)"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-600"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                        <input 
                           type="range" 
                           min="5" 
                           max="100" 
                           value={zoomLevel} 
                           onChange={(e) => setZoomLevel(Number(e.target.value))}
                           className="w-24 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-600"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                    </div>
                </div>
            </div>

            {/* Timeline Area */}
            <Timeline 
                segments={timelineSegments}
                currentTime={timelineTime}
                totalDuration={totalDuration || 60}
                zoomLevel={zoomLevel}
                selectedSegmentId={selectedSegmentId}
                onSeek={(time) => {
                    setTimelineTime(time);
                    setPreviewClipId(null); // Switch to timeline mode on seek
                }}
                onSelectSegment={(id) => {
                    setSelectedSegmentId(id);
                    setPreviewClipId(null); // Switch to timeline mode on select
                }}
            />
         </div>
      </div>
    </div>
  );
}