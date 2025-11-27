"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { addEquityCurveEntries, createBlock } from "@/lib/db";
import { GenericBlock } from "@/lib/models/block";
import {
    EquityCurveProcessingResult,
    EquityCurveUploadConfig,
} from "@/lib/models/equity-curve";
import { EquityCurveProcessor } from "@/lib/processing/equity-curve-processor";
import {
    AlertCircle,
    CheckCircle2,
    FileSpreadsheet,
    Loader2,
    Plus,
    Trash2,
    Upload,
    X,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { EquityCurveColumnMapper } from "./equity-curve-column-mapper";

interface EquityCurveUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (blockId: string) => void;
}

type UploadStage = "details" | "select-file" | "map-columns" | "processing" | "review";

interface ProcessedStrategy {
  strategyName: string;
  fileName: string;
  fileSize: number;
  config: EquityCurveUploadConfig;
  result: EquityCurveProcessingResult;
}

interface CurrentFileState {
  file: File;
  config?: EquityCurveUploadConfig;
}

export function EquityCurveUploadDialog({
  open,
  onOpenChange,
  onSuccess,
}: EquityCurveUploadDialogProps) {
  const [blockName, setBlockName] = useState("");
  const [description, setDescription] = useState("");
  const [stage, setStage] = useState<UploadStage>("details");
  const [currentFile, setCurrentFile] = useState<CurrentFileState | null>(null);
  const [processedStrategies, setProcessedStrategies] = useState<ProcessedStrategy[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  // Reset state when dialog closes
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen && !processing) {
        setBlockName("");
        setDescription("");
        setStage("details");
        setCurrentFile(null);
        setProcessedStrategies([]);
        setProgress(0);
        setErrors([]);
      }
      onOpenChange(newOpen);
    },
    [processing, onOpenChange]
  );

  // Handle file selection
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Please upload a CSV file");
      return;
    }

    setCurrentFile({ file });
    setStage("map-columns");
    toast.success("CSV file loaded. Map columns to continue.");
  }, []);

  // Handle column mapping completion
  const handleMappingComplete = useCallback(
    async (config: EquityCurveUploadConfig) => {
      if (!currentFile) return;

      // Check for duplicate strategy name
      if (processedStrategies.some(s => s.strategyName === config.strategyName)) {
        toast.error(`Strategy "${config.strategyName}" already exists. Please use a different name.`);
        return;
      }

      setStage("processing");
      setProcessing(true);
      setProgress(0);
      setErrors([]);

      try {
        // Process the equity curve
        const processor = new EquityCurveProcessor({
          progressCallback: (progressData) => {
            setProgress(progressData.progress);
          },
        });

        const result = await processor.processFile(currentFile.file, config);

        if (result.errors.length > 0) {
          const errorMessages = result.errors.map((e) => `Row ${e.row}: ${e.message}`);
          setErrors(errorMessages);
          toast.warning(`Processed with ${result.errors.length} errors`);
        }

        // Add to processed strategies
        setProcessedStrategies(prev => [...prev, {
          strategyName: config.strategyName,
          fileName: currentFile.file.name,
          fileSize: currentFile.file.size,
          config,
          result,
        }]);

        setCurrentFile(null);
        setStage("review");
        toast.success(
          `Processed ${result.validEntries} entries for strategy "${config.strategyName}"`
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        setErrors([errorMsg]);
        toast.error(`Processing failed: ${errorMsg}`);
        setStage("select-file");
      } finally {
        setProcessing(false);
      }
    },
    [currentFile, processedStrategies]
  );

  // Remove a processed strategy
  const handleRemoveStrategy = useCallback((strategyName: string) => {
    setProcessedStrategies(prev => prev.filter(s => s.strategyName !== strategyName));
    toast.success(`Removed strategy "${strategyName}"`);
  }, []);

  // Start adding another strategy
  const handleAddAnother = useCallback(() => {
    setCurrentFile(null);
    setStage("select-file");
    setErrors([]);
  }, []);

  // Cancel current file upload
  const handleCancelCurrentFile = useCallback(() => {
    setCurrentFile(null);
    setStage(processedStrategies.length > 0 ? "review" : "select-file");
    setErrors([]);
  }, [processedStrategies.length]);

  // Handle saving the generic block
  const handleSave = useCallback(async () => {
    if (processedStrategies.length === 0) return;

    setProcessing(true);
    setProgress(0);

    try {
      console.log('Starting block save...');
      const now = new Date();
      const timestamp = Date.now();

      // Create Generic Block
      const genericBlock: Omit<GenericBlock, "id" | "created" | "lastModified"> = {
        type: "equity-curve",
        name: blockName.trim(),
        description: description.trim() || undefined,
        isActive: false,
        equityCurves: processedStrategies.map(strategy => ({
          strategyName: strategy.strategyName,
          fileName: strategy.fileName,
          fileSize: strategy.fileSize,
          originalRowCount: strategy.result.totalRows,
          processedRowCount: strategy.result.validEntries,
          uploadedAt: now,
          startingCapital: strategy.config.startingCapital,
        })),
        processingStatus: "completed",
        dataReferences: {
          equityCurveStorageKeys: Object.fromEntries(
            processedStrategies.map(strategy => [
              strategy.strategyName,
              `block_${timestamp}_equity_${strategy.strategyName}`,
            ])
          ),
        },
        analysisConfig: {
          riskFreeRate: 0.05,
          useBusinessDaysOnly: false,
          annualizationFactor: 252,
          confidenceLevel: 0.95,
        },
      };

      console.log('Saving block to IndexedDB...', genericBlock);

      // Save to IndexedDB
      const savedBlock = await createBlock(genericBlock);

      console.log('Block saved, ID:', savedBlock.id);

      // Add all equity curve entries
      for (const strategy of processedStrategies) {
        console.log(`Adding equity curve entries for ${strategy.strategyName}:`, strategy.result.curve.entries.length, 'entries');
        await addEquityCurveEntries(savedBlock.id, strategy.result.curve.entries);
      }

      console.log('All equity curve entries saved successfully');

      toast.success(`Block "${blockName}" created with ${processedStrategies.length} ${processedStrategies.length === 1 ? 'strategy' : 'strategies'}!`);

      if (onSuccess) {
        console.log('Calling onSuccess callback');
        onSuccess(savedBlock.id);
      }

      handleOpenChange(false);
    } catch (error) {
      console.error('Error saving block:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to save block: ${errorMsg}`);
      setErrors([errorMsg]);
    } finally {
      setProcessing(false);
    }
  }, [processedStrategies, blockName, description, handleOpenChange, onSuccess]);

  const canProceedToUpload = blockName.trim();
  const canSave = blockName.trim() && processedStrategies.length > 0 && !processing;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={`${stage === 'map-columns' ? 'sm:max-w-[90vw] lg:max-w-[1700px]' : 'sm:max-w-2xl'} max-h-[95vh] overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Create Equity Curve Block
          </DialogTitle>
          <DialogDescription>
            Upload equity curve CSVs to create a block for portfolio analysis
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Block Details */}
          {stage === "details" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="block-name">
                  Block Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="block-name"
                  placeholder="e.g., Combined Strategies 2025"
                  value={blockName}
                  onChange={(e) => setBlockName(e.target.value)}
                  disabled={processing}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="block-description">Description (Optional)</Label>
                <Textarea
                  id="block-description"
                  placeholder="Brief description of this block..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  disabled={processing}
                />
              </div>

              <Button
                onClick={() => setStage("select-file")}
                disabled={!canProceedToUpload}
                className="w-full"
              >
                Continue to Upload Strategies
              </Button>
            </div>
          )}

          {/* Stage: File Selection */}
          {stage === "select-file" && (
            <div className="space-y-4">
              {/* Block name display */}
              <div className="rounded-lg bg-muted p-3">
                <div className="text-sm">
                  <span className="font-medium">Block:</span> {blockName}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-2">Upload Equity Curve CSV</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Select a CSV file containing equity curve data (Date, Daily Return %, Margin Req %)
                </p>
              </div>

              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
                onClick={() => document.getElementById("file-input")?.click()}
              >
                <input
                  id="file-input"
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <div className="flex flex-col items-center gap-3">
                  <div className="p-3 bg-muted rounded-full">
                    <Upload className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium">Upload CSV File</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Click to browse or drag and drop
                    </p>
                  </div>
                </div>
              </div>

              {processedStrategies.length > 0 && (
                <Button
                  onClick={() => setStage("review")}
                  variant="outline"
                  className="w-full"
                >
                  Back to Review ({processedStrategies.length} {processedStrategies.length === 1 ? 'strategy' : 'strategies'})
                </Button>
              )}
            </div>
          )}

          {/* Stage: Column Mapping */}
          {stage === "map-columns" && currentFile && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium">Map CSV Columns</h3>
                  <p className="text-sm text-muted-foreground">
                    Selected file: {currentFile.file.name}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={handleCancelCurrentFile}>
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
              </div>

              <EquityCurveColumnMapper
                file={currentFile.file}
                onMappingComplete={(config) => handleMappingComplete(config as EquityCurveUploadConfig)}
                onCancel={handleCancelCurrentFile}
              />
            </div>
          )}

          {/* Stage: Processing */}
          {stage === "processing" && (
            <div className="space-y-4">
              <Alert>
                <Loader2 className="h-4 w-4 animate-spin" />
                <div className="text-sm text-muted-foreground">
                  <div className="space-y-2">
                    <p className="font-medium">Processing equity curve...</p>
                    <Progress value={progress} className="h-2" />
                    <p className="text-xs text-muted-foreground">{progress}% complete</p>
                  </div>
                </div>
              </Alert>
            </div>
          )}

          {/* Stage: Review Strategies */}
          {stage === "review" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium mb-2">Strategies ({processedStrategies.length})</h3>
                <p className="text-sm text-muted-foreground">
                  Review and manage your equity curve strategies
                </p>
              </div>

              {processedStrategies.length === 0 ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    No strategies added yet. Click "Add Strategy" to begin.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-2">
                  {processedStrategies.map((strategy) => (
                    <div
                      key={strategy.strategyName}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <FileSpreadsheet className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <span className="font-medium truncate">{strategy.strategyName}</span>
                          <Badge variant="secondary" className="text-xs">
                            {strategy.result.validEntries} entries
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {strategy.fileName}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveStrategy(strategy.strategyName)}
                        disabled={processing}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <Button
                onClick={handleAddAnother}
                variant="outline"
                className="w-full"
                disabled={processing}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Another Strategy
              </Button>

              {/* Error Display */}
              {errors.length > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <p className="font-medium mb-1">Processing Errors:</p>
                    <ul className="list-disc list-inside text-xs space-y-1">
                      {errors.slice(0, 5).map((error, i) => (
                        <li key={i}>{error}</li>
                      ))}
                      {errors.length > 5 && (
                        <li>... and {errors.length - 5} more errors</li>
                      )}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {stage === "details" && (
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
          )}

          {(stage === "select-file" || stage === "review") && (
            <>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={processing}
              >
                Cancel
              </Button>
              {processedStrategies.length > 0 && (
                <Button onClick={handleSave} disabled={!canSave}>
                  {processing ? "Creating..." : `Create Block (${processedStrategies.length} ${processedStrategies.length === 1 ? 'strategy' : 'strategies'})`}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
