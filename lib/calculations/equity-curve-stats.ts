import { EquityCurveEntry } from '@/lib/models/equity-curve'
import { PortfolioStats } from '@/lib/models/portfolio-stats'
import { std, mean } from 'mathjs'

export interface EquityCurveChartData {
  equityCurve: Array<{ date: string; equity: number; highWaterMark: number; tradeNumber: number }>
  drawdownData: Array<{ date: string; drawdownPct: number }>
  monthlyReturns: Record<number, Record<number, number>>
  monthlyReturnsPercent: Record<number, Record<number, number>>
  returnDistribution: number[]
  rollingMetrics: Array<{ date: string; winRate: number; sharpeRatio: number; profitFactor: number; volatility: number }>
}

export interface EquityCurveSnapshot {
  entries: EquityCurveEntry[]
  portfolioStats: PortfolioStats
  chartData: EquityCurveChartData
}

/**
 * Calculate portfolio statistics from equity curve entries
 */
export function calculateEquityCurveStats(
  entries: EquityCurveEntry[],
  riskFreeRate: number = 2.0
): PortfolioStats {
  if (entries.length === 0) {
    return createEmptyStats()
  }

  // Sort entries by date
  const sortedEntries = [...entries].sort((a, b) => a.date.getTime() - b.date.getTime())

  // Extract daily returns
  const dailyReturns = sortedEntries.map(e => e.dailyReturnPct)

  // Calculate cumulative returns
  let cumulativeReturn = 0
  const cumulativeReturns: number[] = []
  for (const dailyReturn of dailyReturns) {
    cumulativeReturn = (1 + cumulativeReturn) * (1 + dailyReturn) - 1
    cumulativeReturns.push(cumulativeReturn)
  }

  // Get initial and final capital
  const initialCapital = sortedEntries[0].strategyName
    ? sortedEntries.filter(e => e.strategyName === sortedEntries[0].strategyName)[0]?.accountValue / (1 + sortedEntries.filter(e => e.strategyName === sortedEntries[0].strategyName)[0]?.dailyReturnPct) || 10000
    : sortedEntries[0].accountValue / (1 + sortedEntries[0].dailyReturnPct)

  const finalCapital = sortedEntries[sortedEntries.length - 1].accountValue
  const totalReturn = (finalCapital - initialCapital) / initialCapital

  // Calculate max drawdown from equity curve
  let maxDrawdown = 0
  let maxDrawdownPct = 0
  let highWaterMark = sortedEntries[0].accountValue
  let drawdownDuration = 0
  let currentDrawdownStart: Date | null = null
  let maxDrawdownDuration = 0

  for (let i = 0; i < sortedEntries.length; i++) {
    const equity = sortedEntries[i].accountValue

    if (equity > highWaterMark) {
      highWaterMark = equity
      if (currentDrawdownStart) {
        const duration = (sortedEntries[i].date.getTime() - currentDrawdownStart.getTime()) / (1000 * 60 * 60 * 24)
        if (duration > maxDrawdownDuration) {
          maxDrawdownDuration = duration
        }
        currentDrawdownStart = null
      }
    } else {
      if (!currentDrawdownStart) {
        currentDrawdownStart = sortedEntries[i].date
      }
      const drawdown = highWaterMark - equity
      const drawdownPct = drawdown / highWaterMark

      if (drawdownPct > maxDrawdownPct) {
        maxDrawdownPct = drawdownPct
        maxDrawdown = drawdown
      }
    }
  }

  // Calculate volatility (annualized standard deviation)
  const dailyVolatility = dailyReturns.length > 1
    ? std(dailyReturns, 'uncorrected') as number
    : 0
  const annualizedVolatility = dailyVolatility * Math.sqrt(252)

  // Calculate Sharpe Ratio (annualized)
  const avgDailyReturn = mean(dailyReturns) as number
  const annualizedReturn = Math.pow(1 + avgDailyReturn, 252) - 1
  const dailyRiskFreeRate = Math.pow(1 + riskFreeRate / 100, 1 / 252) - 1
  const excessDailyReturn = avgDailyReturn - dailyRiskFreeRate
  const sharpeRatio = dailyVolatility > 0
    ? (excessDailyReturn / dailyVolatility) * Math.sqrt(252)
    : 0

  // Calculate Sortino Ratio (using downside deviation)
  const downsideReturns = dailyReturns.filter(r => r < dailyRiskFreeRate)
  const downsideDeviation = downsideReturns.length > 0
    ? std(downsideReturns, 'biased') as number
    : 0
  const sortinoRatio = downsideDeviation > 0
    ? (excessDailyReturn / downsideDeviation) * Math.sqrt(252)
    : 0

  // Calculate Calmar Ratio
  const calmarRatio = maxDrawdownPct > 0
    ? annualizedReturn / maxDrawdownPct
    : 0

  // Winning/losing days
  const winningDays = dailyReturns.filter(r => r > 0).length
  const losingDays = dailyReturns.filter(r => r < 0).length
  const winRate = dailyReturns.length > 0 ? winningDays / dailyReturns.length : 0

  // Average win/loss
  const avgWin = winningDays > 0
    ? dailyReturns.filter(r => r > 0).reduce((sum, r) => sum + r, 0) / winningDays
    : 0
  const avgLoss = losingDays > 0
    ? dailyReturns.filter(r => r < 0).reduce((sum, r) => sum + r, 0) / losingDays
    : 0

  // Profit factor
  const totalWins = dailyReturns.filter(r => r > 0).reduce((sum, r) => sum + r, 0)
  const totalLosses = Math.abs(dailyReturns.filter(r => r < 0).reduce((sum, r) => sum + r, 0))
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0

  return {
    initialCapital,
    finalCapital,
    totalPl: finalCapital - initialCapital,
    totalReturn,
    totalTrades: dailyReturns.length,
    winningTrades: winningDays,
    losingTrades: losingDays,
    winRate,
    avgWin: avgWin * initialCapital,
    avgLoss: avgLoss * initialCapital,
    largestWin: Math.max(...dailyReturns) * initialCapital,
    largestLoss: Math.min(...dailyReturns) * initialCapital,
    profitFactor,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    maxDrawdown,
    maxDrawdownPct,
    maxDrawdownDuration,
    volatility: annualizedVolatility,
    returnOnMaxDrawdown: maxDrawdown > 0 ? (finalCapital - initialCapital) / maxDrawdown : 0,
    avgMarginUsed: mean(sortedEntries.map(e => e.marginReq)) as number,
    maxMarginUsed: Math.max(...sortedEntries.map(e => e.marginReq)),
    // Trade-specific metrics not applicable to equity curves
    totalCommissions: 0,
    avgDuration: 0,
    avgWinDuration: 0,
    avgLossDuration: 0,
    expectancy: avgWin * winRate + avgLoss * (1 - winRate),
  }
}

/**
 * Build chart data from equity curve entries
 */
export function buildEquityCurveChartData(entries: EquityCurveEntry[]): EquityCurveChartData {
  if (entries.length === 0) {
    return {
      equityCurve: [],
      drawdownData: [],
      monthlyReturns: {},
      monthlyReturnsPercent: {},
      returnDistribution: [],
      rollingMetrics: [],
    }
  }

  // Sort entries by date
  const sortedEntries = [...entries].sort((a, b) => a.date.getTime() - b.date.getTime())

  // Build equity curve
  const equityCurve: Array<{ date: string; equity: number; highWaterMark: number; tradeNumber: number }> = []
  let highWaterMark = sortedEntries[0].accountValue

  for (let i = 0; i < sortedEntries.length; i++) {
    const entry = sortedEntries[i]
    if (entry.accountValue > highWaterMark) {
      highWaterMark = entry.accountValue
    }
    equityCurve.push({
      date: entry.date.toISOString(),
      equity: entry.accountValue,
      highWaterMark,
      tradeNumber: i + 1,
    })
  }

  // Build drawdown data
  const drawdownData: Array<{ date: string; drawdownPct: number }> = []
  highWaterMark = sortedEntries[0].accountValue

  for (const entry of sortedEntries) {
    if (entry.accountValue > highWaterMark) {
      highWaterMark = entry.accountValue
    }
    const drawdownPct = highWaterMark > 0 ? ((entry.accountValue - highWaterMark) / highWaterMark) * 100 : 0
    drawdownData.push({
      date: entry.date.toISOString(),
      drawdownPct,
    })
  }

  // Build monthly returns
  const monthlyReturns: Record<number, Record<number, number>> = {}
  const monthlyReturnsPercent: Record<number, Record<number, number>> = {}

  for (const entry of sortedEntries) {
    const year = entry.date.getFullYear()
    const month = entry.date.getMonth() + 1

    if (!monthlyReturns[year]) {
      monthlyReturns[year] = {}
      monthlyReturnsPercent[year] = {}
    }

    if (!monthlyReturns[year][month]) {
      monthlyReturns[year][month] = 0
      monthlyReturnsPercent[year][month] = 0
    }

    const returnAmount = entry.accountValue * entry.dailyReturnPct
    monthlyReturns[year][month] += returnAmount
    monthlyReturnsPercent[year][month] += entry.dailyReturnPct * 100
  }

  // Build return distribution
  const returnDistribution = sortedEntries.map(e => e.dailyReturnPct * 100)

  // Build rolling metrics (30-day window)
  const rollingMetrics: Array<{ date: string; winRate: number; sharpeRatio: number; profitFactor: number; volatility: number }> = []
  const windowSize = 30

  for (let i = windowSize - 1; i < sortedEntries.length; i++) {
    const windowEntries = sortedEntries.slice(i - windowSize + 1, i + 1)
    const windowReturns = windowEntries.map(e => e.dailyReturnPct)

    const winningDays = windowReturns.filter(r => r > 0).length
    const winRate = winningDays / windowReturns.length

    const avgReturn = mean(windowReturns) as number
    const volatility = std(windowReturns, 'uncorrected') as number
    const sharpeRatio = volatility > 0 ? (avgReturn / volatility) * Math.sqrt(252) : 0

    const totalWins = windowReturns.filter(r => r > 0).reduce((sum, r) => sum + r, 0)
    const totalLosses = Math.abs(windowReturns.filter(r => r < 0).reduce((sum, r) => sum + r, 0))
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0

    rollingMetrics.push({
      date: sortedEntries[i].date.toISOString(),
      winRate: winRate * 100,
      sharpeRatio,
      profitFactor,
      volatility: volatility * Math.sqrt(252) * 100,
    })
  }

  return {
    equityCurve,
    drawdownData,
    monthlyReturns,
    monthlyReturnsPercent,
    returnDistribution,
    rollingMetrics,
  }
}

/**
 * Build complete equity curve snapshot with stats and chart data
 */
export function buildEquityCurveSnapshot(
  entries: EquityCurveEntry[],
  riskFreeRate: number = 2.0
): EquityCurveSnapshot {
  const portfolioStats = calculateEquityCurveStats(entries, riskFreeRate)
  const chartData = buildEquityCurveChartData(entries)

  return {
    entries,
    portfolioStats,
    chartData,
  }
}

function createEmptyStats(): PortfolioStats {
  return {
    initialCapital: 0,
    finalCapital: 0,
    totalPl: 0,
    totalReturn: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    avgWin: 0,
    avgLoss: 0,
    largestWin: 0,
    largestLoss: 0,
    profitFactor: 0,
    sharpeRatio: 0,
    sortinoRatio: 0,
    calmarRatio: 0,
    maxDrawdown: 0,
    maxDrawdownPct: 0,
    maxDrawdownDuration: 0,
    volatility: 0,
    returnOnMaxDrawdown: 0,
    avgMarginUsed: 0,
    maxMarginUsed: 0,
    totalCommissions: 0,
    avgDuration: 0,
    avgWinDuration: 0,
    avgLossDuration: 0,
    expectancy: 0,
  }
}
