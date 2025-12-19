import React from 'react';
import { VideoClip } from '../types';
import Button from './Button';

interface MediaPoolProps {
  clips: VideoClip[];
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAnalyze: () => void;
  isProcessing: boolean;
  selectedClipId: string | null;
  onSelectClip: (id: string) => void;
}

const MediaPool: React.FC<MediaPoolProps> = ({ 
  clips, 
  onUpload, 
  onAnalyze, 
  isProcessing,
  selectedClipId,
  onSelectClip
}) => {
  return (
    <div className="w-80 border-r border-zinc-800 bg-zinc-900/50 flex flex-col h-full">
      <div className="p-4 border-b border-zinc-800">
        <h2 className="text-zinc-100 font-semibold mb-1">Project Files</h2>
        <p className="text-zinc-500 text-xs mb-4">Drag videos to import</p>
        
        <label className="block w-full">
          <input 
            type="file" 
            multiple 
            accept="video/*" 
            onChange={onUpload} 
            className="hidden" 
          />
          <div className="flex items-center justify-center w-full h-24 px-4 transition bg-zinc-800/50 border-2 border-zinc-700 border-dashed rounded-lg appearance-none cursor-pointer hover:border-zinc-500 hover:bg-zinc-800 focus:outline-none">
            <span className="flex flex-col items-center space-y-2">
              <svg className="w-6 h-6 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
              <span className="font-medium text-zinc-400 text-xs">Drop files to Import</span>
            </span>
          </div>
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
            {/* Thumbnail Placeholder */}
            <div className="w-16 h-10 bg-black rounded flex-shrink-0 flex items-center justify-center overflow-hidden border border-zinc-800 relative">
               <video src={clip.url} className="w-full h-full object-cover opacity-50" />
               <span className="absolute text-[9px] bottom-0 right-0 bg-black/80 px-1 text-zinc-300 font-mono">
                 {Math.round(clip.duration)}s
               </span>
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

      <div className="p-4 border-t border-zinc-800">
         <Button 
            className="w-full relative overflow-hidden" 
            onClick={onAnalyze} 
            disabled={isProcessing || clips.length === 0}
            variant="primary"
         >
           {isProcessing ? (
             <span className="flex items-center gap-2">
               <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
               </svg>
               AI Analyzing...
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