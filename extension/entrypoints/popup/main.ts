import type {
  FocusPolicy,
  GetStateMessage,
  SetStateMessage,
  StateResponse,
} from "../../utils/types";

const toggle = document.getElementById("active-toggle") as HTMLInputElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;
const popupMark = document.getElementById("popup-mark") as HTMLImageElement;
const connectionStatus = document.getElementById("connection-status") as HTMLParagraphElement;
const focusPolicySelect = document.getElementById("focus-policy") as HTMLSelectElement;
const focusHint = document.getElementById("focus-hint") as HTMLParagraphElement;

const FOCUS_HINTS: Record<FocusPolicy, string> = {
  background: "Agents keep working without stealing your keyboard focus.",
  tab: "Switches to the automation tab inside Chrome, but leaves other apps focused.",
  window: "Brings Chrome to the front (old behavior).",
};

function updateUI(state: StateResponse): void {
  toggle.checked = state.isActive;
  statusText.textContent = state.isActive ? "Active" : "Inactive";
  popupMark.src = state.isActive ? "/icons/icon-48.png" : "/icons/icon-inactive-48.png";
  focusPolicySelect.value = state.focusPolicy || "background";
  focusHint.textContent = FOCUS_HINTS[state.focusPolicy] || FOCUS_HINTS.background;

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
