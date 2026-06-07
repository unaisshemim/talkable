import "./env.js";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import type { ZodIssue } from "zod";
import {
  ClientEventSchema,
  type ClientEvent,
  type ServerEvent,
  type UiSelection,
} from "@talkable/shared";
import { runCodexTask } from "./codex.js";
import { createSpeechAudio } from "./speech.js";
import {
  getTranscriptionConfig,
  transcribePcm16Audio,
} from "./transcription.js";

const DEFAULT_PORT = 4317;
const port = Number.parseInt(process.env.PORT ?? "", 10) || DEFAULT_PORT;
const host = process.env.HOST ?? "127.0.0.1";
const execFileAsync = promisify(execFile);

type SessionState = {
  projectPath?: string;
  codexThreadId?: string;
  latestSelection?: UiSelection;
  undoRecord?: UndoRecord;
  audioStarted: boolean;
  audioChunks: string[];
  audioSampleRate: number;
  partialTranscript: string;
  completedTranscripts: Set<string>;
  codexAbortController?: AbortController;
  codexRunning: boolean;
};

type ProjectSnapshot = {
  diff: string;
  untrackedFiles: string[];
};

type UndoRecord = {
  projectPath: string;
  before: ProjectSnapshot;
  after: ProjectSnapshot;
  changedFiles: string[];
};

const server = createServer((request, response) => {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    writeJson(response, 200, {
      ok: true,
      service: "talkable-server",
      version: "0.1.0",
    });
    return;
  }

  if (request.method === "POST" && request.url === "/pick-project-path") {
    void pickProjectPath(response);
    return;
  }

  writeJson(response, 404, {
    ok: false,
    error: "not_found",
  });
});

const sockets = new WebSocketServer({
  noServer: true,
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (url.pathname !== "/sessions") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  sockets.handleUpgrade(request, socket, head, (webSocket) => {
    sockets.emit("connection", webSocket, request);
  });
});

sockets.on("connection", (socket) => {
  const session: SessionState = {
    audioStarted: false,
    audioChunks: [],
    audioSampleRate: 24000,
    partialTranscript: "",
    completedTranscripts: new Set(),
    codexRunning: false,
  };

  send(socket, {
    type: "status",
    state: "disconnected",
    message: "Connected to backend. Configure a project path to begin.",
  });
  logBackend("socket.connected");

  socket.on("message", (data) => {
    const event = parseClientEvent(data);

    if (!event.ok) {
      send(socket, {
        type: "error",
        code: "invalid_client_event",
        message: event.message,
        recoverable: true,
        nextAction: "Send a valid client event payload.",
      });
      return;
    }

    handleClientEvent(socket, session, event.value);
  });

  socket.on("close", () => {
    logBackend("socket.closed", {
      projectConfigured: Boolean(session.projectPath),
      codexRunning: session.codexRunning,
    });
    cleanupSession(session);
  });
});

server.listen(port, host, () => {
  console.log(`Talkable backend listening on http://${host}:${port}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Talkable backend could not start because http://${host}:${port} is already in use.`,
    );
    console.error("Stop the existing backend process or set a different PORT.");
    process.exit(1);
  }

  throw error;
});

function handleClientEvent(
  socket: WebSocket,
  session: SessionState,
  event: ClientEvent,
) {
  switch (event.type) {
    case "session.configure": {
      const projectPath = resolve(event.projectPath);

      if (!isAbsolute(event.projectPath) || !existsSync(projectPath)) {
        send(socket, {
          type: "error",
          code: "invalid_project_path",
          message: "Project path must be an existing absolute path.",
          recoverable: true,
          nextAction:
            "Update the extension settings with a valid local project path.",
        });
        send(socket, {
          type: "status",
          state: "error",
          message: "Project path is invalid.",
        });
        return;
      }

      session.projectPath = projectPath;
      session.codexThreadId = event.codexThreadId;
      session.partialTranscript = "";
      session.completedTranscripts.clear();
      logBackend("session.configure", {
        projectPath,
        hasThreadId: Boolean(session.codexThreadId),
      });

      send(socket, {
        type: "status",
        state: "ready",
        message: "Backend ready. Start speaking to create a Codex task.",
      });

      if (session.codexThreadId) {
        send(socket, {
          type: "codex.thread",
          threadId: session.codexThreadId,
        });
      }
      return;
    }

    case "audio.start": {
      if (!session.projectPath) {
        send(socket, {
          type: "error",
          code: "project_path_required",
          message: "Configure a valid project path before streaming audio.",
          recoverable: true,
          nextAction: "Open extension settings and set the project path.",
        });
        return;
      }

      if (event.format !== "pcm16" || event.sampleRate !== 24000) {
        send(socket, {
          type: "error",
          code: "unsupported_audio_format",
          message: "Whisper transcription requires 24 kHz mono PCM16 audio.",
          recoverable: true,
          nextAction:
            "Restart voice capture so Talkable can record PCM16 audio.",
        });
        return;
      }

      const transcriptionConfig = getTranscriptionConfig();

      if (!transcriptionConfig.apiKey) {
        send(socket, {
          type: "error",
          code: "openai_api_key_required",
          message: "OPENAI_API_KEY is required to use Whisper transcription.",
          recoverable: true,
          nextAction:
            "Set OPENAI_API_KEY in the backend environment and restart the server.",
        });
        send(socket, {
          type: "status",
          state: "error",
          message: "OpenAI API key is missing.",
        });
        return;
      }

      session.audioStarted = true;
      session.audioChunks = [];
      session.audioSampleRate = event.sampleRate;
      session.partialTranscript = "";
      session.completedTranscripts.clear();
      logBackend("audio.start", {
        format: event.format,
        sampleRate: event.sampleRate,
        transcriptionModel: transcriptionConfig.model,
      });

      send(socket, {
        type: "status",
        state: "listening",
        message: `Audio recording started as ${event.format} at ${event.sampleRate} Hz.`,
      });
      return;
    }

    case "audio.chunk": {
      if (!session.audioStarted) {
        send(socket, {
          type: "error",
          code: "audio_not_started",
          message: "Received audio chunk before audio.start.",
          recoverable: true,
          nextAction: "Start audio capture before sending chunks.",
        });
        return;
      }

      session.audioChunks.push(event.data);
      if (session.audioChunks.length % 100 === 0) {
        logBackend("audio.chunk", {
          chunks: session.audioChunks.length,
        });
      }
      return;
    }

    case "audio.stop": {
      session.audioStarted = false;
      logBackend("audio.stop", {
        chunks: session.audioChunks.length,
        sampleRate: session.audioSampleRate,
      });
      send(socket, {
        type: "status",
        state: "processing",
        message: "Audio recording stopped. Transcribing with Whisper.",
      });
      void transcribeStoppedAudio(socket, session);
      return;
    }

    case "codex.cancel": {
      logBackend("codex.cancel");
      cleanupSession(session);
      send(socket, {
        type: "status",
        state: session.projectPath ? "ready" : "disconnected",
        message: "Current Codex task was cancelled.",
      });
      return;
    }

    case "codex.undo_last_change": {
      void undoLastChange(socket, session);
      return;
    }

    case "ui.selection.set": {
      session.latestSelection = event.selection;
      logBackend("ui.selection.set", {
        label: getSelectionLogLabel(event.selection),
        file: event.selection.source?.file,
        component: event.selection.source?.component,
      });
      send(socket, {
        type: "status",
        state: "ready",
        message: "UI target selected. Speak the edit you want for that part.",
      });
      return;
    }
  }
}

async function transcribeStoppedAudio(
  socket: WebSocket,
  session: SessionState,
) {
  const chunks = session.audioChunks.splice(0);
  const sampleRate = session.audioSampleRate;
  const transcriptionConfig = getTranscriptionConfig();
  const startedAt = Date.now();

  if (chunks.length === 0) {
    logBackend("transcription.skipped", {
      reason: "empty_audio",
    });
    send(socket, {
      type: "error",
      code: "empty_audio",
      message: "No audio was recorded.",
      recoverable: true,
      nextAction: "Start recording and speak your edit request again.",
    });
    send(socket, {
      type: "status",
      state: "ready",
      message: "No audio was recorded.",
    });
    return;
  }

  try {
    logBackend("transcription.start", {
      chunks: chunks.length,
      sampleRate,
      model: transcriptionConfig.model,
    });
    const text = await transcribePcm16Audio({
      ...transcriptionConfig,
      sampleRate,
      chunks,
    });

    logBackend("transcription.done", {
      durationMs: Date.now() - startedAt,
      textLength: text.length,
      textPreview: truncateForLog(text),
    });

    if (!text) {
      send(socket, {
        type: "error",
        code: "empty_transcript",
        message: "Whisper did not return any transcript text.",
        recoverable: true,
        nextAction: "Try speaking again with a little more volume.",
      });
      send(socket, {
        type: "status",
        state: "ready",
        message: "No transcript was detected.",
      });
      return;
    }

    session.partialTranscript = text;
    send(socket, {
      type: "transcript.final",
      text,
    });
    void speak(socket, buildHeardConfirmation(text, session.latestSelection));
    void startCodexFromTranscript(socket, session, text);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Whisper transcription failed.";

    logBackend("transcription.error", {
      message,
    });
    send(socket, {
      type: "error",
      code: "transcription_failed",
      message,
      recoverable: true,
      nextAction: "Restart voice capture and try again.",
    });
    send(socket, {
      type: "status",
      state: "error",
      message: "Whisper transcription failed.",
    });
  }
}

async function startCodexFromTranscript(
  socket: WebSocket,
  session: SessionState,
  transcript: string,
) {
  await startCodexTask(socket, session, transcript, undefined, true);
}

async function startCodexTask(
  socket: WebSocket,
  session: SessionState,
  taskInput: string,
  clarificationSummary?: string,
  speakResult = false,
) {
  const task = [taskInput.trim(), clarificationSummary?.trim()]
    .filter(Boolean)
    .join("\n\nClarification summary:\n");

  if (!task) {
    send(socket, {
      type: "error",
      code: "empty_codex_task",
      message: "Whisper did not return a usable task.",
      recoverable: true,
      nextAction: "Try speaking the Codex task again.",
    });
    return;
  }

  if (!session.projectPath) {
    send(socket, {
      type: "error",
      code: "project_path_required",
      message: "Configure a valid project path before running Codex.",
      recoverable: true,
      nextAction: "Open extension settings and set the project path.",
    });
    return;
  }

  if (session.codexRunning || session.completedTranscripts.has(task)) {
    logBackend("codex.skipped", {
      reason: session.codexRunning ? "already_running" : "duplicate_task",
    });
    return;
  }

  logBackend("codex.start", {
    taskPreview: truncateForLog(task),
    hasSelectedTarget: Boolean(session.latestSelection),
  });
  session.completedTranscripts.add(task);
  session.codexRunning = true;
  session.codexAbortController = new AbortController();
  const selectedTarget = session.latestSelection;
  session.latestSelection = undefined;
  const beforeSnapshot = await tryCaptureProjectSnapshot(
    socket,
    session.projectPath,
    "Undo is unavailable because the selected project is not ready for git diff snapshots.",
  );

  const result = await runCodexTask({
    projectPath: session.projectPath,
    threadId: session.codexThreadId,
    task,
    selectedTarget,
    signal: session.codexAbortController.signal,
    send: (event) => send(socket, event),
    onThreadId: (threadId) => {
      session.codexThreadId = threadId;
    },
    onDone: async () => {
      logBackend("codex.done", {
        speakResult,
      });
      if (speakResult) {
        await speak(socket, "Done. I updated it.");
      }
    },
    onFailed: async () => {
      logBackend("codex.failed", {
        speakResult,
      });
      if (speakResult) {
        await speak(socket, "I could not finish that. Check the notes.");
      }
    },
  });

  if (result.completed && beforeSnapshot) {
    const afterSnapshot = await tryCaptureProjectSnapshot(
      socket,
      session.projectPath,
      "Undo is unavailable because the post-run git diff snapshot could not be captured.",
    );

    if (!afterSnapshot) {
      session.codexRunning = false;
      session.codexAbortController = undefined;
      return;
    }

    session.undoRecord = {
      projectPath: session.projectPath,
      before: beforeSnapshot,
      after: afterSnapshot,
      changedFiles: result.changedFiles,
    };
    send(socket, {
      type: "codex.undo_available",
      changedFiles: result.changedFiles,
    });
    logBackend("undo.available", {
      changedFiles: result.changedFiles,
    });
  }

  session.codexRunning = false;
  session.codexAbortController = undefined;
}

async function undoLastChange(socket: WebSocket, session: SessionState) {
  try {
    await performUndoLastChange(socket, session);
  } catch (error) {
    send(socket, {
      type: "error",
      code: "undo_failed",
      message:
        error instanceof Error
          ? error.message
          : "Undo failed while reading the project state.",
      recoverable: true,
      nextAction: "Review the working tree manually before retrying.",
    });
  }
}

async function performUndoLastChange(socket: WebSocket, session: SessionState) {
  const undoRecord = session.undoRecord;

  if (!undoRecord) {
    logBackend("undo.skipped", {
      reason: "not_available",
    });
    send(socket, {
      type: "error",
      code: "undo_not_available",
      message: "There is no completed Codex change to undo.",
      recoverable: true,
      nextAction: "Run a voice task first, then undo after it completes.",
    });
    return;
  }

  if (session.codexRunning) {
    logBackend("undo.blocked", {
      reason: "codex_running",
    });
    send(socket, {
      type: "error",
      code: "undo_blocked",
      message: "Wait for the current Codex task to finish before undoing.",
      recoverable: true,
      nextAction: "Cancel or finish the current task, then try undo again.",
    });
    return;
  }

  const current = await captureProjectSnapshot(undoRecord.projectPath);

  if (!snapshotsMatch(current, undoRecord.after)) {
    logBackend("undo.conflict", {
      changedFiles: undoRecord.changedFiles,
    });
    send(socket, {
      type: "error",
      code: "undo_conflict",
      message:
        "Undo is not safe because the project changed after the Codex run.",
      recoverable: true,
      nextAction:
        "Review the working tree manually, or run a fresh task after saving your changes.",
    });
    return;
  }

  await removeNewUntrackedFiles(undoRecord.projectPath, undoRecord);

  if (undoRecord.after.diff.trim()) {
    await applyGitPatch(undoRecord.projectPath, undoRecord.after.diff, true);
  }

  if (undoRecord.before.diff.trim()) {
    await applyGitPatch(undoRecord.projectPath, undoRecord.before.diff, false);
  }

  session.undoRecord = undefined;
  logBackend("undo.completed", {
    changedFiles: undoRecord.changedFiles,
  });
  send(socket, {
    type: "codex.undo_completed",
    message: "Last Codex change was undone.",
  });
  send(socket, {
    type: "status",
    state: "ready",
    message: "Last Codex change was undone.",
  });
}

async function tryCaptureProjectSnapshot(
  socket: WebSocket,
  projectPath: string,
  failureMessage: string,
) {
  try {
    return await captureProjectSnapshot(projectPath);
  } catch (error) {
    send(socket, {
      type: "codex.progress",
      message:
        error instanceof Error
          ? `${failureMessage} ${error.message}`
          : failureMessage,
    });
    return undefined;
  }
}

async function captureProjectSnapshot(
  projectPath: string,
): Promise<ProjectSnapshot> {
  const [{ stdout: diff }, { stdout: untracked }] = await Promise.all([
    execFileAsync("git", ["diff", "HEAD", "--binary", "--no-ext-diff"], {
      cwd: projectPath,
      maxBuffer: 25 * 1024 * 1024,
    }),
    execFileAsync("git", ["ls-files", "--others", "--exclude-standard"], {
      cwd: projectPath,
      maxBuffer: 5 * 1024 * 1024,
    }),
  ]);

  return {
    diff,
    untrackedFiles: untracked
      .split("\n")
      .map((path) => path.trim())
      .filter(Boolean)
      .sort(),
  };
}

function snapshotsMatch(left: ProjectSnapshot, right: ProjectSnapshot) {
  return (
    left.diff === right.diff &&
    left.untrackedFiles.join("\n") === right.untrackedFiles.join("\n")
  );
}

async function applyGitPatch(
  projectPath: string,
  patch: string,
  reverse: boolean,
) {
  const tempDir = await mkdtemp(join(tmpdir(), "talkable-undo-"));
  const patchPath = join(tempDir, "change.patch");

  try {
    await writeFile(patchPath, patch, "utf8");
    await execFileAsync(
      "git",
      [
        "apply",
        "--whitespace=nowarn",
        ...(reverse ? ["--reverse"] : []),
        patchPath,
      ],
      {
        cwd: projectPath,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
  } finally {
    await rm(tempDir, {
      force: true,
      recursive: true,
    });
  }
}

async function removeNewUntrackedFiles(
  projectPath: string,
  undoRecord: UndoRecord,
) {
  const before = new Set(undoRecord.before.untrackedFiles);
  const createdFiles = undoRecord.after.untrackedFiles.filter(
    (path) => !before.has(path),
  );

  for (const file of createdFiles) {
    const absolutePath = resolve(projectPath, file);
    const relativePath = relative(projectPath, absolutePath);

    if (
      relativePath.startsWith("..") ||
      isAbsolute(relativePath) ||
      relativePath.length === 0
    ) {
      throw new Error(`Refusing to remove unsafe undo path: ${file}`);
    }

    await rm(absolutePath, {
      force: true,
      recursive: true,
    });
  }
}

function cleanupSession(session: SessionState) {
  session.audioStarted = false;
  session.audioChunks = [];
  session.codexAbortController?.abort();
  session.codexAbortController = undefined;
  session.codexRunning = false;
}

function parseClientEvent(
  data: RawData,
): { ok: true; value: ClientEvent } | { ok: false; message: string } {
  try {
    const json = JSON.parse(data.toString());
    const parsed = ClientEventSchema.safeParse(json);

    if (!parsed.success) {
      return {
        ok: false,
        message: parsed.error.issues
          .map((issue: ZodIssue) => issue.message)
          .join("; "),
      };
    }

    return {
      ok: true,
      value: parsed.data,
    };
  } catch {
    return {
      ok: false,
      message: "Message must be valid JSON.",
    };
  }
}

function send(socket: WebSocket, event: ServerEvent) {
  socket.send(JSON.stringify(event));
}

async function speak(socket: WebSocket, text: string) {
  try {
    logBackend("speech.start", {
      text: truncateForLog(text),
    });
    const speech = await createSpeechAudio(text);

    if (!speech || socket.readyState !== WebSocket.OPEN) {
      logBackend("speech.skipped", {
        reason: !speech ? "disabled_or_unavailable" : "socket_closed",
      });
      return;
    }

    send(socket, {
      type: "speech.audio",
      ...speech,
    });
    logBackend("speech.sent", {
      text: truncateForLog(speech.text),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Speech generation failed.";

    logBackend("speech.error", {
      message,
    });
    send(socket, {
      type: "codex.progress",
      message,
    });
  }
}

function buildHeardConfirmation(
  transcript: string,
  selectedTarget?: UiSelection,
) {
  const task = transcript.trim();
  if (!task) {
    return "I did not catch that. Please try again.";
  }

  return selectedTarget
    ? "Got it. I am working on that part."
    : "Got it. I am working on it.";
}

function logBackend(event: string, details?: Record<string, unknown>) {
  const payload = details ? ` ${JSON.stringify(details)}` : "";
  console.log(`[talkable:${new Date().toISOString()}] ${event}${payload}`);
}

function truncateForLog(value: string, maxLength = 140) {
  const compact = value.replace(/\s+/g, " ").trim();

  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 1)}...`;
}

function getSelectionLogLabel(selection: UiSelection) {
  return (
    selection.source?.component ||
    selection.text?.slice(0, 80) ||
    selection.ariaLabel ||
    selection.selector ||
    selection.tagName
  );
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function setCorsHeaders(response: ServerResponse) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

async function pickProjectPath(response: ServerResponse) {
  if (process.platform !== "darwin") {
    writeJson(response, 501, {
      ok: false,
      error: "folder_picker_unsupported",
      message:
        "Native folder selection is currently implemented for macOS only.",
    });
    return;
  }

  try {
    const { stdout } = await execFileAsync("/usr/bin/osascript", [
      "-e",
      [
        'tell application "Finder"',
        "activate",
        'set selectedFolder to choose folder with prompt "Select the Codex project folder"',
        "POSIX path of selectedFolder",
        "end tell",
      ].join("\n"),
    ]);
    const projectPath = stdout.trim().replace(/\/$/, "");

    if (!projectPath || !isAbsolute(projectPath) || !existsSync(projectPath)) {
      writeJson(response, 400, {
        ok: false,
        error: "invalid_selected_folder",
        message: "Selected folder was not a valid absolute path.",
      });
      return;
    }

    writeJson(response, 200, {
      ok: true,
      projectPath,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Folder selection failed.";
    const cancelled = message.toLowerCase().includes("user canceled");

    writeJson(response, cancelled ? 499 : 500, {
      ok: false,
      error: cancelled
        ? "folder_selection_cancelled"
        : "folder_selection_failed",
      message: cancelled ? "Folder selection was cancelled." : message,
    });
  }
}
