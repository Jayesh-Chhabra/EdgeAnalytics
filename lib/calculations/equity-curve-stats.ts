import { EquityCurveEntry } from '@/lib/models/equity-curve';
import { PortfolioStats } from '@/lib/models/portfolio-stats';
import { mean, std } from 'mathjs';

export interface EquityCurveChartData {
  equityCurve: Array<{ date: string; equity: number; highWaterMark: number; tradeNumber: number }>
  drawdownData: Array<{ date: string; drawdownPct: number }>
  monthlyReturns: Record<number, Record<number, number>>
  monthlyReturnsPercent: Record<number, Record<number, number>>
  returnDistribution: number[]
  rollingMetrics: Array<{ date: string; winRate: number; sharpeRatio: number; profitFactor: number; volatility: number }>
  streakData?: {
    winDistribution: Record<number, number>
    lossDistribution: Record<number, number>
    statistics: {
      maxWinStreak: number
      maxLossStreak: number
      avgWinStreak: number
      avgLossStreak: number
      currentStreak: number
    }
  }
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
  // const totalReturn = (finalCapital - initialCapital) / initialCapital

  // Calculate max drawdown from equity curve
  let maxDrawdown = 0
  let maxDrawdownPct = 0
  let highWaterMark = sortedEntries[0].accountValue

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
  // const annualizedVolatility = dailyVolatility * Math.sqrt(252)

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
    totalPl: finalCapital - initialCapital,
    netPl: finalCapital - initialCapital,
    totalTrades: dailyReturns.length,
    winningTrades: winningDays,
    losingTrades: losingDays,
    breakEvenTrades: dailyReturns.length - winningDays - losingDays,
    winRate,
    avgWin: avgWin * initialCapital,
    avgLoss: avgLoss * initialCapital,
    maxWin: Math.max(...dailyReturns) * initialCapital,
    maxLoss: Math.min(...dailyReturns) * initialCapital,
    profitFactor,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    maxDrawdown,
    avgDailyPl: mean(dailyReturns) * initialCapital,
    totalCommissions: 0,
    // Optional fields that were calculated but not part of interface or named differently
    // volatility: annualizedVolatility, 
    // maxDrawdownPct,
    // maxDrawdownDuration,
    // returnOnMaxDrawdown: maxDrawdown > 0 ? (finalCapital - initialCapital) / maxDrawdown : 0,
    // avgMarginUsed: mean(sortedEntries.map(e => e.marginReq)) as number,
    // maxMarginUsed: Math.max(...sortedEntries.map(e => e.marginReq)),
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

  // Calculate streaks
  const winDistribution: Record<number, number> = {}
  const lossDistribution: Record<number, number> = {}
  let currentWinStreak = 0
  let currentLossStreak = 0
  let maxWinStreak = 0
  let maxLossStreak = 0
  const winStreaks: number[] = []
  const lossStreaks: number[] = []

  for (const entry of sortedEntries) {
    const returnPct = entry.dailyReturnPct
    
    if (returnPct > 0) {
      // Win
      if (currentLossStreak > 0) {
        lossDistribution[currentLossStreak] = (lossDistribution[currentLossStreak] || 0) + 1
        lossStreaks.push(currentLossStreak)
        currentLossStreak = 0
      }
      currentWinStreak++
      if (currentWinStreak > maxWinStreak) maxWinStreak = currentWinStreak
    } else if (returnPct < 0) {
      // Loss
      if (currentWinStreak > 0) {
        winDistribution[currentWinStreak] = (winDistribution[currentWinStreak] || 0) + 1
        winStreaks.push(currentWinStreak)
        currentWinStreak = 0
      }
      currentLossStreak++
      if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak
    }
    // Zero return doesn't break streak in this simple model, or we could treat it as neutral. 
    // Usually 0 return breaks a streak or is ignored. Let's assume it breaks streak for now to be safe, 
    // or arguably it shouldn't count. 
    // If we want to be strict:
    else {
        if (currentWinStreak > 0) {
            winDistribution[currentWinStreak] = (winDistribution[currentWinStreak] || 0) + 1
            winStreaks.push(currentWinStreak)
            currentWinStreak = 0
        }
        if (currentLossStreak > 0) {
            lossDistribution[currentLossStreak] = (lossDistribution[currentLossStreak] || 0) + 1
            lossStreaks.push(currentLossStreak)
            currentLossStreak = 0
        }
    }
  }

  // Add final streaks
  if (currentWinStreak > 0) {
    winDistribution[currentWinStreak] = (winDistribution[currentWinStreak] || 0) + 1
    winStreaks.push(currentWinStreak)
  }
  if (currentLossStreak > 0) {
    lossDistribution[currentLossStreak] = (lossDistribution[currentLossStreak] || 0) + 1
    lossStreaks.push(currentLossStreak)
  }

  const avgWinStreak = winStreaks.length > 0 ? mean(winStreaks) as number : 0
  const avgLossStreak = lossStreaks.length > 0 ? mean(lossStreaks) as number : 0
  
  // Determine current streak
  let currentStreak = 0
  if (currentWinStreak > 0) currentStreak = currentWinStreak
  else if (currentLossStreak > 0) currentStreak = -currentLossStreak

  return {
    equityCurve,
    drawdownData,
    monthlyReturns,
    monthlyReturnsPercent,
    returnDistribution,
    rollingMetrics,
    streakData: {
      winDistribution,
      lossDistribution,
      statistics: {
        maxWinStreak,
        maxLossStreak,
        avgWinStreak,
        avgLossStreak,
        currentStreak
      }
    }
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
    totalPl: 0,
    netPl: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    breakEvenTrades: 0,
    winRate: 0,
    avgWin: 0,
    avgLoss: 0,
    maxWin: 0,
    maxLoss: 0,
    profitFactor: 0,
    sharpeRatio: 0,
    sortinoRatio: 0,
    calmarRatio: 0,
    maxDrawdown: 0,
    avgDailyPl: 0,
    totalCommissions: 0,
  }
}
