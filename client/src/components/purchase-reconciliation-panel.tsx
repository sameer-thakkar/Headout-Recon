import { useMemo, useState, useRef, Fragment, useCallback, useEffect, memo, useTransition, forwardRef, useImperativeHandle } from "react";
import { Calculator, TrendingUp, TrendingDown, ArrowRight, Minus, Plus, Wallet, Loader2, AlertCircle, ChevronDown, ChevronRight, FileWarning, AlertTriangle, Check, CheckCircle2, X, Search, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { apiRequest, queryClient, authFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PrimaryRow, VendorBalance, PaxBreakdown, PortalReload, ReloadAdjustment } from "@shared/schema";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  isSecondaryVendor?: boolean;
  vid?: string;
  paymentMethod?: string;
  spPaymentMethod?: string;
  alreadyReconciledType?: "same_be" | "different_be";
  hoBeId?: string;
  spBeId?: string;
  chargedLoss?: string;
  comment?: string;
  experienceName?: string;
  reconciliationStatus?: string;
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
  onReconciliationFinalized?: () => void; // Called when Apply & confirm is clicked
}

const INITIAL_TID_LIMIT = 10;
const INITIAL_REASON_LIMIT = 5;

function needsVendorCorrection(booking: PurchaseBooking): boolean {
  if (booking.isSecondaryVendor) return true;
  const hoP = (booking.paymentMethod || "").trim();
  const spP = (booking.spPaymentMethod || "").trim();
  return !!(hoP && spP && hoP.toLowerCase() !== spP.toLowerCase());
}


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
  const [localFnp, setLocalFnp] = useState(fnpValue.toFixed(2));
  const [fnpFocused, setFnpFocused] = useState(false);
  const localFnpRef = useRef(localFnp);
  localFnpRef.current = localFnp;

  useEffect(() => {
    if (fnpValue.toFixed(2) !== localFnpRef.current) {
      setLocalFnp(fnpValue.toFixed(2));
    }
  }, [fnpValue]);

  const commitFnp = useCallback(() => {
    const cleaned = localFnp.replace(/,/g, "");
    const parsed = Math.round((parseFloat(cleaned) || 0) * 100) / 100;
    setLocalFnp(parsed.toFixed(2));
    setFnpFocused(false);
    if (parsed !== fnpValue) {
      onUpdateFnp(booking.bookingId, parsed);
    }
  }, [localFnp, fnpValue, booking.bookingId, onUpdateFnp]);

  const isNegativeSp = booking.spNet < 0;

  return (
    <Fragment key={`${itemId}-booking-${groupIdx}-${tid}-${bookingIdx}`}>
      <TableRow className={`h-7 ${hasDispute ? "bg-amber-50/50 dark:bg-amber-950/20" : isNegativeSp ? "bg-red-50/60 dark:bg-red-950/20" : needsDisputeWarning ? "bg-orange-50/50 dark:bg-orange-950/10" : ""}`}>
        <TableCell className="py-1 font-mono w-[22%]">
          <div className="flex items-center gap-1">
            {booking.bookingId}
            {hasDispute && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 text-amber-600 border-amber-300">
                Dispute: {disputeAmount?.toFixed(2)}
              </Badge>
            )}
            {isNegativeSp && (
              <>
                <Badge variant="outline" className="text-[10px] px-1 py-0 text-red-600 border-red-300 dark:text-red-400 dark:border-red-700">
                  Refund
                </Badge>
                <Badge variant="outline" className={`text-[10px] px-1 py-0 ${
                  booking.hoNet === 0
                    ? "text-muted-foreground border-muted-foreground/40"
                    : Math.abs(booking.spNet) === Math.abs(booking.hoNet)
                      ? "text-green-600 border-green-300 dark:text-green-400 dark:border-green-700"
                      : "text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700"
                }`}>
                  {booking.hoNet === 0 ? "Zero HO" : Math.abs(booking.spNet) === Math.abs(booking.hoNet) ? "Matched" : "Difference"}
                </Badge>
                {booking.reconciliationStatus && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 text-violet-600 border-violet-300 dark:text-violet-400 dark:border-violet-700">
                    {booking.reconciliationStatus}
                  </Badge>
                )}
              </>
            )}
          </div>
        </TableCell>
        <TableCell className={`py-1 text-right font-mono w-[16%] ${isNegativeSp ? "text-red-600 dark:text-red-400 font-semibold" : ""}`}>{formatNumber(booking.spNet)}</TableCell>
        <TableCell className="py-1 text-right font-mono w-[16%]">{formatNumber(booking.hoNet)}</TableCell>
        <TableCell className="py-1 text-right font-mono text-amber-600 dark:text-amber-400 w-[16%]">
          {formatNumber(booking.difference)}
        </TableCell>
        <TableCell className="py-1 text-right w-[22%]" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1">
            <Input
              type="text"
              inputMode="decimal"
              className="h-6 text-[length:inherit] w-full font-mono text-right border-transparent hover:border-input focus:border-input bg-transparent"
              value={fnpFocused ? localFnp : formatNumber(parseFloat(localFnp) || 0)}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^0-9.\-]/g, "");
                setLocalFnp(raw);
              }}
              onFocus={() => setFnpFocused(true)}
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
                className="h-6 w-6 p-0 text-muted-foreground hover:text-blue-600"
                onClick={() => onOpenIssueModal({
                  bookingId: booking.bookingId,
                  spNet: booking.spNet,
                  hoNet: booking.hoNet,
                  difference: booking.difference,
                  reason: reasonName,
                })}
                data-testid={`button-flag-issue-${booking.bookingId}`}
                title="Log issue"
              >
                <AlertTriangle className="h-3 w-3" />
              </Button>
            </div>
          </TableCell>
        )}
      </TableRow>
    </Fragment>
  );
});

function formatNumber(value: number): string {
  if (isNaN(value)) return "0.00";
  return new Intl.NumberFormat("en-IN", {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

interface DisputeModalHandle {
  open: (booking: BookingForDispute) => void;
}

const DisputeModal = memo(forwardRef<DisputeModalHandle, {
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
    const amount = Math.round((parseFloat(amountInput) || 0) * 100) / 100;
    if (isNaN(parseFloat(amountInput)) || amount <= 0) {
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
}));

interface IssueModalHandle {
  open: (booking: BookingForDispute) => void;
}

const IssueModal = memo(forwardRef<IssueModalHandle, {
  currency: string;
  billingEntityName: string;
  effectiveFxRate: number | null;
  onSave: (booking: BookingForDispute, driTeamOverride?: string) => Promise<void>;
}>(function IssueModal({ currency, billingEntityName, effectiveFxRate, onSave }, ref) {
  const [isOpen, setIsOpen] = useState(false);
  const [booking, setBooking] = useState<BookingForDispute | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedDriTeam, setSelectedDriTeam] = useState<string | null>(null);
  const { toast } = useToast();

  const isUnmapped = booking?.reason === "Unmapped";

  useImperativeHandle(ref, () => ({
    open: (b: BookingForDispute) => {
      setBooking(b);
      setSelectedDriTeam(null);
      setIsOpen(true);
    }
  }));

  const handleSave = useCallback(async () => {
    if (!booking) return;
    if (isUnmapped && !selectedDriTeam) return;
    setIsSaving(true);
    try {
      await onSave(booking, isUnmapped ? selectedDriTeam! : undefined);
      setIsOpen(false);
      setBooking(null);
      setSelectedDriTeam(null);
    } catch {
      toast({
        title: "Error",
        description: "Failed to flag issue. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }, [booking, isUnmapped, selectedDriTeam, onSave, toast]);

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
                <span className="text-muted-foreground">Discrepancy:</span>
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
            {isUnmapped ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">Select DRI Team:</p>
                <div className="flex flex-col gap-2">
                  <Button
                    variant={selectedDriTeam === "Finance- Prepurchase" ? "default" : "outline"}
                    className="justify-start gap-2"
                    onClick={() => setSelectedDriTeam("Finance- Prepurchase")}
                    data-testid="button-dri-finance-prepurchase"
                  >
                    <Wallet className="h-4 w-4" />
                    Finance- Prepurchase
                  </Button>
                  <Button
                    variant={selectedDriTeam === "Reservation Ops" ? "default" : "outline"}
                    className="justify-start gap-2"
                    onClick={() => setSelectedDriTeam("Reservation Ops")}
                    data-testid="button-dri-reservation-ops"
                  >
                    <Calculator className="h-4 w-4" />
                    Reservation Ops
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                This issue will be assigned to the appropriate DRI team based on the reason classification.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => { setIsOpen(false); setBooking(null); setSelectedDriTeam(null); }}
            data-testid="button-cancel-issue"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || (isUnmapped && !selectedDriTeam)}
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
}));

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
  fnpVersion: number;
  getFinalNetPrice: (bookingId: string, defaultSpNet: number) => number;
  updateFinalNetPrice: (bookingId: string, value: number) => void;
  openIssueModal: (booking: BookingForDispute) => void;
}

const TidGroup = memo(function TidGroup({
  tidKey, tid, tidBookings, itemId, groupIdx, currency, runId, reasonName,
  isExpanded, onToggle, activeDisputes, disputeAmounts, loggedIssues, fnpVersion,
  getFinalNetPrice, updateFinalNetPrice,
}: TidGroupProps) {
  const tidTotal = useMemo(() => tidBookings.reduce((s, b) => s + b.difference, 0), [tidBookings]);
  const expName = useMemo(() => tidBookings.find(b => b.experienceName)?.experienceName, [tidBookings]);
  const tidDiffPercent = useMemo(() => {
    const hoTotal = tidBookings.reduce((s, b) => s + b.hoNet, 0);
    if (hoTotal === 0) return null;
    const spTotal = tidBookings.reduce((s, b) => s + b.spNet, 0);
    return ((hoTotal - spTotal) / hoTotal) * 100;
  }, [tidBookings]);

  return (
    <div className="border-t first:border-t-0">
      <div
        className="flex items-center justify-between px-2 py-1 cursor-pointer hover:bg-muted/40 transition-colors"
        onClick={() => onToggle(tidKey)}
        data-testid={`tid-header-${itemId}-${groupIdx}-${tid}`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {isExpanded ? <ChevronDown className="h-3 w-3 text-primary shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
          <span className="font-mono text-xs shrink-0">{tid}</span>
          <span className="font-mono text-xs text-muted-foreground shrink-0">({tidBookings.length})</span>
          {expName && (
            <span className="font-mono text-xs truncate max-w-[750px]" title={expName}>· {expName}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs" onClick={(e) => e.stopPropagation()}>
          {tidDiffPercent !== null && (
            <span className="font-mono text-xs text-muted-foreground">
              ({tidDiffPercent.toFixed(2)}%)
            </span>
          )}
          <span className="font-mono text-amber-600 dark:text-amber-400 text-xs">
            {formatNumber(tidTotal)}
          </span>
        </div>
      </div>
      {isExpanded && (
        <div className="px-1 pb-1">
          <Table className="text-xs table-fixed">
            <TableHeader>
              <TableRow className="h-7">
                <TableHead className="py-1 text-xs w-[22%]">Booking ID</TableHead>
                <TableHead className="py-1 text-xs text-right w-[16%]">SP Net</TableHead>
                <TableHead className="py-1 text-xs text-right w-[16%]">HO Net</TableHead>
                <TableHead className="py-1 text-xs text-right w-[16%]">Difference</TableHead>
                <TableHead className="py-1 text-xs text-right w-[22%]">Total Amount Payable</TableHead>
                {runId && <TableHead className="py-1 text-xs text-center w-[8%]">Actions</TableHead>}
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
  grandTotal: number;
  onToggleReason: (key: string) => void;
  onToggleTid: (key: string) => void;
  onShowMoreTids: (reasonKey: string, totalCount: number) => void;
  activeDisputes: Set<string>;
  disputeAmounts: Map<string, number>;
  loggedIssues: Set<string>;
  fnpVersion: number;
  getFinalNetPrice: (bookingId: string, defaultSpNet: number) => number;
  updateFinalNetPrice: (bookingId: string, value: number) => void;
  openIssueModal: (booking: BookingForDispute) => void;
  negativeSpVerified?: boolean;
  onSetNegativeSpVerified?: (val: boolean) => void;
}

const ReasonGroup = memo(function ReasonGroup({
  itemId, groupIdx, reasonGroup, currency, runId,
  isReasonExpanded, expandedTids, visibleTidCount, grandTotal,
  onToggleReason, onToggleTid, onShowMoreTids,
  activeDisputes, disputeAmounts, loggedIssues, fnpVersion,
  getFinalNetPrice, updateFinalNetPrice,
  negativeSpVerified, onSetNegativeSpVerified,
}: ReasonGroupProps) {
  const reasonKey = `${itemId}-${reasonGroup.reason}`;
  const tidEntries = reasonGroup.tidEntries;
  const visibleTids = tidEntries.slice(0, visibleTidCount);
  const hasMore = tidEntries.length > visibleTidCount;
  const percentage = grandTotal !== 0 ? Math.round((Math.abs(reasonGroup.totalDifference) / Math.abs(grandTotal)) * 100) : 0;

  return (
    <div className="rounded-md border bg-background overflow-hidden">
      <div
        className="flex flex-col cursor-pointer hover-elevate bg-muted/50"
        onClick={() => onToggleReason(reasonKey)}
        data-testid={`reason-header-${itemId}-${groupIdx}`}
      >
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2 flex-wrap">
            {isReasonExpanded ? <ChevronDown className="h-4 w-4 text-primary" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            <span className="font-medium text-sm">{reasonGroup.reason}</span>
            <Badge variant="secondary" className="text-xs">{reasonGroup.count}</Badge>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="outline" className="text-[10px] font-mono">{percentage}%</Badge>
            <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
              {formatNumber(reasonGroup.totalDifference)} {currency}
            </span>
          </div>
        </div>
      </div>
      {isReasonExpanded && (
        <div className="px-2 pb-2 pt-1">
          {reasonGroup.reason === "Negative SP - Partial Refund" && (() => {
            const allBookings = tidEntries.flatMap(([, b]) => b);
            const zeroHo = allBookings.filter(b => b.hoNet === 0);
            const matched = allBookings.filter(b => b.hoNet !== 0 && Math.abs(b.spNet) === Math.abs(b.hoNet));
            const diff = allBookings.filter(b => b.hoNet !== 0 && Math.abs(b.spNet) !== Math.abs(b.hoNet));
            const totalRefund = allBookings.reduce((s, b) => s + b.spNet, 0);
            const totalFnp = allBookings.reduce((s, b) => {
              if (b.hoNet === 0) return s;
              if (Math.abs(b.spNet) === Math.abs(b.hoNet)) return s;
              return s + Math.abs(Math.abs(b.hoNet) - Math.abs(b.spNet));
            }, 0);
            return (
              <div className="space-y-2 mb-2">
                <div className="rounded-md border bg-red-50/50 dark:bg-red-950/20 p-3 space-y-2">
                  <div className="text-xs font-medium text-red-800 dark:text-red-300 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Negative SP Net Summary — {allBookings.length} refund bookings
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded border bg-background p-2">
                      <div className="text-muted-foreground">Zero HO</div>
                      <div className="font-mono font-semibold">{zeroHo.length} bookings</div>
                      <div className="text-[10px] text-muted-foreground">FNP = 0</div>
                    </div>
                    <div className="rounded border bg-background p-2">
                      <div className="text-muted-foreground">Matched</div>
                      <div className="font-mono font-semibold text-green-600">{matched.length} bookings</div>
                      <div className="text-[10px] text-muted-foreground">|SP| = |HO|, FNP = 0</div>
                    </div>
                    <div className="rounded border bg-background p-2">
                      <div className="text-muted-foreground">Difference</div>
                      <div className="font-mono font-semibold text-amber-600">{diff.length} bookings</div>
                      <div className="text-[10px] text-muted-foreground">FNP = ||HO| - |SP||</div>
                    </div>
                  </div>
                  {(() => {
                    const statusCounts = new Map<string, number>();
                    allBookings.forEach(b => {
                      const s = b.reconciliationStatus || "—";
                      statusCounts.set(s, (statusCounts.get(s) || 0) + 1);
                    });
                    const hasStatuses = allBookings.some(b => b.reconciliationStatus);
                    if (!hasStatuses) return null;
                    return (
                      <div className="flex flex-wrap gap-1.5 text-xs pt-1">
                        <span className="text-muted-foreground">Status:</span>
                        {Array.from(statusCounts.entries()).map(([status, count]) => (
                          <Badge key={status} variant="outline" className="text-[10px] px-1.5 py-0 text-violet-600 border-violet-300 dark:text-violet-400 dark:border-violet-700">
                            {status} ({count})
                          </Badge>
                        ))}
                      </div>
                    );
                  })()}
                  <div className="flex items-center justify-between text-xs pt-1 border-t">
                    <div>
                      <span className="text-muted-foreground">Total Refund: </span>
                      <span className="font-mono font-semibold text-red-600">{formatNumber(totalRefund)} {currency}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Total Auto FNP: </span>
                      <span className="font-mono font-semibold">{formatNumber(totalFnp)} {currency}</span>
                    </div>
                  </div>
                </div>
                {onSetNegativeSpVerified && (
                  <div
                    className={`rounded-md border-2 p-3 flex items-center justify-between transition-colors ${
                      negativeSpVerified
                        ? "border-green-500 dark:border-green-600 bg-green-50/50 dark:bg-green-950/20"
                        : "border-amber-400 dark:border-amber-600 bg-amber-50/50 dark:bg-amber-950/20"
                    }`}
                  >
                    <div className="flex items-center gap-2 text-sm">
                      {negativeSpVerified ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      )}
                      <span className={negativeSpVerified ? "text-green-800 dark:text-green-300" : "text-amber-800 dark:text-amber-300"}>
                        {negativeSpVerified ? "Negative SP Net transactions verified" : "Please verify all negative SP Net refund transactions"}
                      </span>
                    </div>
                    <Checkbox
                      checked={negativeSpVerified}
                      onCheckedChange={(checked) => onSetNegativeSpVerified(checked === true)}
                      data-testid="checkbox-negative-sp-verified"
                    />
                  </div>
                )}
              </div>
            );
          })()}
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
                fnpVersion={fnpVersion}
                getFinalNetPrice={getFinalNetPrice}
                updateFinalNetPrice={updateFinalNetPrice}
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

interface BreakupSectionProps {
  itemId: number;
  breakupData: { reason: string; count: number; totalDifference: number }[];
  breakupWithTids: { reason: string; count: number; totalDifference: number; tidEntries: [string, PurchaseBooking[]][] }[];
  currency: string;
  runId?: string | null;
  effectiveFxRate: number | null;
  expandedReasons: Set<string>;
  expandedTids: Set<string>;
  getVisibleTidCount: (reasonKey: string) => number;
  toggleReasonExpand: (key: string) => void;
  toggleTidExpand: (key: string) => void;
  showMoreTids: (reasonKey: string, totalCount: number) => void;
  activeDisputes: Set<string>;
  disputeAmounts: Map<string, number>;
  loggedIssues: Set<string>;
  fnpVersion: number;
  getFinalNetPrice: (bookingId: string, defaultSpNet: number) => number;
  updateFinalNetPrice: (bookingId: string, value: number) => void;
  openIssueModal: (booking: BookingForDispute) => void;
  negativeSpVerified?: boolean;
  onSetNegativeSpVerified?: (val: boolean) => void;
}

const BreakupSection = memo(function BreakupSection({
  itemId, breakupData, breakupWithTids, currency, runId, effectiveFxRate,
  expandedReasons, expandedTids, getVisibleTidCount,
  toggleReasonExpand, toggleTidExpand, showMoreTids,
  activeDisputes, disputeAmounts, loggedIssues, fnpVersion,
  getFinalNetPrice, updateFinalNetPrice, openIssueModal,
  negativeSpVerified, onSetNegativeSpVerified,
}: BreakupSectionProps) {
  const [searchFilter, setSearchFilter] = useState("");
  const [showAllReasons, setShowAllReasons] = useState(false);

  const grandTotal = useMemo(() => breakupData.reduce((sum, g) => sum + g.totalDifference, 0), [breakupData]);
  const totalItems = useMemo(() => breakupData.reduce((sum, g) => sum + g.count, 0), [breakupData]);

  const filteredReasons = useMemo(() => {
    if (!searchFilter.trim()) return breakupWithTids;
    const query = searchFilter.trim().toLowerCase();
    return breakupWithTids
      .map(rg => {
        const filteredTidEntries = rg.tidEntries
          .map(([tid, bookings]) => {
            const matchesTid = tid.toLowerCase().includes(query);
            if (matchesTid) return [tid, bookings] as [string, PurchaseBooking[]];
            const filteredBookings = bookings.filter(b => b.bookingId.toLowerCase().includes(query));
            if (filteredBookings.length > 0) return [tid, filteredBookings] as [string, PurchaseBooking[]];
            return null;
          })
          .filter((e): e is [string, PurchaseBooking[]] => e !== null);
        if (filteredTidEntries.length === 0 && !rg.reason.toLowerCase().includes(query)) return null;
        return {
          ...rg,
          tidEntries: filteredTidEntries.length > 0 ? filteredTidEntries : rg.tidEntries,
          count: filteredTidEntries.length > 0 ? filteredTidEntries.reduce((s, [, b]) => s + b.length, 0) : rg.count,
        };
      })
      .filter((rg): rg is NonNullable<typeof rg> => rg !== null);
  }, [breakupWithTids, searchFilter]);

  const isFiltering = searchFilter.trim().length > 0;
  const needsLazyLoad = !isFiltering && filteredReasons.length > INITIAL_REASON_LIMIT;
  const visibleReasons = needsLazyLoad && !showAllReasons
    ? filteredReasons.slice(0, INITIAL_REASON_LIMIT)
    : filteredReasons;
  const hiddenReasonCount = filteredReasons.length - INITIAL_REASON_LIMIT;

  return (
    <div className="space-y-2">
      {breakupWithTids.length > 3 && (
        <div className="relative" data-testid={`breakup-search-${itemId}`}>
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Filter by Booking ID, TID, or reason..."
            className="h-8 text-xs pl-8"
            value={searchFilter}
            onChange={(e) => { setSearchFilter(e.target.value); setShowAllReasons(false); }}
            data-testid={`input-breakup-search-${itemId}`}
          />
          {searchFilter && (
            <Button
              size="icon"
              variant="ghost"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
              onClick={() => setSearchFilter("")}
              data-testid={`button-clear-search-${itemId}`}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}
      {isFiltering && (
        <div className="text-xs text-muted-foreground px-1">
          Showing {filteredReasons.length} of {breakupWithTids.length} reason groups
          {filteredReasons.length === 0 && (
            <span className="ml-1 text-amber-600">— no matches found</span>
          )}
        </div>
      )}
      {visibleReasons.map((reasonGroup, groupIdx) => {
        const reasonKey = `${itemId}-${reasonGroup.reason}`;
        const isReasonExpanded = expandedReasons.has(reasonKey) || isFiltering;
        const visibleCount = getVisibleTidCount(reasonKey);
        return (
          <ReasonGroup
            key={`${itemId}-reason-${groupIdx}`}
            itemId={itemId}
            groupIdx={groupIdx}
            reasonGroup={reasonGroup}
            currency={currency}
            runId={runId}
            isReasonExpanded={isReasonExpanded}
            expandedTids={expandedTids}
            visibleTidCount={visibleCount}
            grandTotal={grandTotal}
            onToggleReason={toggleReasonExpand}
            onToggleTid={toggleTidExpand}
            onShowMoreTids={showMoreTids}
            activeDisputes={activeDisputes}
            disputeAmounts={disputeAmounts}
            loggedIssues={loggedIssues}
            fnpVersion={fnpVersion}
            getFinalNetPrice={getFinalNetPrice}
            updateFinalNetPrice={updateFinalNetPrice}
            openIssueModal={openIssueModal}
            negativeSpVerified={negativeSpVerified}
            onSetNegativeSpVerified={onSetNegativeSpVerified}
          />
        );
      })}
      {needsLazyLoad && !showAllReasons && hiddenReasonCount > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs"
          onClick={() => setShowAllReasons(true)}
          data-testid={`button-show-all-reasons-${itemId}`}
        >
          Show all {filteredReasons.length} reasons ({hiddenReasonCount} more)
        </Button>
      )}
      <div className="flex items-center justify-end gap-3 pt-2 border-t text-sm">
        <span className="text-muted-foreground">Grand Total ({totalItems} items):</span>
        <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
          {formatNumber(grandTotal)} {currency}
        </span>
        {effectiveFxRate && (
          <span className="font-mono text-muted-foreground">
            ({formatNumber(grandTotal * effectiveFxRate)} USD)
          </span>
        )}
      </div>
    </div>
  );
});

interface ManageReloadsModalHandle {
  open: () => void;
}

interface ManageReloadsModalProps {
  beId: string;
  currency: string;
  reloads: PortalReload[];
  adjustments: ReloadAdjustment[];
  originalTotal: number;
  adjustedTotal: number;
}

const ManageReloadsModal = memo(forwardRef<ManageReloadsModalHandle, ManageReloadsModalProps>(function ManageReloadsModal(
  { beId, currency, reloads, adjustments, originalTotal, adjustedTotal },
  ref
) {
  interface AdjRow {
    id: string;
    type: "add" | "less";
    zendeskId: string;
    date: string;
    amountLoaded: string;
    paidAmount: string;
  }

  const makeRow = (): AdjRow => ({ id: crypto.randomUUID(), type: "add", zendeskId: "", date: "", amountLoaded: "", paidAmount: "" });

  const formatDateDisplay = useCallback((val: string | null | undefined): string => {
    if (!val) return "-";
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(val)) return val;
    const num = Number(val);
    if (!isNaN(num) && num > 10000 && num < 100000) {
      const excelEpoch = new Date(1899, 11, 30);
      const d = new Date(excelEpoch.getTime() + num * 86400000);
      if (!isNaN(d.getTime())) {
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        return `${dd}/${mm}/${d.getFullYear()}`;
      }
    }
    const d = new Date(val);
    if (!isNaN(d.getTime()) && val.length > 4) {
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      return `${dd}/${mm}/${d.getFullYear()}`;
    }
    return val;
  }, []);

  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [rows, setRows] = useState<AdjRow[]>([makeRow()]);
  const [isSaving, setIsSaving] = useState(false);

  useImperativeHandle(ref, () => ({
    open: () => setIsOpen(true),
  }));

  const updateRow = useCallback((rowId: string, field: keyof AdjRow, value: string) => {
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, [field]: value } : r));
  }, []);

  const removeRow = useCallback((rowId: string) => {
    setRows(prev => {
      const next = prev.filter(r => r.id !== rowId);
      return next.length === 0 ? [makeRow()] : next;
    });
  }, []);

  const addRow = useCallback(() => {
    setRows(prev => [...prev, makeRow()]);
  }, []);

  const handleSaveAllAdjustments = useCallback(async () => {
    const validRows = rows.filter(r => {
      const amt = parseFloat(r.paidAmount);
      return !isNaN(amt) && amt !== 0;
    });
    if (validRows.length === 0) {
      toast({ title: "No valid rows", description: "Enter a paid amount in at least one row", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      for (const r of validRows) {
        await apiRequest("POST", "/api/reload-adjustments", {
          beId,
          zendeskId: r.zendeskId || null,
          dateOfPayment: r.date || null,
          amountLoadedAtDate: r.amountLoaded || null,
          paidAmount: parseFloat(r.paidAmount),
          adjustmentType: r.type,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/portal-reloads', beId] });
      setRows([makeRow()]);
      toast({ title: "Adjustments saved", description: `${validRows.length} adjustment(s) added` });
    } catch (e) {
      toast({ title: "Error", description: "Failed to save adjustments", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }, [beId, rows, toast]);

  const handleDeleteAdjustment = useCallback(async (id: number) => {
    try {
      await apiRequest("DELETE", `/api/reload-adjustments/${id}`);
      queryClient.invalidateQueries({ queryKey: ['/api/portal-reloads', beId] });
      toast({ title: "Adjustment removed" });
    } catch (e) {
      toast({ title: "Error", description: "Failed to remove adjustment", variant: "destructive" });
    }
  }, [beId, toast]);

  const addTotal = adjustments.filter(a => a.adjustmentType === "add").reduce((s, a) => s + a.paidAmount, 0);
  const lessTotal = adjustments.filter(a => a.adjustmentType === "less").reduce((s, a) => s + a.paidAmount, 0);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Manage Reloads
            <Badge variant="outline" className="text-xs font-mono">BE: {beId}</Badge>
          </DialogTitle>
          <DialogDescription>
            View current reload breakup and add adjustments to correct the reloads value.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
              Current Reloads
              <Badge variant="secondary" className="text-xs">{reloads.length} entries</Badge>
              <span className="ml-auto font-mono text-sm">{formatNumber(originalTotal)} {reloads.find(r => r.currency)?.currency || currency}</span>
            </h4>
            {reloads.length > 0 ? (
              <div className="rounded-md border overflow-hidden max-h-48 overflow-y-auto">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow className="h-7">
                      <TableHead className="py-1 text-xs">Zendesk ID</TableHead>
                      <TableHead className="py-1 text-xs whitespace-nowrap">Date of Payment</TableHead>
                      <TableHead className="py-1 text-xs text-right whitespace-nowrap">Amt Loaded at Date</TableHead>
                      <TableHead className="py-1 text-xs">Currency</TableHead>
                      <TableHead className="py-1 text-xs text-right whitespace-nowrap">Paid Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reloads.map((r, i) => (
                      <TableRow key={`reload-${r.id || i}`} className="h-7">
                        <TableCell className="py-1 font-mono">{r.zendeskId ? String(r.zendeskId).replace(/\.0+$/, "") : "-"}</TableCell>
                        <TableCell className="py-1">{formatDateDisplay(r.dateOfPayment)}</TableCell>
                        <TableCell className="py-1 text-right">{formatDateDisplay(r.amountLoadedAtDate)}</TableCell>
                        <TableCell className="py-1 font-mono text-xs">{r.currency || "-"}</TableCell>
                        <TableCell className="py-1 text-right font-mono">{formatNumber(Math.round(r.paidAmount * 100) / 100)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground border rounded-md p-3 bg-muted/20">
                No reload entries uploaded yet.
              </div>
            )}
          </div>

          <Separator />

          {adjustments.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                Adjustments
                <Badge variant="secondary" className="text-xs">{adjustments.length}</Badge>
                {addTotal > 0 && <Badge className="text-[10px] bg-green-100 text-green-700 border-green-300" variant="outline">+{formatNumber(addTotal)}</Badge>}
                {lessTotal > 0 && <Badge className="text-[10px] bg-red-100 text-red-700 border-red-300" variant="outline">-{formatNumber(lessTotal)}</Badge>}
              </h4>
              <div className="rounded-md border overflow-hidden max-h-48 overflow-y-auto">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow className="h-7">
                      <TableHead className="py-1 text-xs w-14">Type</TableHead>
                      <TableHead className="py-1 text-xs">Zendesk ID</TableHead>
                      <TableHead className="py-1 text-xs whitespace-nowrap">Date of Payment</TableHead>
                      <TableHead className="py-1 text-xs text-right whitespace-nowrap">Amt Loaded at Date</TableHead>
                      <TableHead className="py-1 text-xs text-right whitespace-nowrap">Paid Amount</TableHead>
                      <TableHead className="py-1 text-xs w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {adjustments.map((a) => (
                      <TableRow key={`adj-${a.id}`} className={`h-7 ${a.adjustmentType === "add" ? "bg-green-50/50 dark:bg-green-950/10" : "bg-red-50/50 dark:bg-red-950/10"}`}>
                        <TableCell className="py-1">
                          <Badge variant={a.adjustmentType === "add" ? "default" : "destructive"} className="text-[10px]">
                            {a.adjustmentType === "add" ? "+" : "-"}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-1 font-mono">{a.zendeskId ? String(a.zendeskId).replace(/\.0+$/, "") : "-"}</TableCell>
                        <TableCell className="py-1">{formatDateDisplay(a.dateOfPayment)}</TableCell>
                        <TableCell className="py-1 text-right">{formatDateDisplay(a.amountLoadedAtDate)}</TableCell>
                        <TableCell className={`py-1 text-right font-mono ${a.adjustmentType === "add" ? "text-green-600" : "text-red-600"}`}>
                          {a.adjustmentType === "add" ? "+" : "-"}{formatNumber(Math.round(a.paidAmount * 100) / 100)}
                        </TableCell>
                        <TableCell className="py-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDeleteAdjustment(a.id)}
                            data-testid={`button-delete-adjustment-${a.id}`}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium">Add Adjustments</h4>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={addRow}
                  data-testid="button-add-adjustment-row"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Row
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleSaveAllAdjustments}
                  disabled={isSaving || rows.every(r => !r.paidAmount)}
                  data-testid="button-save-adjustment"
                >
                  {isSaving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                  Save All ({rows.filter(r => { const a = parseFloat(r.paidAmount); return !isNaN(a) && a !== 0; }).length})
                </Button>
              </div>
            </div>
            <div className="rounded-md border overflow-hidden">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="h-7">
                    <TableHead className="py-1 text-xs w-24">Type</TableHead>
                    <TableHead className="py-1 text-xs">Zendesk ID</TableHead>
                    <TableHead className="py-1 text-xs">Date</TableHead>
                    <TableHead className="py-1 text-xs whitespace-nowrap">Amt Loaded at Date</TableHead>
                    <TableHead className="py-1 text-xs">Paid Amt *</TableHead>
                    <TableHead className="py-1 text-xs w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, idx) => (
                    <TableRow key={row.id} className="h-8">
                      <TableCell className="py-0.5 px-1">
                        <Select value={row.type} onValueChange={(v) => updateRow(row.id, "type", v)}>
                          <SelectTrigger className="h-7 text-xs border-0 bg-transparent px-1" data-testid={`select-adj-type-${idx}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="add">Add (+)</SelectItem>
                            <SelectItem value="less">Less (-)</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="py-0.5 px-1">
                        <Input
                          className="h-7 text-xs font-mono border-0 bg-transparent px-1"
                          placeholder="-"
                          value={row.zendeskId}
                          onChange={(e) => updateRow(row.id, "zendeskId", e.target.value)}
                          data-testid={`input-adj-zendesk-${idx}`}
                        />
                      </TableCell>
                      <TableCell className="py-0.5 px-1">
                        <Input
                          className="h-7 text-xs border-0 bg-transparent px-1"
                          placeholder="-"
                          value={row.date}
                          onChange={(e) => updateRow(row.id, "date", e.target.value)}
                          data-testid={`input-adj-date-${idx}`}
                        />
                      </TableCell>
                      <TableCell className="py-0.5 px-1">
                        <Input
                          className="h-7 text-xs border-0 bg-transparent px-1"
                          placeholder="DD/MM/YYYY"
                          type="text"
                          value={row.amountLoaded}
                          onChange={(e) => updateRow(row.id, "amountLoaded", e.target.value)}
                          data-testid={`input-adj-loaded-${idx}`}
                        />
                      </TableCell>
                      <TableCell className="py-0.5 px-1">
                        <Input
                          className="h-7 text-xs font-mono border-0 bg-transparent px-1"
                          placeholder="Required"
                          type="number"
                          value={row.paidAmount}
                          onChange={(e) => updateRow(row.id, "paidAmount", e.target.value)}
                          data-testid={`input-adj-paid-${idx}`}
                        />
                      </TableCell>
                      <TableCell className="py-0.5 px-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeRow(row.id)}
                          data-testid={`button-remove-adj-row-${idx}`}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <Separator />

          <div className="rounded-md border p-3 bg-muted/20 space-y-1">
            {(() => { const reloadCcy = reloads.find(r => r.currency)?.currency || currency; return (<>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Original Reloads</span>
              <span className="font-mono">{formatNumber(originalTotal)} {reloadCcy}</span>
            </div>
            {addTotal > 0 && (
              <div className="flex items-center justify-between text-xs text-green-600">
                <span>Additions</span>
                <span className="font-mono">+{formatNumber(addTotal)} {reloadCcy}</span>
              </div>
            )}
            {lessTotal > 0 && (
              <div className="flex items-center justify-between text-xs text-red-600">
                <span>Deductions</span>
                <span className="font-mono">-{formatNumber(lessTotal)} {reloadCcy}</span>
              </div>
            )}
            <Separator className="my-1" />
            <div className="flex items-center justify-between text-sm font-semibold">
              <span>Final Reloads</span>
              <span className="font-mono">{formatNumber(adjustedTotal)} {reloadCcy}</span>
            </div>
            </>); })()}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setIsOpen(false)} data-testid="button-close-manage-reloads">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}));

interface LineItemsTableCardProps {
  billingEntityName: string;
  calculations: {
    netDifference: number;
    row10Breakup: { reason: string; bookings: PurchaseBooking[]; totalDifference: number; count: number }[];
    row11Breakup: { reason: string; bookings: PurchaseBooking[]; totalDifference: number; count: number }[];
    row10WithTids: any[];
    row11WithTids: any[];
  };
  effectiveFxRate: number | null;
  currency: string;
  hasBalance: boolean;
  lineItems: any[];
  tableSections: { key: string; label: string; rows: number[]; description: string }[];
  expandedTableSections: Set<string>;
  toggleTableSection: (section: string) => void;
  expandedRows: Set<number>;
  toggleRowExpand: (id: number) => void;
  expandedReasons: Set<string>;
  expandedTids: Set<string>;
  getVisibleTidCount: (key: string) => number;
  toggleReasonExpand: (key: string) => void;
  toggleTidExpand: (key: string) => void;
  showMoreTids: (reasonKey: string, totalCount: number) => void;
  activeDisputes: Set<string>;
  disputeAmounts: Map<string, number>;
  loggedIssues: Set<string>;
  fnpVersion: number;
  getFinalNetPrice: (bookingId: string, spNet: number) => number;
  updateFinalNetPrice: (bookingId: string, value: number) => void;
  openIssueModal: (booking: BookingForDispute) => void;
  onManageReloads?: () => void;
  runId?: string | null;
  negativeSpVerified?: boolean;
  onSetNegativeSpVerified?: (val: boolean) => void;
  summaryCurrency?: string;
  summaryFxRateToUsd?: number | null;
  isCrossCurrency?: boolean;
}

const LineItemsTableCard = memo(function LineItemsTableCard({
  billingEntityName,
  calculations,
  effectiveFxRate,
  currency,
  hasBalance,
  lineItems,
  tableSections,
  expandedTableSections,
  toggleTableSection,
  expandedRows,
  toggleRowExpand,
  expandedReasons,
  expandedTids,
  getVisibleTidCount,
  toggleReasonExpand,
  toggleTidExpand,
  showMoreTids,
  activeDisputes,
  disputeAmounts,
  loggedIssues,
  fnpVersion,
  getFinalNetPrice,
  updateFinalNetPrice,
  openIssueModal,
  onManageReloads,
  runId,
  negativeSpVerified,
  onSetNegativeSpVerified,
  summaryCurrency: sumCcy,
  summaryFxRateToUsd: sumFxRate,
  isCrossCurrency: crossCcy,
}: LineItemsTableCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
          <span>{billingEntityName || "Supplier"}</span>
          <div className="flex items-center gap-2">
            <Badge variant={calculations.netDifference === 0 ? "default" : "destructive"} className="text-xs">
              {calculations.netDifference === 0 ? "Balanced" : "Unbalanced"}
            </Badge>
            {(sumFxRate ?? effectiveFxRate) && (sumFxRate ?? effectiveFxRate) !== 1 && (
              <Badge variant="outline" className="text-xs">
                {crossCcy ? `${sumCcy}→USD: ` : "FX: "}{(sumFxRate ?? effectiveFxRate)!.toFixed(4)}
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {tableSections.map((section) => {
          const isSectionExpanded = expandedTableSections.has(section.key);
          const sectionLineItems = lineItems.filter((item: any) => section.rows.includes(item.id));
          const lastItem = sectionLineItems[sectionLineItems.length - 1];

          return (
            <div key={section.key} className="rounded-md border overflow-hidden">
              <div
                className="flex items-center justify-between px-3 py-2 bg-muted/40 cursor-pointer hover-elevate"
                onClick={() => toggleTableSection(section.key)}
                data-testid={`table-section-${section.key}`}
              >
                <div className="flex items-center gap-2">
                  {isSectionExpanded ? <ChevronDown className="h-4 w-4 text-primary" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <span className="text-sm font-medium">{section.label}</span>
                  <span className="text-xs text-muted-foreground hidden sm:inline">{section.description}</span>
                </div>
                <div className="flex items-center gap-2">
                  {!isSectionExpanded && lastItem && (
                    <span className={`font-mono text-xs ${lastItem.value < 0 ? "text-red-600 dark:text-red-400" : lastItem.value > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                      {lastItem.label}: {formatNumber(lastItem.value)} {sumCcy || currency}
                    </span>
                  )}
                  <Badge variant="outline" className="text-[10px]">
                    Rows {section.rows[0]}-{section.rows[section.rows.length - 1]}
                  </Badge>
                </div>
              </div>
              {isSectionExpanded && (
                <Table className="text-sm table-fixed w-full">
                  <colgroup>
                    <col className="w-8" />
                    <col style={{ width: "35%" }} />
                    <col style={{ width: "18%" }} />
                    <col style={{ width: "16%" }} />
                    <col style={{ width: "31%" }} />
                  </colgroup>
                  <TableHeader>
                    <TableRow className="h-8">
                      <TableHead className="py-1.5 text-xs">#</TableHead>
                      <TableHead className="py-1.5 text-xs">Line Item</TableHead>
                      <TableHead className="py-1.5 text-xs text-right">Amount ({sumCcy || currency})</TableHead>
                      <TableHead className="py-1.5 text-xs text-right">Amount (USD)</TableHead>
                      <TableHead className="py-1.5 text-xs">Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sectionLineItems.map((item: any) => {
                      const IconComponent = item.icon;
                      const isNegative = item.value < 0;
                      const isPositive = item.value > 0;
                      const fxForUsd = sumFxRate ?? effectiveFxRate;
                      const usdValue = fxForUsd ? item.value * fxForUsd : null;
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
                              <div className="flex items-center gap-2">
                                <span>
                                  {item.description}
                                  {hasBreakup && <span className="ml-1 text-primary">(click to expand)</span>}
                                </span>
                                {item.hasManage && onManageReloads && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-5 px-2 text-[10px]"
                                    onClick={(e) => { e.stopPropagation(); onManageReloads(); }}
                                    data-testid="button-manage-reloads"
                                  >
                                    Manage
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                          {hasBreakup && isExpanded && (
                            <TableRow className="bg-muted/30">
                              <TableCell colSpan={5} className="py-3 px-8">
                                <BreakupSection
                                  itemId={item.id}
                                  breakupData={breakupData}
                                  breakupWithTids={breakupWithTids}
                                  currency={currency}
                                  runId={runId}
                                  effectiveFxRate={effectiveFxRate}
                                  expandedReasons={expandedReasons}
                                  expandedTids={expandedTids}
                                  getVisibleTidCount={getVisibleTidCount}
                                  toggleReasonExpand={toggleReasonExpand}
                                  toggleTidExpand={toggleTidExpand}
                                  showMoreTids={showMoreTids}
                                  activeDisputes={activeDisputes}
                                  disputeAmounts={disputeAmounts}
                                  loggedIssues={loggedIssues}
                                  fnpVersion={fnpVersion}
                                  getFinalNetPrice={getFinalNetPrice}
                                  updateFinalNetPrice={updateFinalNetPrice}
                                  openIssueModal={openIssueModal}
                                  negativeSpVerified={negativeSpVerified}
                                  onSetNegativeSpVerified={onSetNegativeSpVerified}
                                />
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
});

interface InsightsCardProps {
  insightTabsCount: number;
  defaultInsightTab: string;
  alreadyReconciledData: {
    hasData: boolean;
    sameBE: { bookings: PrimaryRow[]; total: number };
    differentBE: { bookings: PrimaryRow[]; total: number };
    totalBookings: number;
    totalAmount: number;
  };
  paymentMismatchData: {
    hasData: boolean;
    tidEntries: [string, (PrimaryRow & { mismatchLabel: string })[]][];
    totalBookings: number;
    totalAmount: number;
  };
  cancellationData: {
    hasData: boolean;
    breakdown: { reason: string; bookings: PrimaryRow[]; total: number; count: number }[];
    totalBookings: number;
    totalAmount: number;
  };
  currency: string;
  effectiveFxRate: number | null;
  expandedAlreadyRecon: "same_be" | "different_be" | null;
  setExpandedAlreadyRecon: (fn: (prev: "same_be" | "different_be" | null) => "same_be" | "different_be" | null) => void;
  expandedPaymentMismatch: boolean;
  setExpandedPaymentMismatch: (fn: (prev: boolean) => boolean) => void;
  expandedCancellations: boolean;
  setExpandedCancellations: (fn: (prev: boolean) => boolean) => void;
  expandedCancType: string | null;
  setExpandedCancType: (fn: (prev: string | null) => string | null) => void;
}

const InsightsCard = memo(function InsightsCard({
  insightTabsCount,
  defaultInsightTab,
  alreadyReconciledData,
  paymentMismatchData,
  cancellationData,
  currency,
  effectiveFxRate,
  expandedAlreadyRecon,
  setExpandedAlreadyRecon,
  expandedPaymentMismatch,
  setExpandedPaymentMismatch,
  expandedCancellations,
  setExpandedCancellations,
  expandedCancType,
  setExpandedCancType,
}: InsightsCardProps) {
  if (insightTabsCount <= 0) return null;

  return (
    <Card data-testid="section-insights">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileWarning className="h-4 w-4 text-muted-foreground" />
          <span>Insights</span>
          <Badge variant="secondary" className="text-xs">{insightTabsCount} categories</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={defaultInsightTab}>
          <TabsList className="w-full justify-start gap-1 flex-wrap" data-testid="insight-tabs">
            {alreadyReconciledData.hasData && (
              <TabsTrigger value="reconciled" className="text-xs gap-1.5" data-testid="tab-reconciled">
                <Check className="h-3 w-3 text-green-600" />
                Reconciled
                <Badge variant="secondary" className="text-[10px] ml-0.5">{alreadyReconciledData.totalBookings}</Badge>
              </TabsTrigger>
            )}
            {paymentMismatchData.hasData && (
              <TabsTrigger value="mismatch" className="text-xs gap-1.5" data-testid="tab-mismatch">
                <AlertTriangle className="h-3 w-3 text-violet-600" />
                Payment Mismatch
                <Badge variant="secondary" className="text-[10px] ml-0.5">{paymentMismatchData.totalBookings}</Badge>
              </TabsTrigger>
            )}
            {cancellationData.hasData && (
              <TabsTrigger value="cancellations" className="text-xs gap-1.5" data-testid="tab-cancellations">
                <X className="h-3 w-3 text-red-500" />
                Cancellations
                <Badge variant="secondary" className="text-[10px] ml-0.5">{cancellationData.totalBookings}</Badge>
              </TabsTrigger>
            )}
          </TabsList>

          {alreadyReconciledData.hasData && (
            <TabsContent value="reconciled" data-testid="section-already-reconciled">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs px-1">
                  <span className="text-muted-foreground">{alreadyReconciledData.totalBookings} bookings already reconciled</span>
                  <span className="font-mono">{formatNumber(alreadyReconciledData.totalAmount)} {currency}</span>
                </div>
                {alreadyReconciledData.sameBE.bookings.length > 0 && (
                  <div className="rounded-md border bg-background overflow-hidden">
                    <div
                      className="flex items-center justify-between px-3 py-2 bg-green-50/50 dark:bg-green-950/20 cursor-pointer hover-elevate"
                      onClick={() => setExpandedAlreadyRecon(prev => prev === "same_be" ? null : "same_be")}
                      data-testid="already-recon-same-be-header"
                    >
                      <div className="flex items-center gap-2">
                        {expandedAlreadyRecon === "same_be" ? <ChevronDown className="h-4 w-4 text-green-600" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        <span className="text-sm font-medium">Same BE</span>
                        <Badge variant="secondary" className="text-xs">{alreadyReconciledData.sameBE.bookings.length}</Badge>
                      </div>
                      <span className="font-mono text-xs">{formatNumber(alreadyReconciledData.sameBE.total)} {currency}</span>
                    </div>
                    {expandedAlreadyRecon === "same_be" && (
                      <Table className="text-xs">
                        <TableHeader>
                          <TableRow className="h-7">
                            <TableHead className="py-1 text-xs">TID</TableHead>
                            <TableHead className="py-1 text-xs">Booking ID</TableHead>
                            <TableHead className="py-1 text-xs text-right">SP Net</TableHead>
                            <TableHead className="py-1 text-xs text-right">HO Net</TableHead>
                            <TableHead className="py-1 text-xs">Payment</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {alreadyReconciledData.sameBE.bookings.map((b, i) => {
                            const hoP = (b.paymentMethod || "").trim();
                            const spP = (b.spPaymentMethod || "").trim();
                            const mismatch = hoP && spP && hoP.toLowerCase() !== spP.toLowerCase();
                            return (
                              <TableRow key={`ar-same-${i}`} className="h-8">
                                <TableCell className="py-1 font-mono">{b.tid || "-"}</TableCell>
                                <TableCell className="py-1 font-mono">{b.bookingId}</TableCell>
                                <TableCell className="py-1 text-right font-mono">{formatNumber(b.spNetInHo)}</TableCell>
                                <TableCell className="py-1 text-right font-mono">{formatNumber(b.hoNet)}</TableCell>
                                <TableCell className="py-1">
                                  {mismatch ? (
                                    <Badge variant="destructive" className="text-[10px]">{hoP} vs {spP}</Badge>
                                  ) : (
                                    <span className="text-muted-foreground">{hoP || spP || "-"}</span>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                )}
                {alreadyReconciledData.differentBE.bookings.length > 0 && (
                  <div className="rounded-md border bg-background overflow-hidden">
                    <div
                      className="flex items-center justify-between px-3 py-2 bg-amber-50/50 dark:bg-amber-950/20 cursor-pointer hover-elevate"
                      onClick={() => setExpandedAlreadyRecon(prev => prev === "different_be" ? null : "different_be")}
                      data-testid="already-recon-diff-be-header"
                    >
                      <div className="flex items-center gap-2">
                        {expandedAlreadyRecon === "different_be" ? <ChevronDown className="h-4 w-4 text-amber-600" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        <span className="text-sm font-medium">Different BE</span>
                        <Badge variant="secondary" className="text-xs">{alreadyReconciledData.differentBE.bookings.length}</Badge>
                      </div>
                      <span className="font-mono text-xs">{formatNumber(alreadyReconciledData.differentBE.total)} {currency}</span>
                    </div>
                    {expandedAlreadyRecon === "different_be" && (
                      <Table className="text-xs">
                        <TableHeader>
                          <TableRow className="h-7">
                            <TableHead className="py-1 text-xs">TID</TableHead>
                            <TableHead className="py-1 text-xs">Booking ID</TableHead>
                            <TableHead className="py-1 text-xs text-right">SP Net</TableHead>
                            <TableHead className="py-1 text-xs text-right">HO Net</TableHead>
                            <TableHead className="py-1 text-xs">HO BE ID</TableHead>
                            <TableHead className="py-1 text-xs">SP BE ID</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {alreadyReconciledData.differentBE.bookings.map((b, i) => (
                            <TableRow key={`ar-diff-${i}`} className="h-8">
                              <TableCell className="py-1 font-mono">{b.tid || "-"}</TableCell>
                              <TableCell className="py-1 font-mono">{b.bookingId}</TableCell>
                              <TableCell className="py-1 text-right font-mono">{formatNumber(b.spNetInHo)}</TableCell>
                              <TableCell className="py-1 text-right font-mono">{formatNumber(b.hoNet)}</TableCell>
                              <TableCell className="py-1 font-mono">{b.hoBeId || "-"}</TableCell>
                              <TableCell className="py-1 font-mono">{b.spBeId || b.beId || "-"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                )}
              </div>
            </TabsContent>
          )}

          {paymentMismatchData.hasData && (
            <TabsContent value="mismatch" data-testid="section-payment-mismatch">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs px-1">
                  <span className="text-muted-foreground">{paymentMismatchData.totalBookings} bookings with different HO/SP payment methods</span>
                  <span className="font-mono">{formatNumber(paymentMismatchData.totalAmount)} {currency}</span>
                </div>
                <div className="rounded-md border bg-background overflow-hidden">
                  <div
                    className="flex items-center justify-between px-3 py-2 bg-muted/40 cursor-pointer hover-elevate"
                    onClick={() => setExpandedPaymentMismatch(prev => !prev)}
                    data-testid="payment-mismatch-header"
                  >
                    <div className="flex items-center gap-2">
                      {expandedPaymentMismatch ? <ChevronDown className="h-4 w-4 text-primary" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <span className="text-sm font-medium">Mismatched Bookings</span>
                      <Badge variant="outline" className="text-xs">{paymentMismatchData.tidEntries.length} TIDs</Badge>
                    </div>
                  </div>
                  {expandedPaymentMismatch && (
                    <div className="p-2 space-y-1">
                      {paymentMismatchData.tidEntries.map(([tid, bookings]) => (
                        <div key={`pm-tid-${tid}`} className="rounded-md border overflow-hidden">
                          <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-medium">TID: {tid}</span>
                              <Badge variant="secondary" className="text-[10px]">{bookings.length}</Badge>
                            </div>
                          </div>
                          <Table className="text-xs">
                            <TableHeader>
                              <TableRow className="h-7">
                                <TableHead className="py-1 text-xs">Booking ID</TableHead>
                                <TableHead className="py-1 text-xs text-right">SP Net</TableHead>
                                <TableHead className="py-1 text-xs text-right">HO Net</TableHead>
                                <TableHead className="py-1 text-xs">HO Payment</TableHead>
                                <TableHead className="py-1 text-xs">SP Payment</TableHead>
                                <TableHead className="py-1 text-xs">Reason</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {bookings.map((b, i) => (
                                <TableRow key={`pm-${tid}-${i}`} className="h-8">
                                  <TableCell className="py-1 font-mono">{b.bookingId}</TableCell>
                                  <TableCell className="py-1 text-right font-mono">{formatNumber(b.spNetInHo)}</TableCell>
                                  <TableCell className="py-1 text-right font-mono">{formatNumber(b.hoNet)}</TableCell>
                                  <TableCell className="py-1">
                                    <Badge variant="outline" className="text-[10px]">{b.paymentMethod || "-"}</Badge>
                                  </TableCell>
                                  <TableCell className="py-1">
                                    <Badge variant="outline" className="text-[10px]">{b.spPaymentMethod || "-"}</Badge>
                                  </TableCell>
                                  <TableCell className="py-1 text-muted-foreground">{b.reason}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>
          )}

          {cancellationData.hasData && (
            <TabsContent value="cancellations" data-testid="section-cancellations">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs px-1">
                  <span className="text-muted-foreground">{cancellationData.totalBookings} cancelled bookings</span>
                  <span className="font-mono">{formatNumber(cancellationData.totalAmount)} {currency}</span>
                </div>
                <div className="rounded-md border bg-background overflow-hidden">
                  <div
                    className="flex items-center justify-between px-3 py-2 bg-muted/40 cursor-pointer hover-elevate"
                    onClick={() => setExpandedCancellations(prev => !prev)}
                    data-testid="cancellations-header"
                  >
                    <div className="flex items-center gap-2">
                      {expandedCancellations ? <ChevronDown className="h-4 w-4 text-primary" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <span className="text-sm font-medium">Breakdown by Type</span>
                      <Badge variant="outline" className="text-xs">{cancellationData.breakdown.length} types</Badge>
                    </div>
                  </div>
                  {expandedCancellations && (
                    <div className="p-2 space-y-1">
                      {cancellationData.breakdown.map((group) => (
                        <div key={`canc-${group.reason}`} className="rounded-md border overflow-hidden">
                          <div
                            className="flex items-center justify-between px-3 py-1.5 bg-muted/30 cursor-pointer hover-elevate"
                            onClick={() => setExpandedCancType(prev => prev === group.reason ? null : group.reason)}
                            data-testid={`cancellation-type-${group.reason}`}
                          >
                            <div className="flex items-center gap-2">
                              {expandedCancType === group.reason ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                              <span className="text-xs font-medium">{group.reason}</span>
                              <Badge variant="secondary" className="text-[10px]">{group.count}</Badge>
                            </div>
                            <span className="font-mono text-xs text-muted-foreground">{formatNumber(group.total)} {currency}</span>
                          </div>
                          {expandedCancType === group.reason && (
                            <Table className="text-xs">
                              <TableHeader>
                                <TableRow className="h-7">
                                  <TableHead className="py-1 text-xs">TID</TableHead>
                                  <TableHead className="py-1 text-xs">Booking ID</TableHead>
                                  <TableHead className="py-1 text-xs text-right">SP Net</TableHead>
                                  <TableHead className="py-1 text-xs text-right">HO Net</TableHead>
                                  <TableHead className="py-1 text-xs">Charged Loss</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {group.bookings.map((b, i) => (
                                  <TableRow key={`canc-${group.reason}-${i}`} className="h-8">
                                    <TableCell className="py-1 font-mono">{b.tid || "-"}</TableCell>
                                    <TableCell className="py-1 font-mono">{b.bookingId}</TableCell>
                                    <TableCell className="py-1 text-right font-mono">{formatNumber(b.spNetInHo)}</TableCell>
                                    <TableCell className="py-1 text-right font-mono">{formatNumber(b.hoNet)}</TableCell>
                                    <TableCell className="py-1">
                                      <Badge variant={b.chargedLoss === "TRUE" ? "destructive" : "outline"} className="text-[10px]">
                                        {b.chargedLoss || "FALSE"}
                                      </Badge>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )}
                        </div>
                      ))}
                      <div className="flex items-center justify-end gap-3 pt-2 border-t text-xs">
                        <span className="text-muted-foreground">Total ({cancellationData.totalBookings} bookings):</span>
                        <span className="font-mono font-semibold">{formatNumber(cancellationData.totalAmount)} {currency}</span>
                        {effectiveFxRate && (
                          <span className="font-mono text-muted-foreground">({formatNumber(cancellationData.totalAmount * effectiveFxRate)} USD)</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
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
  onReconciliationFinalized,
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
  // Total Amount Payable state: bookingId → total amount payable (defaults to SP Net)
  const [finalNetPrices, setFinalNetPrices] = useState<Map<string, number>>(new Map());
  const [fnpVersion, setFnpVersion] = useState(0);
  const finalNetPricesRef = useRef(finalNetPrices);
  finalNetPricesRef.current = finalNetPrices;
  // Final Vendor ID state: bookingId → corrected vendor ID (for secondary vendor rows)
  const [finalVendorIds, setFinalVendorIds] = useState<Map<string, string>>(new Map());
  const finalVendorIdsRef = useRef(finalVendorIds);
  finalVendorIdsRef.current = finalVendorIds;
  const [isPriceUpdatePending, startPriceTransition] = useTransition();
  
  // Dispute tracking state
  const [activeDisputes, setActiveDisputes] = useState<Set<string>>(new Set());
  const [disputeAmounts, setDisputeAmounts] = useState<Map<string, number>>(new Map());
  const [disputesLoaded, setDisputesLoaded] = useState(false);

  // Apply & confirm + export state
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [showApplyConfirmation, setShowApplyConfirmation] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [gSheetUrl, setGSheetUrl] = useState<string | null>(null);
  
  // Track bookings that have had issues logged (to suppress warning)
  const [loggedIssues, setLoggedIssues] = useState<Set<string>>(new Set());
  
  // Negative SP Net verification state
  const [negativeSpVerified, setNegativeSpVerified] = useState(false);
  const hasNegativeSpBookings = useMemo(() => primaryRows.some(r => r.spNetInHo < 0 && !r.isSecondaryVendor), [primaryRows]);

  const openDisputeData = useMemo(() => {
    const openRows = primaryRows.filter(r => r.disputeStatus?.toUpperCase() === "OPEN" && (r.disputedAmount ?? 0) !== 0);
    if (openRows.length === 0) return { total: 0, groups: [], bookingCount: 0 };

    const byBe = new Map<string, { beName: string; beId: string; rows: typeof openRows; total: number }>();
    for (const row of openRows) {
      const key = row.beId || "unknown";
      if (!byBe.has(key)) {
        byBe.set(key, { beName: row.billingEntityName || key, beId: key, rows: [], total: 0 });
      }
      const g = byBe.get(key)!;
      g.rows.push(row);
      g.total += row.disputedAmount ?? 0;
    }

    const groups = Array.from(byBe.values()).map(g => ({
      ...g,
      total: Math.round(g.total * 100) / 100,
    }));
    const total = Math.round(groups.reduce((s, g) => s + g.total, 0) * 100) / 100;
    return { total, groups, bookingCount: openRows.length };
  }, [primaryRows]);

  const [isOpenDisputeExpanded, setIsOpenDisputeExpanded] = useState(false);
  
  // Imperative refs for modals (state lives inside modal components, not here)
  const disputeModalRef = useRef<DisputeModalHandle>(null);
  const issueModalRef = useRef<IssueModalHandle>(null);
  const manageReloadsModalRef = useRef<ManageReloadsModalHandle>(null);
  
  const formatCurrency = useCallback((value: number) => {
    return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }, []);

  const effectiveFxRate = useMemo(() => {
    if (fxRateToUsd) return fxRateToUsd;
    if (currency === "USD") return 1;
    return null;
  }, [fxRateToUsd, currency]);

  const spCurrency = useMemo(() => {
    const first = primaryRows.find(r => r.spCurrency);
    return first?.spCurrency || currency;
  }, [primaryRows, currency]);

  const summaryCurrency = spCurrency;

  const isCrossCurrency = useMemo(() => spCurrency !== currency, [spCurrency, currency]);

  const summaryFxRateToUsd = useMemo(() => {
    if (!isCrossCurrency) return effectiveFxRate;
    if (spCurrency === "USD") return 1;
    const firstRow = primaryRows.find(r => r.fxRateUsed && r.fxRateUsed !== 0);
    if (firstRow && effectiveFxRate) {
      return effectiveFxRate * firstRow.fxRateUsed;
    }
    return effectiveFxRate;
  }, [isCrossCurrency, spCurrency, primaryRows, effectiveFxRate]);
  
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

  useEffect(() => {
    const negativeSpBookings = primaryRows.filter(r => r.spNetInHo < 0 && !r.isSecondaryVendor);
    if (negativeSpBookings.length === 0) return;
    setFinalNetPrices(prev => {
      const next = new Map(prev);
      let changed = false;
      for (const row of negativeSpBookings) {
        if (next.has(row.bookingId)) continue;
        const spAbs = Math.abs(row.spNetInHo);
        const hoAbs = Math.abs(row.hoNet);
        let fnp: number;
        if (row.hoNet === 0) {
          fnp = 0;
        } else if (spAbs === hoAbs) {
          fnp = 0;
        } else {
          fnp = Math.abs(hoAbs - spAbs);
        }
        next.set(row.bookingId, fnp);
        changed = true;
      }
      if (!changed) return prev;
      return next;
    });
  }, [primaryRows]);

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
      setFnpVersion(v => v + 1);
    });
  }, []);

  const getFinalVendorId = useCallback((bookingId: string, defaultVid: string) => {
    return finalVendorIdsRef.current.has(bookingId) ? finalVendorIdsRef.current.get(bookingId)! : defaultVid;
  }, []);

  const [, startConfirmTransition] = useTransition();
  const handleConfirmApply = useCallback(() => {
    setShowApplyConfirmation(false);
    startConfirmTransition(() => {
      setIsConfirmed(true);
      onReconciliationFinalized?.();
    });
  }, [onReconciliationFinalized]);

  const handleExportExcel = useCallback(async () => {
    if (!runId) {
      toast({ title: "No data to export", description: "Please run a reconciliation first", variant: "destructive" });
      return;
    }
    try {
      setIsExporting(true);
      toast({ title: "Generating export...", description: "Please wait while the export files are being prepared" });
      const [analysisResponse, financialResponse] = await Promise.all([
        fetch(`/api/runs/${runId}/export/analysis`),
        fetch(`/api/runs/${runId}/export/financial`),
      ]);
      if (!analysisResponse.ok || !financialResponse.ok) throw new Error("Failed to generate export");
      const timestamp = new Date().toISOString().slice(0, 10);
      const analysisBlob = await analysisResponse.blob();
      const analysisUrl = window.URL.createObjectURL(analysisBlob);
      const a1 = document.createElement("a");
      a1.href = analysisUrl;
      a1.download = `reconciliation_analysis_${timestamp}.xlsx`;
      document.body.appendChild(a1); a1.click(); window.URL.revokeObjectURL(analysisUrl); document.body.removeChild(a1);
      const financialBlob = await financialResponse.blob();
      const financialUrl = window.URL.createObjectURL(financialBlob);
      const a2 = document.createElement("a");
      a2.href = financialUrl;
      a2.download = `financial_report_${timestamp}.xlsx`;
      document.body.appendChild(a2); a2.click(); window.URL.revokeObjectURL(financialUrl); document.body.removeChild(a2);
      toast({ title: "Export complete", description: "Your reconciliation reports have been downloaded" });
    } catch (error) {
      toast({ title: "Export failed", description: "Failed to generate export file", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  }, [runId, toast]);

  const handleExportGSheet = useCallback(async () => {
    if (!runId) {
      toast({ title: "No data to export", description: "Please run a reconciliation first", variant: "destructive" });
      return;
    }
    try {
      setIsExporting(true);
      toast({ title: "Creating Google Sheets...", description: "Please wait while the spreadsheet is being created" });
      const response = await authFetch(`/api/runs/${runId}/export-gsheet/financial`, { method: "POST" });
      if (!response.ok) throw new Error("Failed to create Google Sheet");
      const data = await response.json();
      if (data.spreadsheetUrl) setGSheetUrl(data.spreadsheetUrl);
      toast({ title: "Google Sheet ready", description: "Click the link below to open it" });
    } catch (error) {
      toast({ title: "Export failed", description: "Failed to create Google Sheet", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  }, [runId, toast]);

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

  const handleIssueSave = useCallback(async (booking: BookingForDispute, driTeamOverride?: string) => {
    if (!runId) return;
    const allRowsArr = [...primaryRows, ...secondaryVendorRows, ...unmappedRows];
    const bookingRow = allRowsArr.find(r => r.bookingId === booking.bookingId);
    
    let driTeam = driTeamOverride || "Finance";
    if (!driTeamOverride) {
      if (booking.reason.includes("Cancelled")) {
        driTeam = "Operations";
      } else if (booking.reason.includes("NPD") || booking.reason.includes("MTB")) {
        driTeam = "Supplier Management";
      }
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

  const { data: portalReloadData } = useQuery<{ total: number; adjustedTotal: number; reloads: PortalReload[]; adjustments: ReloadAdjustment[] }>({
    queryKey: ['/api/portal-reloads', beId],
    enabled: !!beId,
  });

  const balance = balanceData?.balance;
  const hasBalance = !!balance;
  const portalReloadTotal = portalReloadData?.adjustedTotal ?? portalReloadData?.total ?? 0;
  const portalReloadOriginalTotal = portalReloadData?.total ?? 0;
  const hasReloadAdjustments = (portalReloadData?.adjustments?.length ?? 0) > 0;

  const calculations = useMemo(() => {
    const openingBalance = balance?.openingBalance ?? 0;
    const reloads = portalReloadTotal;
    const closingBalance = balance?.closingBalance ?? 0;

    const toSpCcy = (row: PrimaryRow) => row.fxRateUsed && row.fxRateUsed !== 0 ? 1 / row.fxRateUsed : 1;
    
    // Summary values use spNetOriginal (SP/balance currency) for consistency with balances
    const refunds = allRows
      .filter(row => row.spNetOriginal < 0)
      .reduce((sum, row) => sum + row.spNetOriginal, 0);
    
    const computedPurchase = openingBalance + reloads + refunds - closingBalance;
    
    const actualPurchase = allRows.reduce((sum, row) => sum + row.spNetOriginal, 0);
    
    const timingDifference = computedPurchase - actualPurchase;
    
    // Purchases as per HO: convert hoNet from HO currency to SP/balance currency
    const purchasesAsPerHO = primaryRows
      .filter(row => !row.isSecondaryVendor)
      .reduce((sum, row) => sum + row.hoNet * toSpCcy(row), 0);
    
    const difference = purchasesAsPerHO - actualPurchase;
    
    const secondaryRows = secondaryVendorRows;

    // Summary aggregates for rows 10/11 in SP/balance currency
    const inSPNotInHO_primary = primaryRows
      .filter(row => !row.isSecondaryVendor && row.spNetInHo > row.hoNet)
      .reduce((sum, row) => sum + (row.spNetOriginal - row.hoNet * toSpCcy(row)), 0);
    const inSPNotInHO_secondary = secondaryRows
      .reduce((sum, row) => sum + row.spNetOriginal, 0);
    const inSPNotInHO_unmapped = unmappedRows
      .reduce((sum, row) => sum + row.spNetOriginal, 0);
    const inSPNotInHO = inSPNotInHO_primary + inSPNotInHO_secondary + inSPNotInHO_unmapped;
    
    const inHONotInSP = primaryRows
      .filter(row => !row.isSecondaryVendor && row.hoNet > row.spNetInHo)
      .reduce((sum, row) => sum + (row.hoNet * toSpCcy(row) - row.spNetOriginal), 0);

    const netDifference = difference + inSPNotInHO - inHONotInSP;
    
    // Breakup data for row 10: In SP not in HO (grouped by reason)
    const row10ByReason = new Map<string, PurchaseBooking[]>();
    
    // Primary rows where SP > HO
    primaryRows
      .filter(row => !row.isSecondaryVendor && row.spNetInHo > row.hoNet)
      .forEach(row => {
        const reason = row.reason || "Unknown";
        if (!row10ByReason.has(reason)) row10ByReason.set(reason, []);
        const diff = row.spNetInHo < 0 ? Math.abs(row.spNetInHo) - Math.abs(row.hoNet) : row.spNetInHo - row.hoNet;
        row10ByReason.get(reason)!.push({
          bookingId: row.bookingId,
          spNet: row.spNetInHo,
          hoNet: row.hoNet,
          difference: diff,
          reason,
          tid: row.tid || "Unknown",
          ticketId: row.ticketId || "",
          paxBreakdown: row.paxBreakdown,
          experienceDate: row.experienceDate,
          bookingCreationDate: row.bookingCreationDate,
          paymentBasis: row.paymentBasis,
          paymentMethod: row.paymentMethod,
          spPaymentMethod: row.spPaymentMethod,
          alreadyReconciledType: row.alreadyReconciledType,
          hoBeId: row.hoBeId,
          spBeId: row.spBeId || row.beId,
          chargedLoss: row.chargedLoss,
          comment: row.comment,
          experienceName: row.experienceName,
          reconciliationStatus: row.reconciliationStatus,
        });
      });
    
    // Secondary vendor rows always go to row 10 with "SV: " prefix to keep them visually distinct
    secondaryRows.forEach(row => {
      const baseReason = row.reason || "Secondary Vendor";
      const reason = `SV: ${baseReason}`;
      if (!row10ByReason.has(reason)) row10ByReason.set(reason, []);
      const diff = row.spNetInHo < 0 ? Math.abs(row.spNetInHo) - Math.abs(row.hoNet) : row.spNetInHo - row.hoNet;
      row10ByReason.get(reason)!.push({
        bookingId: row.bookingId,
        spNet: row.spNetInHo,
        hoNet: row.hoNet,
        difference: diff,
        reason,
        tid: row.tid || "Unknown",
        ticketId: row.ticketId || "",
        paxBreakdown: row.paxBreakdown,
        experienceDate: row.experienceDate,
        bookingCreationDate: row.bookingCreationDate,
        paymentBasis: row.paymentBasis,
        isSecondaryVendor: true,
        vid: row.vid,
        paymentMethod: row.paymentMethod,
        spPaymentMethod: row.spPaymentMethod,
        alreadyReconciledType: row.alreadyReconciledType,
        hoBeId: row.hoBeId,
        spBeId: row.spBeId || row.beId,
        chargedLoss: row.chargedLoss,
        comment: row.comment,
        experienceName: row.experienceName,
        reconciliationStatus: row.reconciliationStatus,
      });
    });

    // Unmapped rows always go to row 10 (full spNetInHo as difference)
    unmappedRows.forEach(row => {
      const reason = row.reason || "Unmapped";
      if (!row10ByReason.has(reason)) row10ByReason.set(reason, []);
      row10ByReason.get(reason)!.push({
        bookingId: row.bookingId,
        spNet: row.spNetInHo,
        hoNet: 0,
        difference: row.spNetInHo,
        reason,
        tid: row.tid || "Unknown",
        ticketId: row.ticketId || "",
        paxBreakdown: row.paxBreakdown,
        experienceDate: row.experienceDate,
        bookingCreationDate: row.bookingCreationDate,
        paymentBasis: row.paymentBasis,
        paymentMethod: row.paymentMethod,
        spPaymentMethod: row.spPaymentMethod,
        experienceName: row.experienceName,
        reconciliationStatus: row.reconciliationStatus,
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
    
    // Breakup data for row 11: In HO not in SP - only primary rows (secondary/unmapped never here)
    const row11ByReason = new Map<string, PurchaseBooking[]>();
    primaryRows
      .filter(row => !row.isSecondaryVendor && row.hoNet > row.spNetInHo)
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
          paymentMethod: row.paymentMethod,
          spPaymentMethod: row.spPaymentMethod,
          alreadyReconciledType: row.alreadyReconciledType,
          hoBeId: row.hoBeId,
          spBeId: row.spBeId || row.beId,
          chargedLoss: row.chargedLoss,
          comment: row.comment,
          experienceName: row.experienceName,
          reconciliationStatus: row.reconciliationStatus,
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
  }, [allRows, primaryRows, secondaryVendorRows, unmappedRows, balance, portalReloadTotal]);

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
      description: hasReloadAdjustments
        ? `Adjusted (original: ${formatNumber(portalReloadOriginalTotal)})`
        : portalReloadTotal > 0 ? "From portal reloads upload" : "Not configured",
      icon: Plus,
      isFromDb: true,
      hasManage: true,
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
      description: isCrossCurrency ? `Total of primary fulfillments (HO Net → ${summaryCurrency})` : "Total of primary fulfillments (HO Net)",
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

  const cancellationReasons = useMemo(() => [
    "Cancelled-SP error",
    "Cancelled-Insured Booking",
    "Cancelled-DSS policy",
    "Cancelled-Check for Charge loss",
  ], []);

  const alreadyReconciledData = useMemo(() => {
    const sameBE: PrimaryRow[] = [];
    const differentBE: PrimaryRow[] = [];
    const seen = new Set<string>();
    for (const row of [...primaryRows, ...secondaryVendorRows]) {
      if (seen.has(row.bookingId)) continue;
      if (row.alreadyReconciledType === "same_be" || row.reason === "Already Reconciled-Same BE") {
        seen.add(row.bookingId);
        sameBE.push(row);
      } else if (row.alreadyReconciledType === "different_be" || row.reason === "Already Reconciled-Different BE") {
        seen.add(row.bookingId);
        differentBE.push(row);
      }
    }
    const total = sameBE.length + differentBE.length;
    const sameBETotal = sameBE.reduce((s, r) => s + r.spNetInHo, 0);
    const differentBETotal = differentBE.reduce((s, r) => s + r.spNetInHo, 0);
    return {
      hasData: total > 0,
      sameBE: { bookings: sameBE, total: sameBETotal },
      differentBE: { bookings: differentBE, total: differentBETotal },
      totalBookings: total,
      totalAmount: sameBETotal + differentBETotal,
    };
  }, [primaryRows, secondaryVendorRows]);

  const paymentMismatchData = useMemo(() => {
    const mismatches: Array<PrimaryRow & { mismatchLabel: string }> = [];
    const seen = new Set<string>();
    for (const row of [...primaryRows, ...secondaryVendorRows, ...unmappedRows]) {
      if (seen.has(row.bookingId)) continue;
      const ho = (row.paymentMethod || "").trim();
      const sp = (row.spPaymentMethod || "").trim();
      if (ho && sp && ho.toLowerCase() !== sp.toLowerCase()) {
        seen.add(row.bookingId);
        mismatches.push({ ...row, mismatchLabel: `${ho} vs ${sp}` });
      }
    }
    const byTid = new Map<string, typeof mismatches>();
    for (const m of mismatches) {
      const tid = m.tid || "Unknown";
      if (!byTid.has(tid)) byTid.set(tid, []);
      byTid.get(tid)!.push(m);
    }
    const tidEntries = Array.from(byTid.entries()).sort((a, b) => b[1].length - a[1].length);
    return {
      hasData: mismatches.length > 0,
      mismatches,
      tidEntries,
      totalBookings: mismatches.length,
      totalAmount: mismatches.reduce((s, m) => s + m.spNetInHo, 0),
    };
  }, [primaryRows, secondaryVendorRows, unmappedRows]);

  const cancellationData = useMemo(() => {
    const seenCanc = new Set<string>();
    const cancBookings = [...primaryRows, ...secondaryVendorRows].filter(r => {
      if (seenCanc.has(r.bookingId)) return false;
      const isCanc = cancellationReasons.includes(r.reason) || (r.reason === "Reconciled" && (r.comment || "").startsWith("Cancelled"));
      if (isCanc) seenCanc.add(r.bookingId);
      return isCanc;
    });
    if (cancBookings.length === 0) return { hasData: false, breakdown: [], totalBookings: 0, totalAmount: 0 };
    const breakdown = cancellationReasons.map(reason => {
      const bookings = cancBookings.filter(b => b.reason === reason);
      const total = bookings.reduce((s, b) => s + b.spNetInHo, 0);
      return { reason, bookings, total, count: bookings.length };
    }).filter(g => g.count > 0);
    const cancelledOKBookings = cancBookings.filter(b => b.reason === "Reconciled" && (b.comment || "").startsWith("Cancelled"));
    if (cancelledOKBookings.length > 0) {
      breakdown.unshift({
        reason: "Cancelled-OK",
        bookings: cancelledOKBookings,
        total: cancelledOKBookings.reduce((s, b) => s + b.spNetInHo, 0),
        count: cancelledOKBookings.length,
      });
    }
    return {
      hasData: true,
      breakdown,
      totalBookings: cancBookings.length,
      totalAmount: cancBookings.reduce((s, b) => s + b.spNetInHo, 0),
    };
  }, [primaryRows, secondaryVendorRows, cancellationReasons]);

  const [expandedAlreadyRecon, setExpandedAlreadyRecon] = useState<"same_be" | "different_be" | null>(null);
  const [expandedPaymentMismatch, setExpandedPaymentMismatch] = useState(false);
  const [expandedCancellations, setExpandedCancellations] = useState(false);
  const [expandedCancType, setExpandedCancType] = useState<string | null>(null);

  const [expandedTableSections, setExpandedTableSections] = useState<Set<string>>(() => new Set(["purchase", "reconciliation"]));
  const toggleTableSection = useCallback((section: string) => {
    setExpandedTableSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }, []);

  const tableSections = useMemo(() => [
    { key: "balance", label: "Balance & Deposits", rows: [1, 2, 3, 4], description: "Opening/closing balances, reloads, refunds" },
    { key: "purchase", label: "Purchase Comparison", rows: [5, 6, 7, 8, 9], description: "Computed vs actual purchases" },
    { key: "reconciliation", label: "Reconciliation Breakdown", rows: [10, 11, 12], description: "SP vs HO discrepancies" },
  ], []);

  const insightTabsCount = useMemo(() => {
    let count = 0;
    if (alreadyReconciledData.hasData) count++;
    if (paymentMismatchData.hasData) count++;
    if (cancellationData.hasData) count++;
    return count;
  }, [alreadyReconciledData.hasData, paymentMismatchData.hasData, cancellationData.hasData]);

  const defaultInsightTab = useMemo(() => {
    if (alreadyReconciledData.hasData) return "reconciled";
    if (paymentMismatchData.hasData) return "mismatch";
    if (cancellationData.hasData) return "cancellations";
    return "reconciled";
  }, [alreadyReconciledData.hasData, paymentMismatchData.hasData, cancellationData.hasData]);

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
            {isCrossCurrency ? `${summaryCurrency} (HO: ${currency})` : currency}
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
          <Button
            size="sm"
            variant={isConfirmed ? "outline" : "default"}
            onClick={() => setShowApplyConfirmation(true)}
            data-testid="button-apply-confirm-purchase-reco"
            className={isConfirmed ? "text-green-600 border-green-500 hover:bg-green-50 dark:hover:bg-green-950/20" : ""}
          >
            <Check className="h-3.5 w-3.5 mr-1" />
            {isConfirmed ? "Confirmed" : "Apply & confirm"}
          </Button>
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

      <LineItemsTableCard
        billingEntityName={billingEntityName}
        calculations={calculations}
        effectiveFxRate={effectiveFxRate}
        currency={currency}
        hasBalance={hasBalance}
        lineItems={lineItems}
        tableSections={tableSections}
        expandedTableSections={expandedTableSections}
        toggleTableSection={toggleTableSection}
        expandedRows={expandedRows}
        toggleRowExpand={toggleRowExpand}
        expandedReasons={expandedReasons}
        expandedTids={expandedTids}
        getVisibleTidCount={getVisibleTidCount}
        toggleReasonExpand={toggleReasonExpand}
        toggleTidExpand={toggleTidExpand}
        showMoreTids={showMoreTids}
        activeDisputes={activeDisputes}
        disputeAmounts={disputeAmounts}
        loggedIssues={loggedIssues}
        fnpVersion={fnpVersion}
        getFinalNetPrice={getFinalNetPrice}
        updateFinalNetPrice={updateFinalNetPrice}
        openIssueModal={openIssueModal}
        onManageReloads={() => manageReloadsModalRef.current?.open()}
        runId={runId}
        negativeSpVerified={negativeSpVerified}
        onSetNegativeSpVerified={setNegativeSpVerified}
        summaryCurrency={summaryCurrency}
        summaryFxRateToUsd={summaryFxRateToUsd}
        isCrossCurrency={isCrossCurrency}
      />

      <InsightsCard
        insightTabsCount={insightTabsCount}
        defaultInsightTab={defaultInsightTab}
        alreadyReconciledData={alreadyReconciledData}
        paymentMismatchData={paymentMismatchData}
        cancellationData={cancellationData}
        currency={currency}
        effectiveFxRate={effectiveFxRate}
        expandedAlreadyRecon={expandedAlreadyRecon}
        setExpandedAlreadyRecon={setExpandedAlreadyRecon}
        expandedPaymentMismatch={expandedPaymentMismatch}
        setExpandedPaymentMismatch={setExpandedPaymentMismatch}
        expandedCancellations={expandedCancellations}
        setExpandedCancellations={setExpandedCancellations}
        expandedCancType={expandedCancType}
        setExpandedCancType={setExpandedCancType}
      />

      {openDisputeData.bookingCount > 0 && (
        <div className="border border-amber-200 dark:border-amber-800 rounded-lg p-3 bg-amber-50/50 dark:bg-amber-950/20">
          <Collapsible open={isOpenDisputeExpanded} onOpenChange={setIsOpenDisputeExpanded}>
            <CollapsibleTrigger asChild>
              <div className="flex items-center justify-between cursor-pointer" data-testid="toggle-open-disputes-purchase">
                <div className="flex items-center gap-2">
                  {isOpenDisputeExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <p className="text-sm font-medium">Open Dispute Bookings</p>
                  <Badge variant="secondary" className="text-xs">{openDisputeData.bookingCount}</Badge>
                </div>
                <span className="font-mono font-medium text-amber-700 dark:text-amber-300 text-sm">
                  {formatCurrency(openDisputeData.total)} {currency}
                </span>
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-3 space-y-3">
                {openDisputeData.groups.map(group => (
                  <div key={group.beId} className="space-y-1">
                    <div className="flex items-center justify-between px-2">
                      <span className="text-xs font-medium text-muted-foreground">{group.beName}</span>
                      <span className="text-xs font-mono">{formatCurrency(group.total)} {currency} · {group.rows.length} booking(s)</span>
                    </div>
                    <div className="border rounded overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/30">
                            <TableHead className="text-xs py-1">Booking ID</TableHead>
                            <TableHead className="text-xs py-1">TID</TableHead>
                            <TableHead className="text-xs py-1 text-right">Disputed Amt</TableHead>
                            <TableHead className="text-xs py-1 text-right">SP Net</TableHead>
                            <TableHead className="text-xs py-1 text-right">HO Net</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.rows.map(row => (
                            <TableRow key={row.bookingId} data-testid={`open-dispute-purchase-row-${row.bookingId}`}>
                              <TableCell className="text-xs font-mono py-1">{row.bookingId}</TableCell>
                              <TableCell className="text-xs font-mono py-1">{row.tid || "-"}</TableCell>
                              <TableCell className="text-xs font-mono py-1 text-right text-amber-700 dark:text-amber-300">
                                {formatCurrency(row.disputedAmount ?? 0)}
                              </TableCell>
                              <TableCell className="text-xs font-mono py-1 text-right">{formatCurrency(row.spNet)}</TableCell>
                              <TableCell className="text-xs font-mono py-1 text-right">{formatCurrency(row.hoNet)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      <div className="flex items-center justify-between pt-2 flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onClose} data-testid="button-close-purchase-reco">
          Close
        </Button>
        {isConfirmed && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={handleExportExcel}
              disabled={isExporting}
              data-testid="button-export-excel-purchase-reco"
            >
              {isExporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Export Excel
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportGSheet}
              disabled={isExporting}
              data-testid="button-export-gsheet-purchase-reco"
            >
              {isExporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Export Google Sheets
            </Button>
            {gSheetUrl && (
              <a
                href={gSheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary underline underline-offset-2 hover:opacity-80 font-medium"
                data-testid="link-gsheet-purchase-reco"
              >
                Open Google Sheet →
              </a>
            )}
          </div>
        )}
      </div>

      <Dialog open={showApplyConfirmation} onOpenChange={setShowApplyConfirmation}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Purchase Reconciliation</DialogTitle>
            <DialogDescription>
              Are you sure you want to confirm this purchase reconciliation? This will lock in the current values and enable the financial report export.
            </DialogDescription>
          </DialogHeader>
          {hasNegativeSpBookings && !negativeSpVerified && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <span className="font-medium">Negative SP Net bookings not verified.</span>{" "}
                Please go to the "Negative SP - Partial Refund" reason group and verify all refund transactions before confirming.
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApplyConfirmation(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmApply}
              disabled={hasNegativeSpBookings && !negativeSpVerified}
              data-testid="button-confirm-apply-purchase-reco"
            >
              Yes, confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DisputeModal ref={disputeModalRef} currency={currency} onSave={handleDisputeSave} />
      <IssueModal ref={issueModalRef} currency={currency} billingEntityName={billingEntityName} effectiveFxRate={effectiveFxRate} onSave={handleIssueSave} />
      <ManageReloadsModal
        ref={manageReloadsModalRef}
        beId={beId}
        currency={currency}
        reloads={portalReloadData?.reloads ?? []}
        adjustments={portalReloadData?.adjustments ?? []}
        originalTotal={portalReloadOriginalTotal}
        adjustedTotal={portalReloadTotal}
      />

    </div>
  );
}
