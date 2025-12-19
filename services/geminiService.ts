import { GoogleGenAI, Type } from "@google/genai";
import { ClipAnalysis, VideoClip } from "../types";

// Helper to convert File to Base64
export const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64Data = reader.result as string;
      const base64Content = base64Data.split(',')[1];
      resolve({
        inlineData: {
          data: base64Content,
          mimeType: file.type,
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// Main analysis function
export const analyzeClipsWithGemini = async (clips: VideoClip[]): Promise<Record<string, ClipAnalysis>> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing. Please check your environment configuration.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const results: Record<string, ClipAnalysis> = {};

  const analysisSchema = {
    type: Type.OBJECT,
    properties: {
      files: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            filename: { type: Type.STRING },
            summary: { type: Type.STRING },
            segments: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING, description: "Transcription of this specific segment" },
                  start: { type: Type.NUMBER, description: "Start time in seconds" },
                  end: { type: Type.NUMBER, description: "End time in seconds" },
                  groupId: { type: Type.STRING, description: "ID connecting retakes of the same content" },
                  score: { type: Type.NUMBER, description: "Quality score 0-100" },
                  isBest: { type: Type.BOOLEAN, description: "Is this the best take of this group?" }
                },
                required: ["text", "start", "end", "groupId", "score", "isBest"]
              }
            }
          },
          required: ["filename", "summary", "segments"]
        }
      }
    },
    required: ["files"]
  };

  try {
    const parts = [];
    
    parts.push({
      text: `You are a professional video editor AI. 
      I will provide video files. Each file may contain multiple "takes" or sentences.
      
      Your Goal:
      1. Analyze every sentence/take in the videos.
      2. Group them by narrative content (groupId). If a user says the same line 3 times, they share a groupId.
      3. Score each take (0-100) based on delivery and stability.
      4. Mark the best take in each group as 'isBest'.
      5. Provide precise start/end timestamps for each active segment (excluding silence/prep).
      
      Output JSON matching the schema.`
    });

    for (const clip of clips) {
      // Limit file size/count logic would go here in prod
      const videoPart = await fileToGenerativePart(clip.file);
      parts.push({ text: `File Name: ${clip.name}` });
      parts.push(videoPart);
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: analysisSchema
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");

    const parsed = JSON.parse(text);
    
    parsed.files.forEach((item: any) => {
      const originalClip = clips.find(c => c.name === item.filename);
      if (originalClip) {
        results[originalClip.id] = {
          summary: item.summary,
          segments: item.segments
        };
      }
    });

    return results;

  } catch (error) {
    console.error("Gemini Analysis Failed:", error);
    throw error;
  }
};