import { useMemo, useState, useRef, Fragment, useCallback, useEffect, memo, useTransition, forwardRef, useImperativeHandle } from "react";
import { Calculator, TrendingUp, TrendingDown, ArrowRight, Minus, Plus, Wallet, Loader2, AlertCircle, ChevronDown, ChevronRight, FileWarning, AlertTriangle, Check, X, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PrimaryRow, VendorBalance, PaxBreakdown } from "@shared/schema";

type PurchaseBooking = {
  bookingId: string;
  spNet: number;
  hoNet: number;
  difference: number;
  reason: string;
  tid: string;
  ticketId: string;
  paxBreakdown?: PaxBreakdown[];
  experienceDate?: string;
  bookingCreationDate?: string | null;
  paymentBasis?: string;
};

interface BookingForDispute {
  bookingId: string;
  spNet: number;
  hoNet: number;
  difference: number;
  reason: string;
}

interface PurchaseReconciliationPanelProps {
  primaryRows: PrimaryRow[];
  secondaryVendorRows?: PrimaryRow[]; // Include secondary vendor for complete SP Invoice total
  unmappedRows?: PrimaryRow[]; // SP Invoice rows with no HO match
  currency: string;
  billingEntityName: string;
  beId: string;
  onClose: () => void;
  fxRateToUsd?: number; // FX rate to convert from local currency to USD
  runId?: string | null; // Run ID for saving disputes and issues
}

const INITIAL_TID_LIMIT = 10;


interface BookingRowProps {
  booking: PurchaseBooking;
  itemId: number;
  groupIdx: number;
  tid: string;
  bookingIdx: number;
  currency: string;
  runId?: string | null;
  hasDispute: boolean;
  disputeAmount?: number;
  fnpValue: number;
  needsDisputeWarning: boolean;

  reasonName: string;
  onUpdateFnp: (bookingId: string, value: number) => void;
  onOpenIssueModal: (booking: BookingForDispute) => void;
}

const BookingRow = memo(function BookingRow({
  booking,
  itemId,
  groupIdx,
  tid,
  bookingIdx,
  currency,
  runId,
  hasDispute,
  disputeAmount,
  fnpValue,
  needsDisputeWarning,
  reasonName,
  onUpdateFnp,
  onOpenIssueModal,
}: BookingRowProps) {
  const [localFnp, setLocalFnp] = useState(String(fnpValue));
  const localFnpRef = useRef(localFnp);
  localFnpRef.current = localFnp;

  useEffect(() => {
    if (String(fnpValue) !== localFnpRef.current) {
      setLocalFnp(String(fnpValue));
    }
  }, [fnpValue]);

  const commitFnp = useCallback(() => {
    const parsed = parseFloat(localFnp) || 0;
    if (parsed !== fnpValue) {
      onUpdateFnp(booking.bookingId, parsed);
    }
  }, [localFnp, fnpValue, booking.bookingId, onUpdateFnp]);

  return (
    <Fragment key={`${itemId}-booking-${groupIdx}-${tid}-${bookingIdx}`}>
      <TableRow className={`h-8 ${hasDispute ? "bg-amber-50/50 dark:bg-amber-950/20" : needsDisputeWarning ? "bg-orange-50/50 dark:bg-orange-950/10" : ""}`}>
        <TableCell className="py-1 font-mono">
          <div className="flex items-center gap-1">
            {booking.bookingId}
            {hasDispute && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 text-amber-600 border-amber-300">
                Dispute: {disputeAmount?.toFixed(2)}
              </Badge>
            )}
          </div>
        </TableCell>
        <TableCell className="py-1 text-right font-mono">{formatNumber(booking.spNet)}</TableCell>
        <TableCell className="py-1 text-right font-mono">{formatNumber(booking.hoNet)}</TableCell>
        <TableCell className="py-1 text-right font-mono text-amber-600 dark:text-amber-400">
          {formatNumber(booking.difference)}
        </TableCell>
        <TableCell className="py-1 text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1">
            <Input
              type="number"
              step="0.01"
              className="h-6 text-xs w-28 font-mono text-right"
              value={localFnp}
              onChange={(e) => setLocalFnp(e.target.value)}
              onBlur={commitFnp}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              data-testid={`input-fnp-${booking.bookingId}`}
            />
            {needsDisputeWarning && (
              <div className="flex items-center gap-0.5 text-amber-600" title="Difference to be logged in into issue tracker">
                <AlertTriangle className="h-3.5 w-3.5" />
              </div>
            )}
          </div>
        </TableCell>
        {runId && (
          <TableCell className="py-1">
            <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs text-amber-600 opacity-50 cursor-not-allowed"
                disabled
                title="Dispute functionality coming soon"
                data-testid={`button-raise-dispute-${booking.bookingId}`}
              >
                <FileWarning className="h-3 w-3 mr-1" />
                Dispute
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs text-blue-600"
                onClick={() => onOpenIssueModal({
                  bookingId: booking.bookingId,
                  spNet: booking.spNet,
                  hoNet: booking.hoNet,
                  difference: booking.difference,
                  reason: reasonName,
                })}
                data-testid={`button-flag-issue-${booking.bookingId}`}
              >
                <AlertTriangle className="h-3 w-3 mr-1" />
                Issue
              </Button>
            </div>
          </TableCell>
        )}
      </TableRow>
    </Fragment>
  );
});

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function normalizeDate(d: string): Date | null {
  const num = Number(d);
  if (!isNaN(num) && num > 10000 && num < 100000) {
    const epoch = new Date((num - 25569) * 86400000);
    if (!isNaN(epoch.getTime())) return epoch;
  }
  const ts = Date.parse(d);
  if (!isNaN(ts)) {
    const dt = new Date(ts);
    if (dt.getFullYear() > 1900 && dt.getFullYear() < 2200) return dt;
  }
  return null;
}

interface FinalNetPriceModalHandle {
  open: (bookings: PurchaseBooking[], tid: string) => void;
}

const FinalNetPriceModal = forwardRef<FinalNetPriceModalHandle, {
  currency: string;
  onApplySpNet: (bookings: { bookingId: string; spNet: number; hoNet: number }[]) => void;
  onApplyHoNet: (bookings: { bookingId: string; spNet: number; hoNet: number }[]) => void;
  onApplyPax: (bookings: PurchaseBooking[], newPrices: Record<string, string>, dateToRowKeyMap: Map<string, string>, tid: string) => void;
}>(function FinalNetPriceModal({ currency, onApplySpNet, onApplyHoNet, onApplyPax }, ref) {
  const [isOpen, setIsOpen] = useState(false);
  const [bookings, setBookings] = useState<PurchaseBooking[]>([]);
  const [tid, setTid] = useState("");
  const [newPrices, setNewPrices] = useState<Record<string, string>>({});
  const hasPax = useMemo(() => bookings.some(b => b.paxBreakdown && b.paxBreakdown.length > 0), [bookings]);

  const paymentBasis = useMemo(() => {
    const first = bookings.find(b => b.paymentBasis);
    return first?.paymentBasis || "";
  }, [bookings]);

  const dateField = useMemo<"experienceDate" | "bookingCreationDate">(() => {
    if (paymentBasis.toUpperCase().includes("EXPERIENCE")) return "experienceDate";
    return "bookingCreationDate";
  }, [paymentBasis]);

  type PaxDateRow = {
    paxType: string;
    dateRange: string;
    dates: string[];
    count: number;
    spUnitPrice: number;
    hoUnitPrice: number;
    rowKey: string;
  };

  const formatDateShort = useCallback((d: string): string => {
    const dt = normalizeDate(d);
    if (!dt) return d;
    return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
  }, []);

  const { paxDateRows, dateToRowKeyMap } = useMemo(() => {
    const dateGroupKey = (b: PurchaseBooking) => {
      const raw = dateField === "experienceDate" ? b.experienceDate : b.bookingCreationDate;
      if (!raw) return "Unknown";
      const dt = normalizeDate(raw);
      return dt ? dt.toISOString() : "Unknown";
    };

    const byDateAndPax = new Map<string, {
      paxType: string;
      date: string;
      count: number;
      spTotal: number;
      hoUnitPrice: number;
    }>();

    for (const b of bookings) {
      if (!b.paxBreakdown) continue;
      const date = dateGroupKey(b);
      const bookingHoTotal = b.paxBreakdown.reduce((s, pb) => s + pb.priceNet, 0);
      for (const pb of b.paxBreakdown) {
        const spContribution = bookingHoTotal > 0 ? (pb.priceNet / bookingHoTotal) * b.spNet : 0;
        const key = `${pb.paxType}||${date}`;
        const existing = byDateAndPax.get(key);
        if (existing) {
          existing.count += pb.count;
          existing.spTotal += spContribution;
        } else {
          byDateAndPax.set(key, {
            paxType: pb.paxType,
            date,
            count: pb.count,
            spTotal: spContribution,
            hoUnitPrice: pb.unitPrice,
          });
        }
      }
    }

    const dateEntries = Array.from(byDateAndPax.values()).map(e => ({
      paxType: e.paxType,
      date: e.date,
      count: e.count,
      spUnitPrice: e.count > 0 ? Math.round((e.spTotal / e.count) * 100) / 100 : 0,
      hoUnitPrice: e.hoUnitPrice,
    }));

    type DateEntry = { paxType: string; date: string; count: number; spUnitPrice: number; hoUnitPrice: number };
    const byPaxType = new Map<string, DateEntry[]>();
    for (const entry of dateEntries) {
      const arr = byPaxType.get(entry.paxType) || [];
      arr.push(entry);
      byPaxType.set(entry.paxType, arr);
    }

    const toDateOnly = (d: string): string => {
      const dt = normalizeDate(d);
      if (!dt) return "";
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    };

    const rows: PaxDateRow[] = [];
    const dtRowKeyMap = new Map<string, string>();

    for (const [paxType, paxEntries] of Array.from(byPaxType.entries())) {
      const unknowns = paxEntries.filter((e: DateEntry) => toDateOnly(e.date) === "");
      const dated = paxEntries.filter((e: DateEntry) => toDateOnly(e.date) !== "");

      dated.sort((a: DateEntry, b: DateEntry) => toDateOnly(a.date).localeCompare(toDateOnly(b.date)));

      const runs: DateEntry[][] = [];
      for (const entry of dated) {
        const lastRun = runs[runs.length - 1];
        if (lastRun) {
          const lastEntry = lastRun[lastRun.length - 1];
          const samePrice = lastEntry.spUnitPrice === entry.spUnitPrice && lastEntry.hoUnitPrice === entry.hoUnitPrice;
          if (samePrice) {
            lastRun.push(entry);
            continue;
          }
        }
        runs.push([entry]);
      }

      for (const run of runs) {
        const totalCount = run.reduce((s: number, e: DateEntry) => s + e.count, 0);
        const firstDate = run[0].date;
        const lastDate = run[run.length - 1].date;
        const dateRange = run.length === 1
          ? formatDateShort(firstDate)
          : `${formatDateShort(firstDate)} - ${formatDateShort(lastDate)}`;
        const rowKey = `${paxType}__${dateRange}`;
        rows.push({
          paxType,
          dateRange,
          dates: run.map((e: DateEntry) => e.date),
          count: totalCount,
          spUnitPrice: run[0].spUnitPrice,
          hoUnitPrice: run[0].hoUnitPrice,
          rowKey,
        });
        for (const e of run) {
          dtRowKeyMap.set(`${paxType}||${e.date}`, rowKey);
        }
      }

      const unknownByPrice = new Map<string, DateEntry[]>();
      for (const u of unknowns) {
        const pk = `${u.spUnitPrice}||${u.hoUnitPrice}`;
        const arr = unknownByPrice.get(pk) || [];
        arr.push(u);
        unknownByPrice.set(pk, arr);
      }
      let unknownIdx = 0;
      for (const [, uGroup] of Array.from(unknownByPrice.entries())) {
        const totalCount = uGroup.reduce((s: number, e: DateEntry) => s + e.count, 0);
        const suffix = unknownByPrice.size > 1 ? `Unknown_${++unknownIdx}` : "Unknown";
        const rowKey = `${paxType}__${suffix}`;
        rows.push({
          paxType,
          dateRange: suffix,
          dates: [suffix],
          count: totalCount,
          spUnitPrice: uGroup[0].spUnitPrice,
          hoUnitPrice: uGroup[0].hoUnitPrice,
          rowKey,
        });
        for (const e of uGroup) {
          dtRowKeyMap.set(`${paxType}||${e.date}`, rowKey);
        }
      }
    }

    rows.sort((a, b) => a.paxType.localeCompare(b.paxType) || (a.dates[0] || "").localeCompare(b.dates[0] || ""));
    return { paxDateRows: rows, dateToRowKeyMap: dtRowKeyMap };
  }, [bookings, dateField, formatDateShort]);

  const spTotal = useMemo(() => bookings.reduce((s, b) => s + b.spNet, 0), [bookings]);
  const hoTotal = useMemo(() => bookings.reduce((s, b) => s + b.hoNet, 0), [bookings]);

  useImperativeHandle(ref, () => ({
    open: (tidBookings: PurchaseBooking[], tidVal: string) => {
      setNewPrices({});
      setBookings(tidBookings);
      setTid(tidVal);
      setIsOpen(true);
    }
  }));

  const handleApplySpNet = useCallback(() => {
    setIsOpen(false);
    onApplySpNet(bookings);
  }, [bookings, onApplySpNet]);

  const handleApplyHoNet = useCallback(() => {
    setIsOpen(false);
    onApplyHoNet(bookings);
  }, [bookings, onApplyHoNet]);

  const allPaxFilled = useMemo(() => {
    if (!hasPax || paxDateRows.length === 0) return false;
    for (const row of paxDateRows) {
      const val = newPrices[row.rowKey];
      if (val === undefined || val === "") return false;
    }
    return true;
  }, [hasPax, paxDateRows, newPrices]);

  const handleApplyPax = useCallback(() => {
    if (!allPaxFilled) return;
    setIsOpen(false);
    onApplyPax(bookings, newPrices, dateToRowKeyMap, tid);
  }, [bookings, newPrices, dateToRowKeyMap, tid, onApplyPax, allPaxFilled]);

  const formatDisplayName = (paxType: string) =>
    paxType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  const renderPaxBreakdownTable = (priceSource: "sp" | "ho") => {
    if (!hasPax || paxDateRows.length === 0) return null;
    return (
      <div className="rounded-md border overflow-hidden mt-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Pax Type</TableHead>
              <TableHead className="text-xs text-right">Count</TableHead>
              <TableHead className="text-xs text-right">Unit Price ({currency})</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paxDateRows.map((row) => (
              <TableRow key={row.rowKey}>
                <TableCell className="text-xs font-medium">{formatDisplayName(row.paxType)}</TableCell>
                <TableCell className="text-xs text-right font-mono">{row.count}</TableCell>
                <TableCell className="text-xs text-right font-mono">{formatNumber(priceSource === "sp" ? row.spUnitPrice : row.hoUnitPrice)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5 text-primary" />
            Update Final Net Price
          </DialogTitle>
          <DialogDescription>
            Choose how to update Final Net Price for {bookings.length} bookings in TID {tid}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-3 pr-1" data-testid="modal-scroll-area">
          <div className="rounded-md border bg-background overflow-hidden">
            <div
              className="flex items-center justify-between px-4 py-3 cursor-pointer hover-elevate"
              onClick={handleApplySpNet}
              data-testid={`modal-btn-spnet-${tid}`}
            >
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center h-8 w-8 rounded-md bg-blue-100 dark:bg-blue-900/30">
                  <TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <div className="text-sm font-medium">Update to SP Net</div>
                  <div className="text-xs text-muted-foreground">
                    Set Final Net Price = SP Net for all bookings (Total: {formatNumber(spTotal)} {currency})
                  </div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>
            {hasPax && (
              <div className="px-4 pb-3">
                {renderPaxBreakdownTable("sp")}
              </div>
            )}
          </div>

          <div className="rounded-md border bg-background overflow-hidden">
            <div
              className="flex items-center justify-between px-4 py-3 cursor-pointer hover-elevate"
              onClick={handleApplyHoNet}
              data-testid={`modal-btn-honet-${tid}`}
            >
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center h-8 w-8 rounded-md bg-green-100 dark:bg-green-900/30">
                  <TrendingDown className="h-4 w-4 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <div className="text-sm font-medium">Update to HO Net</div>
                  <div className="text-xs text-muted-foreground">
                    Set Final Net Price = HO Net for all bookings (Total: {formatNumber(hoTotal)} {currency})
                  </div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>
            {hasPax && (
              <div className="px-4 pb-3">
                {renderPaxBreakdownTable("ho")}
              </div>
            )}
          </div>

          {hasPax && (
            <div className="rounded-md border bg-background overflow-hidden">
              <div className="px-4 py-3 border-b bg-muted/30">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-8 w-8 rounded-md bg-violet-100 dark:bg-violet-900/30">
                    <Calculator className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">Update based on Pax Type</div>
                    <div className="text-xs text-muted-foreground">Enter final unit price per pax type to recalculate Final Net Price</div>
                  </div>
                </div>
              </div>
              <div className="p-3 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-xs mb-2">
                  <div className="rounded-md border p-2 bg-blue-50 dark:bg-blue-900/20">
                    <span className="text-muted-foreground">SP Net Total:</span>{" "}
                    <span className="font-mono font-semibold text-blue-700 dark:text-blue-300">{formatNumber(spTotal)} {currency}</span>
                  </div>
                  <div className="rounded-md border p-2 bg-green-50 dark:bg-green-900/20">
                    <span className="text-muted-foreground">HO Net Total:</span>{" "}
                    <span className="font-mono font-semibold text-green-700 dark:text-green-300">{formatNumber(hoTotal)} {currency}</span>
                  </div>
                </div>
                {paymentBasis && (
                  <div className="text-xs text-muted-foreground mb-1">
                    Grouped by: <span className="font-medium text-foreground">{dateField === "experienceDate" ? "Experience Date" : "Booking Creation Date"}</span>
                    <span className="ml-1">(Payment Basis: {paymentBasis})</span>
                  </div>
                )}
                <div className="rounded-md border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Pax Type</TableHead>
                        <TableHead className="text-xs">{dateField === "experienceDate" ? "Experience Date" : "Booking Date"}</TableHead>
                        <TableHead className="text-xs text-right">Count</TableHead>
                        <TableHead className="text-xs text-right">SP Unit ({currency})</TableHead>
                        <TableHead className="text-xs text-right">HO Unit ({currency})</TableHead>
                        <TableHead className="text-xs text-right">Final Price ({currency})</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paxDateRows.map((row) => (
                        <TableRow key={row.rowKey}>
                          <TableCell className="text-xs font-medium">{formatDisplayName(row.paxType)}</TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">{row.dateRange}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{row.count}</TableCell>
                          <TableCell className="text-xs text-right font-mono text-muted-foreground">
                            {formatNumber(row.spUnitPrice)}
                          </TableCell>
                          <TableCell className="text-xs text-right font-mono text-muted-foreground">
                            {formatNumber(row.hoUnitPrice)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="Enter price"
                              value={newPrices[row.rowKey] ?? ""}
                              onChange={(e) => setNewPrices(prev => ({ ...prev, [row.rowKey]: e.target.value }))}
                              className="w-28 text-xs font-mono text-right ml-auto"
                              data-testid={`input-pax-price-${row.rowKey}`}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-xs text-muted-foreground">
                    New FNP = Sum of (Count x Final Price) per pax type
                  </p>
                  <Button
                    size="sm"
                    onClick={handleApplyPax}
                    disabled={!allPaxFilled}
                    data-testid="button-apply-pax-update"
                  >
                    <Check className="h-3.5 w-3.5 mr-1.5" />
                    Apply Pax Prices
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-md border p-3 bg-muted/50">
            <p className="text-xs text-muted-foreground">
              Applies to <span className="font-semibold">{bookings.length}</span> bookings in TID <span className="font-mono font-medium">{tid}</span>
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});

interface DisputeModalHandle {
  open: (booking: BookingForDispute) => void;
}

const DisputeModal = forwardRef<DisputeModalHandle, {
  currency: string;
  onSave: (booking: BookingForDispute, amount: number) => Promise<void>;
}>(function DisputeModal({ currency, onSave }, ref) {
  const [isOpen, setIsOpen] = useState(false);
  const [booking, setBooking] = useState<BookingForDispute | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  useImperativeHandle(ref, () => ({
    open: (b: BookingForDispute) => {
      setBooking(b);
      setAmountInput(Math.abs(b.difference).toFixed(2));
      setIsOpen(true);
    }
  }));

  const handleSave = useCallback(async () => {
    if (!booking) return;
    const amount = parseFloat(amountInput);
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid dispute amount greater than zero.",
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);
    try {
      await onSave(booking, amount);
      setIsOpen(false);
      setBooking(null);
      setAmountInput("");
    } catch {
      toast({
        title: "Error",
        description: "Failed to save dispute. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }, [booking, amountInput, onSave, toast]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileWarning className="h-5 w-5 text-amber-600" />
            Raise Dispute
          </DialogTitle>
          <DialogDescription>
            Create a dispute for this booking that will appear in the Dispute Tracker.
          </DialogDescription>
        </DialogHeader>
        {booking && (
          <div className="space-y-4">
            <div className="rounded-md border p-3 bg-muted/50 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Booking ID:</span>
                <span className="font-mono font-medium">{booking.bookingId}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Reason:</span>
                <Badge variant="outline" className="text-xs">{booking.reason}</Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">SP Net:</span>
                <span className="font-mono">{formatNumber(booking.spNet)} {currency}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">HO Net:</span>
                <span className="font-mono">{formatNumber(booking.hoNet)} {currency}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Difference:</span>
                <span className="font-mono text-amber-600 font-semibold">{formatNumber(booking.difference)} {currency}</span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Dispute Amount ({currency})</label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="Enter dispute amount"
                data-testid="input-dispute-amount"
              />
              <p className="text-xs text-muted-foreground">
                Max dispute: {formatNumber(Math.abs(booking.difference))} {currency}
              </p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => { setIsOpen(false); setBooking(null); setAmountInput(""); }}
            data-testid="button-cancel-dispute"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            data-testid="button-submit-dispute"
          >
            {isSaving ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</>
            ) : (
              <><Check className="h-4 w-4 mr-2" />Raise Dispute</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

interface IssueModalHandle {
  open: (booking: BookingForDispute) => void;
}

const IssueModal = forwardRef<IssueModalHandle, {
  currency: string;
  billingEntityName: string;
  effectiveFxRate: number | null;
  onSave: (booking: BookingForDispute) => Promise<void>;
}>(function IssueModal({ currency, billingEntityName, effectiveFxRate, onSave }, ref) {
  const [isOpen, setIsOpen] = useState(false);
  const [booking, setBooking] = useState<BookingForDispute | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  useImperativeHandle(ref, () => ({
    open: (b: BookingForDispute) => {
      setBooking(b);
      setIsOpen(true);
    }
  }));

  const handleSave = useCallback(async () => {
    if (!booking) return;
    setIsSaving(true);
    try {
      await onSave(booking);
      setIsOpen(false);
      setBooking(null);
    } catch {
      toast({
        title: "Error",
        description: "Failed to flag issue. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }, [booking, onSave, toast]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-blue-600" />
            Flag Issue
          </DialogTitle>
          <DialogDescription>
            Create an issue for this booking that will appear in the Issue Tracker.
          </DialogDescription>
        </DialogHeader>
        {booking && (
          <div className="space-y-4">
            <div className="rounded-md border p-3 bg-muted/50 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Booking ID:</span>
                <span className="font-mono font-medium">{booking.bookingId}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Reason:</span>
                <Badge variant="outline" className="text-xs">{booking.reason}</Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Discrepancy ({currency}):</span>
                <span className="font-mono text-amber-600 font-semibold">{formatNumber(booking.difference)}</span>
              </div>
              {effectiveFxRate && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Discrepancy (USD):</span>
                  <span className="font-mono text-muted-foreground">{formatNumber(booking.difference * effectiveFxRate)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Billing Entity:</span>
                <span className="font-medium">{billingEntityName}</span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              This issue will be assigned to the appropriate DRI team based on the reason classification.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => { setIsOpen(false); setBooking(null); }}
            data-testid="button-cancel-issue"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            data-testid="button-submit-issue"
          >
            {isSaving ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</>
            ) : (
              <><Check className="h-4 w-4 mr-2" />Flag Issue</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

interface TidGroupProps {
  tidKey: string;
  tid: string;
  tidBookings: PurchaseBooking[];
  itemId: number;
  groupIdx: number;
  currency: string;
  runId?: string | null;
  reasonName: string;
  isExpanded: boolean;
  onToggle: (key: string) => void;
  activeDisputes: Set<string>;
  disputeAmounts: Map<string, number>;
  loggedIssues: Set<string>;
  getFinalNetPrice: (bookingId: string, defaultSpNet: number) => number;
  updateFinalNetPrice: (bookingId: string, value: number) => void;
  openFnpModal: (tidBookings: PurchaseBooking[], tid: string) => void;
  handleTidBulkIssue: (tidBookings: PurchaseBooking[], reason: string, tid: string) => void;
  openIssueModal: (booking: BookingForDispute) => void;
}

const TidGroup = memo(function TidGroup({
  tidKey, tid, tidBookings, itemId, groupIdx, currency, runId, reasonName,
  isExpanded, onToggle, activeDisputes, disputeAmounts, loggedIssues,
  getFinalNetPrice, updateFinalNetPrice, openFnpModal,
  handleTidBulkIssue, openIssueModal,
}: TidGroupProps) {
  const tidTotal = useMemo(() => tidBookings.reduce((s, b) => s + b.difference, 0), [tidBookings]);

  return (
    <div className="rounded-md border bg-background overflow-hidden">
      <div
        className="flex items-center justify-between px-3 py-1.5 bg-muted/30 cursor-pointer hover-elevate"
        onClick={() => onToggle(tidKey)}
        data-testid={`tid-header-${itemId}-${groupIdx}-${tid}`}
      >
        <div className="flex items-center gap-2">
          {isExpanded ? <ChevronDown className="h-3 w-3 text-primary" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          <span className="font-mono text-xs font-medium">TID: {tid}</span>
          <Badge variant="secondary" className="text-[10px]">{tidBookings.length}</Badge>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono text-amber-600 dark:text-amber-400 font-semibold">
            {formatNumber(tidTotal)} {currency}
          </span>
        </div>
      </div>
      {isExpanded && (
        <div>
          <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/10" onClick={(e) => e.stopPropagation()}>
            <Button
              size="sm"
              variant="outline"
              className="text-[10px]"
              onClick={() => openFnpModal(tidBookings, tid)}
              data-testid={`button-update-fnp-${tid}`}
            >
              <Pencil className="h-3 w-3 mr-1" />
              Update Final Net Price
            </Button>
            <div className="flex-1" />
            {runId && (
              <>
                <Button size="sm" variant="ghost" className="text-[10px] text-amber-600 opacity-50 cursor-not-allowed" disabled title="Dispute functionality coming soon" data-testid={`button-tid-bulk-dispute-${tid}`}>
                  <FileWarning className="h-3 w-3 mr-0.5" />
                  Dispute All
                </Button>
                <Button size="sm" variant="ghost" className="text-[10px] text-blue-600" onClick={() => handleTidBulkIssue(tidBookings, reasonName, tid)} data-testid={`button-tid-bulk-issue-${tid}`}>
                  <AlertTriangle className="h-3 w-3 mr-0.5" />
                  Issue All
                </Button>
              </>
            )}
          </div>
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="h-7">
                <TableHead className="py-1 text-xs">Booking ID</TableHead>
                <TableHead className="py-1 text-xs text-right">SP Net ({currency})</TableHead>
                <TableHead className="py-1 text-xs text-right">HO Net ({currency})</TableHead>
                <TableHead className="py-1 text-xs text-right">Difference ({currency})</TableHead>
                <TableHead className="py-1 text-xs text-right">Final Net Price ({currency})</TableHead>
                {runId && <TableHead className="py-1 text-xs text-center">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tidBookings.map((booking, bookingIdx) => {
                const hasDispute = activeDisputes.has(booking.bookingId);
                const disputeAmt = disputeAmounts.get(booking.bookingId);
                const fnp = getFinalNetPrice(booking.bookingId, booking.spNet);
                const fnpDiffersFromSp = Math.abs(fnp - booking.spNet) > 0.01;
                const needsDisputeWarning = fnpDiffersFromSp && !loggedIssues.has(booking.bookingId);
                return (
                  <BookingRow
                    key={`${itemId}-booking-${groupIdx}-${tid}-${bookingIdx}`}
                    booking={booking}
                    itemId={itemId}
                    groupIdx={groupIdx}
                    tid={tid}
                    bookingIdx={bookingIdx}
                    currency={currency}
                    runId={runId}
                    hasDispute={hasDispute}
                    disputeAmount={disputeAmt}
                    fnpValue={fnp}
                    needsDisputeWarning={needsDisputeWarning}
                    reasonName={reasonName}
                    onUpdateFnp={updateFinalNetPrice}
                    onOpenIssueModal={openIssueModal}
                  />
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
});

interface ReasonGroupProps {
  itemId: number;
  groupIdx: number;
  reasonGroup: {
    reason: string;
    count: number;
    totalDifference: number;
    tidEntries: [string, PurchaseBooking[]][];
  };
  currency: string;
  runId?: string | null;
  isReasonExpanded: boolean;
  expandedTids: Set<string>;
  visibleTidCount: number;
  onToggleReason: (key: string) => void;
  onToggleTid: (key: string) => void;
  onShowMoreTids: (reasonKey: string, totalCount: number) => void;
  activeDisputes: Set<string>;
  disputeAmounts: Map<string, number>;
  loggedIssues: Set<string>;
  getFinalNetPrice: (bookingId: string, defaultSpNet: number) => number;
  updateFinalNetPrice: (bookingId: string, value: number) => void;
  openFnpModal: (tidBookings: PurchaseBooking[], tid: string) => void;
  handleTidBulkIssue: (tidBookings: PurchaseBooking[], reason: string, tid: string) => void;
  openIssueModal: (booking: BookingForDispute) => void;
}

const ReasonGroup = memo(function ReasonGroup({
  itemId, groupIdx, reasonGroup, currency, runId,
  isReasonExpanded, expandedTids, visibleTidCount,
  onToggleReason, onToggleTid, onShowMoreTids,
  activeDisputes, disputeAmounts, loggedIssues,
  getFinalNetPrice, updateFinalNetPrice, openFnpModal,
  handleTidBulkIssue, openIssueModal,
}: ReasonGroupProps) {
  const reasonKey = `${itemId}-${reasonGroup.reason}`;
  const tidEntries = reasonGroup.tidEntries;
  const visibleTids = tidEntries.slice(0, visibleTidCount);
  const hasMore = tidEntries.length > visibleTidCount;

  return (
    <div className="rounded-md border bg-background overflow-hidden">
      <div
        className="flex items-center justify-between px-3 py-2 bg-muted/50 cursor-pointer hover-elevate"
        onClick={() => onToggleReason(reasonKey)}
        data-testid={`reason-header-${itemId}-${groupIdx}`}
      >
        <div className="flex items-center gap-2">
          {isReasonExpanded ? <ChevronDown className="h-4 w-4 text-primary" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <span className="font-medium text-sm">{reasonGroup.reason}</span>
          <Badge variant="secondary" className="text-xs">{reasonGroup.count} items</Badge>
          <Badge variant="outline" className="text-xs">{tidEntries.length} TIDs</Badge>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">Total:</span>
          <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
            {formatNumber(reasonGroup.totalDifference)} {currency}
          </span>
        </div>
      </div>
      {isReasonExpanded && (
        <div className="space-y-1 p-2">
          {visibleTids.map(([tid, tidBookings]) => {
            const tidKey = `${itemId}-${reasonGroup.reason}-${tid}`;
            const isTidExpanded = expandedTids.has(tidKey);
            return (
              <TidGroup
                key={tidKey}
                tidKey={tidKey}
                tid={tid}
                tidBookings={tidBookings}
                itemId={itemId}
                groupIdx={groupIdx}
                currency={currency}
                runId={runId}
                reasonName={reasonGroup.reason}
                isExpanded={isTidExpanded}
                onToggle={onToggleTid}
                activeDisputes={activeDisputes}
                disputeAmounts={disputeAmounts}
                loggedIssues={loggedIssues}
                getFinalNetPrice={getFinalNetPrice}
                updateFinalNetPrice={updateFinalNetPrice}
                openFnpModal={openFnpModal}
                handleTidBulkIssue={handleTidBulkIssue}
                openIssueModal={openIssueModal}
              />
            );
          })}
          {hasMore && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => onShowMoreTids(reasonKey, tidEntries.length)}
              data-testid={`button-show-more-tids-${reasonKey}`}
            >
              Show More ({tidEntries.length - visibleTidCount} remaining)
            </Button>
          )}
        </div>
      )}
    </div>
  );
});

export function PurchaseReconciliationPanel({
  primaryRows,
  secondaryVendorRows = [],
  unmappedRows = [],
  currency,
  billingEntityName,
  beId,
  onClose,
  fxRateToUsd,
  runId,
}: PurchaseReconciliationPanelProps) {
  const { toast } = useToast();
  
  // State for expanded rows (line items 10 and 11)
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  // State for expanded reason groups within rows 10 and 11
  const [expandedReasons, setExpandedReasons] = useState<Set<string>>(new Set());
  // State for expanded TID groups within reason groups
  const [expandedTids, setExpandedTids] = useState<Set<string>>(new Set());
  // State for visible TID count per reason group (pagination)
  const [visibleTidCounts, setVisibleTidCounts] = useState<Map<string, number>>(new Map());
  // Final Net Price state: bookingId → final net price (defaults to SP Net)
  const [finalNetPrices, setFinalNetPrices] = useState<Map<string, number>>(new Map());
  const finalNetPricesRef = useRef(finalNetPrices);
  finalNetPricesRef.current = finalNetPrices;
  const [isPriceUpdatePending, startPriceTransition] = useTransition();
  
  // Dispute tracking state
  const [activeDisputes, setActiveDisputes] = useState<Set<string>>(new Set());
  const [disputeAmounts, setDisputeAmounts] = useState<Map<string, number>>(new Map());
  const [disputesLoaded, setDisputesLoaded] = useState(false);
  
  // Track bookings that have had issues logged (to suppress warning)
  const [loggedIssues, setLoggedIssues] = useState<Set<string>>(new Set());
  
  // Imperative refs for modals (state lives inside modal components, not here)
  const fnpModalRef = useRef<FinalNetPriceModalHandle>(null);
  const disputeModalRef = useRef<DisputeModalHandle>(null);
  const issueModalRef = useRef<IssueModalHandle>(null);
  
  const effectiveFxRate = useMemo(() => {
    if (fxRateToUsd) return fxRateToUsd;
    if (currency === "USD") return 1;
    return null;
  }, [fxRateToUsd, currency]);
  
  // Load existing disputes when runId changes
  useEffect(() => {
    if (runId) {
      setActiveDisputes(new Set());
      setDisputeAmounts(new Map());
      setLoggedIssues(new Set());
      
      fetch(`/api/disputes/${runId}`)
        .then(res => res.json())
        .then(data => {
          const disputes = data.disputes || [];
          const newActiveDisputes = new Set<string>();
          const newDisputeAmounts = new Map<string, number>();
          for (const d of disputes) {
            if (d.closureStatus === "open") {
              newActiveDisputes.add(d.bookingId);
              newDisputeAmounts.set(d.bookingId, d.disputeAmount);
            }
          }
          setActiveDisputes(newActiveDisputes);
          setDisputeAmounts(newDisputeAmounts);
          setDisputesLoaded(true);
        })
        .catch(err => {
          console.error("Failed to load existing disputes:", err);
          setDisputesLoaded(true);
        });
    } else {
      setActiveDisputes(new Set());
      setDisputeAmounts(new Map());
      setLoggedIssues(new Set());
      setDisputesLoaded(false);
    }
  }, [runId]); // Only depend on runId, reload when it changes
  
  const [, startExpandTransition] = useTransition();

  const toggleRowExpand = useCallback((rowId: number) => {
    startExpandTransition(() => {
      setExpandedRows(prev => {
        const next = new Set(prev);
        if (next.has(rowId)) next.delete(rowId);
        else next.add(rowId);
        return next;
      });
    });
  }, []);
  
  const toggleReasonExpand = useCallback((key: string) => {
    startExpandTransition(() => {
      setExpandedReasons(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    });
  }, []);
  
  const toggleTidExpand = useCallback((key: string) => {
    startExpandTransition(() => {
      setExpandedTids(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    });
  }, []);

  const getVisibleTidCount = useCallback((reasonKey: string) => {
    return visibleTidCounts.get(reasonKey) || INITIAL_TID_LIMIT;
  }, [visibleTidCounts]);

  const showMoreTids = useCallback((reasonKey: string, totalCount: number) => {
    setVisibleTidCounts(prev => {
      const next = new Map(prev);
      const current = prev.get(reasonKey) || INITIAL_TID_LIMIT;
      next.set(reasonKey, Math.min(current + INITIAL_TID_LIMIT, totalCount));
      return next;
    });
  }, []);

  const getFinalNetPrice = useCallback((bookingId: string, defaultSpNet: number) => {
    return finalNetPricesRef.current.has(bookingId) ? finalNetPricesRef.current.get(bookingId)! : defaultSpNet;
  }, []);

  const updateFinalNetPrice = useCallback((bookingId: string, value: number) => {
    startPriceTransition(() => {
      setFinalNetPrices(prev => {
        const next = new Map(prev);
        next.set(bookingId, value);
        return next;
      });
    });
  }, []);

  const openFnpModal = useCallback((tidBookings: PurchaseBooking[], tid: string) => {
    fnpModalRef.current?.open(tidBookings, tid);
  }, []);

  const handlePaxApply = useCallback((bookings: PurchaseBooking[], newPrices: Record<string, string>, dtRowKeyMap: Map<string, string>, tid: string) => {
    const paymentBasisVal = bookings.find(b => b.paymentBasis)?.paymentBasis || "";
    const useDateField: "experienceDate" | "bookingCreationDate" =
      paymentBasisVal.toUpperCase().includes("EXPERIENCE") ? "experienceDate" : "bookingCreationDate";

    startPriceTransition(() => {
      setFinalNetPrices(prev => {
        const next = new Map(prev);
        for (const booking of bookings) {
          if (!booking.paxBreakdown || booking.paxBreakdown.length === 0) continue;
          const rawDate = (useDateField === "experienceDate" ? booking.experienceDate : booking.bookingCreationDate) || "";
          const dtObj = normalizeDate(rawDate);
          const bookingDate = dtObj ? dtObj.toISOString() : "Unknown";
          let newTotal = 0;
          for (const pb of booking.paxBreakdown) {
            const lookupKey = `${pb.paxType}||${bookingDate}`;
            const rowKey = dtRowKeyMap.get(lookupKey);
            const priceStr = rowKey ? newPrices[rowKey] : undefined;
            const parsedPrice = priceStr ? parseFloat(priceStr) : NaN;
            const finalPrice = !isNaN(parsedPrice) ? parsedPrice : pb.unitPrice;
            newTotal += pb.count * finalPrice;
          }
          next.set(booking.bookingId, Math.round(newTotal * 100) / 100);
        }
        return next;
      });
    });
    toast({
      title: "Pax prices updated",
      description: `Final Net Price recalculated for ${bookings.length} bookings in TID ${tid}.`,
    });
  }, [toast]);

  const applyBulkFinalNetPrice = useCallback((source: "spNet" | "hoNet", bookings: { bookingId: string; spNet: number; hoNet: number }[]) => {
    startPriceTransition(() => {
      setFinalNetPrices(prev => {
        const next = new Map(prev);
        for (const b of bookings) {
          next.set(b.bookingId, source === "spNet" ? b.spNet : b.hoNet);
        }
        return next;
      });
    });
    toast({
      title: "Bulk Update Applied",
      description: `Final Net Price set to ${source === "spNet" ? "SP Net" : "HO Net"} for ${bookings.length} bookings.`,
    });
  }, [toast]);

  const handleApplySpNet = useCallback((bookings: { bookingId: string; spNet: number; hoNet: number }[]) => {
    applyBulkFinalNetPrice("spNet", bookings);
  }, [applyBulkFinalNetPrice]);

  const handleApplyHoNet = useCallback((bookings: { bookingId: string; spNet: number; hoNet: number }[]) => {
    applyBulkFinalNetPrice("hoNet", bookings);
  }, [applyBulkFinalNetPrice]);

  const handleTidBulkDispute = useCallback(async (tidBookings: PurchaseBooking[], reason: string) => {
    if (!runId) return;
    let count = 0;
    for (const booking of tidBookings) {
      if (activeDisputes.has(booking.bookingId)) continue;
      try {
        await apiRequest("POST", `/api/disputes/${runId}`, {
          bookingId: booking.bookingId,
          billingEntityId: beId,
          billingEntityName: billingEntityName,
          ticketId: booking.ticketId,
          tid: booking.tid,
          currency: currency,
          disputeAmount: Math.abs(booking.difference),
          maxDisputeAmount: Math.abs(booking.difference),
          reconciledNet: Math.abs(booking.hoNet),
          status: "pending",
          closureStatus: "open",
        });
        setActiveDisputes(prev => { const next = new Set(prev); next.add(booking.bookingId); return next; });
        setDisputeAmounts(prev => { const next = new Map(prev); next.set(booking.bookingId, Math.abs(booking.difference)); return next; });
        count++;
      } catch (err) {
        console.error(`Failed to raise dispute for ${booking.bookingId}:`, err);
      }
    }
    if (count > 0) {
      toast({ title: "Bulk Disputes Raised", description: `${count} disputes raised for TID group.` });
      queryClient.invalidateQueries({ queryKey: [`/api/disputes/${runId}`] });
    }
  }, [runId, activeDisputes, beId, billingEntityName, currency, toast]);

  const handleTidBulkIssue = useCallback(async (tidBookings: PurchaseBooking[], reason: string, tid: string) => {
    if (!runId) return;
    const fxRate = effectiveFxRate || 1;
    let driTeam = "Finance";
    if (reason.includes("Cancelled")) driTeam = "Operations";
    else if (reason.includes("NPD") || reason.includes("MTB")) driTeam = "Supplier Management";
    const totalDiscrepancy = tidBookings.reduce((sum, b) => sum + b.difference, 0);
    try {
      await apiRequest("POST", `/api/issues`, {
        runId,
        createdDate: new Date().toISOString(),
        billingEntityId: beId,
        billingEntityName: billingEntityName,
        currency: currency,
        discrepancyLocal: totalDiscrepancy,
        discrepancyUsd: totalDiscrepancy * fxRate,
        reason: reason,
        driTeam: driTeam,
        bookingIds: tidBookings.map(b => b.bookingId),
        ticketId: tidBookings[0]?.ticketId || "",
        tid: tid,
      });
      setLoggedIssues(prev => { const next = new Set(prev); tidBookings.forEach(b => next.add(b.bookingId)); return next; });
      toast({ title: "Issue Flagged", description: `Issue created for TID ${tid} with ${tidBookings.length} bookings.` });
      queryClient.invalidateQueries({ queryKey: [`/api/issues/${runId}`] });
    } catch (err) {
      console.error("Failed to flag TID issue:", err);
      toast({ title: "Error", description: "Failed to flag issue.", variant: "destructive" });
    }
  }, [runId, beId, billingEntityName, currency, effectiveFxRate, toast]);

  const openDisputeModal = useCallback((booking: BookingForDispute) => {
    disputeModalRef.current?.open(booking);
  }, []);

  const handleDisputeSave = useCallback(async (booking: BookingForDispute, amount: number) => {
    if (!runId) return;
    const allRowsArr = [...primaryRows, ...secondaryVendorRows, ...unmappedRows];
    const bookingRow = allRowsArr.find(r => r.bookingId === booking.bookingId);
    
    await apiRequest("POST", `/api/disputes/${runId}`, {
      bookingId: booking.bookingId,
      billingEntityId: beId,
      billingEntityName: billingEntityName,
      ticketId: bookingRow?.ticketId || "",
      tid: bookingRow?.tid || "",
      currency: currency,
      disputeAmount: amount,
      maxDisputeAmount: Math.abs(booking.difference),
      reconciledNet: Math.abs(booking.hoNet),
      status: "pending",
      closureStatus: "open",
    });
    
    setActiveDisputes(prev => { const next = new Set(prev); next.add(booking.bookingId); return next; });
    setDisputeAmounts(prev => { const next = new Map(prev); next.set(booking.bookingId, amount); return next; });
    
    toast({
      title: "Dispute Raised",
      description: `Dispute for ${amount.toFixed(2)} ${currency} raised for booking ${booking.bookingId}.`,
    });
    queryClient.invalidateQueries({ queryKey: [`/api/disputes/${runId}`] });
  }, [runId, beId, billingEntityName, currency, primaryRows, secondaryVendorRows, unmappedRows, toast]);

  const openIssueModal = useCallback((booking: BookingForDispute) => {
    issueModalRef.current?.open(booking);
  }, []);

  const handleIssueSave = useCallback(async (booking: BookingForDispute) => {
    if (!runId) return;
    const allRowsArr = [...primaryRows, ...secondaryVendorRows, ...unmappedRows];
    const bookingRow = allRowsArr.find(r => r.bookingId === booking.bookingId);
    
    let driTeam = "Finance";
    if (booking.reason.includes("Cancelled")) {
      driTeam = "Operations";
    } else if (booking.reason.includes("NPD") || booking.reason.includes("MTB")) {
      driTeam = "Supplier Management";
    }
    
    const fxRate = effectiveFxRate || 1;
    
    await apiRequest("POST", `/api/issues`, {
      runId,
      createdDate: new Date().toISOString(),
      billingEntityId: beId,
      billingEntityName: billingEntityName,
      currency: currency,
      discrepancyLocal: booking.difference,
      discrepancyUsd: booking.difference * fxRate,
      reason: booking.reason,
      driTeam: driTeam,
      bookingIds: [booking.bookingId],
      ticketId: bookingRow?.ticketId || "",
      tid: bookingRow?.tid || "",
    });
    
    setLoggedIssues(prev => { const next = new Set(prev); next.add(booking.bookingId); return next; });
    
    toast({
      title: "Issue Flagged",
      description: `Issue created for booking ${booking.bookingId}. Check Issue Tracker for details.`,
    });
    queryClient.invalidateQueries({ queryKey: [`/api/issues/${runId}`] });
  }, [runId, beId, billingEntityName, currency, effectiveFxRate, primaryRows, secondaryVendorRows, unmappedRows, toast]);
  
  // Remove dispute handler
  const handleRemoveDispute = useCallback(async (bookingId: string) => {
    if (!runId) return;
    
    try {
      await apiRequest("DELETE", `/api/disputes/${runId}/${bookingId}`);
      
      setActiveDisputes(prev => {
        const next = new Set(prev);
        next.delete(bookingId);
        return next;
      });
      setDisputeAmounts(prev => {
        const next = new Map(prev);
        next.delete(bookingId);
        return next;
      });
      
      toast({
        title: "Dispute Removed",
        description: `Dispute for booking ${bookingId} has been removed.`,
      });
      
      queryClient.invalidateQueries({ queryKey: [`/api/disputes/${runId}`] });
    } catch (error) {
      console.error("Failed to remove dispute:", error);
      toast({
        title: "Error",
        description: "Failed to remove dispute. Please try again.",
        variant: "destructive",
      });
    }
  }, [runId, toast]);
  
  // Combine all rows for complete SP Invoice calculations (primary + secondary + unmapped)
  const allRows = useMemo(() => [...primaryRows, ...secondaryVendorRows, ...unmappedRows], [primaryRows, secondaryVendorRows, unmappedRows]);
  const { data: balanceData, isLoading: isLoadingBalance } = useQuery<{ balance: VendorBalance | null }>({
    queryKey: ['/api/vendor-balances', beId],
    enabled: !!beId,
  });

  const balance = balanceData?.balance;
  const hasBalance = !!balance;

  const calculations = useMemo(() => {
    const openingBalance = balance?.openingBalance ?? 0;
    const reloads = balance?.reloads ?? 0;
    const closingBalance = balance?.closingBalance ?? 0;
    
    // Refunds: All negative SP values from entire SP Invoice (primary + secondary)
    const refunds = allRows
      .filter(row => row.spNetInHo < 0)
      .reduce((sum, row) => sum + row.spNetInHo, 0);
    
    const computedPurchase = openingBalance + reloads + refunds - closingBalance;
    
    // Actual Purchase: Total from entire SP Invoice data (primary + secondary)
    const actualPurchase = allRows.reduce((sum, row) => sum + row.spNetInHo, 0);
    
    const timingDifference = computedPurchase - actualPurchase;
    
    // Purchases as per HO: Only primary vendor fulfillments (HO Net)
    const purchasesAsPerHO = primaryRows
      .filter(row => !row.isSecondaryVendor)
      .reduce((sum, row) => sum + row.hoNet, 0);
    
    const difference = purchasesAsPerHO - actualPurchase;
    
    // In SP not in HO: From all rows where SP Net > HO Net
    const inSPNotInHO = allRows
      .filter(row => row.spNetInHo > row.hoNet)
      .reduce((sum, row) => sum + (row.spNetInHo - row.hoNet), 0);
    
    // In HO not in SP: From all rows where HO Net > SP Net
    const inHONotInSP = allRows
      .filter(row => row.hoNet > row.spNetInHo)
      .reduce((sum, row) => sum + (row.hoNet - row.spNetInHo), 0);

    const netDifference = difference + inSPNotInHO - inHONotInSP;
    
    // Breakup data for row 10: In SP not in HO (grouped by reason)
    const row10ByReason = new Map<string, PurchaseBooking[]>();
    allRows
      .filter(row => row.spNetInHo > row.hoNet)
      .forEach(row => {
        const reason = row.reason || "Unknown";
        if (!row10ByReason.has(reason)) {
          row10ByReason.set(reason, []);
        }
        row10ByReason.get(reason)!.push({
          bookingId: row.bookingId,
          spNet: row.spNetInHo,
          hoNet: row.hoNet,
          difference: row.spNetInHo - row.hoNet,
          reason,
          tid: row.tid || "Unknown",
          ticketId: row.ticketId || "",
          paxBreakdown: row.paxBreakdown,
          experienceDate: row.experienceDate,
          bookingCreationDate: row.bookingCreationDate,
          paymentBasis: row.paymentBasis,
        });
      });
    
    // Convert to array and sort by total discrepancy
    const row10Breakup = Array.from(row10ByReason.entries())
      .map(([reason, bookings]) => ({
        reason,
        bookings: bookings.sort((a, b) => b.difference - a.difference),
        totalDifference: bookings.reduce((sum, b) => sum + b.difference, 0),
        count: bookings.length,
      }))
      .sort((a, b) => b.totalDifference - a.totalDifference);
    
    // Breakup data for row 11: In HO not in SP (grouped by reason)
    const row11ByReason = new Map<string, PurchaseBooking[]>();
    allRows
      .filter(row => row.hoNet > row.spNetInHo)
      .forEach(row => {
        const reason = row.reason || "Unknown";
        if (!row11ByReason.has(reason)) {
          row11ByReason.set(reason, []);
        }
        row11ByReason.get(reason)!.push({
          bookingId: row.bookingId,
          spNet: row.spNetInHo,
          hoNet: row.hoNet,
          difference: row.hoNet - row.spNetInHo,
          reason,
          tid: row.tid || "Unknown",
          ticketId: row.ticketId || "",
          paxBreakdown: row.paxBreakdown,
          experienceDate: row.experienceDate,
          bookingCreationDate: row.bookingCreationDate,
          paymentBasis: row.paymentBasis,
        });
      });
    
    // Convert to array and sort by total discrepancy
    const row11Breakup = Array.from(row11ByReason.entries())
      .map(([reason, bookings]) => ({
        reason,
        bookings: bookings.sort((a, b) => b.difference - a.difference),
        totalDifference: bookings.reduce((sum, b) => sum + b.difference, 0),
        count: bookings.length,
      }))
      .sort((a, b) => b.totalDifference - a.totalDifference);

    const precomputeTidGroups = (breakup: typeof row10Breakup) => {
      return breakup.map(reasonGroup => {
        const tidMap = new Map<string, typeof reasonGroup.bookings>();
        for (const b of reasonGroup.bookings) {
          const tid = b.tid || "Unknown";
          if (!tidMap.has(tid)) tidMap.set(tid, []);
          tidMap.get(tid)!.push(b);
        }
        const tidEntries = Array.from(tidMap.entries()).sort((a, b) => {
          const totalA = a[1].reduce((s, x) => s + x.difference, 0);
          const totalB = b[1].reduce((s, x) => s + x.difference, 0);
          return totalB - totalA;
        });
        return { ...reasonGroup, tidEntries };
      });
    };

    const row10WithTids = precomputeTidGroups(row10Breakup);
    const row11WithTids = precomputeTidGroups(row11Breakup);

    return {
      openingBalance,
      reloads,
      refunds,
      closingBalance,
      computedPurchase,
      actualPurchase,
      timingDifference,
      purchasesAsPerHO,
      difference,
      inSPNotInHO,
      inHONotInSP,
      netDifference,
      row10Breakup,
      row11Breakup,
      row10WithTids,
      row11WithTids,
    };
  }, [allRows, primaryRows, balance]);

  const lineItems = useMemo(() => [
    {
      id: 1,
      label: "Opening Balance",
      value: calculations.openingBalance,
      description: hasBalance ? "From database" : "Not configured",
      icon: Wallet,
      isFromDb: true,
    },
    {
      id: 2,
      label: "Reloads",
      value: calculations.reloads,
      description: hasBalance ? "From database" : "Not configured",
      icon: Plus,
      isFromDb: true,
    },
    {
      id: 3,
      label: "Refunds",
      value: calculations.refunds,
      description: "SP Invoice negative values",
      icon: Minus,
    },
    {
      id: 4,
      label: "Closing Balance",
      value: calculations.closingBalance,
      description: hasBalance ? "From database" : "Not configured",
      icon: Wallet,
      isFromDb: true,
    },
    {
      id: 5,
      label: "Computed Purchase",
      value: calculations.computedPurchase,
      description: "= 1 + 2 + 3 - 4",
      icon: Calculator,
      isFormula: true,
    },
    {
      id: 6,
      label: "Actual Purchase",
      value: calculations.actualPurchase,
      description: "Total from SP Invoice data",
      icon: TrendingUp,
    },
    {
      id: 7,
      label: "Timing Difference in Closing Balance",
      value: calculations.timingDifference,
      description: "= 5 - 6",
      icon: ArrowRight,
      isFormula: true,
    },
    {
      id: 8,
      label: "Purchases as per HO",
      value: calculations.purchasesAsPerHO,
      description: "Total of primary fulfillments (HO Net)",
      icon: TrendingUp,
    },
    {
      id: 9,
      label: "Difference",
      value: calculations.difference,
      description: "= 8 - 6",
      icon: ArrowRight,
      isFormula: true,
      isHighlight: true,
    },
    {
      id: 10,
      label: "In SP data not in HO",
      value: calculations.inSPNotInHO,
      description: "Sum where SP Net > HO Net",
      icon: TrendingDown,
      isReco: true,
    },
    {
      id: 11,
      label: "In HO data not in SP",
      value: calculations.inHONotInSP,
      description: "Sum where HO Net > SP Net",
      icon: TrendingUp,
      isReco: true,
    },
    {
      id: 12,
      label: "Net Difference",
      value: calculations.netDifference,
      description: "= 9 + 10 - 11 (should be 0)",
      icon: Calculator,
      isFormula: true,
      isValidation: true,
    },
  ], [calculations, hasBalance]);

  if (!beId) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md">
          <Wallet className="h-5 w-5 text-amber-600" />
          <span className="text-amber-800 dark:text-amber-200">
            No Billing Entity ID available. Cannot load balance data.
          </span>
        </div>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose} data-testid="button-close-purchase-reco">
            Close
          </Button>
        </div>
      </div>
    );
  }

  if (isLoadingBalance) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading balances...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calculator className="h-5 w-5 text-primary" />
          <span className="font-semibold">Purchase Reconciliation</span>
          <Badge variant="outline" className="text-xs">
            {currency}
          </Badge>
          {isPriceUpdatePending && (
            <Badge variant="secondary" className="text-xs animate-pulse">
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
              Updating...
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            PORTAL_DEPOSIT
          </Badge>
          {beId && (
            <Badge variant="outline" className="text-xs font-mono">
              BE: {beId}
            </Badge>
          )}
        </div>
      </div>

      {!hasBalance && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <span className="text-sm text-amber-800 dark:text-amber-200">
            No balances configured for this BE ID. Upload balances from the home page to enable accurate calculations.
          </span>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <span>{billingEntityName || "Supplier"}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table className="text-sm">
            <TableHeader>
              <TableRow className="h-8">
                <TableHead className="py-1.5 text-xs w-8">#</TableHead>
                <TableHead className="py-1.5 text-xs">Line Item</TableHead>
                <TableHead className="py-1.5 text-xs text-right">Amount ({currency})</TableHead>
                <TableHead className="py-1.5 text-xs text-right">Amount (USD)</TableHead>
                <TableHead className="py-1.5 text-xs">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineItems.map((item) => {
                const IconComponent = item.icon;
                const isNegative = item.value < 0;
                const isPositive = item.value > 0;
                const usdValue = effectiveFxRate ? item.value * effectiveFxRate : null;
                const isUsdNegative = usdValue !== null && usdValue < 0;
                const isUsdPositive = usdValue !== null && usdValue > 0;
                const breakupData = item.id === 10 ? calculations.row10Breakup : item.id === 11 ? calculations.row11Breakup : [];
                const breakupWithTids = item.id === 10 ? calculations.row10WithTids : item.id === 11 ? calculations.row11WithTids : [];
                const hasBreakup = (item.id === 10 || item.id === 11) && breakupData.length > 0;
                const isExpanded = expandedRows.has(item.id);
                
                return (
                  <Fragment key={item.id}>
                    <TableRow 
                      className={`h-10 ${item.isHighlight ? "bg-primary/5" : ""} ${item.isReco ? "bg-muted/50" : ""} ${item.isValidation ? (item.value === 0 ? "bg-green-50 dark:bg-green-950/30 border-t-2 border-green-200 dark:border-green-800" : "bg-red-50 dark:bg-red-950/30 border-t-2 border-red-200 dark:border-red-800") : ""} ${hasBreakup ? "cursor-pointer hover-elevate" : ""}`}
                      data-testid={`purchase-reco-row-${item.id}`}
                      onClick={hasBreakup ? () => toggleRowExpand(item.id) : undefined}
                    >
                      <TableCell className="py-2 font-mono text-xs text-muted-foreground">
                        {item.id}
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="flex items-center gap-2">
                          {hasBreakup && (
                            isExpanded ? <ChevronDown className="h-4 w-4 text-primary" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                          <IconComponent className={`h-4 w-4 ${item.isFormula ? "text-blue-500" : "text-muted-foreground"}`} />
                          <span className={`${item.isHighlight ? "font-semibold" : ""}`}>
                            {item.label}
                          </span>
                          {item.isFromDb && !hasBalance && (
                            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                              Not set
                            </Badge>
                          )}
                          {hasBreakup && (
                            <Badge variant="secondary" className="text-xs">
                              {breakupData.length} items
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className={`py-2 text-right font-mono ${isNegative ? "text-red-600 dark:text-red-400" : isPositive && item.isHighlight ? "text-green-600 dark:text-green-400" : ""}`}>
                        {formatNumber(item.value)}
                      </TableCell>
                      <TableCell className={`py-2 text-right font-mono ${isUsdNegative ? "text-red-600 dark:text-red-400" : isUsdPositive && item.isHighlight ? "text-green-600 dark:text-green-400" : ""}`}>
                        {usdValue !== null ? formatNumber(usdValue) : "-"}
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground">
                        {item.description}
                        {hasBreakup && <span className="ml-1 text-primary">(click to expand)</span>}
                      </TableCell>
                    </TableRow>
                    {hasBreakup && isExpanded && (
                      <TableRow className="bg-muted/30">
                        <TableCell colSpan={5} className="py-3 px-8">
                          <div className="space-y-2">
                            {breakupWithTids.map((reasonGroup, groupIdx) => {
                              const reasonKey = `${item.id}-${reasonGroup.reason}`;
                              const isReasonExpanded = expandedReasons.has(reasonKey);
                              const visibleCount = getVisibleTidCount(reasonKey);
                              return (
                                <ReasonGroup
                                  key={`${item.id}-reason-${groupIdx}`}
                                  itemId={item.id}
                                  groupIdx={groupIdx}
                                  reasonGroup={reasonGroup}
                                  currency={currency}
                                  runId={runId}
                                  isReasonExpanded={isReasonExpanded}
                                  expandedTids={expandedTids}
                                  visibleTidCount={visibleCount}
                                  onToggleReason={toggleReasonExpand}
                                  onToggleTid={toggleTidExpand}
                                  onShowMoreTids={showMoreTids}
                                  activeDisputes={activeDisputes}
                                  disputeAmounts={disputeAmounts}
                                  loggedIssues={loggedIssues}
                                  getFinalNetPrice={getFinalNetPrice}
                                  updateFinalNetPrice={updateFinalNetPrice}
                                  openFnpModal={openFnpModal}
                                  handleTidBulkIssue={handleTidBulkIssue}
                                  openIssueModal={openIssueModal}
                                />
                              );
                            })}
                            <div className="flex items-center justify-end gap-3 pt-2 border-t text-sm">
                              <span className="text-muted-foreground">Grand Total ({breakupData.reduce((sum, g) => sum + g.count, 0)} items):</span>
                              <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                                {formatNumber(breakupData.reduce((sum, g) => sum + g.totalDifference, 0))} {currency}
                              </span>
                              {effectiveFxRate && (
                                <span className="font-mono text-muted-foreground">
                                  ({formatNumber(breakupData.reduce((sum, g) => sum + g.totalDifference, 0) * effectiveFxRate)} USD)
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>

          <Separator className="my-4" />

          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Reconciliation Summary:</span>
              <Badge variant={calculations.netDifference === 0 ? "default" : "destructive"}>
                {calculations.netDifference === 0 ? "Balanced" : "Unbalanced"}
              </Badge>
              {effectiveFxRate && effectiveFxRate !== 1 && (
                <Badge variant="outline" className="text-xs">
                  FX Rate: {effectiveFxRate.toFixed(6)}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <span className="text-xs text-muted-foreground">Net Difference (Line 12)</span>
                <p className={`font-mono font-semibold ${calculations.netDifference !== 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                  {formatNumber(calculations.netDifference)} {currency}
                  {effectiveFxRate && (
                    <span className="text-xs text-muted-foreground ml-2">
                      ({formatNumber(calculations.netDifference * effectiveFxRate)} USD)
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end pt-2">
        <Button variant="outline" size="sm" onClick={onClose} data-testid="button-close-purchase-reco">
          Close
        </Button>
      </div>
      
      <FinalNetPriceModal
        ref={fnpModalRef}
        currency={currency}
        onApplySpNet={handleApplySpNet}
        onApplyHoNet={handleApplyHoNet}
        onApplyPax={handlePaxApply}
      />
      <DisputeModal ref={disputeModalRef} currency={currency} onSave={handleDisputeSave} />
      <IssueModal ref={issueModalRef} currency={currency} billingEntityName={billingEntityName} effectiveFxRate={effectiveFxRate} onSave={handleIssueSave} />
    </div>
  );
}
