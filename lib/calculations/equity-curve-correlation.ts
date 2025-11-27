
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

// ... (keep helper functions)

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
      strongest: { value: 0, pair: ["", ""] },
      weakest: { value: 0, pair: ["", ""] },
      averageCorrelation: 0,
      strategyCount: n,
    }
  }

  // Collect all off-diagonal correlations
  const correlations: number[] = []
  const pairs: Array<{ strategy1: string; strategy2: string; correlation: number }> = []
  
  let strongest = { value: -1, pair: ["", ""] as [string, string] }
  let weakest = { value: 1, pair: ["", ""] as [string, string] }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const corr = correlationData[i][j]
      correlations.push(corr)
      pairs.push({
        strategy1: strategies[i],
        strategy2: strategies[j],
        correlation: corr,
      })

      if (corr > strongest.value) {
        strongest = { value: corr, pair: [strategies[i], strategies[j]] }
      }
      if (corr < weakest.value) {
        weakest = { value: corr, pair: [strategies[i], strategies[j]] }
      }
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
    strongest,
    weakest,
    averageCorrelation: avgCorrelation,
    strategyCount: n,
  }
}
