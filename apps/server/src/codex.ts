import {
  Codex,
  type FileChangeItem,
  type Thread,
  type ThreadEvent,
  type ThreadItem,
} from "@openai/codex-sdk";
import type { ServerEvent, UiSelection } from "@talkable/shared";

type CodexRunOptions = {
  projectPath: string;
  threadId?: string;
  task: string;
  selectedTarget?: UiSelection;
  signal: AbortSignal;
  send: (event: ServerEvent) => void;
  onThreadId: (threadId: string) => void;
  onDone?: (summary: string) => void | Promise<void>;
  onFailed?: (message: string) => void | Promise<void>;
};

type CodexRunResult = {
  completed: boolean;
  changedFiles: string[];
};

const codex = new Codex();

export async function runCodexTask(
  options: CodexRunOptions,
): Promise<CodexRunResult> {
  const thread = createThread(options.projectPath, options.threadId);
  const prompt = buildCodexPrompt(
    options.task,
    options.projectPath,
    options.selectedTarget,
  );
  const changedFiles = new Set<string>();
  let finalSummary = "";

  options.send({
    type: "status",
    state: "codex_running",
    message: "Codex is working on the voice task.",
  });

  try {
    const { events } = await thread.runStreamed(prompt, {
      signal: options.signal,
    });

    for await (const event of events) {
      handleCodexEvent(event, {
        thread,
        changedFiles,
        send: options.send,
        onThreadId: options.onThreadId,
        onSummary: (summary) => {
          finalSummary = summary;
        },
      });
    }

    const summary = finalSummary || "Codex completed the task.";

    options.send({
      type: "codex.done",
      summary,
      changedFiles: [...changedFiles],
      undoAvailable: false,
    });
    options.send({
      type: "status",
      state: "done",
      message: "Codex task completed.",
    });
    await options.onDone?.(summary);
    return {
      completed: true,
      changedFiles: [...changedFiles],
    };
  } catch (error) {
    if (options.signal.aborted) {
      options.send({
        type: "status",
        state: "ready",
        message: "Codex task was cancelled.",
      });
      return {
        completed: false,
        changedFiles: [...changedFiles],
      };
    }

    const message =
      error instanceof Error ? error.message : "Codex run failed.";
    options.send({
      type: "error",
      code: "codex_run_failed",
      message,
      recoverable: true,
      nextAction: "Check Codex CLI authentication and retry the voice task.",
    });
    options.send({
      type: "status",
      state: "error",
      message: "Codex run failed.",
    });
    await options.onFailed?.(message);
    return {
      completed: false,
      changedFiles: [...changedFiles],
    };
  }
}

function createThread(projectPath: string, threadId?: string): Thread {
  const options = {
    workingDirectory: projectPath,
    skipGitRepoCheck: true,
    sandboxMode: "workspace-write" as const,
    approvalPolicy: "on-request" as const,
  };

  if (threadId) {
    return codex.resumeThread(threadId, options);
  }

  return codex.startThread(options);
}

function buildCodexPrompt(
  task: string,
  projectPath: string,
  selectedTarget?: UiSelection,
) {
  const prompt = [
    `Project path: ${projectPath}`,
    "",
    "You are receiving a task dictated through Talkable voice control.",
    "Implement the requested project change in this repository, keep edits focused, and run appropriate verification if practical.",
  ];

  if (selectedTarget) {
    prompt.push(
      "",
      "Selected UI target:",
      formatSelectedTarget(selectedTarget),
    );
  }

  prompt.push("", "Voice task:", task);

  return prompt.join("\n");
}

function formatSelectedTarget(selection: UiSelection) {
  const source = selection.source;
  const lines = [
    `URL: ${selection.url}`,
    `Element: <${selection.tagName.toLowerCase()}>`,
  ];

  if (source?.file) {
    lines.push(
      `Source: ${source.file}${source.line ? `:${source.line}` : ""}${
        source.column ? `:${source.column}` : ""
      }${source.component ? ` (${source.component})` : ""}`,
    );
  }

  if (selection.className) {
    lines.push(`Class: ${selection.className}`);
  }

  if (selection.ariaLabel) {
    lines.push(`ARIA label: ${selection.ariaLabel}`);
  }

  if (selection.text) {
    lines.push(`Text: ${selection.text}`);
  }

  if (selection.nearbyHeading) {
    lines.push(`Nearby heading: ${selection.nearbyHeading}`);
  }

  if (selection.selector) {
    lines.push(`Selector fallback: ${selection.selector}`);
  }

  lines.push(
    `Viewport rect: x=${Math.round(selection.rect.x)}, y=${Math.round(
      selection.rect.y,
    )}, width=${Math.round(selection.rect.width)}, height=${Math.round(
      selection.rect.height,
    )}`,
  );

  return lines.join("\n");
}

function handleCodexEvent(
  event: ThreadEvent,
  context: {
    thread: Thread;
    changedFiles: Set<string>;
    send: (event: ServerEvent) => void;
    onThreadId: (threadId: string) => void;
    onSummary: (summary: string) => void;
  },
) {
  switch (event.type) {
    case "thread.started": {
      context.onThreadId(event.thread_id);
      context.send({
        type: "codex.thread",
        threadId: event.thread_id,
      });
      return;
    }

    case "turn.started": {
      const threadId = context.thread.id;

      if (threadId) {
        context.onThreadId(threadId);
        context.send({
          type: "codex.thread",
          threadId,
        });
      }

      context.send({
        type: "codex.progress",
        message: "Codex turn started.",
      });
      return;
    }

    case "turn.completed": {
      context.send({
        type: "codex.progress",
        message: "Codex turn completed.",
        details: {
          usage: event.usage,
        },
      });
      return;
    }

    case "turn.failed": {
      context.send({
        type: "error",
        code: "codex_run_failed",
        message: event.error.message,
        recoverable: true,
        nextAction: "Review the Codex error and retry.",
      });
      return;
    }

    case "item.started":
    case "item.updated":
    case "item.completed": {
      handleCodexItem(event.item, context);
      return;
    }

    case "error": {
      context.send({
        type: "error",
        code: "codex_run_failed",
        message: event.message,
        recoverable: true,
        nextAction: "Review the Codex error and retry.",
      });
    }
  }
}

function handleCodexItem(
  item: ThreadItem,
  context: {
    changedFiles: Set<string>;
    send: (event: ServerEvent) => void;
    onSummary: (summary: string) => void;
  },
) {
  switch (item.type) {
    case "agent_message": {
      context.onSummary(item.text);
      context.send({
        type: "codex.progress",
        message: truncate(item.text, 220),
      });
      return;
    }

    case "command_execution": {
      context.send({
        type: "codex.progress",
        message:
          item.status === "in_progress"
            ? `Running: ${item.command}`
            : `Command ${item.status}: ${item.command}`,
        details: {
          command: item.command,
          status: item.status,
          exitCode: item.exit_code,
        },
      });
      return;
    }

    case "file_change": {
      handleFileChange(item, context);
      return;
    }

    case "todo_list": {
      const completed = item.items.filter((todo) => todo.completed).length;
      context.send({
        type: "codex.progress",
        message: `Codex checklist: ${completed}/${item.items.length} complete.`,
        details: {
          items: item.items,
        },
      });
      return;
    }

    case "error": {
      context.send({
        type: "error",
        code: "codex_run_failed",
        message: item.message,
        recoverable: true,
        nextAction: "Review the Codex error and retry.",
      });
      return;
    }
  }
}

function handleFileChange(
  item: FileChangeItem,
  context: {
    changedFiles: Set<string>;
    send: (event: ServerEvent) => void;
  },
) {
  for (const change of item.changes) {
    context.changedFiles.add(change.path);
    context.send({
      type: "codex.file_changed",
      path: change.path,
      action:
        change.kind === "add"
          ? "created"
          : change.kind === "delete"
            ? "deleted"
            : "updated",
    });
  }
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}
