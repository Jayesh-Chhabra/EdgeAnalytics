"use client";

import { useState, useEffect, useCallback } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  updateBlock,
  getBlock,
  addEquityCurveEntries,
  deleteEquityCurvesByBlockAndStrategy,
} from "@/lib/db";
import { toast } from "sonner";
import type { EquityCurveBlock } from "@/lib/stores/block-store";
import type { GenericBlock } from "@/lib/models/block";
import {
  EquityCurveProcessingResult,
  EquityCurveUploadConfig,
} from "@/lib/models/equity-curve";
import { EquityCurveProcessor } from "@/lib/processing/equity-curve-processor";
import { EquityCurveColumnMapper } from "./equity-curve-column-mapper";
import {
  AlertCircle,
  FileSpreadsheet,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";

interface EquityCurveEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  block: EquityCurveBlock | null;
  onSuccess?: () => void;
}

type EditMode = "view" | "add-strategy" | "map-columns" | "processing";

interface NewStrategy {
  file: File;
  config?: EquityCurveUploadConfig;
  result?: EquityCurveProcessingResult;
}

export function EquityCurveEditDialog({
  open,
  onOpenChange,
  block,
  onSuccess,
}: EquityCurveEditDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<EditMode>("view");
  const [newStrategy, setNewStrategy] = useState<NewStrategy | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  // Initialize form when block changes
  useEffect(() => {
    if (block) {
      setName(block.name);
      setDescription(block.description || "");
      setMode("view");
      setNewStrategy(null);
      setErrors([]);
    }
  }, [block]);

  const handleSaveBasicInfo = async () => {
    if (!block) return;

    if (!name.trim()) {
      toast.error("Block name is required");
      return;
    }

    setProcessing(true);
    try {
      await updateBlock(block.id, {
        name: name.trim(),
        description: description.trim() || undefined,
      });

      toast.success("Block updated successfully");

      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error("Error updating block:", error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to update block: ${errorMsg}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Please upload a CSV file");
      return;
    }

    setNewStrategy({ file });
    setMode("map-columns");
    toast.success("CSV file loaded. Map columns to continue.");
  }, []);

  const handleMappingComplete = useCallback(
    async (config: EquityCurveUploadConfig) => {
      if (!newStrategy || !block) return;

      // Check for duplicate strategy name
      if (block.equityCurves.some(s => s.strategyName === config.strategyName)) {
        toast.error(`Strategy "${config.strategyName}" already exists. Please use a different name.`);
        return;
      }

      setMode("processing");
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

        const result = await processor.processFile(newStrategy.file, config);

        if (result.errors.length > 0) {
          const errorMessages = result.errors.map((e) => `Row ${e.row}: ${e.message}`);
          setErrors(errorMessages);
          toast.warning(`Processed with ${result.errors.length} errors`);
        }

        // Get the current block from DB to update it
        const dbBlock = await getBlock(block.id) as GenericBlock;
        if (!dbBlock) throw new Error("Block not found");

        // Add new strategy to block
        const updatedEquityCurves = [
          ...(dbBlock.equityCurves || []),
          {
            strategyName: config.strategyName,
            fileName: newStrategy.file.name,
            fileSize: newStrategy.file.size,
            originalRowCount: result.totalRows,
            processedRowCount: result.validEntries,
            uploadedAt: new Date(),
            startingCapital: config.startingCapital,
          },
        ];

        const timestamp = Date.now();
        const updatedDataReferences = {
          ...dbBlock.dataReferences,
          equityCurveStorageKeys: {
            ...dbBlock.dataReferences.equityCurveStorageKeys,
            [config.strategyName]: `block_${timestamp}_equity_${config.strategyName}`,
          },
        };

        // Update block in DB
        await updateBlock(block.id, {
          equityCurves: updatedEquityCurves,
          dataReferences: updatedDataReferences,
        });

        // Add equity curve entries to IndexedDB
        await addEquityCurveEntries(block.id, result.curve.entries);

        toast.success(
          `Added strategy "${config.strategyName}" with ${result.validEntries} entries`
        );

        // Reset and return to view mode
        setNewStrategy(null);
        setMode("view");

        if (onSuccess) {
          onSuccess();
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        setErrors([errorMsg]);
        toast.error(`Processing failed: ${errorMsg}`);
        setMode("view");
      } finally {
        setProcessing(false);
      }
    },
    [newStrategy, block, onSuccess]
  );

  const handleRemoveStrategy = async (strategyName: string) => {
    if (!block) return;

    // Don't allow removing the last strategy
    if (block.equityCurves.length === 1) {
      toast.error("Cannot remove the last strategy from a block");
      return;
    }

    const confirmDelete = confirm(
      `Are you sure you want to remove strategy "${strategyName}"? This will delete all associated data.`
    );

    if (!confirmDelete) return;

    setProcessing(true);
    try {
      // Get the current block from DB
      const dbBlock = await getBlock(block.id) as GenericBlock;
      if (!dbBlock) throw new Error("Block not found");

      // Remove strategy from block
      const updatedEquityCurves = (dbBlock.equityCurves || []).filter(
        s => s.strategyName !== strategyName
      );

      const updatedDataReferences = { ...dbBlock.dataReferences };
      const { [strategyName]: _, ...remainingKeys } = updatedDataReferences.equityCurveStorageKeys;
      updatedDataReferences.equityCurveStorageKeys = remainingKeys;

      // Update block in DB
      await updateBlock(block.id, {
        equityCurves: updatedEquityCurves,
        dataReferences: updatedDataReferences,
      });

      // Delete equity curve entries from IndexedDB
      await deleteEquityCurvesByBlockAndStrategy(block.id, strategyName);

      toast.success(`Removed strategy "${strategyName}"`);

      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error("Error removing strategy:", error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to remove strategy: ${errorMsg}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleStartAddStrategy = () => {
    setMode("add-strategy");
    setNewStrategy(null);
    setErrors([]);
  };

  const handleCancelAddStrategy = () => {
    setMode("view");
    setNewStrategy(null);
    setErrors([]);
  };

  const handleCancel = () => {
    // Reset form to original values
    if (block) {
      setName(block.name);
      setDescription(block.description || "");
    }
    setMode("view");
    setNewStrategy(null);
    setErrors([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${mode === 'map-columns' ? 'sm:max-w-[90vw] lg:max-w-[1700px]' : 'sm:max-w-[600px]'} max-h-[95vh] overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle>Edit Equity Curve Block</DialogTitle>
          <DialogDescription>
            Update block details and manage equity curve strategies
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* View/Edit Mode */}
          {mode === "view" && (
            <>
              {/* Basic Info */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Block Name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter block name"
                    disabled={processing}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description (Optional)</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Enter block description"
                    rows={3}
                    disabled={processing}
                  />
                </div>

                <Button
                  onClick={handleSaveBasicInfo}
                  disabled={processing || !name.trim()}
                  className="w-full"
                >
                  {processing ? "Saving..." : "Save Block Info"}
                </Button>
              </div>

              <Separator />

              {/* Strategies */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium">
                      Strategies ({block?.equityCurves.length || 0})
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Manage equity curve strategies in this block
                    </p>
                  </div>
                </div>

                {block && block.equityCurves.length > 0 ? (
                  <div className="space-y-2">
                    {block.equityCurves.map((strategy) => (
                      <div
                        key={strategy.strategyName}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <FileSpreadsheet className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span className="font-medium truncate">
                              {strategy.strategyName}
                            </span>
                            <Badge variant="secondary" className="text-xs">
                              {strategy.processedRowCount} entries
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {strategy.fileName} •{" "}
                            {new Date(strategy.uploadedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveStrategy(strategy.strategyName)}
                          disabled={processing || block.equityCurves.length === 1}
                          title={
                            block.equityCurves.length === 1
                              ? "Cannot remove the last strategy"
                              : "Remove strategy"
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>No strategies found in this block.</AlertDescription>
                  </Alert>
                )}

                <Button
                  onClick={handleStartAddStrategy}
                  variant="outline"
                  className="w-full"
                  disabled={processing}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Strategy
                </Button>
              </div>

              {/* Block Stats */}
              {block && (
                <div className="rounded-lg bg-muted p-3 text-sm">
                  <div className="font-medium mb-2">Block Summary:</div>
                  <div className="space-y-1 text-muted-foreground">
                    <div>• {block.stats.totalEntries} total entries</div>
                    {block.stats.dateRange && (
                      <div>
                        • Date range:{" "}
                        {new Date(block.stats.dateRange.start).toLocaleDateString()}{" "}
                        to {new Date(block.stats.dateRange.end).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Add Strategy Mode - File Selection */}
          {mode === "add-strategy" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium mb-2">Upload Strategy CSV</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Select a CSV file containing equity curve data
                </p>
              </div>

              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
                onClick={() => document.getElementById("edit-file-input")?.click()}
              >
                <input
                  id="edit-file-input"
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

              <Button
                onClick={handleCancelAddStrategy}
                variant="outline"
                className="w-full"
              >
                Cancel
              </Button>
            </div>
          )}

          {/* Column Mapping Mode */}
          {mode === "map-columns" && newStrategy && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium">Map CSV Columns</h3>
                  <p className="text-sm text-muted-foreground">
                    Selected file: {newStrategy.file.name}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={handleCancelAddStrategy}>
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
              </div>

              <EquityCurveColumnMapper
                file={newStrategy.file}
                onMappingComplete={(config) =>
                  handleMappingComplete(config as EquityCurveUploadConfig)
                }
                onCancel={handleCancelAddStrategy}
              />
            </div>
          )}

          {/* Processing Mode */}
          {mode === "processing" && (
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
          {mode === "view" && (
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={processing}
            >
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
