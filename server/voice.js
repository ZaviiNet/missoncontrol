import OpenAI from 'openai';
import { GoogleGenAI, Modality } from '@google/genai';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import config from './config.js';

// ============================================================
// Agent → voice mappings per provider
// Override any voice via environment variables.
// ============================================================

// OpenAI TTS voices
// main (Jansky): onyx — deep, authoritative boss voice
// claw-1 (Orbit):  echo  — clear, precise technical voice
// claw-2 (Nova):   fable — warm, narrative storytelling voice
const OPENAI_VOICES = {
  'main':   process.env.OPENAI_VOICE_MAIN   || 'onyx',
  'claw-1': process.env.OPENAI_VOICE_CLAW1  || 'echo',
  'claw-2': process.env.OPENAI_VOICE_CLAW2  || 'fable',
};

// ElevenLabs pre-made voice IDs (defaults: Adam / Josh / Rachel)
const ELEVENLABS_VOICES = {
  'main':   process.env.ELEVENLABS_VOICE_MAIN   || 'pNInz6obpgDQGcFmaJgB',
  'claw-1': process.env.ELEVENLABS_VOICE_CLAW1  || 'TxGEqnHWrfWFTfGW9XjX',
  'claw-2': process.env.ELEVENLABS_VOICE_CLAW2  || '21m00Tcm4TlvDq8ikWAM',
};

// Gemini TTS prebuilt voice names
// main (Jansky): Charon — informative, authoritative
// claw-1 (Orbit):  Kore   — firm, precise
// claw-2 (Nova):   Aoede  — breezy, warm
const GEMINI_VOICES = {
  'main':   process.env.GEMINI_VOICE_MAIN   || 'Charon',
  'claw-1': process.env.GEMINI_VOICE_CLAW1  || 'Kore',
  'claw-2': process.env.GEMINI_VOICE_CLAW2  || 'Aoede',
};

// ============================================================
// Lazy client singletons
// ============================================================

let openaiClient = null;
let geminiClient = null;
let elevenLabsClient = null;

function getOpenAIClient() {
  if (!openaiClient) {
    if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY not set in .env');
    openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return openaiClient;
}

function getGeminiClient() {
  if (!geminiClient) {
    if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY not set in .env');
    geminiClient = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }
  return geminiClient;
}

function getElevenLabsClient() {
  if (!elevenLabsClient) {
    if (!config.elevenLabsApiKey) throw new Error('ELEVENLABS_API_KEY not set in .env');
    elevenLabsClient = new ElevenLabsClient({ apiKey: config.elevenLabsApiKey });
  }
  return elevenLabsClient;
}

// ============================================================
// Helpers
// ============================================================

// Wrap raw PCM16-LE samples in a WAV container so browsers can decode them.
// Gemini TTS returns 16-bit PCM at 24 kHz mono by default.
function pcm16ToWav(pcmBuffer, sampleRate = 24000, numChannels = 1) {
  const bitsPerSample = 16;
  const byteRate    = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign  = numChannels * bitsPerSample / 8;
  const dataLength  = pcmBuffer.length;
  const header      = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);            // Subchunk1Size (PCM = 16)
  header.writeUInt16LE(1, 20);             // AudioFormat   (PCM = 1)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return Buffer.concat([header, pcmBuffer]);
}

// Drain a Web ReadableStream<Uint8Array> (Node 18+ async-iterable) into a Buffer.
async function readableStreamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// ============================================================
// Transcription (STT)
// ============================================================

async function transcribeWithOpenAI(audioBuffer, filename) {
  const client = getOpenAIClient();
  const file   = new File([audioBuffer], filename, { type: 'audio/webm' });
  const result = await client.audio.transcriptions.create({ model: 'whisper-1', file });
  return result.text;
}

async function transcribeWithGemini(audioBuffer, filename) {
  const client   = getGeminiClient();
  const mimeType = filename.endsWith('.mp3') ? 'audio/mpeg'
    : filename.endsWith('.wav')  ? 'audio/wav'
    : 'audio/webm';

  const result = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { data: audioBuffer.toString('base64'), mimeType } },
        { text: 'Transcribe the audio. Return only the transcribed text, no other commentary.' },
      ],
    }],
  });
  return result.text.trim();
}

async function transcribeWithElevenLabs(audioBuffer, filename) {
  const client = getElevenLabsClient();
  const file   = new File([audioBuffer], filename, { type: 'audio/webm' });
  const result = await client.speechToText.convert({ modelId: 'scribe_v1', file });
  return result.text;
}

export async function transcribe(audioBuffer, filename = 'audio.webm') {
  switch (config.sttProvider) {
    case 'gemini':     return transcribeWithGemini(audioBuffer, filename);
    case 'elevenlabs': return transcribeWithElevenLabs(audioBuffer, filename);
    default:           return transcribeWithOpenAI(audioBuffer, filename);
  }
}

// ============================================================
// Speech synthesis (TTS)
// Returns { audio: Buffer, contentType: string }
// ============================================================

async function speakWithOpenAI(text, agentId) {
  const client = getOpenAIClient();
  const voice  = OPENAI_VOICES[agentId] || 'nova';

  const response    = await client.audio.speech.create({ model: 'tts-1', voice, input: text, response_format: 'mp3' });
  const arrayBuffer = await response.arrayBuffer();
  return { audio: Buffer.from(arrayBuffer), contentType: 'audio/mpeg' };
}

async function speakWithElevenLabs(text, agentId) {
  const client  = getElevenLabsClient();
  const voiceId = ELEVENLABS_VOICES[agentId] || ELEVENLABS_VOICES['main'];

  const stream = await client.textToSpeech.convert(voiceId, {
    text,
    modelId:      'eleven_multilingual_v2',
    outputFormat: 'mp3_44100_128',
  });
  const audio = await readableStreamToBuffer(stream);
  return { audio, contentType: 'audio/mpeg' };
}

async function speakWithGemini(text, agentId) {
  const client    = getGeminiClient();
  const voiceName = GEMINI_VOICES[agentId] || GEMINI_VOICES['main'];

  const response = await client.models.generateContent({
    model:    'gemini-2.5-flash-preview-tts',
    contents: [{ role: 'user', parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName } },
      },
    },
  });

  const part = response.candidates?.[0]?.content?.parts?.[0];
  if (!part?.inlineData?.data) {
    throw new Error('Gemini TTS returned no audio data');
  }

  const pcmBuffer = Buffer.from(part.inlineData.data, 'base64');
  return { audio: pcm16ToWav(pcmBuffer), contentType: 'audio/wav' };
}

export async function speak(text, agentId = 'main') {
  switch (config.ttsProvider) {
    case 'elevenlabs': return speakWithElevenLabs(text, agentId);
    case 'gemini':     return speakWithGemini(text, agentId);
    default:           return speakWithOpenAI(text, agentId);
  }
}
