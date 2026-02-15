import { useState, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import { TrendingUp, FileWarning, AlertTriangle, Filter, Check, X, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BookingForPayable } from "./amount-payable-modal";
import type { PrimaryRow } from "@shared/schema";
import { driTeams } from "@shared/schema";

function formatNumberModal(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export interface ReasonLevelModalHandle {
  open: (reason: string, section: "discrepancy" | "cancellation" | "secondary_vendor") => void;
}

export interface ReasonLevelModalProps {
  currency: string;
  runId?: string | null;
  allRows: PrimaryRow[];
  bookingsByReason: Record<string, BookingForPayable[]>;
  cancellationsByReason: Record<string, BookingForPayable[]>;
  secondaryVendorByReason: Record<string, BookingForPayable[]>;
  localSelections: Record<string, "ho" | "sp">;
  activeDisputes: Set<string>;
  disputeAmounts: Map<string, number>;
  onApplyBulkSelection: (bookingIds: string[], value: "ho" | "sp") => void;
  onApplyFlatAdjustment: (bookingIds: string[], adjustment: number) => void;
  onRaiseDispute: (bookings: BookingForPayable[]) => void;
  onClearDisputes: (bookingIds: string[]) => void;
  onLogIssue: (reason: string, description: string, priority: "low" | "medium" | "high", driTeam: string, bookingIds: string[]) => void;
}

export const ReasonLevelModal = forwardRef<ReasonLevelModalHandle, ReasonLevelModalProps>(
  function ReasonLevelModal(props, ref) {
    const {
      currency,
      allRows,
      bookingsByReason,
      cancellationsByReason,
      secondaryVendorByReason,
      localSelections,
      activeDisputes,
      disputeAmounts,
      onApplyBulkSelection,
      onApplyFlatAdjustment,
      onRaiseDispute,
      onClearDisputes,
      onLogIssue,
    } = props;

    const [isOpen, setIsOpen] = useState(false);
    const [reason, setReason] = useState("");
    const [section, setSection] = useState<"discrepancy" | "cancellation" | "secondary_vendor">("discrepancy");
    const [threshold, setThreshold] = useState(0);
    const [flatAdj, setFlatAdj] = useState(0);
    const [issueOpen, setIssueOpen] = useState(false);
    const [disputeOpen, setDisputeOpen] = useState(false);
    const [issuePriority, setIssuePriority] = useState<"low" | "medium" | "high">("medium");
    const [issueDescription, setIssueDescription] = useState("");
    const [driTeamOverride, setDriTeamOverride] = useState<string>("");

    useImperativeHandle(ref, () => ({
      open: (r: string, s: "discrepancy" | "cancellation" | "secondary_vendor") => {
        setReason(r);
        setSection(s);
        setThreshold(0);
        setFlatAdj(0);
        setIssueOpen(false);
        setDisputeOpen(false);
        setIssuePriority("medium");
        setIssueDescription("");
        setDriTeamOverride("");
        setIsOpen(true);
      },
    }));

    const bookings = useMemo(() => {
      const source =
        section === "discrepancy"
          ? bookingsByReason
          : section === "cancellation"
            ? cancellationsByReason
            : secondaryVendorByReason;
      return source[reason] || [];
    }, [reason, section, bookingsByReason, cancellationsByReason, secondaryVendorByReason]);

    const filteredBookings = useMemo(() => {
      const filtered = bookings.filter(
        (b) => Math.abs(b.spNet - b.hoNet) > threshold
      );
      return filtered.sort(
        (a, b) => Math.abs(b.spNet - b.hoNet) - Math.abs(a.spNet - a.hoNet)
      );
    }, [bookings, threshold]);

    const totalSpNet = useMemo(
      () => Math.round(bookings.reduce((s, b) => s + b.spNet, 0) * 100) / 100,
      [bookings]
    );

    const totalHoNet = useMemo(
      () => Math.round(bookings.reduce((s, b) => s + b.hoNet, 0) * 100) / 100,
      [bookings]
    );

    const totalDiscrepancy = useMemo(
      () =>
        Math.round(
          bookings.reduce((s, b) => s + Math.abs(b.spNet - b.hoNet), 0) * 100
        ) / 100,
      [bookings]
    );

    const detectedDriTeam = useMemo(() => {
      const match = allRows.find((r) => r.reason === reason && r.driTeam);
      return match?.driTeam || "";
    }, [allRows, reason]);

    const effectiveDriTeam = driTeamOverride || detectedDriTeam || "Tech";

    const uniqueTids = useMemo(() => {
      const tids = new Set<string>();
      bookings.forEach((b) => {
        if (b.tid) tids.add(b.tid);
      });
      return tids;
    }, [bookings]);

    const getSelection = useCallback(
      (bookingId: string): "ho" | "sp" => {
        return localSelections[bookingId] || "sp";
      },
      [localSelections]
    );

    const getFinalNet = useCallback(
      (b: BookingForPayable): number => {
        const sel = getSelection(b.bookingId);
        return sel === "ho" ? b.hoNet : b.spNet;
      },
      [getSelection]
    );

    const disputableBookings = useMemo(() => {
      return filteredBookings.filter(
        (b) => getSelection(b.bookingId) === "sp" || reason === "Unmapped"
      );
    }, [filteredBookings, getSelection, reason]);

    const totalDisputeAmount = useMemo(() => {
      return Math.round(
        disputableBookings.reduce(
          (s, b) => s + Math.abs(b.spNet - b.hoNet),
          0
        ) * 100
      ) / 100;
    }, [disputableBookings]);

    const isCancellationType = reason.toLowerCase().includes("cancel");
    const isReconciled = reason === "Reconciled";
    const isUnmapped = reason === "Unmapped";
    const isNegativeSp = reason.toLowerCase().includes("negative sp");

    const handleUseHoAll = useCallback(() => {
      onApplyBulkSelection(
        filteredBookings.map((b) => b.bookingId),
        "ho"
      );
    }, [filteredBookings, onApplyBulkSelection]);

    const handleUseSpAll = useCallback(() => {
      onApplyBulkSelection(
        filteredBookings.map((b) => b.bookingId),
        "sp"
      );
    }, [filteredBookings, onApplyBulkSelection]);

    const handleSetZeroAll = useCallback(() => {
      onApplyFlatAdjustment(
        filteredBookings.map((b) => b.bookingId),
        0
      );
    }, [filteredBookings, onApplyFlatAdjustment]);

    const handleApplyFlat = useCallback(() => {
      if (flatAdj === 0) return;
      onApplyFlatAdjustment(
        filteredBookings.map((b) => b.bookingId),
        Math.round(flatAdj * 100) / 100
      );
    }, [filteredBookings, flatAdj, onApplyFlatAdjustment]);

    const handleFlagIssue = useCallback(() => {
      onLogIssue(
        reason,
        issueDescription,
        issuePriority,
        effectiveDriTeam,
        bookings.map((b) => b.bookingId)
      );
      setIssueOpen(false);
      setIssueDescription("");
    }, [reason, issueDescription, issuePriority, effectiveDriTeam, bookings, onLogIssue]);

    const handleDisputeAllFiltered = useCallback(() => {
      onRaiseDispute(disputableBookings);
    }, [disputableBookings, onRaiseDispute]);

    const handleClearAllDisputes = useCallback(() => {
      onClearDisputes(bookings.map((b) => b.bookingId));
    }, [bookings, onClearDisputes]);

    const handleApplyDisputes = useCallback(() => {
      const disputedBookings = bookings.filter(
        (b) => activeDisputes.has(b.bookingId)
      );
      if (disputedBookings.length > 0) {
        onRaiseDispute(disputedBookings);
      }
    }, [bookings, activeDisputes, onRaiseDispute]);

    const activeDisputeCount = useMemo(() => {
      return bookings.filter((b) => activeDisputes.has(b.bookingId)).length;
    }, [bookings, activeDisputes]);

    const activeDisputeTotal = useMemo(() => {
      let total = 0;
      bookings.forEach((b) => {
        const amt = disputeAmounts.get(b.bookingId);
        if (amt) total += amt;
      });
      return Math.round(total * 100) / 100;
    }, [bookings, disputeAmounts]);

    return (
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <TrendingUp className="h-5 w-5 text-primary" />
              Manage Reason: {reason}
            </DialogTitle>
            <DialogDescription>
              {bookings.length} bookings in {section === "discrepancy" ? "discrepancy" : section === "cancellation" ? "cancellation" : "secondary vendor"} section
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1" data-testid="reason-modal-scroll-area">
            <div className="rounded-md border bg-background overflow-visible">
              <div className="px-4 py-3 border-b bg-blue-50 dark:bg-blue-900/20">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-8 w-8 rounded-md bg-blue-100 dark:bg-blue-900/30">
                    <TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="text-sm font-medium">Price Update</div>
                </div>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  <div className="rounded-md border p-2 bg-muted/30">
                    <div className="text-xs text-muted-foreground">Bookings</div>
                    <div className="text-sm font-semibold font-mono" data-testid="stat-booking-count">
                      {bookings.length}
                    </div>
                  </div>
                  <div className="rounded-md border p-2 bg-blue-50/50 dark:bg-blue-900/10">
                    <div className="text-xs text-muted-foreground">Total SP Net</div>
                    <div className="text-sm font-semibold font-mono text-blue-700 dark:text-blue-300" data-testid="stat-sp-net">
                      {formatNumberModal(totalSpNet)}
                    </div>
                  </div>
                  <div className="rounded-md border p-2 bg-green-50/50 dark:bg-green-900/10">
                    <div className="text-xs text-muted-foreground">Total HO Net</div>
                    <div className="text-sm font-semibold font-mono text-green-700 dark:text-green-300" data-testid="stat-ho-net">
                      {formatNumberModal(totalHoNet)}
                    </div>
                  </div>
                  <div className="rounded-md border p-2 bg-amber-50/50 dark:bg-amber-900/10">
                    <div className="text-xs text-muted-foreground">Discrepancy</div>
                    <div className="text-sm font-semibold font-mono text-amber-700 dark:text-amber-300" data-testid="stat-discrepancy">
                      {formatNumberModal(totalDiscrepancy)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {isReconciled ? (
                    <Button
                      size="sm"
                      className="bg-green-600 text-white"
                      onClick={handleUseHoAll}
                      data-testid="btn-confirm-all-paid"
                    >
                      <Check className="h-3.5 w-3.5 mr-1.5" />
                      Confirm All as Paid
                    </Button>
                  ) : isUnmapped ? (
                    <Button
                      size="sm"
                      className="bg-blue-600 text-white"
                      onClick={handleUseSpAll}
                      data-testid="btn-use-sp-all"
                    >
                      Use SP Net for All
                    </Button>
                  ) : isCancellationType ? (
                    <Button
                      size="sm"
                      className="bg-green-600 text-white"
                      onClick={handleUseHoAll}
                      data-testid="btn-accept-cancellation"
                    >
                      Accept Cancellation Pricing
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        className="bg-green-600 text-white"
                        onClick={handleUseHoAll}
                        data-testid="btn-use-ho-all"
                      >
                        Use HO Net for All
                      </Button>
                      <Button
                        size="sm"
                        className="bg-blue-600 text-white"
                        onClick={handleUseSpAll}
                        data-testid="btn-use-sp-all"
                      >
                        Use SP Net for All
                      </Button>
                    </>
                  )}
                  {isNegativeSp && (
                    <Button
                      size="sm"
                      className="bg-red-600 text-white"
                      onClick={handleSetZeroAll}
                      data-testid="btn-set-zero-all"
                    >
                      Set Final Net = 0 for All
                    </Button>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Filter by discrepancy &gt;</span>
                  </div>
                  <Input
                    type="number"
                    step={1}
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value) || 0)}
                    className="w-24"
                    data-testid="input-threshold"
                  />
                  <Badge variant="secondary" className="no-default-active-elevate">
                    {filteredBookings.length} / {bookings.length}
                  </Badge>
                  {threshold > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setThreshold(0)}
                      data-testid="btn-clear-threshold"
                    >
                      <X className="h-3.5 w-3.5 mr-1" />
                      Clear
                    </Button>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">Flat adjustment</span>
                  <Input
                    type="number"
                    step={0.01}
                    value={flatAdj}
                    onChange={(e) => setFlatAdj(Number(e.target.value) || 0)}
                    className="w-28"
                    data-testid="input-flat-adjustment"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleApplyFlat}
                    disabled={flatAdj === 0}
                    data-testid="btn-apply-flat"
                  >
                    Apply to filtered
                  </Button>
                </div>

                <div className="max-h-64 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Booking ID</TableHead>
                        <TableHead className="text-xs text-right">HO Net</TableHead>
                        <TableHead className="text-xs text-right">SP Net</TableHead>
                        <TableHead className="text-xs text-right">Discrepancy</TableHead>
                        <TableHead className="text-xs">Selection</TableHead>
                        <TableHead className="text-xs text-right">Final Net</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredBookings.map((b) => {
                        const disc = Math.round(Math.abs(b.spNet - b.hoNet) * 100) / 100;
                        const sel = getSelection(b.bookingId);
                        const finalNet = getFinalNet(b);
                        return (
                          <TableRow key={b.bookingId} data-testid={`row-booking-${b.bookingId}`}>
                            <TableCell className="text-xs font-mono">{b.bookingId}</TableCell>
                            <TableCell className="text-xs font-mono text-right text-green-700 dark:text-green-300">
                              {formatNumberModal(b.hoNet)}
                            </TableCell>
                            <TableCell className="text-xs font-mono text-right text-blue-700 dark:text-blue-300">
                              {formatNumberModal(b.spNet)}
                            </TableCell>
                            <TableCell className="text-xs font-mono text-right text-amber-700 dark:text-amber-300">
                              {formatNumberModal(disc)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={sel === "sp" ? "default" : "secondary"}
                                className="text-xs no-default-active-elevate"
                                data-testid={`badge-selection-${b.bookingId}`}
                              >
                                {sel.toUpperCase()}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs font-mono text-right font-semibold">
                              {formatNumberModal(finalNet)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {filteredBookings.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-4">
                            No bookings match the current filter
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>

            <Collapsible open={issueOpen} onOpenChange={setIssueOpen}>
              <div className="rounded-md border bg-background overflow-visible">
                <CollapsibleTrigger asChild>
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover-elevate"
                    data-testid="trigger-flag-issue"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center h-8 w-8 rounded-md bg-orange-100 dark:bg-orange-900/30">
                        <FileWarning className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                      </div>
                      <div className="text-sm font-medium">Flag Issue</div>
                    </div>
                    {issueOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 pb-4 space-y-3 border-t pt-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground">DRI Team:</span>
                      {detectedDriTeam && (
                        <Badge variant="secondary" className="no-default-active-elevate" data-testid="badge-dri-detected">
                          {detectedDriTeam}
                        </Badge>
                      )}
                      <Select
                        value={driTeamOverride || detectedDriTeam || ""}
                        onValueChange={(v) => setDriTeamOverride(v)}
                      >
                        <SelectTrigger className="w-40" data-testid="select-dri-team">
                          <SelectValue placeholder="Override DRI" />
                        </SelectTrigger>
                        <SelectContent>
                          {driTeams.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Priority:</span>
                      {(["low", "medium", "high"] as const).map((p) => (
                        <Badge
                          key={p}
                          variant={issuePriority === p ? "default" : "outline"}
                          className={`cursor-pointer toggle-elevate ${issuePriority === p ? "toggle-elevated" : ""}`}
                          onClick={() => setIssuePriority(p)}
                          data-testid={`badge-priority-${p}`}
                        >
                          {p.charAt(0).toUpperCase() + p.slice(1)}
                        </Badge>
                      ))}
                    </div>

                    <Textarea
                      placeholder="Describe the issue..."
                      value={issueDescription}
                      onChange={(e) => setIssueDescription(e.target.value)}
                      className="text-xs"
                      data-testid="textarea-issue-description"
                    />

                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground">Affected:</span>
                      <Badge variant="secondary" className="no-default-active-elevate" data-testid="badge-tid-count">
                        {uniqueTids.size} TIDs
                      </Badge>
                      <Badge variant="secondary" className="no-default-active-elevate" data-testid="badge-booking-count">
                        {bookings.length} Bookings
                      </Badge>
                    </div>

                    <Button
                      size="sm"
                      className="bg-orange-600 text-white"
                      onClick={handleFlagIssue}
                      disabled={!issueDescription.trim()}
                      data-testid="btn-flag-issue"
                    >
                      <FileWarning className="h-3.5 w-3.5 mr-1.5" />
                      Flag Issue
                    </Button>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>

            <Collapsible open={disputeOpen} onOpenChange={setDisputeOpen}>
              <div className="rounded-md border bg-background overflow-visible">
                <CollapsibleTrigger asChild>
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover-elevate"
                    data-testid="trigger-raise-dispute"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center h-8 w-8 rounded-md bg-amber-100 dark:bg-amber-900/30">
                        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      </div>
                      <div className="text-sm font-medium">Raise Dispute</div>
                    </div>
                    {disputeOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 pb-4 space-y-3 border-t pt-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-xs text-muted-foreground">Disputable bookings:</span>
                      <Badge variant="secondary" className="no-default-active-elevate" data-testid="badge-disputable-count">
                        {disputableBookings.length}
                      </Badge>
                      <span className="text-xs text-muted-foreground">Total dispute amount:</span>
                      <Badge variant="secondary" className="font-mono no-default-active-elevate" data-testid="badge-dispute-total">
                        {formatNumberModal(totalDisputeAmount)} {currency}
                      </Badge>
                    </div>

                    {activeDisputeCount > 0 && (
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xs text-muted-foreground">Active disputes:</span>
                        <Badge variant="default" className="no-default-active-elevate" data-testid="badge-active-dispute-count">
                          {activeDisputeCount}
                        </Badge>
                        <span className="text-xs font-mono text-amber-600 dark:text-amber-400" data-testid="text-active-dispute-total">
                          {formatNumberModal(activeDisputeTotal)} {currency}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleDisputeAllFiltered}
                        disabled={disputableBookings.length === 0}
                        data-testid="btn-dispute-all-filtered"
                      >
                        <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
                        Dispute All Filtered
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleClearAllDisputes}
                        data-testid="btn-clear-all-disputes"
                      >
                        <X className="h-3.5 w-3.5 mr-1.5" />
                        Clear All Disputes
                      </Button>
                    </div>

                    <Button
                      size="sm"
                      className="bg-amber-600 text-white"
                      onClick={handleApplyDisputes}
                      disabled={activeDisputeCount === 0}
                      data-testid="btn-apply-disputes"
                    >
                      <Check className="h-3.5 w-3.5 mr-1.5" />
                      Apply Disputes ({activeDisputeCount})
                    </Button>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
);
