import { useState, useCallback } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";

import { LandingPage } from "@/pages/landing";
import { UploadPage } from "@/pages/upload";
import { MappingPage } from "@/pages/mapping";
import { RunPage } from "@/pages/run";
import { ResultsPage } from "@/pages/results";
import { DiscrepancyAnalysisPage } from "@/pages/discrepancy-analysis";
import { DraftsPage } from "@/pages/drafts";
import { DriPage } from "@/pages/dri";
import { ExportPage } from "@/pages/export";
import NotFound from "@/pages/not-found";

import type {
  RunRecord,
  UploadedFile,
  ColumnMapping,
  SummaryRow,
  DraftMessage,
  ReconResult,
  FxRate,
  ProgressStep,
  RunStatus,
} from "@shared/schema";
import { requiredFields, optionalFields, headerAliases } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

function AppContent() {
  
  // Global state
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [lastFxRefresh, setLastFxRefresh] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastExportTimestamp, setLastExportTimestamp] = useState<string | null>(null);

  // Run-specific state
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [availableHeaders, setAvailableHeaders] = useState<string[]>([]);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [results, setResults] = useState<ReconResult[]>([]);
  const [fxRates, setFxRates] = useState<FxRate[]>([]);
  const [overallSummary, setOverallSummary] = useState<SummaryRow[]>([]);
  const [mtbSummary, setMtbSummary] = useState<SummaryRow[]>([]);
  const [npdSummary, setNpdSummary] = useState<SummaryRow[]>([]);
  const [chargeLossSummary, setChargeLossSummary] = useState<SummaryRow[]>([]);
  const [draftMessages, setDraftMessages] = useState<DraftMessage[]>([]);

  const hasFiles = uploadedFiles.length > 0;
  const hasMapping = mappings.length > 0 && mappings.filter(m => m.isRequired && m.isMatched).length === mappings.filter(m => m.isRequired).length;
  const hasResults = results.length > 0;

  // File upload handler - uploads file and auto-runs reconciliation
  const handleFilesUploaded = useCallback(async (files: File[]): Promise<UploadedFile[]> => {
    if (files.length === 0) {
      throw new Error("No files provided");
    }

    const formData = new FormData();
    formData.append("file", files[0]);

    try {
      setStatus("processing");
      
      // Step 1: Upload file
      const uploadResponse = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const uploadData = await uploadResponse.json();
      
      if (!uploadResponse.ok || uploadData.error) {
        throw new Error(uploadData.error || "Upload failed");
      }
      
      const uploadedFile: UploadedFile = uploadData.file;
      setUploadedFiles([uploadedFile]);
      
      // Step 2: Automatically run reconciliation
      const runResponse = await apiRequest("POST", "/api/runs/from-upload", {
        uploadId: uploadData.uploadId,
      });
      const runData = await runResponse.json();
      
      // Step 3: Store run and navigate to results
      const newRun: RunRecord = {
        id: runData.runId,
        uploadId: uploadData.uploadId,
        status: "done",
        progressStep: null,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        error: null,
      };
      setRuns((prev) => [newRun, ...prev]);
      setCurrentRunId(newRun.id);
      setLastFxRefresh(runData.fx?.refreshedAt || new Date().toISOString());
      setStatus("done");
      // Stay on current page - summary will show inline

      return [uploadedFile];
    } catch (error) {
      console.error("Upload error:", error);
      setStatus("error");
      throw error;
    }
  }, []);

  // Demo mode handler
  const handleLoadDemo = useCallback(async () => {
    setStatus("processing");
    try {
      const response = await apiRequest("POST", "/api/demo");
      const data = await response.json();
      
      // New API returns { runId, uploadId, fx, overallSummary, primaryRows, allRows, spFxDebugRows }
      const newRun: RunRecord = {
        id: data.runId,
        uploadId: data.uploadId,
        status: "done",
        progressStep: null,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        error: null,
      };
      setRuns((prev) => [newRun, ...prev]);
      setCurrentRunId(newRun.id);
      setLastFxRefresh(data.fx?.refreshedAt || new Date().toISOString());
      setStatus("done");
      // Stay on current page - summary will show inline
    } catch (error) {
      console.error("Demo load error:", error);
      setStatus("error");
    }
  }, []);

  // Save mappings handler
  const handleSaveMappings = useCallback((newMappings: ColumnMapping[]) => {
    setMappings(newMappings);
  }, []);

  // Run reconciliation handler
  const handleRunReconciliation = useCallback(async (
    onProgress: (stepId: string, status: ProgressStep["status"]) => void
  ) => {
    setStatus("processing");

    const steps = ["parse", "fx", "compute", "summaries", "drafts", "dri"];
    
    try {
      for (const step of steps) {
        onProgress(step, "active");
        
        // Simulate step processing with API call
        const response = await apiRequest("POST", `/api/run/${step}`, {
          mappings,
          files: uploadedFiles,
        });
        const data = await response.json();

        // Update state based on step
        if (step === "fx") {
          setFxRates(data.fxRates);
          setLastFxRefresh(new Date().toISOString());
        } else if (step === "compute") {
          setResults(data.results);
        } else if (step === "summaries") {
          setOverallSummary(data.overallSummary);
          setMtbSummary(data.mtbSummary);
          setNpdSummary(data.npdSummary);
          setChargeLossSummary(data.chargeLossSummary);
        } else if (step === "drafts") {
          setDraftMessages(data.draftMessages);
        }

        onProgress(step, "completed");
      }

      // Create run record
      const newRun: RunRecord = {
        id: `run-${Date.now()}`,
        uploadId: uploadedFiles[0]?.id || "unknown",
        status: "done",
        progressStep: null,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        error: null,
      };
      setRuns((prev) => [newRun, ...prev]);
      setCurrentRunId(newRun.id);
      setStatus("done");
    } catch (error) {
      console.error("Reconciliation error:", error);
      setStatus("error");
      throw error;
    }
  }, [mappings, uploadedFiles, results]);

  // FX refresh handler
  const handleFxRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const response = await apiRequest("POST", "/api/fx/refresh");
      const data = await response.json();
      setFxRates(data.fxRates);
      setLastFxRefresh(new Date().toISOString());
    } catch (error) {
      console.error("FX refresh error:", error);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Export handlers
  const handleExportFiltered = useCallback((filteredResults: ReconResult[]) => {
    const csv = [
      ["BID", "TID", "Currency", "HO Net", "SP Net", "Difference", "Diff USD", "Reason", "DRI Team", "Status"].join(","),
      ...filteredResults.map((r) =>
        [r.bid, r.tid, r.currency, r.hoNet, r.spNet, r.difference, r.differenceUsd, r.reason, r.driTeam, r.bookingStatus].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dri-export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setLastExportTimestamp(new Date().toISOString());
  }, []);

  const handleExportZip = useCallback(async () => {
    const response = await fetch("/api/export/zip");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reconciliation-${Date.now()}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    setLastExportTimestamp(new Date().toISOString());
  }, []);

  const handleExportXlsx = useCallback(async () => {
    const response = await fetch("/api/export/xlsx");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reconciliation-${Date.now()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    setLastExportTimestamp(new Date().toISOString());
  }, []);

  // Run change handler
  const handleRunChange = useCallback((runId: string) => {
    setCurrentRunId(runId);
    // In a real app, we'd load the run data from the backend here
  }, []);

  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <TopBar
            runs={runs}
            currentRunId={currentRunId}
            onRunChange={handleRunChange}
            status={status}
            lastFxRefresh={lastFxRefresh}
            onFxRefresh={handleFxRefresh}
            isRefreshing={isRefreshing}
          />
          <main className="flex-1 overflow-auto bg-background">
            <Switch>
              <Route path="/">
                <LandingPage
                  runs={runs}
                  lastFxRefresh={lastFxRefresh}
                  onStartDemo={handleLoadDemo}
                />
              </Route>
              <Route path="/upload">
                <UploadPage
                  onFilesUploaded={handleFilesUploaded}
                  onLoadDemo={handleLoadDemo}
                  uploadedFiles={uploadedFiles}
                  currentRunId={currentRunId}
                />
              </Route>
              <Route path="/mapping">
                <MappingPage
                  mappings={mappings}
                  availableHeaders={availableHeaders}
                  onSaveMappings={handleSaveMappings}
                  hasFiles={hasFiles}
                />
              </Route>
              <Route path="/run">
                <RunPage
                  onRunReconciliation={handleRunReconciliation}
                  hasMapping={hasMapping}
                  isProcessing={status === "processing"}
                />
              </Route>
              <Route path="/results">
                <ResultsPage runId={currentRunId} />
              </Route>
              <Route path="/discrepancy-analysis">
                <DiscrepancyAnalysisPage runId={currentRunId} />
              </Route>
              <Route path="/drafts">
                <DraftsPage draftMessages={draftMessages} hasResults={hasResults} />
              </Route>
              <Route path="/dri">
                <DriPage
                  results={results}
                  hasResults={hasResults}
                  onExportFiltered={handleExportFiltered}
                />
              </Route>
              <Route path="/export">
                <ExportPage
                  hasResults={hasResults}
                  onExportZip={handleExportZip}
                  onExportXlsx={handleExportXlsx}
                  lastExportTimestamp={lastExportTimestamp}
                />
              </Route>
              <Route component={NotFound} />
            </Switch>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AppContent />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
