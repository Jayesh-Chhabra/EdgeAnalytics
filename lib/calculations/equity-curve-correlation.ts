import { EquityCurveEntry } from "../models/equity-curve";
import { std, variance } from "mathjs";

export interface EquityCurveCorrelationMatrix {
  strategies: string[]
  correlationData: number[][]
  dates: Date[]
  alignedReturns: Record<string, number[]>
}

export interface EquityCurveCorrelationAnalytics {
  avgCorrelation: number
  maxCorrelation: number
  minCorrelation: number
  diversificationScore: number
  highlyCorrelatedPairs: Array<{
    strategy1: string
    strategy2: string
    correlation: number
  }>
  uncorrelatedPairs: Array<{
    strategy1: string
    strategy2: string
    correlation: number
  }>
  // Compatibility with CorrelationAnalytics
  strongest: {
    value: number
    pair: [string, string]
  }
  weakest: {
    value: number
    pair: [string, string]
  }
  averageCorrelation: number
  strategyCount: number
}

export interface SPYCorrelationResult {
  correlation: number
  beta: number
  alpha: number  // Annualized alpha
  rSquared: number
  trackingError: number
}

/**
 * Calculate Pearson correlation coefficient between two return series
 */
function calculateCorrelation(returns1: number[], returns2: number[]): number {
  if (returns1.length !== returns2.length || returns1.length === 0) {
    return 0;
  }

  const n = returns1.length;
  const mean1 = returns1.reduce((a, b) => a + b, 0) / n;
  const mean2 = returns2.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let sum1Sq = 0;
  let sum2Sq = 0;

  for (let i = 0; i < n; i++) {
    const diff1 = returns1[i] - mean1;
    const diff2 = returns2[i] - mean2;
    numerator += diff1 * diff2;
    sum1Sq += diff1 * diff1;
    sum2Sq += diff2 * diff2;
  }

  const denominator = Math.sqrt(sum1Sq * sum2Sq);
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Calculate beta (systematic risk) between strategy and benchmark
 */
function calculateBeta(strategyReturns: number[], benchmarkReturns: number[]): number {
  if (strategyReturns.length !== benchmarkReturns.length || strategyReturns.length === 0) {
    return 0;
  }

  const n = strategyReturns.length;
  const meanStrategy = strategyReturns.reduce((a, b) => a + b, 0) / n;
  const meanBenchmark = benchmarkReturns.reduce((a, b) => a + b, 0) / n;

  let covariance = 0;
  let benchmarkVariance = 0;

  for (let i = 0; i < n; i++) {
    const strategyDiff = strategyReturns[i] - meanStrategy;
    const benchmarkDiff = benchmarkReturns[i] - meanBenchmark;
    covariance += strategyDiff * benchmarkDiff;
    benchmarkVariance += benchmarkDiff * benchmarkDiff;
  }

  return benchmarkVariance === 0 ? 0 : covariance / benchmarkVariance;
}

/**
 * Align equity curve entries by date across multiple strategies
 */
function alignEquityCurvesByDate(
  entriesByStrategy: Record<string, EquityCurveEntry[]>
): { dates: Date[]; alignedReturns: Record<string, number[]> } {
  const strategies = Object.keys(entriesByStrategy);

  if (strategies.length === 0) {
    return { dates: [], alignedReturns: {} };
  }

  // Get all unique dates across all strategies
  const allDatesSet = new Set<number>();
  for (const strategy of strategies) {
    entriesByStrategy[strategy].forEach(entry => {
      allDatesSet.add(entry.date.getTime());
    });
  }

  // Sort dates
  const dates = Array.from(allDatesSet)
    .sort((a, b) => a - b)
    .map(timestamp => new Date(timestamp));

  // Create return maps for each strategy
  const returnMaps: Record<string, Map<number, number>> = {};
  for (const strategy of strategies) {
    const returnMap = new Map<number, number>();
    entriesByStrategy[strategy].forEach(entry => {
      returnMap.set(entry.date.getTime(), entry.dailyReturnPct / 100); // Convert % to decimal
    });
    returnMaps[strategy] = returnMap;
  }

  // Align returns - use 0 for missing dates (strategy not trading that day)
  const alignedReturns: Record<string, number[]> = {};
  for (const strategy of strategies) {
    alignedReturns[strategy] = dates.map(date =>
      returnMaps[strategy].get(date.getTime()) ?? 0
    );
  }

  return { dates, alignedReturns };
}

/**
 * Calculate correlation matrix for equity curve strategies
 */
export function calculateEquityCurveCorrelationMatrix(
  entriesByStrategy: Record<string, EquityCurveEntry[]>
): EquityCurveCorrelationMatrix {
  const strategies = Object.keys(entriesByStrategy).sort();
  const n = strategies.length;

  if (n === 0) {
    return {
      strategies: [],
      correlationData: [],
      dates: [],
      alignedReturns: {},
    };
  }

  // Align all strategies by date
  const { dates, alignedReturns } = alignEquityCurvesByDate(entriesByStrategy);

  // Calculate correlation matrix
  const correlationData: number[][] = Array(n)
    .fill(0)
    .map(() => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        correlationData[i][j] = 1; // Perfect correlation with self
      } else {
        const correlation = calculateCorrelation(
          alignedReturns[strategies[i]],
          alignedReturns[strategies[j]]
        );
        correlationData[i][j] = correlation;
      }
    }
  }

  return {
    strategies,
    correlationData,
    dates,
    alignedReturns,
  };
}

/**
 * Calculate analytics from correlation matrix
 */
export function calculateEquityCurveCorrelationAnalytics(
  matrix: EquityCurveCorrelationMatrix
): EquityCurveCorrelationAnalytics {
  const { strategies, correlationData } = matrix;
  const n = strategies.length;

  if (n < 2) {
    return {
      avgCorrelation: 0,
      maxCorrelation: 0,
      minCorrelation: 0,
      diversificationScore: 1,
      highlyCorrelatedPairs: [],
      uncorrelatedPairs: [],
      strongest: { value: 0, pair: ["", ""] },
      weakest: { value: 0, pair: ["", ""] },
      averageCorrelation: 0,
      strategyCount: n,
    };
  }

  // Collect all off-diagonal correlations
  const correlations: number[] = [];
  const pairs: Array<{ strategy1: string; strategy2: string; correlation: number }> = [];

  let strongest = { value: -1, pair: ["", ""] as [string, string] };
  let weakest = { value: 1, pair: ["", ""] as [string, string] };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const corr = correlationData[i][j];
      correlations.push(corr);
      pairs.push({
        strategy1: strategies[i],
        strategy2: strategies[j],
        correlation: corr,
      });

      if (corr > strongest.value) {
        strongest = { value: corr, pair: [strategies[i], strategies[j]] };
      }
      if (corr < weakest.value) {
        weakest = { value: corr, pair: [strategies[i], strategies[j]] };
      }
    }
  }

  // Calculate statistics
  const avgCorrelation = correlations.reduce((a, b) => a + b, 0) / correlations.length;
  const maxCorrelation = Math.max(...correlations);
  const minCorrelation = Math.min(...correlations);

  // Diversification score (inverse of average correlation, range 0-1)
  // Lower correlation = better diversification
  const diversificationScore = Math.max(0, 1 - avgCorrelation);

  // Find highly correlated pairs (> 0.7)
  const highlyCorrelatedPairs = pairs
    .filter(p => Math.abs(p.correlation) > 0.7)
    .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))
    .slice(0, 10);

  // Find uncorrelated pairs (< 0.3)
  const uncorrelatedPairs = pairs
    .filter(p => Math.abs(p.correlation) < 0.3)
    .sort((a, b) => Math.abs(a.correlation) - Math.abs(b.correlation))
    .slice(0, 10);

  return {
    avgCorrelation,
    maxCorrelation,
    minCorrelation,
    diversificationScore,
    highlyCorrelatedPairs,
    uncorrelatedPairs,
    strongest,
    weakest,
    averageCorrelation: avgCorrelation,
    strategyCount: n,
  };
}

/**
 * Calculate correlation and beta relative to SPY (or any benchmark)
 * Returns correlation, beta, alpha, R-squared, and tracking error
 */
export function calculateSPYCorrelation(
  strategyReturns: number[],
  spyReturns: number[],
  riskFreeRate: number = 0.05 // 5% annual risk-free rate
): SPYCorrelationResult {
  if (strategyReturns.length !== spyReturns.length || strategyReturns.length === 0) {
    return {
      correlation: 0,
      beta: 0,
      alpha: 0,
      rSquared: 0,
      trackingError: 0,
    };
  }

  // Calculate correlation
  const correlation = calculateCorrelation(strategyReturns, spyReturns);

  // Calculate beta
  const beta = calculateBeta(strategyReturns, spyReturns);

  // Calculate R-squared (square of correlation)
  const rSquared = correlation * correlation;

  // Calculate alpha (CAPM)
  // Alpha = Strategy Return - (Risk-Free Rate + Beta * (Market Return - Risk-Free Rate))
  const avgStrategyReturn = strategyReturns.reduce((a, b) => a + b, 0) / strategyReturns.length;
  const avgMarketReturn = spyReturns.reduce((a, b) => a + b, 0) / spyReturns.length;
  const dailyRiskFreeRate = riskFreeRate / 252; // Convert annual to daily

  // Annualized alpha
  const dailyAlpha = avgStrategyReturn - (dailyRiskFreeRate + beta * (avgMarketReturn - dailyRiskFreeRate));
  const alpha = dailyAlpha * 252; // Annualize

  // Calculate tracking error (standard deviation of return differences)
  const returnDifferences = strategyReturns.map((sr, i) => sr - spyReturns[i]);
  const trackingError = Number(std(returnDifferences, 'uncorrected')) * Math.sqrt(252); // Annualize

  return {
    correlation,
    beta,
    alpha,
    rSquared,
    trackingError,
  };
}

/**
 * Calculate SPY correlation for all strategies in an equity curve block
 */
export function calculateEquityCurveSPYCorrelations(
  entriesByStrategy: Record<string, EquityCurveEntry[]>,
  spyEntries: EquityCurveEntry[],
  riskFreeRate: number = 0.05
): Record<string, SPYCorrelationResult> {
  const results: Record<string, SPYCorrelationResult> = {};

  // Create SPY return map by date
  const spyReturnMap = new Map<number, number>();
  spyEntries.forEach(entry => {
    spyReturnMap.set(entry.date.getTime(), entry.dailyReturnPct / 100);
  });

  // For each strategy, align with SPY and calculate correlation/beta
  for (const [strategyName, entries] of Object.entries(entriesByStrategy)) {
    const alignedStrategyReturns: number[] = [];
    const alignedSPYReturns: number[] = [];

    // Find common dates
    entries.forEach(entry => {
      const spyReturn = spyReturnMap.get(entry.date.getTime());
      if (spyReturn !== undefined) {
        alignedStrategyReturns.push(entry.dailyReturnPct / 100);
        alignedSPYReturns.push(spyReturn);
      }
    });

    // Calculate metrics
    results[strategyName] = calculateSPYCorrelation(
      alignedStrategyReturns,
      alignedSPYReturns,
      riskFreeRate
    );
  }

  return results;
}
