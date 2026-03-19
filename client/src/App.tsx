import { useState, useCallback, useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient, apiRequest, clearAuthToken } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { Loader2 } from "lucide-react";

import { LandingPage } from "@/pages/landing";
import { UploadPage } from "@/pages/upload";
import { MappingPage } from "@/pages/mapping";
import { RunPage } from "@/pages/run";
import { DiscrepancyAnalysisPage } from "@/pages/discrepancy-analysis";
import { DraftsPage } from "@/pages/drafts";
import { DriPage } from "@/pages/dri";
import { ExportPage } from "@/pages/export";
import { DisputeTrackerPage } from "@/pages/dispute-tracker";
import { ReconTrackerPage } from "@/pages/recon-tracker";
import { IssueTrackerPage } from "@/pages/issue-tracker";
import { LoginPage } from "@/pages/login";
import { RetoolPage } from "@/pages/retool";
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
  ReconciliationSession,
  RunResult,
} from "@shared/schema";
import { requiredFields, optionalFields, headerAliases } from "@shared/schema";

const CURRENT_RUN_ID_KEY = "headout-recon-current-run-id";

function AppContent({ onLogout }: { onLogout?: () => void }) {
  
  // Global state - initialize currentRunId from localStorage
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [currentRunId, setCurrentRunId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(CURRENT_RUN_ID_KEY);
    } catch {
      return null;
    }
  });
  const [status, setStatus] = useState<RunStatus>("idle");
  const [lastFxRefresh, setLastFxRefresh] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastExportTimestamp, setLastExportTimestamp] = useState<string | null>(null);
  const [isReconciliationFinalized, setIsReconciliationFinalized] = useState(false);
  const [analysisGSheetUrl, setAnalysisGSheetUrl] = useState<string | null>(null);
  const [financialGSheetUrl, setFinancialGSheetUrl] = useState<string | null>(null);
  const [exportHistory, setExportHistory] = useState<Array<{ reportType: string; format: string; timestamp: string }>>([]);
  
  // Store current run result to pass directly to upload page (avoids React Query issues)
  const [currentRunResult, setCurrentRunResult] = useState<{
    overallSummary: any[];
    secondaryVendorSummary: any[];
    primaryRows: any[];
    secondaryVendorRows: any[];
    unmappedRows: any[];
    fx?: { usdToCcy: Record<string, number>; refreshedAt: string };
  } | null>(null);

  // Persist currentRunId to localStorage whenever it changes
  useEffect(() => {
    try {
      if (currentRunId) {
        localStorage.setItem(CURRENT_RUN_ID_KEY, currentRunId);
      } else {
        localStorage.removeItem(CURRENT_RUN_ID_KEY);
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [currentRunId]);

  // Load saved sessions on mount to populate runs dropdown
  useEffect(() => {
    async function loadSavedSessions() {
      try {
        const response = await fetch("/api/sessions");
        const data = await response.json();
        if (data.sessions && Array.isArray(data.sessions)) {
          const sessionRuns: RunRecord[] = data.sessions.map((session: ReconciliationSession) => ({
            id: session.id,
            uploadId: session.id,
            status: session.status as RunStatus,
            progressStep: session.progressStep || null,
            createdAt: typeof session.createdAt === 'string' ? session.createdAt : session.createdAt.toISOString(),
            completedAt: session.completedAt 
              ? (typeof session.completedAt === 'string' ? session.completedAt : session.completedAt.toISOString()) 
              : null,
            error: session.error,
          }));
          setRuns(sessionRuns);
          
          // If we have a currentRunId from localStorage, set status based on the session
          if (currentRunId) {
            const currentSession = data.sessions.find((s: ReconciliationSession) => s.id === currentRunId);
            if (currentSession) {
              setStatus(currentSession.status as RunStatus);
              if (currentSession.runResult) {
                const result = currentSession.runResult as RunResult;
                setLastFxRefresh(result.fx?.refreshedAt || null);
              }
            }
          }
        }
      } catch (error) {
        console.error("Failed to load saved sessions:", error);
      }
    }
    loadSavedSessions();
  }, []);

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

  // File upload handler - uploads file and auto-runs reconciliation with progress tracking
  const handleFilesUploaded = useCallback(async (
    files: File[], 
    onProgress?: (progress: number, stage: string) => void
  ): Promise<UploadedFile[]> => {
    if (files.length === 0) {
      throw new Error("No files provided");
    }

    const formData = new FormData();
    formData.append("file", files[0]);

    try {
      setStatus("processing");
      
      // Step 1: Upload file with progress tracking using XMLHttpRequest
      onProgress?.(5, "Uploading file...");
      
      const uploadData = await new Promise<{ uploadId: string; file: UploadedFile }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        
        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            const uploadPercent = Math.round((event.loaded / event.total) * 40);
            onProgress?.(5 + uploadPercent, "Uploading file...");
          }
        });
        
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText);
              if (data.error) {
                reject(new Error(data.error));
              } else {
                resolve(data);
              }
            } catch {
              reject(new Error("Invalid server response"));
            }
          } else {
            try {
              const errorData = JSON.parse(xhr.responseText);
              reject(new Error(errorData.error || "Upload failed"));
            } catch {
              reject(new Error("Upload failed"));
            }
          }
        });
        
        xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
        xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));
        
        xhr.open("POST", "/api/upload");
        xhr.send(formData);
      });
      
      onProgress?.(50, "Processing file...");
      
      const uploadedFile: UploadedFile = uploadData.file;
      setUploadedFiles([uploadedFile]);
      
      // Step 2: Run reconciliation
      onProgress?.(55, "Running reconciliation...");
      
      const runResponse = await apiRequest("POST", "/api/runs/from-upload", {
        uploadId: uploadData.uploadId,
      });
      
      onProgress?.(85, "Analyzing results...");
      
      const runData = await runResponse.json();
      
      onProgress?.(95, "Finalizing...");
      
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
      
      // Store results directly in state - this avoids React Query issues
      setCurrentRunResult({
        overallSummary: runData.overallSummary || [],
        secondaryVendorSummary: runData.secondaryVendorSummary || [],
        primaryRows: runData.primaryRows || [],
        secondaryVendorRows: runData.secondaryVendorRows || [],
        unmappedRows: runData.unmappedRows || [],
        fx: runData.fx || undefined,
      });
      
      setStatus("done");
      
      onProgress?.(100, "Complete!");

      return [uploadedFile];
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      console.error("Upload error:", errorMessage);
      setStatus("error");
      throw new Error(errorMessage);
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

  // Load session handler - loads a saved session from the database
  const handleLoadSession = useCallback((session: ReconciliationSession) => {
    // Clear current results - will be fetched via React Query for loaded sessions
    setCurrentRunResult(null);
    
    // Invalidate cached queries for this session to ensure fresh data
    queryClient.invalidateQueries({ queryKey: ["/api/runs", session.id, "results"] });
    queryClient.invalidateQueries({ queryKey: ["/api/runs", session.id, "discrepancy-analysis"] });
    
    // Set the current run ID to the session ID
    setCurrentRunId(session.id);
    
    // Set status based on session status
    setStatus(session.status as RunStatus);
    
    // If session has run result, it means it was completed - we can load the results
    if (session.runResult) {
      const result = session.runResult as RunResult;
      setLastFxRefresh(result.fx?.refreshedAt || null);
    }
    
    // Update runs list with this session as a run
    const sessionRun: RunRecord = {
      id: session.id,
      uploadId: session.id,
      status: session.status as RunStatus,
      progressStep: session.progressStep || null,
      createdAt: typeof session.createdAt === 'string' ? session.createdAt : session.createdAt.toISOString(),
      completedAt: session.completedAt 
        ? (typeof session.completedAt === 'string' ? session.completedAt : session.completedAt.toISOString()) 
        : null,
      error: session.error,
    };
    setRuns((prev) => {
      // Replace if exists, otherwise add
      const exists = prev.find(r => r.id === session.id);
      if (exists) {
        return prev.map(r => r.id === session.id ? sessionRun : r);
      }
      return [sessionRun, ...prev];
    });
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

  const addExportHistoryEntry = useCallback((reportType: string, format: string) => {
    const entry = { reportType, format, timestamp: new Date().toISOString() };
    setExportHistory(prev => [entry, ...prev].slice(0, 10));
    setLastExportTimestamp(entry.timestamp);
  }, []);

  const handleExportAnalysisXlsx = useCallback(async () => {
    if (!currentRunId) return;
    const response = await fetch(`/api/runs/${currentRunId}/export/analysis`);
    if (!response.ok) throw new Error("Failed to export analysis");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `discrepancy_analysis_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    addExportHistoryEntry("Discrepancy Analysis", "Excel");
  }, [currentRunId, addExportHistoryEntry]);

  const handleExportFinancialXlsx = useCallback(async () => {
    if (!currentRunId) return;
    const response = await fetch(`/api/runs/${currentRunId}/export/financial`);
    if (!response.ok) throw new Error("Failed to export financial report");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reconciliation_report_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    addExportHistoryEntry("Reconciliation Report", "Excel");
  }, [currentRunId, addExportHistoryEntry]);

  const handleExportAnalysisGSheet = useCallback(async (): Promise<{ spreadsheetUrl?: string }> => {
    if (!currentRunId) return {};
    const response = await fetch(`/api/runs/${currentRunId}/export-gsheet/analysis`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to export to Google Sheets");
    }
    if (data.spreadsheetUrl) {
      setAnalysisGSheetUrl(data.spreadsheetUrl);
      addExportHistoryEntry("Discrepancy Analysis", "Google Sheets");
    }
    return data;
  }, [currentRunId, addExportHistoryEntry]);

  const handleExportFinancialGSheet = useCallback(async (): Promise<{ spreadsheetUrl?: string }> => {
    if (!currentRunId) return {};
    const response = await fetch(`/api/runs/${currentRunId}/export-gsheet/financial`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to export to Google Sheets");
    }
    if (data.spreadsheetUrl) {
      setFinancialGSheetUrl(data.spreadsheetUrl);
      addExportHistoryEntry("Reconciliation Report", "Google Sheets");
    }
    return data;
  }, [currentRunId, addExportHistoryEntry]);

  // Run change handler
  const handleRunChange = useCallback((runId: string) => {
    setCurrentRunId(runId);
    setIsReconciliationFinalized(false);
    setAnalysisGSheetUrl(null);
    setFinancialGSheetUrl(null);
    setExportHistory([]);
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
            onLogout={onLogout}
          />
          <main className="flex-1 overflow-auto bg-background">
            <Switch>
              <Route path="/">
                <LandingPage
                  lastFxRefresh={lastFxRefresh}
                  onStartDemo={handleLoadDemo}
                  onLoadSession={handleLoadSession}
                />
              </Route>
              <Route path="/upload">
                <UploadPage
                  onFilesUploaded={handleFilesUploaded}
                  onLoadDemo={handleLoadDemo}
                  uploadedFiles={uploadedFiles}
                  currentRunId={currentRunId}
                  onExportAnalysisGSheet={handleExportAnalysisGSheet}
                  onReconciliationFinalized={() => setIsReconciliationFinalized(true)}
                  analysisGSheetUrl={analysisGSheetUrl}
                  initialRunResult={currentRunResult}
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
                  onExportAnalysisXlsx={handleExportAnalysisXlsx}
                  onExportFinancialXlsx={handleExportFinancialXlsx}
                  onExportAnalysisGSheet={handleExportAnalysisGSheet}
                  onExportFinancialGSheet={handleExportFinancialGSheet}
                  isReconciliationFinalized={isReconciliationFinalized}
                  lastExportTimestamp={lastExportTimestamp}
                  analysisGSheetUrl={analysisGSheetUrl}
                  financialGSheetUrl={financialGSheetUrl}
                  exportHistory={exportHistory}
                  currentRunId={currentRunId}
                />
              </Route>
              <Route path="/dispute-tracker">
                <DisputeTrackerPage runId={currentRunId} />
              </Route>
              <Route path="/recon-tracker">
                <ReconTrackerPage runId={currentRunId} />
              </Route>
              <Route path="/issue-tracker">
                <IssueTrackerPage runId={currentRunId} />
              </Route>
              <Route path="/retool">
                <RetoolPage />
              </Route>
              <Route component={NotFound} />
            </Switch>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function AuthGate() {
  const [, setLocation] = useLocation();

  const { data, isLoading } = useQuery<{ authenticated: boolean }>({
    queryKey: ["/api/auth/status"],
    retry: false,
    staleTime: 0,
  });

  const handleLogout = useCallback(async () => {
    clearAuthToken();
    await apiRequest("POST", "/api/auth/logout", {});
    await queryClient.invalidateQueries({ queryKey: ["/api/auth/status"] });
    setLocation("/");
  }, [setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.authenticated) {
    return <LoginPage />;
  }

  return <AppContent onLogout={handleLogout} />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AuthGate />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
