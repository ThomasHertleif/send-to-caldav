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
  if (
    area === "local" &&
    changes.contextMenuData?.newValue &&
    !isContextDataLoaded
  ) {
    const contextData = changes.contextMenuData.newValue as ContextMenuData;
    // Only use if fresh (less than 10s old)
    if (Date.now() - contextData.timestamp < 10000) {
      isContextDataLoaded = true;
      if (contextData.title) titleInput.value = contextData.title;
      if (contextData.url) {
        urlInput.value = contextData.url;
        descInput.value = `Source: ${contextData.url}`;
      }
      if (contextData.selection) {
        descInput.value = `${contextData.selection}\n\nSource: ${contextData.url}`;
      }
      browser.storage.local.remove("contextMenuData");
    }
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
    if (contextData.title) titleInput.value = contextData.title;
    if (contextData.url) {
      urlInput.value = contextData.url;
      descInput.value = `Source: ${contextData.url}`;
    }
    if (contextData.selection) {
      descInput.value = `${contextData.selection}\n\nSource: ${contextData.url}`;
    }
    isContextDataLoaded = true;
    await browser.storage.local.remove("contextMenuData");
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
        descInput.value = `Source: ${tab.url}`;
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
            if (response.description)
              descInput.value =
                response.description +
                (tab.url ? `\n\nSource: ${tab.url}` : "");
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
