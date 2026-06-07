type SpeechAudio = {
  text: string;
  audio: string;
  mimeType: "audio/mpeg";
};

const SPEECH_ENDPOINT = "https://api.openai.com/v1/audio/speech";
const MAX_SPEECH_TEXT_LENGTH = 600;

export async function createSpeechAudio(text: string): Promise<SpeechAudio | null> {
  if (process.env.OPENAI_TTS_ENABLED === "false") {
    return null;
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return null;
  }

  const spokenText = normalizeSpeechText(text);

  if (!spokenText) {
    return null;
  }

  const response = await fetch(SPEECH_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts",
      voice: process.env.OPENAI_TTS_VOICE ?? "marin",
      input: spokenText,
      instructions:
        "Speak clearly and calmly. This is an AI-generated voice confirming software development progress.",
      response_format: "mp3",
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI speech failed with status ${response.status}.`);
  }

  const audio = Buffer.from(await response.arrayBuffer()).toString("base64");

  return {
    text: spokenText,
    audio,
    mimeType: "audio/mpeg",
  };
}

export function summarizeForSpeech(summary: string) {
  const compact = summary
    .replace(/\s+/g, " ")
    .replace(/[`*_#>[\\\]]/g, "")
    .trim();

  if (!compact) {
    return "Codex finished the task.";
  }

  return `Codex finished. ${truncate(compact, 220)}`;
}

function normalizeSpeechText(text: string) {
  return truncate(text.replace(/\s+/g, " ").trim(), MAX_SPEECH_TEXT_LENGTH);
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}
