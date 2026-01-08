import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { Upload, FileSpreadsheet, X, AlertCircle, Play, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import type { UploadedFile } from "@shared/schema";

interface UploadPageProps {
  onFilesUploaded: (files: File[]) => Promise<UploadedFile[]>;
  onLoadDemo: () => void;
  uploadedFiles: UploadedFile[];
}

export function UploadPage({ onFilesUploaded, onLoadDemo, uploadedFiles }: UploadPageProps) {
  const [, setLocation] = useLocation();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>(uploadedFiles);
  const { toast } = useToast();

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      (f) => f.name.endsWith(".xlsx") || f.name.endsWith(".csv")
    );
    
    if (droppedFiles.length === 0) {
      toast({
        title: "Invalid file type",
        description: "Please upload .xlsx or .csv files only",
        variant: "destructive",
      });
      return;
    }
    
    await uploadFiles(droppedFiles);
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      await uploadFiles(selectedFiles);
    }
  };

  const uploadFiles = async (newFiles: File[]) => {
    setIsUploading(true);
    try {
      const uploaded = await onFilesUploaded(newFiles);
      setFiles((prev) => [...prev, ...uploaded]);
      toast({
        title: "Files uploaded",
        description: `Successfully uploaded ${uploaded.length} file(s)`,
      });
    } catch (error) {
      toast({
        title: "Upload failed",
        description: "There was an error uploading your files",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const removeFile = (fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  const handleContinue = () => {
    if (files.length === 0) {
      toast({
        title: "No files uploaded",
        description: "Please upload at least one file to continue",
        variant: "destructive",
      });
      return;
    }
    setLocation("/mapping");
  };

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Upload & Import</h1>
        <p className="text-muted-foreground">
          Upload your reconciliation reports and supplier invoices to get started
        </p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardContent className="pt-6">
            <div
              className={`border-2 border-dashed rounded-lg h-48 flex flex-col items-center justify-center cursor-pointer transition-colors ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50"
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => document.getElementById("file-input")?.click()}
              data-testid="dropzone"
            >
              <input
                id="file-input"
                type="file"
                accept=".xlsx,.csv"
                multiple
                className="hidden"
                onChange={handleFileSelect}
                data-testid="input-file"
              />
              <Upload className={`h-12 w-12 mb-4 ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
              <p className="text-lg font-medium mb-1">
                {isUploading ? "Uploading..." : "Drop files here or click to upload"}
              </p>
              <p className="text-sm text-muted-foreground">
                Supports .xlsx and .csv files
              </p>
            </div>
            <div className="mt-4 flex items-center justify-center gap-2">
              <span className="text-sm text-muted-foreground">Need a template?</span>
              <a
                href="/sample-reconciliation-template.csv"
                download="sample-reconciliation-template.csv"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                data-testid="link-download-template"
              >
                <Download className="h-4 w-4" />
                Download sample CSV
              </a>
            </div>
          </CardContent>
        </Card>

        {files.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Uploaded Files</CardTitle>
              <CardDescription>{files.length} file(s) ready for processing</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                    data-testid={`file-item-${file.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <FileSpreadsheet className="h-5 w-5 text-chart-2" />
                      <div>
                        <p className="font-medium">{file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(file.size / 1024).toFixed(1)} KB
                          {file.rowCount && ` · ${file.rowCount} rows`}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeFile(file.id)}
                      data-testid={`button-remove-${file.id}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Play className="h-5 w-5" />
              Demo Mode
            </CardTitle>
            <CardDescription>
              Try the tool with sample data to see how it works
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={onLoadDemo}
              className="w-full"
              data-testid="button-load-demo"
            >
              Load Demo Dataset
            </Button>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button
            onClick={handleContinue}
            disabled={files.length === 0}
            data-testid="button-continue-to-mapping"
          >
            Continue to Column Mapping
          </Button>
        </div>
      </div>
    </div>
  );
}
