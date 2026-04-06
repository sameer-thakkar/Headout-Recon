import type { SheetData } from "@shared/schema";

export function extractBillingEntityAndTicketId(
  hoData: SheetData | null | undefined,
  spData: SheetData | null | undefined,
): { billingEntityName: string; ticketId: string } {
  let billingEntityName = "";
  let ticketId = "";

  if (hoData && hoData.rows.length > 0) {
    const firstHo = hoData.rows[0] as Record<string, unknown>;
    const raw = firstHo["billingEntityName"] || firstHo["Billing Entity Name"] || firstHo["billing_entity_name"] || firstHo["BE Name"] || firstHo["beName"] || "";
    billingEntityName = String(raw).trim();
  }

  if (spData && spData.rows.length > 0) {
    const firstSp = spData.rows[0] as Record<string, unknown>;
    const raw = firstSp["ticketId"] || firstSp["Ticket ID"] || firstSp["ticket_id"] || firstSp["Ticket Id"] || firstSp["ticketid"] || firstSp["TicketID"] || "";
    ticketId = String(raw).trim();
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
