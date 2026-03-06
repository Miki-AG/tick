import type { TicketStatus, TicketSummary } from "@/lib/types";

export const FILTER_STATUSES: TicketStatus[] = [
  "open",
  "doing",
  "blocked",
  "done",
  "wontfix",
  "parked",
];

export function normalizeStatus(value: unknown): TicketStatus {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return FILTER_STATUSES.includes(normalized as TicketStatus)
    ? (normalized as TicketStatus)
    : "parked";
}

export function normalizeLabel(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function ticketHasLabel(ticket: TicketSummary, labelNeedle: string): boolean {
  const needle = normalizeLabel(labelNeedle);
  if (!needle) return true;

  const labels = String(ticket.labels || "")
    .split(",")
    .map((part) => normalizeLabel(part))
    .filter((part) => part.length > 0);

  return labels.includes(needle);
}

export function toTicketNumber(value: unknown): number | null {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatUpdatedParts(ticket: TicketSummary): { date: string; time: string } {
  const raw = String(ticket.updatedAt || ticket.updated || "").trim();
  if (!raw) return { date: "", time: "" };

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { date: String(ticket.updated || raw), time: "" };
  }

  return {
    date: parsed.toLocaleDateString(),
    time: parsed.toLocaleTimeString(),
  };
}

export function normalizeTicketIdForApi(value: unknown): string {
  const text = String(value || "").trim();
  if (!/^\d+$/.test(text)) return text;
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return text;
  return String(parsed).padStart(4, "0");
}

export function parseLabelsText(value: unknown): string[] {
  return String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function formatLabelsForInput(value: unknown): string {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .join(", ");
}
