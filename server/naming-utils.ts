import type { SheetData } from "@shared/schema";

export function extractBillingEntityAndTicketId(
  hoData: SheetData | null | undefined,
  spData: SheetData | null | undefined,
): { billingEntityName: string; ticketId: string } {
  let billingEntityName = "";
  let ticketId = "";

  if (hoData && hoData.rows.length > 0) {
    for (const row of hoData.rows) {
      const r = row as Record<string, unknown>;
      const raw = r["billingEntityName"] || r["Billing Entity Name"] || r["billing_entity_name"] || r["BE Name"] || r["beName"] || "";
      const val = String(raw).trim();
      if (val) { billingEntityName = val; break; }
    }
  }

  if (spData && spData.rows.length > 0) {
    for (const row of spData.rows) {
      const r = row as Record<string, unknown>;
      const raw = r["ticketId"] || r["Ticket ID"] || r["ticket_id"] || r["Ticket Id"] || r["ticketid"] || r["TicketID"] || "";
      const val = String(raw).trim();
      if (val && val !== "-" && val !== "—") { ticketId = val; break; }
    }
  }

  if (ticketId === "-" || ticketId === "—") ticketId = "";

  return { billingEntityName, ticketId };
}

export function buildSessionName(billingEntityName: string, ticketId: string, fallback: string): string {
  if (!billingEntityName) return fallback;
  if (ticketId) return `${billingEntityName} - ${ticketId}`;
  return billingEntityName;
}

export function buildExportName(billingEntityName: string, ticketId: string, suffix: string): string {
  const parts: string[] = [];
  if (billingEntityName) parts.push(billingEntityName);
  if (ticketId) parts.push(ticketId);
  parts.push(suffix);
  return parts.join(" - ");
}

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[\x00-\x1f"\\/:*?<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}
