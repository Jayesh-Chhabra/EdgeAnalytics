import { EquityCurveEntry } from '@/lib/models/equity-curve'

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
}

/**
 * Calculate Pearson correlation coefficient between two arrays
 */
function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length
  if (n !== y.length || n === 0) return 0

  const sumX = x.reduce((a, b) => a + b, 0)
  const sumY = y.reduce((a, b) => a + b, 0)
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0)
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0)
  const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0)

  const numerator = n * sumXY - sumX * sumY
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY))

  if (denominator === 0) return 0
  return numerator / denominator
}

/**
 * Calculate Spearman rank correlation coefficient
 */
function spearmanCorrelation(x: number[], y: number[]): number {
  const n = x.length
  if (n !== y.length || n === 0) return 0

  // Create rank arrays
  const rankX = getRanks(x)
  const rankY = getRanks(y)

  // Calculate Pearson correlation on ranks
  return pearsonCorrelation(rankX, rankY)
}

/**
 * Get ranks for an array (handles ties by averaging ranks)
 */
function getRanks(arr: number[]): number[] {
  const indexed = arr.map((value, index) => ({ value, index }))
  indexed.sort((a, b) => a.value - b.value)

  const ranks = new Array(arr.length).fill(0)
  let i = 0
  while (i < indexed.length) {
    let j = i
    // Find all elements with the same value
    while (j < indexed.length && indexed[j].value === indexed[i].value) {
      j++
    }
    // Assign average rank to all tied elements
    const avgRank = (i + j - 1) / 2 + 1
    for (let k = i; k < j; k++) {
      ranks[indexed[k].index] = avgRank
    }
    i = j
  }

  return ranks
}

/**
 * Align equity curve entries by date across multiple strategies
 */
function alignEquityCurvesByDate(
  entries: EquityCurveEntry[]
): { dates: Date[]; alignedReturns: Record<string, number[]> } {
  // Group entries by strategy
  const byStrategy = entries.reduce((acc, entry) => {
    if (!acc[entry.strategyName]) {
      acc[entry.strategyName] = []
    }
    acc[entry.strategyName].push(entry)
    return acc
  }, {} as Record<string, EquityCurveEntry[]>)

  // Sort each strategy's entries by date
  Object.keys(byStrategy).forEach(strategy => {
    byStrategy[strategy].sort((a, b) => a.date.getTime() - b.date.getTime())
  })

  // Find all unique dates
  const allDates = new Set<number>()
  Object.values(byStrategy).forEach(strategyEntries => {
    strategyEntries.forEach(entry => {
      allDates.add(entry.date.getTime())
    })
  })

  // Sort dates
  const sortedDates = Array.from(allDates).sort((a, b) => a - b).map(timestamp => new Date(timestamp))

  // Create date-to-return mappings for each strategy
  const dateReturns: Record<string, Map<number, number>> = {}
  Object.entries(byStrategy).forEach(([strategy, strategyEntries]) => {
    dateReturns[strategy] = new Map()
    strategyEntries.forEach(entry => {
      dateReturns[strategy].set(entry.date.getTime(), entry.dailyReturnPct)
    })
  })

  // Find common dates (dates where all strategies have data)
  const strategies = Object.keys(byStrategy)
  const commonDates = sortedDates.filter(date => {
    const timestamp = date.getTime()
    return strategies.every(strategy => dateReturns[strategy].has(timestamp))
  })

  // Build aligned returns
  const alignedReturns: Record<string, number[]> = {}
  strategies.forEach(strategy => {
    alignedReturns[strategy] = commonDates.map(date => {
      return dateReturns[strategy].get(date.getTime()) || 0
    })
  })

  return { dates: commonDates, alignedReturns }
}

/**
 * Calculate correlation matrix from equity curve entries
 */
export function calculateEquityCurveCorrelationMatrix(
  entries: EquityCurveEntry[],
  method: 'pearson' | 'spearman' = 'pearson'
): EquityCurveCorrelationMatrix {
  // Align entries by date
  const { dates, alignedReturns } = alignEquityCurvesByDate(entries)

  const strategies = Object.keys(alignedReturns).sort()
  const n = strategies.length

  // Calculate correlation matrix
  const correlationData: number[][] = []

  for (let i = 0; i < n; i++) {
    const row: number[] = []
    for (let j = 0; j < n; j++) {
      if (i === j) {
        row.push(1) // Correlation with self is always 1
      } else {
        const returns1 = alignedReturns[strategies[i]]
        const returns2 = alignedReturns[strategies[j]]

        const correlation = method === 'pearson'
          ? pearsonCorrelation(returns1, returns2)
          : spearmanCorrelation(returns1, returns2)

        row.push(correlation)
      }
    }
    correlationData.push(row)
  }

  return {
    strategies,
    correlationData,
    dates,
    alignedReturns,
  }
}

/**
 * Calculate analytics from correlation matrix
 */
export function calculateEquityCurveCorrelationAnalytics(
  matrix: EquityCurveCorrelationMatrix
): EquityCurveCorrelationAnalytics {
  const { strategies, correlationData } = matrix
  const n = strategies.length

  if (n < 2) {
    return {
      avgCorrelation: 0,
      maxCorrelation: 0,
      minCorrelation: 0,
      diversificationScore: 1,
      highlyCorrelatedPairs: [],
      uncorrelatedPairs: [],
    }
  }

  // Collect all off-diagonal correlations
  const correlations: number[] = []
  const pairs: Array<{ strategy1: string; strategy2: string; correlation: number }> = []

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const corr = correlationData[i][j]
      correlations.push(corr)
      pairs.push({
        strategy1: strategies[i],
        strategy2: strategies[j],
        correlation: corr,
      })
    }
  }

  // Calculate statistics
  const avgCorrelation = correlations.reduce((a, b) => a + b, 0) / correlations.length
  const maxCorrelation = Math.max(...correlations)
  const minCorrelation = Math.min(...correlations)

  // Diversification score (inverse of average correlation, range 0-1)
  // Lower correlation = better diversification
  const diversificationScore = Math.max(0, 1 - avgCorrelation)

  // Find highly correlated pairs (> 0.7)
  const highlyCorrelatedPairs = pairs
    .filter(p => Math.abs(p.correlation) > 0.7)
    .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))
    .slice(0, 10)

  // Find uncorrelated pairs (< 0.3)
  const uncorrelatedPairs = pairs
    .filter(p => Math.abs(p.correlation) < 0.3)
    .sort((a, b) => Math.abs(a.correlation) - Math.abs(b.correlation))
    .slice(0, 10)

  return {
    avgCorrelation,
    maxCorrelation,
    minCorrelation,
    diversificationScore,
    highlyCorrelatedPairs,
    uncorrelatedPairs,
  }
}
