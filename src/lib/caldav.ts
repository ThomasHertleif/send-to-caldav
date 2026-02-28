import type { CalDavSettings } from "./storage";

export interface CalendarEvent {
  title: string;
  start: string; // ISO string for timed events; YYYY-MM-DD for all-day events
  end: string; // ISO string for timed events; YYYY-MM-DD for all-day events
  allDay?: boolean;
  description?: string;
  url?: string;
}

export class CalDavClient {
  private settings: CalDavSettings;
  private authHeader: string;

  constructor(settings: CalDavSettings) {
    this.settings = settings;
    // Basic Auth header generation with UTF-8 support
    const credentials = `${settings.username}:${settings.password}`;
    const encoded = new TextEncoder().encode(credentials);
    const binary = String.fromCharCode(...encoded);
    this.authHeader = `Basic ${btoa(binary)}`;
  }

  /**
   * Validates the connection to the CalDAV server.
   * It performs a PROPFIND request to the server URL.
   */
  async checkConnection(): Promise<boolean> {
    try {
      const response = await fetch(this.settings.serverUrl, {
        method: "PROPFIND",
        headers: {
          Authorization: this.authHeader,
          Depth: "0",
          "Content-Type": "application/xml; charset=utf-8",
        },
        // Basic body to request resource type
        body: `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`,
      });

      // 200 OK or 207 Multi-Status are successful responses for WebDAV
      return response.ok;
    } catch (error) {
      console.error("CalDAV connection check failed:", error);
      return false;
    }
  }

  /**
   * Creates a new event on the CalDAV server.
   */
  async createEvent(event: CalendarEvent): Promise<void> {
    const uid = this.generateUid();
    const icsContent = this.generateIcs(event, uid);
    const filename = `${uid}.ics`;

    // Ensure URL ends with /
    const baseUrl = this.settings.serverUrl.endsWith("/")
      ? this.settings.serverUrl
      : `${this.settings.serverUrl}/`;

    const targetUrl = `${baseUrl}${filename}`;

    const response = await fetch(targetUrl, {
      method: "PUT",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "text/calendar; charset=utf-8",
        "If-None-Match": "*", // Prevent overwriting existing resource (unlikely with UUID)
      },
      body: icsContent,
    });

    if (!response.ok && response.status !== 201 && response.status !== 204) {
      throw new Error(
        `Failed to create event: ${response.status} ${response.statusText}`,
      );
    }
  }

  private generateUid(): string {
    return crypto.randomUUID();
  }

  private formatDate(dateStr: string): string {
    // Convert ISO string to iCalendar format: YYYYMMDDTHHMMSSZ
    const date = new Date(dateStr);
    // Ensure we are using UTC
    return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
  }

  /**
   * Format a YYYY-MM-DD (or ISO) string as YYYYMMDD for all-day DATE values.
   */
  private formatDateOnly(dateStr: string): string {
    // Accept both "YYYY-MM-DD" and full ISO strings
    const datePart =
      dateStr.length === 10
        ? dateStr
        : new Date(dateStr).toISOString().slice(0, 10);
    return datePart.replace(/-/g, "");
  }

  /**
   * Return the exclusive end date (start + 1 day) as YYYYMMDD, as required
   * by RFC 5545 for all-day DTEND values.
   */
  private formatDateOnlyExclusive(dateStr: string): string {
    const datePart =
      dateStr.length === 10
        ? dateStr
        : new Date(dateStr).toISOString().slice(0, 10);
    const d = new Date(`${datePart}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10).replace(/-/g, "");
  }

  private generateIcs(event: CalendarEvent, uid: string): string {
    const dtStamp = this.formatDate(new Date().toISOString());

    // All-day events use DATE values; timed events use DATETIME (UTC)
    const dtStartProp = event.allDay
      ? `DTSTART;VALUE=DATE:${this.formatDateOnly(event.start)}`
      : `DTSTART:${this.formatDate(event.start)}`;
    const dtEndProp = event.allDay
      ? `DTEND;VALUE=DATE:${this.formatDateOnlyExclusive(event.end)}`
      : `DTEND:${this.formatDate(event.end)}`;

    // Escape special characters in text fields (comma, semicolon, backslash, newline)
    const escapeText = (str: string) =>
      str.replace(/[\\;,]/g, (match) => `\\${match}`).replace(/\n/g, "\\n");

    const summary = escapeText(event.title);
    const description = event.description ? escapeText(event.description) : "";

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//SendToCal//EN",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${dtStamp}`,
      dtStartProp,
      dtEndProp,
      `SUMMARY:${summary}`,
    ];
    if (description) {
      lines.push(`DESCRIPTION:${description}`);
    }
    if (event.url) {
      lines.push(`URL:${event.url}`);
    }
    lines.push("END:VEVENT", "END:VCALENDAR");

    return lines.map((line) => this.foldLine(line)).join("\n");
  }

  /** Fold a content line at 75 octets per RFC 5545 §3.1 */
  private foldLine(line: string): string {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(line);
    if (bytes.length <= 75) return line;

    const decoder = new TextDecoder();
    const parts: string[] = [];
    let offset = 0;
    let limit = 75;

    while (offset < bytes.length) {
      let end = Math.min(offset + limit, bytes.length);
      // Avoid splitting multi-byte UTF-8 characters
      while (
        end > offset &&
        end < bytes.length &&
        (bytes[end] & 0xc0) === 0x80
      ) {
        end--;
      }
      parts.push(decoder.decode(bytes.slice(offset, end)));
      offset = end;
      limit = 74; // continuation lines have a leading space
    }

    return parts.join("\n ");
  }
}
