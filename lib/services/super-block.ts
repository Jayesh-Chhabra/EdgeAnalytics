import { Trade } from '@/lib/models/trade'
import { DailyLogEntry } from '@/lib/models/daily-log'
import { EquityCurveEntry } from '@/lib/models/equity-curve'
import { SuperBlock, DateAlignmentStrategy } from '@/lib/models/block'
import { PortfolioStats } from '@/lib/models/portfolio-stats'
import { calculateEquityCurveStats } from '@/lib/calculations/equity-curve-stats'

export interface CombinedEquityCurve {
  date: Date
  combinedAccountValue: number
  componentValues: Record<string, number>
  combinedReturn: number
  combinedMarginReq: number
}

export interface SuperBlockData {
  combinedEquityCurve: CombinedEquityCurve[]
  portfolioStats: PortfolioStats
  componentStats: Record<string, PortfolioStats>
  dateRange: { start: Date; end: Date }
  alignmentWarnings: string[]
}

/**
 * Align dates across multiple components using specified strategy
 */
function alignDates(
  datesByComponent: Record<string, Date[]>,
  strategy: DateAlignmentStrategy
): { alignedDates: Date[]; warnings: string[] } {
  const warnings: string[] = []
  const components = Object.keys(datesByComponent)

  if (components.length === 0) {
    return { alignedDates: [], warnings: ['No components to align'] }
  }

  // Get all unique dates across components
  const allDates = new Set<number>()
  components.forEach(component => {
    datesByComponent[component].forEach(date => {
      allDates.add(date.getTime())
    })
  })

  const sortedAllDates = Array.from(allDates).sort((a, b) => a - b).map(timestamp => new Date(timestamp))

  switch (strategy) {
    case 'intersection':
      // Only include dates present in ALL components
      const alignedDates = sortedAllDates.filter(date => {
        const timestamp = date.getTime()
        return components.every(component =>
          datesByComponent[component].some(d => d.getTime() === timestamp)
        )
      })

      if (alignedDates.length === 0) {
        warnings.push('No overlapping dates found across all components')
      } else if (alignedDates.length < sortedAllDates.length / 2) {
        warnings.push(`Limited date overlap: ${alignedDates.length} of ${sortedAllDates.length} total dates`)
      }

      return { alignedDates, warnings }

    case 'union':
      // Include all dates, fill missing values with previous day's value (forward fill)
      warnings.push('Using forward-fill for missing dates in some components')
      return { alignedDates: sortedAllDates, warnings }

    case 'earliest-common':
      // Start from the earliest date where all components have data
      const firstCommonDate = sortedAllDates.find(date => {
        const timestamp = date.getTime()
        return components.every(component =>
          datesByComponent[component].some(d => d.getTime() === timestamp)
        )
      })

      if (!firstCommonDate) {
        warnings.push('No common start date found')
        return { alignedDates: [], warnings }
      }

      const alignedFromCommon = sortedAllDates.filter(date => date >= firstCommonDate)
      return { alignedDates: alignedFromCommon, warnings }

    case 'latest-common':
      // End at the latest date where all components still have data
      const lastCommonDate = sortedAllDates.reverse().find(date => {
        const timestamp = date.getTime()
        return components.every(component =>
          datesByComponent[component].some(d => d.getTime() === timestamp)
        )
      })

      if (!lastCommonDate) {
        warnings.push('No common end date found')
        return { alignedDates: [], warnings }
      }

      const alignedToCommon = sortedAllDates.reverse().filter(date => date <= lastCommonDate)
      return { alignedDates: alignedToCommon, warnings }

    default:
      return { alignedDates: sortedAllDates, warnings }
  }
}

/**
 * Convert trades to equity curve entries
 */
function tradesToEquityCurve(
  trades: Trade[],
  componentName: string,
  dailyLogs?: DailyLogEntry[]
): EquityCurveEntry[] {
  // If we have daily logs, prefer those for more accurate equity curve
  if (dailyLogs && dailyLogs.length > 0) {
    const sortedLogs = [...dailyLogs].sort((a, b) => a.date.getTime() - b.date.getTime())

    return sortedLogs.map((log, index) => {
      const prevLog = index > 0 ? sortedLogs[index - 1] : null
      const dailyReturn = prevLog
        ? (log.accountValue - prevLog.accountValue) / prevLog.accountValue
        : 0

      return {
        date: log.date,
        dailyReturnPct: dailyReturn,
        marginReq: log.marginReq || 0,
        accountValue: log.accountValue,
        strategyName: componentName,
      }
    })
  }

  // Fall back to constructing from trades
  const sortedTrades = [...trades].sort((a, b) => a.dateOpened.getTime() - b.dateOpened.getTime())

  if (sortedTrades.length === 0) {
    return []
  }

  const initialCapital = sortedTrades[0].fundsAtClose - sortedTrades[0].pl
  const entries: EquityCurveEntry[] = []

  let currentCapital = initialCapital
  let previousCapital = initialCapital

  sortedTrades.forEach(trade => {
    currentCapital += trade.pl
    const dailyReturn = previousCapital > 0 ? (currentCapital - previousCapital) / previousCapital : 0

    entries.push({
      date: trade.dateClosed || trade.dateOpened,
      dailyReturnPct: dailyReturn,
      marginReq: trade.marginReq / currentCapital, // Convert to percentage
      accountValue: currentCapital,
      strategyName: componentName,
    })

    previousCapital = currentCapital
  })

  return entries
}

/**
 * Combine multiple blocks into a Super Block with aligned equity curves
 */
export async function combineSuperBlock(
  components: Array<{
    blockId: string
    blockName: string
    blockType: 'trade-based' | 'equity-curve'
    trades?: Trade[]
    dailyLogs?: DailyLogEntry[]
    equityCurveEntries?: EquityCurveEntry[]
    weight?: number
  }>,
  alignment: DateAlignmentStrategy
): Promise<SuperBlockData> {
  const warnings: string[] = []

  // Convert all components to equity curves
  const componentCurves: Record<string, EquityCurveEntry[]> = {}

  components.forEach(component => {
    if (component.blockType === 'equity-curve' && component.equityCurveEntries) {
      componentCurves[component.blockName] = component.equityCurveEntries
    } else if (component.blockType === 'trade-based' && component.trades) {
      componentCurves[component.blockName] = tradesToEquityCurve(
        component.trades,
        component.blockName,
        component.dailyLogs
      )
    }
  })

  // Extract dates for each component
  const datesByComponent: Record<string, Date[]> = {}
  Object.entries(componentCurves).forEach(([name, entries]) => {
    datesByComponent[name] = entries.map(e => e.date).sort((a, b) => a.getTime() - b.getTime())
  })

  // Align dates
  const { alignedDates, warnings: alignmentWarnings } = alignDates(datesByComponent, alignment)
  warnings.push(...alignmentWarnings)

  if (alignedDates.length === 0) {
    throw new Error('No aligned dates found - cannot combine blocks')
  }

  // Build value maps for each component
  const valuesByComponent: Record<string, Map<number, EquityCurveEntry>> = {}
  Object.entries(componentCurves).forEach(([name, entries]) => {
    valuesByComponent[name] = new Map()
    entries.forEach(entry => {
      valuesByComponent[name].set(entry.date.getTime(), entry)
    })
  })

  // Combine equity curves
  const combined: CombinedEquityCurve[] = []
  const componentNames = Object.keys(componentCurves)

  // Track last known values for forward-fill
  const lastKnownValues: Record<string, EquityCurveEntry> = {}

  for (const date of alignedDates) {
    const timestamp = date.getTime()
    const componentValues: Record<string, number> = {}
    let combinedValue = 0
    let combinedMarginReq = 0
    let missingCount = 0

    componentNames.forEach(name => {
      const entry = valuesByComponent[name].get(timestamp)
      if (entry) {
        componentValues[name] = entry.accountValue
        combinedValue += entry.accountValue
        combinedMarginReq += entry.marginReq
        lastKnownValues[name] = entry
      } else if (lastKnownValues[name]) {
        // Forward fill with last known value
        componentValues[name] = lastKnownValues[name].accountValue
        combinedValue += lastKnownValues[name].accountValue
        combinedMarginReq += lastKnownValues[name].marginReq
        missingCount++
      }
    })

    if (missingCount > 0 && combined.length === 0) {
      // Skip until we have at least one complete data point
      continue
    }

    // Calculate combined return
    const prevCombined = combined[combined.length - 1]
    const combinedReturn = prevCombined
      ? (combinedValue - prevCombined.combinedAccountValue) / prevCombined.combinedAccountValue
      : 0

    combined.push({
      date,
      combinedAccountValue: combinedValue,
      componentValues,
      combinedReturn,
      combinedMarginReq: combinedMarginReq / componentNames.length, // Average margin req
    })
  }

  // Convert combined equity curve to entries for stats calculation
  const combinedEntries: EquityCurveEntry[] = combined.map(c => ({
    date: c.date,
    dailyReturnPct: c.combinedReturn,
    marginReq: c.combinedMarginReq,
    accountValue: c.combinedAccountValue,
    strategyName: 'Combined',
  }))

  // Calculate portfolio stats
  const portfolioStats = calculateEquityCurveStats(combinedEntries)

  // Calculate stats for each component
  const componentStats: Record<string, PortfolioStats> = {}
  Object.entries(componentCurves).forEach(([name, entries]) => {
    componentStats[name] = calculateEquityCurveStats(entries)
  })

  return {
    combinedEquityCurve: combined,
    portfolioStats,
    componentStats,
    dateRange: {
      start: alignedDates[0],
      end: alignedDates[alignedDates.length - 1],
    },
    alignmentWarnings: warnings,
  }
}
