const form = document.getElementById("settings-form");
const status = document.getElementById("status");
const backendUrl = document.getElementById("backend-url");
const projectPath = document.getElementById("project-path");
const codexThreadId = document.getElementById("codex-thread-id");
const selectProjectFolder = document.getElementById("select-project-folder");

chrome.storage.sync.get(
  {
    backendUrl: "http://127.0.0.1:4317",
    projectPath: "",
    codexThreadId: ""
  },
  (settings) => {
    backendUrl.value = settings.backendUrl;
    projectPath.value = settings.projectPath;
    codexThreadId.value = settings.codexThreadId;
  }
);

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const values = {
    backendUrl: backendUrl.value.trim(),
    projectPath: projectPath.value.trim(),
    codexThreadId: codexThreadId.value.trim()
  };

  const validationError = validate(values);

  if (validationError) {
    status.textContent = validationError;
    return;
  }

  chrome.storage.sync.set(values, () => {
    status.textContent = "Settings saved.";
  });
});

selectProjectFolder.addEventListener("click", async () => {
  const backendValidationError = validateBackendUrl(backendUrl.value.trim());

  if (backendValidationError) {
    status.textContent = backendValidationError;
    return;
  }

  selectProjectFolder.disabled = true;
  status.textContent = "Opening folder picker...";

  try {
    const baseUrl = normalizeBackendUrl(backendUrl.value.trim());
    const healthResponse = await fetch(`${baseUrl}/health`);

    if (!healthResponse.ok) {
      status.textContent = `Backend is not healthy at ${baseUrl}.`;
      return;
    }

    const response = await fetch(
      `${baseUrl}/pick-project-path`,
      {
        method: "POST"
      }
    );
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      status.textContent = payload.message || "Could not select folder.";
      return;
    }

    projectPath.value = payload.projectPath;
    status.textContent = "Folder selected. Click Save to keep it.";
  } catch {
    status.textContent = `Backend must be running at ${normalizeBackendUrl(backendUrl.value.trim())}.`;
  } finally {
    selectProjectFolder.disabled = false;
  }
});

function validate(values) {
  const backendValidationError = validateBackendUrl(values.backendUrl);

  if (backendValidationError) {
    return backendValidationError;
  }

  if (!values.projectPath.startsWith("/")) {
    return "Project path must be an absolute path.";
  }

  return "";
}

function validateBackendUrl(value) {
  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    return "Backend URL must be valid.";
  }

  if (!["http:", "https:"].includes(parsed.protocol) || !isLocalHost(parsed.hostname)) {
    return "Backend URL must be local HTTP or HTTPS.";
  }

  return "";
}

function isLocalHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

function normalizeBackendUrl(value) {
  return value.replace(/\/$/, "").replace("http://localhost", "http://127.0.0.1");
}
