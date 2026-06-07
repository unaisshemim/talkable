type TranscriptionOptions = {
  apiKey: string;
  model: string;
  language?: string;
  sampleRate: number;
  chunks: string[];
};

const TRANSCRIPTION_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const PCM_CHANNELS = 1;
const PCM_BITS_PER_SAMPLE = 16;

export async function transcribePcm16Audio(options: TranscriptionOptions) {
  const pcm = concatBase64Chunks(options.chunks);

  if (pcm.byteLength === 0) {
    throw new Error("No audio was recorded.");
  }

  const wav = encodePcm16Wav(pcm, options.sampleRate);
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([wav], {
      type: "audio/wav",
    }),
    "talkable-recording.wav",
  );
  formData.append("model", options.model);

  if (options.language) {
    formData.append("language", options.language);
  }

  const response = await fetch(TRANSCRIPTION_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: formData,
  });

  const payload = (await response.json().catch(() => ({}))) as {
    text?: string;
    error?: {
      message?: string;
    };
  };

  if (!response.ok) {
    throw new Error(
      payload.error?.message ||
        `OpenAI transcription failed with status ${response.status}.`,
    );
  }

  return (payload.text ?? "").trim();
}

export function getTranscriptionConfig() {
  return {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_TRANSCRIPTION_MODEL ?? "whisper-1",
    language: process.env.OPENAI_TRANSCRIPTION_LANGUAGE || undefined,
  };
}

function concatBase64Chunks(chunks: string[]) {
  const buffers = chunks.map((chunk) => Buffer.from(chunk, "base64"));
  return Buffer.concat(buffers);
}

function encodePcm16Wav(pcm: Buffer, sampleRate: number) {
  const byteRate = sampleRate * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8);
  const blockAlign = PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8);
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(PCM_CHANNELS, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(PCM_BITS_PER_SAMPLE, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.byteLength, 40);

  return Buffer.concat([header, pcm]);
}
