import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion } from "framer-motion";
import {
  Ban,
  ChevronDown,
  ChevronUp,
  Crosshair,
  FileText,
  Folder,
  Mic,
  RotateCcw,
  ScrollText,
  Square,
  Waves
} from "lucide-react";
import "./content.css";

type VoiceState =
  | "backend_ready"
  | "listening"
  | "processing_voice"
  | "codex_working"
  | "done"
  | "needs_attention";

type Settings = {
  backendUrl: string;
  projectPath: string;
  codexThreadId?: string;
};

type ActivityEvent = {
  label: string;
  createdAt: number;
};

type UiSelection = {
  url: string;
  title?: string;
  tagName: string;
  text?: string;
  ariaLabel?: string;
  className?: string;
  selector?: string;
  nearbyHeading?: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  source?: {
    file?: string;
    component?: string;
    line?: number;
    column?: number;
  };
  selectedAt: number;
};

type VoiceCapture = {
  stop: () => void;
};

type SpeechClip = {
  audio: string;
  mimeType: string;
};

type SpeechPlayback = {
  unlock: () => Promise<void>;
  play: (clip: SpeechClip) => Promise<void>;
  close: () => void;
};

const DEFAULT_SETTINGS: Settings = {
  backendUrl: "http://127.0.0.1:4317",
  projectPath: "",
  codexThreadId: ""
};

const REALTIME_SAMPLE_RATE = 24000;
const PCM_PROCESSOR_BUFFER_SIZE = 4096;
const BACKEND_RECONNECT_DELAY_MS = 1500;
const AUTO_RUN_SILENCE_MS = 1000;
const SPEECH_RMS_THRESHOLD = 0.018;
const SELECTABLE_ELEMENT_SELECTOR =
  "[data-talkable-source-file], [data-talkable-source-component], button, a, input, textarea, select, label, h1, h2, h3, h4, p, li, article, section, main, header, footer, nav, div";

function TalkableWidget() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [collapsed, setCollapsed] = useState(false);
  const [connected, setConnected] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("needs_attention");
  const [selectingProject, setSelectingProject] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [currentStep, setCurrentStep] = useState<ActivityEvent>({
    label: "Backend connection pending",
    createdAt: Date.now()
  });
  const [codexNotes, setCodexNotes] = useState<ActivityEvent[]>([]);
  const [changedFiles, setChangedFiles] = useState<string[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [pickMode, setPickMode] = useState(false);
  const [hoverSelection, setHoverSelection] = useState<UiSelection | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<UiSelection | null>(null);
  const [selectedElement, setSelectedElement] = useState<HTMLElement | null>(null);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const voiceCaptureRef = useRef<VoiceCapture | null>(null);
  const speechPlaybackRef = useRef<SpeechPlayback | null>(null);
  const speechQueueRef = useRef<SpeechClip[]>([]);
  const speakingRef = useRef(false);
  const autoRunTimerRef = useRef<number | null>(null);
  const speechDetectedRef = useRef(false);
  const voiceStateRef = useRef<VoiceState>("needs_attention");

  const projectName = useMemo(
    () => getProjectName(settings.projectPath) || "Select project",
    [settings.projectPath]
  );

  useEffect(() => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
      const nextSettings = normalizeSettings(stored as Settings);
      setSettings(nextSettings);
      connect(nextSettings);
    });

    return () => {
      clearReconnectTimer(reconnectTimerRef);
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
      voiceCaptureRef.current?.stop();
      clearAutoRunTimer(autoRunTimerRef);
      speechPlaybackRef.current?.close();
    };
  }, []);

  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);

  useEffect(() => {
    if (!recordingStartedAt || voiceState !== "listening") {
      setRecordingSeconds(0);
      return;
    }

    const timer = window.setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - recordingStartedAt) / 1000));
    }, 250);

    return () => window.clearInterval(timer);
  }, [recordingStartedAt, voiceState]);

  useEffect(() => {
    if (!pickMode) {
      setHoverSelection(null);
      return;
    }

    function handleMouseMove(event: MouseEvent) {
      const element = getSelectableElementAtPoint(event.clientX, event.clientY);

      if (!element) {
        setHoverSelection(null);
        return;
      }

      setHoverSelection(buildSelection(element));
    }

    function handleClick(event: MouseEvent) {
      const element = getSelectableElementAtPoint(event.clientX, event.clientY);

      if (!element) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const selection = buildSelection(element);
      setSelectedElement(element);
      setSelectedTarget(selection);
      setPickMode(false);
      send({
        type: "ui.selection.set",
        selection
      });
      setCurrentStep({
        label: `Target selected: ${getSelectionLabel(selection)}`,
        createdAt: Date.now()
      });
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPickMode(false);
      }
    }

    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove, true);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [pickMode]);

  async function startListening() {
    if (!settings.projectPath) {
      setVoiceState("needs_attention");
      setCurrentStep({
        label: "Select a project folder first",
        createdAt: Date.now()
      });
      return;
    }

    try {
      const playback = speechPlaybackRef.current ?? createSpeechPlayback();
      speechPlaybackRef.current = playback;
      await playback.unlock();

      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        connect(settings);
        await waitForSocket(socketRef);
      }

      send({
        type: "session.configure",
        projectPath: settings.projectPath,
        codexThreadId: settings.codexThreadId || undefined
      });

      send({
        type: "audio.start",
        sampleRate: REALTIME_SAMPLE_RATE,
        format: "pcm16"
      });

      voiceCaptureRef.current?.stop();
      speechDetectedRef.current = false;
      voiceCaptureRef.current = await startPcmVoiceCapture(
        (base64Pcm16) => {
          send({
            type: "audio.chunk",
            data: base64Pcm16
          });
        },
        handleVoiceActivity
      );
      setTranscript("");
      setCanUndo(false);
      setVoiceState("listening");
      setRecordingStartedAt(Date.now());
      setCurrentStep({
        label: "Listening",
        createdAt: Date.now()
      });
    } catch (error) {
      setRecordingStartedAt(null);
      clearAutoRunTimer(autoRunTimerRef);
      setVoiceState("needs_attention");
      voiceStateRef.current = "needs_attention";
      setCurrentStep({
        label:
          error instanceof Error
            ? error.message
            : "Voice capture failed",
        createdAt: Date.now()
      });
    }
  }

  function stopAndRun() {
    if (!voiceCaptureRef.current) {
      return;
    }

    clearAutoRunTimer(autoRunTimerRef);
    speechDetectedRef.current = false;
    voiceCaptureRef.current?.stop();
    voiceCaptureRef.current = null;
    setRecordingStartedAt(null);
    send({ type: "audio.stop" });
    setVoiceState("processing_voice");
    voiceStateRef.current = "processing_voice";
    setCurrentStep({
      label: "Creating task",
      createdAt: Date.now()
    });
  }

  function cancelCodex() {
    clearAutoRunTimer(autoRunTimerRef);
    speechDetectedRef.current = false;
    voiceCaptureRef.current?.stop();
    voiceCaptureRef.current = null;
    setRecordingStartedAt(null);
    send({ type: "codex.cancel" });
    setSelectedElement(null);
    setSelectedTarget(null);
    setVoiceState("backend_ready");
    voiceStateRef.current = "backend_ready";
    setCurrentStep({
      label: "Cancelled",
      createdAt: Date.now()
    });
  }

  function handleVoiceActivity(speaking: boolean) {
    if (voiceStateRef.current !== "listening") {
      return;
    }

    if (speaking) {
      speechDetectedRef.current = true;
      clearAutoRunTimer(autoRunTimerRef);
      return;
    }

    if (!speechDetectedRef.current || autoRunTimerRef.current !== null) {
      return;
    }

    autoRunTimerRef.current = window.setTimeout(() => {
      autoRunTimerRef.current = null;
      stopAndRun();
    }, AUTO_RUN_SILENCE_MS);
  }

  function undoLastChange() {
    if (!window.confirm("Undo the last Codex change?")) {
      return;
    }

    send({ type: "codex.undo_last_change" });
    setCurrentStep({
      label: "Undoing last change",
      createdAt: Date.now()
    });
  }

  async function selectProjectFolder() {
    setSelectingProject(true);
    setCurrentStep({
      label: "Opening project folder picker",
      createdAt: Date.now()
    });

    try {
      const baseUrl = normalizeBackendUrl(settings.backendUrl);
      const healthResponse = await fetch(`${baseUrl}/health`);

      if (!healthResponse.ok) {
        throw new Error(`Backend is not healthy at ${baseUrl}`);
      }

      const response = await fetch(`${baseUrl}/pick-project-path`, {
        method: "POST"
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        projectPath?: string;
        message?: string;
      };

      if (!response.ok || !payload.ok || !payload.projectPath) {
        throw new Error(payload.message || "Could not select project folder");
      }

      const nextSettings = {
        ...settings,
        backendUrl: baseUrl,
        projectPath: payload.projectPath
      };

      await chrome.storage.sync.set(nextSettings);
      setSettings(nextSettings);
      socketRef.current?.close();
      connect(nextSettings);
      setVoiceState("backend_ready");
      setCurrentStep({
        label: `Selected ${getProjectName(payload.projectPath)}`,
        createdAt: Date.now()
      });
    } catch (error) {
      setVoiceState("needs_attention");
      setCurrentStep({
        label: error instanceof Error ? error.message : "Project picker failed",
        createdAt: Date.now()
      });
    } finally {
      setSelectingProject(false);
    }
  }

  function connect(nextSettings: Settings) {
    try {
      clearReconnectTimer(reconnectTimerRef);

      const socket = new WebSocket(
        normalizeBackendUrl(nextSettings.backendUrl).replace(/^http/, "ws") + "/sessions"
      );
      const previousSocket = socketRef.current;
      socketRef.current = socket;

      if (
        previousSocket &&
        previousSocket.readyState !== WebSocket.CLOSED &&
        previousSocket.readyState !== WebSocket.CLOSING
      ) {
        previousSocket.close();
      }

      socket.addEventListener("open", () => {
        if (socketRef.current !== socket) {
          return;
        }

        setConnected(true);
        setVoiceState("backend_ready");
        setCurrentStep({
          label: "Backend ready",
          createdAt: Date.now()
        });
      });

      socket.addEventListener("message", (message) => {
        if (socketRef.current !== socket) {
          return;
        }

        const event = JSON.parse(String(message.data));
        handleServerEvent(event);
      });

      socket.addEventListener("close", () => {
        if (socketRef.current !== socket) {
          return;
        }

        setConnected(false);
        setVoiceState("needs_attention");
        setCurrentStep({
          label: "Backend disconnected. Retrying...",
          createdAt: Date.now()
        });
        scheduleReconnect(reconnectTimerRef, () => connect(nextSettings));
      });

      socket.addEventListener("error", () => {
        if (socketRef.current !== socket) {
          return;
        }

        setConnected(false);
        setVoiceState("needs_attention");
        setCurrentStep({
          label: "Backend unavailable. Retrying...",
          createdAt: Date.now()
        });
        scheduleReconnect(reconnectTimerRef, () => connect(nextSettings));
      });
    } catch {
      setConnected(false);
      setVoiceState("needs_attention");
      scheduleReconnect(reconnectTimerRef, () => connect(nextSettings));
    }
  }

  function handleServerEvent(event: Record<string, unknown>) {
    if (event.type === "status") {
      const mappedState = mapServerState(String(event.state));
      setVoiceState(mappedState);

      if (
        String(event.state) === "done" ||
        String(event.state) === "error" ||
        String(event.state) === "needs_attention" ||
        String(event.state) === "disconnected"
      ) {
        setSelectedElement(null);
        setSelectedTarget(null);
      }

      setCurrentStep({
        label: getFriendlyStatusLabel(String(event.state), String(event.message || "")),
        createdAt: Date.now()
      });
      return;
    }

    if (event.type === "transcript.partial" || event.type === "transcript.final") {
      setTranscript(String(event.text || ""));
      setVoiceState(event.type === "transcript.final" ? "processing_voice" : "listening");
      return;
    }

    if (event.type === "codex.progress") {
      setVoiceState("codex_working");
      addCodexNote(String(event.message || "Codex is working"));
      return;
    }

    if (event.type === "codex.file_changed") {
      setVoiceState("codex_working");
      const path = String(event.path || "");
      if (path) {
        setChangedFiles((files) => [...new Set([...files, path])]);
      }
      setCurrentStep({
        label: "Editing files",
        createdAt: Date.now()
      });
      return;
    }

    if (event.type === "codex.done") {
      const files = Array.isArray(event.changedFiles)
        ? event.changedFiles.map(String)
        : [];
      setVoiceState("done");
      setSelectedElement(null);
      setSelectedTarget(null);
      setChangedFiles(files);
      setCanUndo(Boolean(event.undoAvailable));
      setCurrentStep({
        label: "Finished",
        createdAt: Date.now()
      });
      addCodexNote(String(event.summary || "Codex completed the task."));
      return;
    }

    if (event.type === "codex.undo_available") {
      setCanUndo(true);
      return;
    }

    if (event.type === "codex.undo_completed") {
      setCanUndo(false);
      setChangedFiles([]);
      setSelectedElement(null);
      setSelectedTarget(null);
      setVoiceState("backend_ready");
      setCurrentStep({
        label: String(event.message || "Last Codex change was undone"),
        createdAt: Date.now()
      });
      return;
    }

    if (event.type === "speech.audio") {
      playSpeechAudio(
        String(event.audio || ""),
        String(event.mimeType || "audio/mpeg"),
        speechPlaybackRef,
        speechQueueRef,
        speakingRef
      );
      return;
    }

    if (event.type === "error") {
      setVoiceState("needs_attention");
      setSelectedElement(null);
      setSelectedTarget(null);
      setCurrentStep({
        label: String(event.message || "Talkable needs attention"),
        createdAt: Date.now()
      });
      addCodexNote(String(event.nextAction || event.message || "Talkable needs attention"));
    }
  }

  function addCodexNote(label: string) {
    setCodexNotes((notes) =>
      [
        {
          label,
          createdAt: Date.now()
        },
        ...notes
      ].slice(0, 8)
    );
  }

  function send(event: Record<string, unknown>) {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(event));
    }
  }

  return (
    <>
      <SelectionOverlay
        hoverSelection={hoverSelection}
        selectedTarget={selectedTarget}
        selectedElement={selectedElement}
        pickMode={pickMode}
        editing={voiceState === "codex_working"}
      />
      <motion.aside
        id="talkable-widget"
        className="talkable-widget"
        animate={{
          width: collapsed ? 300 : 440
        }}
        transition={{ type: "spring", stiffness: 360, damping: 34 }}
        data-state={voiceState}
        data-collapsed={collapsed}
      >
        <WidgetHeader
          collapsed={collapsed}
          connected={connected}
          onToggle={() => setCollapsed((value) => !value)}
        />

        <ProjectCard
          projectName={projectName}
          compact={collapsed}
          selecting={selectingProject}
          onSelectProject={selectProjectFolder}
        />

        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              className="talkable-expanded"
              initial={{ opacity: 0, height: 0, y: 8 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0, y: 8 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
            >
              <TargetCard
                pickMode={pickMode}
                selectedTarget={selectedTarget}
                onPick={() => setPickMode((value) => !value)}
                onClear={() => {
                  setSelectedElement(null);
                  setSelectedTarget(null);
                }}
              />
              <VoiceStateCard
                state={voiceState}
                recordingSeconds={recordingSeconds}
                onStart={startListening}
                onStopAndRun={stopAndRun}
                onCancel={cancelCodex}
              />
              <TranscriptCard transcript={transcript} />
              <ProgressPanels
                currentStep={currentStep}
                notes={codexNotes}
                changedFiles={changedFiles}
                canUndo={canUndo}
                onUndo={undoLastChange}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.aside>
    </>
  );
}

function WidgetHeader({
  collapsed,
  connected,
  onToggle
}: {
  collapsed: boolean;
  connected: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="talkable-header">
      <div className="talkable-brand">
        <span className="talkable-wave">
          <Waves size={18} strokeWidth={2.3} />
        </span>
        <span className="talkable-brand-text">Talkable</span>
      </div>

      <div className="talkable-header-actions">
        <span className="talkable-live" data-live={connected}>
          <span />
          {connected ? "Backend live" : "Offline"}
        </span>
        <button
          type="button"
          className="talkable-icon-button"
          aria-label={collapsed ? "Expand Talkable" : "Collapse Talkable"}
          onClick={onToggle}
        >
          {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
    </div>
  );
}

function ProjectCard({
  projectName,
  compact,
  selecting,
  onSelectProject
}: {
  projectName: string;
  compact: boolean;
  selecting: boolean;
  onSelectProject: () => void;
}) {
  return (
    <motion.div className="talkable-project" layout>
      <Folder size={16} />
      <span>{projectName}</span>
      {!compact && (
        <button
          type="button"
          className="talkable-project-action"
          disabled={selecting}
          onClick={onSelectProject}
        >
          {selecting ? "Opening..." : projectName === "Select project" ? "Select" : "Change"}
        </button>
      )}
    </motion.div>
  );
}

function TargetCard({
  pickMode,
  selectedTarget,
  onPick,
  onClear
}: {
  pickMode: boolean;
  selectedTarget: UiSelection | null;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <section className="talkable-target-card" data-active={pickMode || !!selectedTarget}>
      <div>
        <span className="talkable-section-label">UI target</span>
        <p>{selectedTarget ? getSelectionLabel(selectedTarget) : "No page element selected"}</p>
      </div>
      <div className="talkable-target-actions">
        {selectedTarget && (
          <button type="button" className="talkable-icon-button" aria-label="Clear selected UI target" onClick={onClear}>
            <Ban size={15} />
          </button>
        )}
        <button type="button" className="talkable-pick-button" data-active={pickMode} onClick={onPick}>
          <Crosshair size={16} />
          {pickMode ? "Picking..." : "Pick target"}
        </button>
      </div>
    </section>
  );
}

function VoiceStateCard({
  state,
  recordingSeconds,
  onStart,
  onStopAndRun,
  onCancel
}: {
  state: VoiceState;
  recordingSeconds: number;
  onStart: () => void;
  onStopAndRun: () => void;
  onCancel: () => void;
}) {
  const listening = state === "listening";
  const codexWorking = state === "codex_working";
  const working = state === "processing_voice" || codexWorking;
  const copy = getVoiceCopy(state);

  return (
    <motion.section className="talkable-voice-card" whileHover={{ y: -2 }}>
      <button
        type="button"
        className="talkable-mic-button"
        data-listening={listening}
        aria-label={listening ? "Stop recording and run task" : "Start Talkable listening"}
        onClick={listening ? onStopAndRun : onStart}
        disabled={working}
      >
        <span className="talkable-ring talkable-ring-one" />
        <span className="talkable-ring talkable-ring-two" />
        <Mic size={30} strokeWidth={2.4} />
      </button>
      <div className="talkable-voice-copy">
        {listening && (
          <span className="talkable-listening-badge">
            Listening now <strong>{formatTimer(recordingSeconds)}</strong>
            <em>Auto-runs after silence</em>
          </span>
        )}
        <h3>{copy.title}</h3>
        <p>{copy.helper}</p>
        <div className="talkable-command-row">
          {!listening && !working && (
            <button type="button" className="talkable-command-primary" onClick={onStart}>
              <Mic size={15} />
              Start
            </button>
          )}
          {listening && (
            <button type="button" className="talkable-command-primary" onClick={onStopAndRun}>
              <Square size={14} />
              Stop & Run
            </button>
          )}
          {codexWorking && (
            <button type="button" className="talkable-command-danger" onClick={onCancel}>
              <Ban size={15} />
              Cancel
            </button>
          )}
        </div>
      </div>
    </motion.section>
  );
}

function TranscriptCard({ transcript }: { transcript: string }) {
  return (
    <motion.section
      className="talkable-transcript"
      key={transcript || "empty"}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
    >
      <span>Backend transcript</span>
      <p data-empty={!transcript}>{transcript || "Say what you want to build..."}</p>
    </motion.section>
  );
}

function ProgressPanels({
  currentStep,
  notes,
  changedFiles,
  canUndo,
  onUndo
}: {
  currentStep: ActivityEvent;
  notes: ActivityEvent[];
  changedFiles: string[];
  canUndo: boolean;
  onUndo: () => void;
}) {
  const [notesOpen, setNotesOpen] = useState(false);

  return (
    <div className="talkable-progress-grid">
      <section className="talkable-step-card">
        <div>
          <span className="talkable-section-label">Current step</span>
          <p>{currentStep.label}</p>
        </div>
        <time>{relativeTime(currentStep.createdAt)}</time>
      </section>

      <section className="talkable-files-card">
        <div className="talkable-panel-header">
          <span className="talkable-section-label">Changed files</span>
          {canUndo && (
            <button type="button" className="talkable-undo-button" onClick={onUndo}>
              <RotateCcw size={14} />
              Undo last change
            </button>
          )}
        </div>
        {changedFiles.length > 0 ? (
          <ul>
            {changedFiles.slice(0, 5).map((file) => (
              <li key={file}>
                <FileText size={14} />
                <span>{file}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="talkable-muted">No file changes yet</p>
        )}
      </section>

      <section className="talkable-notes-card">
        <button type="button" className="talkable-notes-toggle" onClick={() => setNotesOpen((value) => !value)}>
          <span>
            <ScrollText size={15} />
            Codex notes
          </span>
          {notesOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        <AnimatePresence initial={false}>
          {notesOpen && (
            <motion.div
              className="talkable-notes-list"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              {notes.length > 0 ? (
                notes.map((note) => (
                  <p key={`${note.createdAt}-${note.label}`}>
                    {note.label}
                    <time>{relativeTime(note.createdAt)}</time>
                  </p>
                ))
              ) : (
                <p className="talkable-muted">Technical progress appears here</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}

function SelectionOverlay({
  hoverSelection,
  selectedElement,
  selectedTarget,
  pickMode,
  editing
}: {
  hoverSelection: UiSelection | null;
  selectedElement: HTMLElement | null;
  selectedTarget: UiSelection | null;
  pickMode: boolean;
  editing: boolean;
}) {
  const [trackedSelection, setTrackedSelection] = useState<UiSelection | null>(selectedTarget);

  useEffect(() => {
    if (!selectedTarget) {
      setTrackedSelection(null);
      return;
    }

    if (!selectedElement || !document.contains(selectedElement)) {
      setTrackedSelection(selectedTarget);
      return;
    }

    const element = selectedElement;

    function updateTrackedSelection() {
      setTrackedSelection(buildSelection(element));
    }

    updateTrackedSelection();
    window.addEventListener("scroll", updateTrackedSelection, true);
    window.addEventListener("resize", updateTrackedSelection);
    return () => {
      window.removeEventListener("scroll", updateTrackedSelection, true);
      window.removeEventListener("resize", updateTrackedSelection);
    };
  }, [selectedElement, selectedTarget]);

  const visibleSelection = trackedSelection ?? selectedTarget;

  return (
    <>
      {pickMode && <div className="talkable-pick-scrim">Click an element to target it. Esc cancels.</div>}
      {hoverSelection && pickMode && (
        <SelectionBox selection={hoverSelection} kind="hover" label={getSelectionLabel(hoverSelection)} />
      )}
      {visibleSelection && (
        <div className="talkable-selected-pill">
          <Crosshair size={13} />
          <span>Selected target</span>
          <strong>{getSelectionLabel(visibleSelection)}</strong>
        </div>
      )}
      {visibleSelection && (
        <SelectionBox
          selection={visibleSelection}
          kind="selected"
          label={editing ? `Editing ${getSelectionLabel(visibleSelection)}` : getSelectionLabel(visibleSelection)}
          editing={editing}
        />
      )}
    </>
  );
}

function SelectionBox({
  selection,
  kind,
  label,
  editing = false
}: {
  selection: UiSelection;
  kind: "hover" | "selected";
  label: string;
  editing?: boolean;
}) {
  return (
    <div
      className="talkable-selection-box"
      data-kind={kind}
      data-editing={editing}
      style={{
        left: selection.rect.x,
        top: selection.rect.y,
        width: selection.rect.width,
        height: selection.rect.height
      }}
    >
      <span>{label}</span>
    </div>
  );
}

function getVoiceCopy(state: VoiceState) {
  if (state === "listening") {
    return {
      title: "Listening now",
      helper: "The mic is actively recording this page edit."
    };
  }

  if (state === "processing_voice") {
    return {
      title: "Processing voice",
      helper: "Recording stopped. Waiting for backend Whisper transcription."
    };
  }

  if (state === "codex_working") {
    return {
      title: "Codex working",
      helper: "The task is running against your selected project."
    };
  }

  if (state === "done") {
    return {
      title: "Done",
      helper: "The last voice task completed."
    };
  }

  if (state === "needs_attention") {
    return {
      title: "Needs attention",
      helper: "Check backend connection, microphone permission, or project selection."
    };
  }

  return {
    title: "Backend ready",
    helper: "Tap Start or pick a UI target before speaking."
  };
}

function mapServerState(state: string): VoiceState {
  if (state === "listening") {
    return "listening";
  }

  if (state === "processing") {
    return "processing_voice";
  }

  if (state === "codex_running") {
    return "codex_working";
  }

  if (state === "done") {
    return "done";
  }

  if (state === "error" || state === "needs_attention" || state === "disconnected") {
    return "needs_attention";
  }

  return "backend_ready";
}

function getFriendlyStatusLabel(state: string, message: string) {
  if (state === "listening") {
    return "Listening";
  }

  if (state === "processing") {
    return "Creating task";
  }

  if (state === "codex_running") {
    return "Editing files";
  }

  if (state === "done") {
    return "Finished";
  }

  if (state === "ready") {
    return "Backend ready";
  }

  if (state === "disconnected") {
    return "Backend disconnected";
  }

  return message || "Needs attention";
}

function getSelectableElementAtPoint(x: number, y: number) {
  const target = document.elementFromPoint(x, y);

  if (!target) {
    return null;
  }

  return getSelectableElement(target);
}

function getSelectableElement(target: Element) {
  const widgetRoot = document.getElementById("talkable-widget-root");

  if (widgetRoot?.contains(target)) {
    return null;
  }

  const candidates = [
    ...getElementAncestors(target),
    ...target.querySelectorAll<HTMLElement>(SELECTABLE_ELEMENT_SELECTOR)
  ];
  const element = candidates.find((candidate) => isSelectableElement(candidate, widgetRoot));

  if (!element) {
    return null;
  }

  return element;
}

function getElementAncestors(element: Element) {
  const ancestors: HTMLElement[] = [];
  let current: Element | null = element;

  while (current && current !== document.documentElement) {
    if (current instanceof HTMLElement) {
      ancestors.push(current);
    }
    current = current.parentElement;
  }

  return ancestors;
}

function isSelectableElement(
  element: HTMLElement,
  widgetRoot: HTMLElement | null
) {
  if (
    widgetRoot?.contains(element) ||
    element === document.body ||
    element === document.documentElement ||
    !element.matches(SELECTABLE_ELEMENT_SELECTOR)
  ) {
    return false;
  }

  const rect = element.getBoundingClientRect();

  return rect.width >= 2 && rect.height >= 2;
}

function buildSelection(element: HTMLElement): UiSelection {
  const rect = element.getBoundingClientRect();
  const sourceFile = element.dataset.talkableSourceFile;
  const sourceLine = parsePositiveInt(element.dataset.talkableSourceLine);
  const sourceColumn = parsePositiveInt(element.dataset.talkableSourceColumn);
  const sourceComponent = element.dataset.talkableSourceComponent;
  const text = compactText(element.textContent || "");
  const ariaLabel = element.getAttribute("aria-label") || undefined;
  const className = getClassName(element);

  return {
    url: window.location.href,
    title: document.title || undefined,
    tagName: element.tagName,
    text: text || undefined,
    ariaLabel,
    className,
    selector: buildSelector(element),
    nearbyHeading: findNearbyHeading(element),
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    },
    source:
      sourceFile || sourceComponent || sourceLine || sourceColumn
        ? {
            file: sourceFile,
            component: sourceComponent,
            line: sourceLine,
            column: sourceColumn
          }
        : undefined,
    selectedAt: Date.now()
  };
}

function getSelectionLabel(selection: UiSelection) {
  if (selection.source?.component) {
    return `${selection.source.component} ${selection.tagName.toLowerCase()}`;
  }

  if (selection.text) {
    return selection.text.length > 34 ? `${selection.text.slice(0, 33)}...` : selection.text;
  }

  if (selection.className) {
    return `.${selection.className.split(/\s+/)[0]}`;
  }

  return selection.tagName.toLowerCase();
}

function buildSelector(element: HTMLElement) {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.body && parts.length < 5) {
    const tag = current.tagName.toLowerCase();
    const id = current.id && current.id !== "talkable-widget" ? `#${cssEscape(current.id)}` : "";
    const classes = getClassName(current)
      ?.split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((name) => `.${cssEscape(name)}`)
      .join("");
    parts.unshift(`${tag}${id}${classes || ""}`);
    current = current.parentElement;
  }

  return parts.join(" > ");
}

function findNearbyHeading(element: HTMLElement) {
  const section = element.closest("section, article, main, header, nav");
  const heading = section?.querySelector("h1, h2, h3, [role='heading']");
  return heading ? compactText(heading.textContent || "") || undefined : undefined;
}

function getClassName(element: Element) {
  const value = element.getAttribute("class");
  return value ? compactText(value) : undefined;
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

function parsePositiveInt(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function cssEscape(value: string) {
  if ("CSS" in window && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function getProjectName(projectPath: string) {
  const parts = projectPath.split("/").filter(Boolean);
  return parts.at(-1) ?? "";
}

function normalizeSettings(settings: Settings): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    backendUrl: normalizeBackendUrl(settings.backendUrl || DEFAULT_SETTINGS.backendUrl)
  };
}

function normalizeBackendUrl(value: string) {
  return value.replace(/\/$/, "").replace("http://localhost", "http://127.0.0.1");
}

function relativeTime(createdAt: number) {
  const seconds = Math.max(1, Math.round((Date.now() - createdAt) / 1000));

  if (seconds < 60) {
    return `${seconds} sec ago`;
  }

  return `${Math.round(seconds / 60)} min ago`;
}

function formatTimer(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
}

function waitForSocket(socketRef: React.MutableRefObject<WebSocket | null>) {
  return new Promise<void>((resolve, reject) => {
    const socket = socketRef.current;

    if (!socket) {
      reject(new Error("Socket was not created."));
      return;
    }

    if (socket.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }

    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Backend connection failed.")), {
      once: true
    });
  });
}

function scheduleReconnect(reconnectTimerRef: React.MutableRefObject<number | null>, reconnect: () => void) {
  if (reconnectTimerRef.current !== null) {
    return;
  }

  reconnectTimerRef.current = window.setTimeout(() => {
    reconnectTimerRef.current = null;
    reconnect();
  }, BACKEND_RECONNECT_DELAY_MS);
}

function clearReconnectTimer(reconnectTimerRef: React.MutableRefObject<number | null>) {
  if (reconnectTimerRef.current === null) {
    return;
  }

  window.clearTimeout(reconnectTimerRef.current);
  reconnectTimerRef.current = null;
}

function playSpeechAudio(
  base64Audio: string,
  mimeType: string,
  playbackRef: React.MutableRefObject<SpeechPlayback | null>,
  queueRef: React.MutableRefObject<SpeechClip[]>,
  speakingRef: React.MutableRefObject<boolean>
) {
  if (!base64Audio) {
    return;
  }

  queueRef.current.push({
    audio: base64Audio,
    mimeType
  });
  void playNextSpeechAudio(playbackRef, queueRef, speakingRef);
}

async function playNextSpeechAudio(
  playbackRef: React.MutableRefObject<SpeechPlayback | null>,
  queueRef: React.MutableRefObject<SpeechClip[]>,
  speakingRef: React.MutableRefObject<boolean>
) {
  if (speakingRef.current) {
    return;
  }

  const source = queueRef.current.shift();

  if (!source) {
    return;
  }

  speakingRef.current = true;

  try {
    const playback = playbackRef.current ?? createSpeechPlayback();
    playbackRef.current = playback;
    await playback.play(source);
  } finally {
    speakingRef.current = false;
    void playNextSpeechAudio(playbackRef, queueRef, speakingRef);
  }
}

function createSpeechPlayback(): SpeechPlayback {
  const AudioContextCtor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextCtor) {
    return {
      async unlock() {},
      async play(clip) {
        await playAudioElement(clip);
      },
      close() {}
    };
  }

  const audioContext = new AudioContextCtor();

  return {
    async unlock() {
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
    },
    async play(clip) {
      await this.unlock();
      const buffer = await audioContext.decodeAudioData(base64ToArrayBuffer(clip.audio));
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      await new Promise<void>((resolve) => {
        source.addEventListener("ended", () => resolve(), { once: true });
        source.start();
      });
    },
    close() {
      void audioContext.close();
    }
  };
}

function playAudioElement(clip: SpeechClip) {
  return new Promise<void>((resolve) => {
    const audio = new Audio(`data:${clip.mimeType};base64,${clip.audio}`);

    audio.addEventListener("ended", () => resolve(), { once: true });
    audio.addEventListener("error", () => resolve(), { once: true });
    audio.play().catch(() => resolve());
  });
}

function base64ToArrayBuffer(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

async function startPcmVoiceCapture(
  onChunk: (base64Pcm16: string) => void,
  onVoiceActivity: (speaking: boolean) => void
) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });

  const AudioContextCtor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextCtor) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Web Audio is not available in this browser.");
  }

  const audioContext = new AudioContextCtor();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(PCM_PROCESSOR_BUFFER_SIZE, 1, 1);
  const silentOutput = audioContext.createGain();
  let stopped = false;

  silentOutput.gain.value = 0;

  processor.onaudioprocess = (event) => {
    if (stopped) {
      return;
    }

    const input = event.inputBuffer.getChannelData(0);
    onVoiceActivity(calculateRms(input) >= SPEECH_RMS_THRESHOLD);
    const resampled = resampleToTargetRate(
      input,
      audioContext.sampleRate,
      REALTIME_SAMPLE_RATE
    );
    const base64Pcm16 = floatToPcm16Base64(resampled);

    if (base64Pcm16) {
      onChunk(base64Pcm16);
    }
  };

  source.connect(processor);
  processor.connect(silentOutput);
  silentOutput.connect(audioContext.destination);

  return {
    stop() {
      stopped = true;
      processor.disconnect();
      source.disconnect();
      silentOutput.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void audioContext.close();
    }
  };
}

function calculateRms(samples: Float32Array) {
  let sum = 0;

  for (let index = 0; index < samples.length; index += 1) {
    sum += samples[index] * samples[index];
  }

  return Math.sqrt(sum / samples.length);
}

function clearAutoRunTimer(timerRef: React.MutableRefObject<number | null>) {
  if (timerRef.current === null) {
    return;
  }

  window.clearTimeout(timerRef.current);
  timerRef.current = null;
}

function resampleToTargetRate(
  input: Float32Array,
  sourceRate: number,
  targetRate: number
) {
  if (sourceRate === targetRate) {
    return new Float32Array(input);
  }

  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const lowerIndex = Math.floor(sourceIndex);
    const upperIndex = Math.min(lowerIndex + 1, input.length - 1);
    const weight = sourceIndex - lowerIndex;
    output[index] = input[lowerIndex] * (1 - weight) + input[upperIndex] * weight;
  }

  return output;
}

function floatToPcm16Base64(samples: Float32Array) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return arrayBufferToBase64(buffer);
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function mount() {
  if (document.getElementById("talkable-widget-root")) {
    return;
  }

  const root = document.createElement("div");
  root.id = "talkable-widget-root";
  document.documentElement.append(root);
  createRoot(root).render(<TalkableWidget />);
}

mount();
