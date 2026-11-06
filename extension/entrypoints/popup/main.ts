import type {
  FocusPolicy,
  GetStateMessage,
  SetStateMessage,
  StateResponse,
  TransportMode,
} from "../../utils/types";

const toggle = document.getElementById("active-toggle") as HTMLInputElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;
const popupMark = document.getElementById("popup-mark") as HTMLImageElement;
const connectionStatus = document.getElementById("connection-status") as HTMLParagraphElement;
const focusPolicySelect = document.getElementById("focus-policy") as HTMLSelectElement;
const focusHint = document.getElementById("focus-hint") as HTMLParagraphElement;
const transportSelect = document.getElementById("transport-mode") as HTMLSelectElement;
const transportHint = document.getElementById("transport-hint") as HTMLParagraphElement;

const FOCUS_HINTS: Record<FocusPolicy, string> = {
  background: "Agents keep working without stealing your keyboard focus.",
  tab: "Switches to the automation tab inside Chrome, but leaves other apps focused.",
  window: "Brings Chrome to the front (old behavior).",
};

const TRANSPORT_HINTS: Record<TransportMode, string> = {
  scripting: "No debugging banner and nothing for sites to detect. Uses scripting + tabs APIs.",
  debugger: "Full CDP via chrome.debugger. Shows Chrome's debugging banner; some sites block it.",
};

function updateUI(state: StateResponse): void {
  toggle.checked = state.isActive;
  statusText.textContent = state.isActive ? "Active" : "Inactive";
  popupMark.src = state.isActive ? "/icons/icon-48.png" : "/icons/icon-inactive-48.png";
  focusPolicySelect.value = state.focusPolicy || "background";
  focusHint.textContent = FOCUS_HINTS[state.focusPolicy] || FOCUS_HINTS.background;
  const transportMode = state.transportMode || "scripting";
  transportSelect.value = transportMode;
  const debuggerOption = transportSelect.querySelector('option[value="debugger"]');
  if (debuggerOption instanceof HTMLOptionElement) {
    debuggerOption.disabled = state.debuggerAvailable === false;
  }
  transportHint.textContent =
    state.debuggerAvailable === false
      ? "This browser has no usable chrome.debugger; Browser Hand runs debugger-free."
      : TRANSPORT_HINTS[transportMode];

  if (state.isActive) {
    connectionStatus.textContent = state.isConnected ? "Connected to relay" : "Connecting...";
    connectionStatus.className = state.isConnected
      ? "connection-status connected"
      : "connection-status connecting";
  } else {
    connectionStatus.textContent = "";
    connectionStatus.className = "connection-status";
  }
}

function refreshState(): void {
  chrome.runtime.sendMessage<GetStateMessage, StateResponse>({ type: "getState" }, (response) => {
    if (response) {
      updateUI(response);
    }
  });
}

refreshState();

const pollInterval = setInterval(refreshState, 1000);

window.addEventListener("unload", () => {
  clearInterval(pollInterval);
});

toggle.addEventListener("change", () => {
  const isActive = toggle.checked;
  chrome.runtime.sendMessage<SetStateMessage, StateResponse>(
    { type: "setState", isActive },
    (response) => {
      if (response) {
        updateUI(response);
      }
    }
  );
});

transportSelect.addEventListener("change", () => {
  const transportMode = transportSelect.value as TransportMode;
  chrome.runtime.sendMessage<SetStateMessage, StateResponse>(
    { type: "setState", transportMode },
    (response) => {
      if (response) {
        updateUI(response);
      }
    }
  );
});

focusPolicySelect.addEventListener("change", () => {
  const focusPolicy = focusPolicySelect.value as FocusPolicy;
  chrome.runtime.sendMessage<SetStateMessage, StateResponse>(
    { type: "setState", focusPolicy },
    (response) => {
      if (response) {
        updateUI(response);
      }
    }
  );
});
