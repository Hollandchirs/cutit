import React from 'react';
import { VideoClip, AnalysisProgress } from '../types';
import Button from './Button';

interface MediaPoolProps {
  clips: VideoClip[];
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAnalyze: () => void;
  isProcessing: boolean;
  allClipsReady: boolean;
  analysisProgress: AnalysisProgress;
  selectedClipId: string | null;
  onSelectClip: (id: string) => void;
}

const MediaPool: React.FC<MediaPoolProps> = ({
  clips,
  onUpload,
  onAnalyze,
  isProcessing,
  allClipsReady,
  analysisProgress,
  selectedClipId,
  onSelectClip
}) => {
  return (
    <div className="w-80 border-r border-zinc-800 bg-zinc-900/50 flex flex-col h-full">
      <div className="p-4 border-b border-zinc-800 flex justify-between items-center">
        <div>
          <h2 className="text-zinc-100 font-semibold text-sm">Project Files</h2>
          <p className="text-zinc-500 text-[10px]">{clips.length} clips</p>
        </div>
        <label className="cursor-pointer p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-white transition">
          <input
            type="file"
            multiple
            accept="video/*"
            onChange={onUpload}
            className="hidden"
          />
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path>
          </svg>
        </label>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {clips.map((clip) => (
          <div 
            key={clip.id}
            onClick={() => onSelectClip(clip.id)}
            className={`
              relative flex items-start gap-3 p-2 rounded-md cursor-pointer group transition-all
              ${selectedClipId === clip.id ? 'bg-zinc-800 ring-1 ring-zinc-700' : 'hover:bg-zinc-800/50'}
            `}
          >
            {/* Thumbnail with Loading State */}
            <div className="w-16 h-10 bg-black rounded flex-shrink-0 flex items-center justify-center overflow-hidden border border-zinc-800 relative">
               <video src={clip.url} className="w-full h-full object-cover opacity-50" />
               {clip.status === 'loading' ? (
                 <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                   <svg className="animate-spin h-5 w-5 text-blue-500" viewBox="0 0 24 24">
                     <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none"></circle>
                     <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                   </svg>
                 </div>
               ) : (
                 <span className="absolute text-[9px] bottom-0 right-0 bg-black/80 px-1 text-zinc-300 font-mono">
                   {Math.round(clip.duration)}s
                 </span>
               )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-start">
                <p className={`text-xs font-medium truncate ${selectedClipId === clip.id ? 'text-zinc-100' : 'text-zinc-400'}`}>
                  {clip.name}
                </p>
                {clip.analysis?.isBestTake && (
                   <span className="text-yellow-400">★</span>
                )}
              </div>
              
              {clip.analysis && (
                <div className="mt-1 flex items-center gap-2">
                  <div 
                    className="w-2 h-2 rounded-full" 
                    style={{ backgroundColor: clip.color }} 
                    title={`Group: ${clip.analysis.groupId}`}
                  />
                  <span className="text-[10px] text-zinc-500 truncate">
                    Score: {clip.analysis.score}/100
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}

        {clips.length === 0 && (
          <div className="text-center py-10 text-zinc-600 text-xs">
            No clips imported.
          </div>
        )}
      </div>

      <div className="p-4 border-t border-zinc-800 space-y-2">
         {isProcessing && (
           <div className="space-y-1">
             <div className="flex justify-between text-[10px] text-zinc-400">
               <span>{analysisProgress.message}</span>
               <span>{Math.round(analysisProgress.percent)}%</span>
             </div>
             <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
               <div
                 className="h-full bg-blue-500 transition-all duration-300 ease-out"
                 style={{ width: `${analysisProgress.percent}%` }}
               />
             </div>
           </div>
         )}
         <Button
            className="w-full relative overflow-hidden"
            onClick={onAnalyze}
            disabled={isProcessing || !allClipsReady}
            variant="primary"
         >
           {isProcessing ? (
             <span className="flex items-center gap-2 justify-center">
               <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
               </svg>
               AI Analyzing...
             </span>
           ) : !allClipsReady ? (
             <span className="flex items-center gap-2 justify-center text-zinc-500">
               <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
               </svg>
               Loading...
             </span>
           ) : (
             <span className="flex items-center gap-2 justify-center">
               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
               Smart Cut
             </span>
           )}
         </Button>
      </div>
    </div>
  );
};

export default MediaPool;