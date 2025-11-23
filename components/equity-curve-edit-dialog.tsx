"use client";

import { useState, useEffect } from "react";
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
import { updateBlock } from "@/lib/db";
import { toast } from "sonner";
import type { EquityCurveBlock } from "@/lib/stores/block-store";

interface EquityCurveEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  block: EquityCurveBlock | null;
  onSuccess?: () => void;
}

export function EquityCurveEditDialog({
  open,
  onOpenChange,
  block,
  onSuccess,
}: EquityCurveEditDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Initialize form when block changes
  useEffect(() => {
    if (block) {
      setName(block.name);
      setDescription(block.description || "");
    }
  }, [block]);

  const handleSave = async () => {
    if (!block) return;

    if (!name.trim()) {
      toast.error("Block name is required");
      return;
    }

    setIsSaving(true);
    try {
      await updateBlock(block.id, {
        name: name.trim(),
        description: description.trim() || undefined,
      });

      toast.success("Block updated successfully");
      onOpenChange(false);

      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error("Error updating block:", error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to update block: ${errorMsg}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    // Reset form to original values
    if (block) {
      setName(block.name);
      setDescription(block.description || "");
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Equity Curve Block</DialogTitle>
          <DialogDescription>
            Update the name and description for this equity curve block.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Block Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter block name"
              disabled={isSaving}
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
              disabled={isSaving}
            />
          </div>

          {block && (
            <div className="rounded-lg bg-muted p-3 text-sm">
              <div className="font-medium mb-2">Block Info:</div>
              <div className="space-y-1 text-muted-foreground">
                <div>
                  • {block.equityCurves.length}{" "}
                  {block.equityCurves.length === 1 ? "strategy" : "strategies"}
                </div>
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
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
