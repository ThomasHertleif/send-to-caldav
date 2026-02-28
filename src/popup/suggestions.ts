import {
  type DateTimeSuggestion,
  formatSuggestion,
  toLocalIsoString,
} from "../lib/datetime";

/**
 * Render a list of date/time suggestion chips into the given container.
 */
export function renderSuggestions(
  suggestions: DateTimeSuggestion[],
  container: HTMLDivElement,
  list: HTMLDivElement,
  onApply: (s: DateTimeSuggestion) => void,
): void {
  list.innerHTML = "";

  for (const suggestion of suggestions) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "suggestion-chip";
    chip.innerHTML = `${formatSuggestion(suggestion)} <span class="chip-label">(${suggestion.label})</span>`;
    chip.addEventListener("click", () => onApply(suggestion));
    list.appendChild(chip);
  }

  container.classList.remove("hidden");
}

/**
 * Apply a DateTimeSuggestion to the start/end inputs.
 */
export function applySuggestion(
  s: DateTimeSuggestion,
  startInput: HTMLInputElement,
  endInput: HTMLInputElement,
  allDayCheckbox: HTMLInputElement,
): void {
  const start = new Date(s.start);
  const end = s.end ? new Date(s.end) : new Date(start.getTime() + 3_600_000);

  if (allDayCheckbox.checked) {
    allDayCheckbox.checked = false;
    startInput.type = "datetime-local";
    endInput.type = "datetime-local";
  }

  startInput.value = toLocalIsoString(start);
  endInput.value = toLocalIsoString(end);
}
