import browser from "webextension-polyfill";
import { getSettings } from "../lib/storage";
import { CalDavClient, type CalendarEvent } from "../lib/caldav";
import type { ContextMenuData } from "../background";
import {
  toLocalIsoString,
  restoreDateTime,
  extractDateSuggestions,
} from "../lib/datetime";
import { renderSuggestions, applySuggestion } from "./suggestions";
import {
  type DescriptionSuggestion,
  buildDescription,
  extractDescriptionSuggestions,
  truncateText,
} from "../lib/description";

const form = document.getElementById("event-form") as HTMLFormElement;
const settingsWarning = document.getElementById(
  "settings-warning",
) as HTMLDivElement;
const settingsLink = document.getElementById(
  "settings-link",
) as HTMLAnchorElement;
const loadingOverlay = document.getElementById("loading") as HTMLDivElement;
const statusDiv = document.getElementById("status") as HTMLDivElement;
const cancelBtn = document.getElementById("cancel-btn") as HTMLButtonElement;
const suggestionsContainer = document.getElementById(
  "time-suggestions",
) as HTMLDivElement;
const suggestionsList = document.getElementById(
  "suggestions-list",
) as HTMLDivElement;
const descSuggestionsContainer = document.getElementById(
  "desc-suggestions",
) as HTMLDivElement;
const descSuggestionsList = document.getElementById(
  "desc-suggestions-list",
) as HTMLDivElement;

// Inputs
const titleInput = document.getElementById("title") as HTMLInputElement;
const allDayCheckbox = document.getElementById("all-day") as HTMLInputElement;
const startInput = document.getElementById("start") as HTMLInputElement;
const endInput = document.getElementById("end") as HTMLInputElement;
const descInput = document.getElementById("description") as HTMLTextAreaElement;
const urlInput = document.getElementById("url") as HTMLInputElement;

let isContextDataLoaded = false;

// Listen for storage changes (in case popup opens before background script saves data)
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes.contextMenuData?.newValue && !isContextDataLoaded) {
    const contextData = changes.contextMenuData.newValue as ContextMenuData;
    // Only use if fresh (less than 10s old)
    if (Date.now() - contextData.timestamp < 10000) {
      isContextDataLoaded = true;
      // If the user selected text, use it as the event title
      if (contextData.selection) {
        titleInput.value = truncateText(contextData.selection, 100);
      } else if (contextData.title) {
        titleInput.value = contextData.title;
      }
      if (contextData.url) {
        urlInput.value = contextData.url;
      }
      // Description starts with just the source URL; sibling text (if any)
      // will be filled in when it arrives via contextMenuSiblingText
      descInput.value = buildDescription("", contextData.url);
      browser.storage.local.remove("contextMenuData");
    }
  }

  // Sibling text arrives asynchronously – pre-fill it as the description body
  if (changes.contextMenuSiblingText?.newValue) {
    const { text, timestamp } = changes.contextMenuSiblingText.newValue as {
      text: string;
      timestamp: number;
    };
    if (Date.now() - timestamp < 10000 && text) {
      descInput.value = buildDescription(text, urlInput.value || undefined);
    }
    browser.storage.local.remove("contextMenuSiblingText");
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  const settings = await getSettings();
  if (!settings) {
    form.classList.add("hidden");
    settingsWarning.classList.remove("hidden");
    return;
  }

  // Initialize default times (start: next hour, end: start + 1h)
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  startInput.value = toLocalIsoString(now);

  const end = new Date(now);
  end.setHours(end.getHours() + 1);
  endInput.value = toLocalIsoString(end);

  // Wire up all-day checkbox
  allDayCheckbox.addEventListener("change", () => {
    if (allDayCheckbox.checked) {
      const dateOnly = startInput.value
        ? startInput.value.slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      startInput.type = "date";
      startInput.value = dateOnly;
      endInput.type = "date";
      endInput.value = dateOnly;
    } else {
      const selectedDate =
        startInput.value || new Date().toISOString().slice(0, 10);
      const restored = restoreDateTime(selectedDate);
      startInput.type = "datetime-local";
      startInput.value = toLocalIsoString(restored.start);
      endInput.type = "datetime-local";
      endInput.value = toLocalIsoString(restored.end);
    }
  });

  // Check for context menu data first
  const storage = await browser.storage.local.get("contextMenuData");
  const contextData = storage.contextMenuData as ContextMenuData;

  let activeTabId: number | undefined;

  if (
    !isContextDataLoaded &&
    contextData &&
    Date.now() - contextData.timestamp < 10000
  ) {
    // If the user selected text, use it as the event title
    if (contextData.selection) {
      titleInput.value = truncateText(contextData.selection, 100);
    } else if (contextData.title) {
      titleInput.value = contextData.title;
    }
    if (contextData.url) {
      urlInput.value = contextData.url;
    }
    // Description starts with just the source URL; sibling text (if any)
    // will be filled in below from contextMenuSiblingText
    descInput.value = buildDescription("", contextData.url);
    isContextDataLoaded = true;
    await browser.storage.local.remove("contextMenuData");
  }

  // Sibling text may already be in storage if the background script
  // finished extraction before the popup loaded – pre-fill it as description body.
  const siblingStorage = await browser.storage.local.get(
    "contextMenuSiblingText",
  );
  const siblingData = siblingStorage.contextMenuSiblingText as
    | { text: string; timestamp: number }
    | undefined;
  if (siblingData && Date.now() - siblingData.timestamp < 10000) {
    descInput.value = buildDescription(
      siblingData.text,
      urlInput.value || undefined,
    );
    await browser.storage.local.remove("contextMenuSiblingText");
  }

  // Get active tab (used for scraping and date extraction)
  try {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (tabs.length > 0 && tabs[0].id) {
      activeTabId = tabs[0].id;
    }

    if (!isContextDataLoaded && tabs.length > 0) {
      const tab = tabs[0];
      if (tab.title) titleInput.value = tab.title;
      if (tab.url) {
        urlInput.value = tab.url;
        descInput.value = buildDescription("", tab.url);
      }

      // Scrape OG/meta title + description
      if (tab.id) {
        try {
          const results = await browser.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              try {
                let title = document.title;
                let description = "";
                const ogTitle = document.querySelector(
                  'meta[property="og:title"]',
                );
                if (ogTitle) {
                  const c = ogTitle.getAttribute("content");
                  if (c) title = c;
                }
                const ogDesc = document.querySelector(
                  'meta[property="og:description"]',
                );
                const metaDesc = document.querySelector(
                  'meta[name="description"]',
                );
                if (ogDesc) {
                  const c = ogDesc.getAttribute("content");
                  if (c) description = c;
                } else if (metaDesc) {
                  const c = metaDesc.getAttribute("content");
                  if (c) description = c;
                }
                return { title: title.trim(), description: description.trim() };
              } catch {
                return null;
              }
            },
          });
          const response = results?.[0]?.result as {
            title: string;
            description: string;
          } | null;
          if (response && !isContextDataLoaded) {
            if (response.title) titleInput.value = response.title;
            if (response.description) {
              descInput.value = buildDescription(
                response.description,
                tab.url || undefined,
              );
            }
          }
        } catch (e) {
          console.log("Could not scrape page data", e);
        }
      }
    }
  } catch (error) {
    console.error("Error getting tab info:", error);
  }

  // Always try to extract date/time suggestions from the active tab
  if (activeTabId) {
    extractDateSuggestions(activeTabId).then((suggestions) => {
      if (suggestions.length > 0) {
        renderSuggestions(
          suggestions,
          suggestionsContainer,
          suggestionsList,
          (s) => applySuggestion(s, startInput, endInput, allDayCheckbox),
        );
      }
    });

    // Extract description suggestions from the page.
    // For context-menu flows the sibling text chip is already shown;
    // page-level suggestions are appended alongside it.
    extractDescriptionSuggestions(activeTabId).then((suggestions) => {
      if (suggestions.length > 0) {
        showDescriptionSuggestions(suggestions);
      }
    });
  }
});

settingsLink.addEventListener("click", () => {
  browser.runtime.openOptionsPage();
});

cancelBtn.addEventListener("click", () => {
  window.close();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const settings = await getSettings();
  if (!settings) return;

  if (allDayCheckbox.checked) {
    if (endInput.value < startInput.value) {
      showStatus("End date must be on or after start date.", "error");
      return;
    }
  } else {
    if (new Date(endInput.value) <= new Date(startInput.value)) {
      showStatus("End time must be after start time.", "error");
      return;
    }
  }

  showLoading(true);
  hideStatus();

  const event: CalendarEvent = allDayCheckbox.checked
    ? {
        title: titleInput.value,
        start: startInput.value,
        end: endInput.value,
        allDay: true,
        description: descInput.value || undefined,
        url: urlInput.value || undefined,
      }
    : {
        title: titleInput.value,
        start: new Date(startInput.value).toISOString(),
        end: new Date(endInput.value).toISOString(),
        description: descInput.value || undefined,
        url: urlInput.value || undefined,
      };

  try {
    const client = new CalDavClient(settings);
    await client.createEvent(event);
    showStatus("Event created successfully!", "success");
    setTimeout(() => window.close(), 1500);
  } catch (error) {
    console.error(error);
    showStatus(
      "Failed to create event: " +
        (error instanceof Error ? error.message : String(error)),
      "error",
    );
  } finally {
    showLoading(false);
  }
});

function showLoading(show: boolean) {
  loadingOverlay.style.display = show ? "flex" : "none";
}

function showStatus(msg: string, type: "success" | "error") {
  statusDiv.textContent = msg;
  statusDiv.className = type;
  statusDiv.style.display = "block";
}

function hideStatus() {
  statusDiv.style.display = "none";
}

/**
 * Render description suggestion chips. Clicking a chip replaces the
 * description body while preserving the Source URL line.
 * Chips are appended (not replaced) so sibling-text and page-level
 * suggestions can arrive independently.
 */
function showDescriptionSuggestions(suggestions: DescriptionSuggestion[]) {
  // Collect existing chip texts so we don't add duplicates
  const existing = new Set(
    Array.from(
      descSuggestionsList.querySelectorAll<HTMLElement>(".suggestion-chip"),
    ).map((el) => el.dataset.text),
  );

  for (const suggestion of suggestions) {
    if (existing.has(suggestion.text)) continue;
    existing.add(suggestion.text);

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "suggestion-chip";
    chip.dataset.text = suggestion.text;

    const preview =
      suggestion.text.length > 80
        ? `${suggestion.text.slice(0, 80)}…`
        : suggestion.text;

    chip.innerHTML =
      `<span class="chip-label">${suggestion.source}</span>` +
      `<span class="desc-chip-preview">${preview}</span>`;

    chip.addEventListener("click", () =>
      applyDescriptionSuggestion(suggestion.text),
    );
    descSuggestionsList.appendChild(chip);
  }

  descSuggestionsContainer.classList.remove("hidden");
}

/**
 * Replace the description field body with the given text, keeping the
 * "Source: <url>" line at the end.
 */
function applyDescriptionSuggestion(text: string) {
  const url = urlInput.value;
  descInput.value = buildDescription(text, url || undefined);
}
