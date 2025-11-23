"use client";

import { MetricCard } from "@/components/metric-card";
import { MetricSection } from "@/components/metric-section";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PortfolioStatsCalculator } from "@/lib/calculations/portfolio-stats";
import { getEquityCurvesByBlock } from "@/lib/db";
import { EquityCurveEntry } from "@/lib/models/equity-curve";
import { PortfolioStats } from "@/lib/models/portfolio-stats";
import { useBlockStore, isEquityCurveBlock } from "@/lib/stores/block-store";
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  Gauge,
  TrendingUp,
} from "lucide-react";
import { useEffect, useState } from "react";

export default function EquityCurveStatsPage() {
  const [riskFreeRate, setRiskFreeRate] = useState("5");

  // Data fetching state
  const [equityCurveEntries, setEquityCurveEntries] = useState<EquityCurveEntry[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  // Calculated metrics state
  const [portfolioStats, setPortfolioStats] = useState<PortfolioStats | null>(null);
  const [, setIsCalculating] = useState(false);

  // Get active block from store
  const activeBlock = useBlockStore((state) => {
    const activeBlockId = state.activeBlockId;
    return activeBlockId
      ? state.blocks.find((block) => block.id === activeBlockId)
      : null;
  });
  const isLoading = useBlockStore((state) => state.isLoading);
  const isInitialized = useBlockStore((state) => state.isInitialized);
  const loadBlocks = useBlockStore((state) => state.loadBlocks);

  // Load blocks if not initialized
  useEffect(() => {
    if (!isInitialized) {
      loadBlocks().catch(console.error);
    }
  }, [isInitialized, loadBlocks]);

  // Fetch equity curve entries when active block changes
  useEffect(() => {
    if (!activeBlock || !isEquityCurveBlock(activeBlock)) {
      setEquityCurveEntries([]);
      setDataError(null);
      return;
    }

    setIsLoadingData(true);
    setDataError(null);

    getEquityCurvesByBlock(activeBlock.id)
      .then((entries) => {
        setEquityCurveEntries(entries);
        setIsLoadingData(false);
      })
      .catch((error) => {
        console.error("Error loading equity curve entries:", error);
        setDataError(error instanceof Error ? error.message : "Failed to load equity curve data");
        setIsLoadingData(false);
      });
  }, [activeBlock]);

  // Calculate portfolio stats when equity curve entries or risk-free rate changes
  useEffect(() => {
    if (equityCurveEntries.length === 0) {
      setPortfolioStats(null);
      return;
    }

    setIsCalculating(true);

    try {
      const calculator = new PortfolioStatsCalculator({
        riskFreeRate: parseFloat(riskFreeRate) / 100,
      });

      const stats = calculator.calculateFromEquityCurve(equityCurveEntries);
      setPortfolioStats(stats);
    } catch (error) {
      console.error("Error calculating portfolio stats:", error);
      setDataError(error instanceof Error ? error.message : "Failed to calculate statistics");
    } finally {
      setIsCalculating(false);
    }
  }, [equityCurveEntries, riskFreeRate]);

  // Helper functions
  const getDateRange = () => {
    if (equityCurveEntries.length === 0) return "No data";

    const sortedEntries = [...equityCurveEntries].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const start = new Date(sortedEntries[0].date);
    const end = new Date(sortedEntries[sortedEntries.length - 1].date);

    const formatDate = (date: Date) =>
      date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

    return `${formatDate(start)} - ${formatDate(end)}`;
  };

  const getStartingCapital = () => {
    if (!isEquityCurveBlock(activeBlock)) return 0;

    // Get starting capital from the first equity curve
    const firstCurve = activeBlock.equityCurves[0];
    return firstCurve?.startingCapital || 0;
  };

  const getTotalDays = () => {
    return equityCurveEntries.length;
  };

  const getProfitableDays = () => {
    if (!portfolioStats) return 0;
    return Math.round((portfolioStats.winRate / 100) * equityCurveEntries.length);
  };

  const getLosingDays = () => {
    return getTotalDays() - getProfitableDays();
  };

  // Show loading state
  if (!isInitialized || isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading blocks...</p>
        </div>
      </div>
    );
  }

  // Show message if no active block
  if (!activeBlock) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center max-w-md">
          <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">
            No Active Block Selected
          </h3>
          <p className="text-muted-foreground mb-4">
            Please select an equity curve block from the sidebar to view its statistics.
          </p>
        </div>
      </div>
    );
  }

  // Show error if not an equity curve block
  if (!isEquityCurveBlock(activeBlock)) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center max-w-md">
          <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">
            Wrong Block Type
          </h3>
          <p className="text-muted-foreground mb-4">
            This page is for equity curve blocks. The active block is a trade-based block.
            Please use the Block Stats page instead.
          </p>
        </div>
      </div>
    );
  }

  // Show loading state for data
  if (isLoadingData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">
            Loading {activeBlock.name} data...
          </p>
        </div>
      </div>
    );
  }

  // Show error state
  if (dataError) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center max-w-md">
          <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Error Loading Data</h3>
          <p className="text-muted-foreground mb-4">{dataError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <Label htmlFor="risk-free-rate">Risk-free Rate (%)</Label>
          <Input
            id="risk-free-rate"
            type="number"
            value={riskFreeRate}
            onChange={(e) => setRiskFreeRate(e.target.value)}
            className="w-32"
            placeholder="5"
            min="0"
            max="10"
            step="0.1"
          />
        </div>
      </div>

      {/* Basic Overview */}
      <MetricSection
        title="Basic Overview"
        icon={<BarChart3 className="w-4 h-4" />}
        badge={
          <Badge variant="outline" className="text-xs">
            <Calendar className="w-3 h-3 mr-1" />
            {getDateRange()}
          </Badge>
        }
        gridCols={3}
      >
        <MetricCard
          title="Total Days"
          value={getTotalDays()}
          format="number"
          tooltip={{
            flavor: "Total number of days in your equity curve",
            detailed:
              "The total number of data points in your equity curve. More days provide more reliable statistics and better insight into your strategy's performance over time.",
          }}
        />
        <MetricCard
          title="Starting Capital"
          value={getStartingCapital()}
          format="currency"
          tooltip={{
            flavor: "The initial capital you started with",
            detailed:
              "The initial account value when tracking began. This serves as the baseline for calculating percentage returns and total growth.",
          }}
        />
        <MetricCard
          title="Profitable Days"
          value={getProfitableDays()}
          format="number"
          tooltip={{
            flavor: "Number of days with positive returns",
            detailed:
              "Total count of days where your equity increased. A higher number suggests more consistent daily performance.",
          }}
        />
      </MetricSection>

      {/* Return Metrics */}
      <MetricSection
        title="Return Metrics"
        icon={<TrendingUp className="w-4 h-4" />}
        gridCols={5}
      >
        <MetricCard
          title="Total P/L"
          value={portfolioStats?.totalPl || 0}
          format="currency"
          isPositive={(portfolioStats?.totalPl || 0) > 0}
          size="lg"
          tooltip={{
            flavor: "Net profit or loss across all days",
            detailed:
              "Sum of all daily profits and losses. This is the absolute dollar amount gained or lost from your strategy.",
          }}
        />
        <MetricCard
          title="CAGR"
          value={portfolioStats?.cagr || 0}
          format="percentage"
          isPositive={(portfolioStats?.cagr || 0) > 0}
          tooltip={{
            flavor: "Annual growth rate",
            detailed:
              "Compound Annual Growth Rate normalizes returns over time, showing the equivalent annual growth rate. Higher CAGR indicates faster wealth building.",
          }}
        />
        <MetricCard
          title="Win Rate"
          value={portfolioStats?.winRate || 0}
          format="percentage"
          isPositive={(portfolioStats?.winRate || 0) > 50}
          tooltip={{
            flavor: "Percentage of profitable days",
            detailed:
              "The percentage of days with positive returns. A higher win rate means more consistent daily profitability.",
          }}
        />
        <MetricCard
          title="Avg Win"
          value={portfolioStats?.avgWin || 0}
          format="currency"
          isPositive={true}
          tooltip={{
            flavor: "Average gain on profitable days",
            detailed:
              "The average dollar amount gained on days when your equity increased. Compare this to average loss to assess risk/reward balance.",
          }}
        />
        <MetricCard
          title="Avg Loss"
          value={portfolioStats?.avgLoss || 0}
          format="currency"
          isPositive={false}
          tooltip={{
            flavor: "Average loss on losing days",
            detailed:
              "The average dollar amount lost on days when your equity decreased. Smaller losses relative to wins indicate better risk management.",
          }}
        />
        <MetricCard
          title="Profit Factor"
          value={portfolioStats?.profitFactor || 0}
          format="decimal"
          isPositive={(portfolioStats?.profitFactor || 0) > 1}
          tooltip={{
            flavor: "Ratio of total gains to total losses",
            detailed:
              "Total profits divided by total losses. Values above 1.0 indicate profitable performance. Higher is better.",
          }}
        />
        <MetricCard
          title="Win/Loss Ratio"
          value={portfolioStats?.avgWin && portfolioStats?.avgLoss
            ? Math.abs(portfolioStats.avgWin / portfolioStats.avgLoss)
            : 0}
          format="decimal"
          isPositive={true}
          tooltip={{
            flavor: "Average win compared to average loss",
            detailed:
              "The ratio of average winning day to average losing day. Values above 1.0 mean wins are larger than losses on average.",
          }}
        />
        <MetricCard
          title="Total Return"
          value={portfolioStats?.totalReturn || 0}
          format="percentage"
          isPositive={(portfolioStats?.totalReturn || 0) > 0}
          tooltip={{
            flavor: "Total percentage gain or loss",
            detailed:
              "The overall percentage return from start to finish. This normalizes performance relative to starting capital.",
          }}
        />
      </MetricSection>

      {/* Risk Metrics */}
      <MetricSection
        title="Risk Metrics"
        icon={<Gauge className="w-4 h-4" />}
        gridCols={4}
      >
        <MetricCard
          title="Max Drawdown"
          value={portfolioStats?.maxDrawdown || 0}
          format="percentage"
          isPositive={false}
          tooltip={{
            flavor: "Largest peak-to-trough decline",
            detailed:
              "The maximum percentage decline from a peak to a subsequent trough. This measures the worst-case scenario you experienced. Lower is better.",
          }}
        />
        <MetricCard
          title="Sharpe Ratio"
          value={portfolioStats?.sharpeRatio || 0}
          format="decimal"
          isPositive={(portfolioStats?.sharpeRatio || 0) > 1}
          tooltip={{
            flavor: "Risk-adjusted returns",
            detailed:
              "Measures return per unit of risk. Values above 1.0 are good, above 2.0 are very good, above 3.0 are excellent.",
          }}
        />
        <MetricCard
          title="Sortino Ratio"
          value={portfolioStats?.sortinoRatio || 0}
          format="decimal"
          isPositive={(portfolioStats?.sortinoRatio || 0) > 1}
          tooltip={{
            flavor: "Downside risk-adjusted returns",
            detailed:
              "Similar to Sharpe but focuses only on downside volatility. Better for strategies with asymmetric return distributions.",
          }}
        />
        <MetricCard
          title="Calmar Ratio"
          value={portfolioStats?.calmarRatio || 0}
          format="decimal"
          isPositive={(portfolioStats?.calmarRatio || 0) > 1}
          tooltip={{
            flavor: "Return relative to max drawdown",
            detailed:
              "Annual return divided by maximum drawdown. Higher values indicate better risk-adjusted performance.",
          }}
        />
      </MetricSection>

      {/* Streak Metrics */}
      <MetricSection
        title="Streak Metrics"
        icon={<TrendingUp className="w-4 h-4" />}
        gridCols={2}
      >
        <MetricCard
          title="Max Win Streak"
          value={portfolioStats?.maxWinStreak || 0}
          format="number"
          isPositive={true}
          tooltip={{
            flavor: "Longest consecutive profitable days",
            detailed:
              "The maximum number of consecutive days with positive returns. Shows your best momentum period.",
          }}
        />
        <MetricCard
          title="Max Loss Streak"
          value={portfolioStats?.maxLossStreak || 0}
          format="number"
          isPositive={false}
          tooltip={{
            flavor: "Longest consecutive losing days",
            detailed:
              "The maximum number of consecutive days with negative returns. Helps you prepare for challenging periods.",
          }}
        />
      </MetricSection>
    </div>
  );
}
