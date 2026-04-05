import OpenAI from 'openai';
import config from './config.js';

let openai = null;

function getClient() {
  if (!openai) {
    if (!config.openaiApiKey) {
      throw new Error('OPENAI_API_KEY not set in .env');
    }
    openai = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return openai;
}

export async function transcribe(audioBuffer, filename = 'audio.webm') {
  const client = getClient();
  const file = new File([audioBuffer], filename, { type: 'audio/webm' });

  const result = await client.audio.transcriptions.create({
    model: 'whisper-1',
    file,
  });

  return result.text;
}

// Agent → voice mapping
// main (Jansky): onyx — deep, authoritative boss voice
// claw-1 (Coder): echo — clear, precise technical voice
// claw-2 (Research): fable — warm, narrative storytelling voice
const AGENT_VOICES = {
  'main': 'onyx',
  'claw-1': 'echo',
  'claw-2': 'fable',
};

export async function speak(text, agentId = 'main') {
  const client = getClient();
  const voice = AGENT_VOICES[agentId] || 'nova';

  const response = await client.audio.speech.create({
    model: 'tts-1',
    voice,
    input: text,
    response_format: 'mp3',
  });

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
