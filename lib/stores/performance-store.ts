import { DailyLogEntry } from '@/lib/models/daily-log'
import { EquityCurveEntry } from '@/lib/models/equity-curve'
import { PortfolioStats } from '@/lib/models/portfolio-stats'
import { Trade } from '@/lib/models/trade'
import {
  buildPerformanceSnapshot,
  SnapshotChartData,
  SnapshotFilters
} from '@/lib/services/performance-snapshot'
import { buildEquityCurveSnapshot, EquityCurveChartData } from '@/lib/calculations/equity-curve-stats'
import {
  deriveGroupedLegOutcomes,
  GroupedLegOutcomes
} from '@/lib/utils/performance-helpers'
import { create } from 'zustand'

// Re-export types from helper
export type { GroupedLegEntry, GroupedLegOutcomes, GroupedLegSummary, GroupedOutcome } from '@/lib/utils/performance-helpers'

export interface DateRange {
  from: Date | undefined
  to: Date | undefined
}

export interface ChartSettings {
  equityScale: 'linear' | 'log'
  showDrawdownAreas: boolean
  showTrend: boolean
  maWindow: number
  rollingMetricType: 'win_rate' | 'sharpe' | 'profit_factor'
}

export interface TradeBasedPerformanceData extends SnapshotChartData {
  blockType: 'trade-based'
  trades: Trade[]
  allTrades: Trade[]
  allRawTrades: Trade[]
  dailyLogs: DailyLogEntry[]
  allDailyLogs: DailyLogEntry[]
  portfolioStats: PortfolioStats | null
  groupedLegOutcomes: GroupedLegOutcomes | null
}

export interface EquityCurvePerformanceData extends EquityCurveChartData {
  blockType: 'equity-curve'
  equityCurveEntries: EquityCurveEntry[]
  allEquityCurveEntries: EquityCurveEntry[]
  portfolioStats: PortfolioStats | null
}

export type PerformanceData = TradeBasedPerformanceData | EquityCurvePerformanceData

interface PerformanceStore {
  isLoading: boolean
  error: string | null
  dateRange: DateRange
  selectedStrategies: string[]
  data: PerformanceData | null
  chartSettings: ChartSettings
  normalizeTo1Lot: boolean
  setDateRange: (dateRange: DateRange) => void
  setSelectedStrategies: (strategies: string[]) => void
  updateChartSettings: (settings: Partial<ChartSettings>) => void
  fetchPerformanceData: (blockId: string) => Promise<void>
  applyFilters: () => Promise<void>
  setNormalizeTo1Lot: (value: boolean) => void
  reset: () => void
}

const initialDateRange: DateRange = {
  from: undefined,
  to: undefined
}

const initialChartSettings: ChartSettings = {
  equityScale: 'linear',
  showDrawdownAreas: true,
  showTrend: true,
  maWindow: 30,
  rollingMetricType: 'win_rate'
}

function buildSnapshotFilters(dateRange: DateRange, strategies: string[]): SnapshotFilters {
  const filters: SnapshotFilters = {}

  if (dateRange.from || dateRange.to) {
    filters.dateRange = {
      from: dateRange.from,
      to: dateRange.to
    }
  }

  if (strategies.length > 0) {
    filters.strategies = strategies
  }

  return filters
}

// Selecting every available strategy should behave the same as selecting none.
// This prevents "(Select All)" in the UI from acting like a restrictive filter
// and keeps the output aligned with the default "All Strategies" view.
function normalizeStrategyFilter(selected: string[], trades?: Trade[]): string[] {
  if (!trades || selected.length === 0) return selected

  const uniqueStrategies = new Set(trades.map(trade => trade.strategy || 'Unknown'))

  // If the user picked every strategy we know about, drop the filter so the
  // snapshot uses the full data set (identical to the default state).
  return selected.length === uniqueStrategies.size ? [] : selected
}

export const usePerformanceStore = create<PerformanceStore>((set, get) => ({
  isLoading: false,
  error: null,
  dateRange: initialDateRange,
  selectedStrategies: [],
  data: null,
  chartSettings: initialChartSettings,
  normalizeTo1Lot: false,

  setDateRange: (dateRange) => {
    set({ dateRange })
    get().applyFilters().catch(console.error)
  },

  setSelectedStrategies: (selectedStrategies) => {
    set({ selectedStrategies })
    get().applyFilters().catch(console.error)
  },

  updateChartSettings: (settings) => {
    set(state => ({
      chartSettings: { ...state.chartSettings, ...settings }
    }))
  },

  setNormalizeTo1Lot: (value) => {
    set({ normalizeTo1Lot: value })
    get().applyFilters().catch(console.error)
  },

  fetchPerformanceData: async (blockId: string) => {
    // Clear existing data to avoid showing the previous block's charts while loading the new one
    set({ isLoading: true, error: null, data: null })

    try {
      const {
        getTradesByBlockWithOptions,
        getTradesByBlock,
        getDailyLogsByBlock,
        getEquityCurvesByBlock,
        getBlock,
        getPerformanceSnapshotCache
      } = await import('@/lib/db')
      const { isGenericBlock } = await import('@/lib/models/block')

      // Get the block to determine its type
      const block = await getBlock(blockId)
      if (!block) {
        throw new Error('Block not found')
      }

      if (isGenericBlock(block)) {
        // Load equity curve data
        const equityCurveEntries = await getEquityCurvesByBlock(blockId)

        // TODO: Apply date range filters when implemented
        // For now, use all entries
        const filteredEntries = equityCurveEntries

        const snapshot = buildEquityCurveSnapshot(filteredEntries, 2.0)

        set({
          data: {
            blockType: 'equity-curve',
            equityCurveEntries: filteredEntries,
            allEquityCurveEntries: equityCurveEntries,
            portfolioStats: snapshot.portfolioStats,
            ...snapshot.chartData
          },
          isLoading: false
        })
      } else {
        // Load trade-based data with caching and combineLegGroups support
        const combineLegGroups = block.analysisConfig?.combineLegGroups ?? false

        const state = get()
        const riskFreeRate = 2.0

        // Check if we can use cached snapshot (default view with no filters)
        const isDefaultView =
          !state.dateRange.from &&
          !state.dateRange.to &&
          state.selectedStrategies.length === 0 &&
          !state.normalizeTo1Lot &&
          riskFreeRate === 2.0 // explicit parity with block-stats page default

        if (isDefaultView) {
          const cachedSnapshot = await getPerformanceSnapshotCache(blockId)
          if (cachedSnapshot) {
            // Use cached data - much faster!
            // Still need raw trades for groupedLegOutcomes
            const rawTrades = await getTradesByBlock(blockId)
            const groupedLegOutcomes = deriveGroupedLegOutcomes(rawTrades)

            set({
              data: {
                blockType: 'trade-based',
                trades: cachedSnapshot.filteredTrades,
                allTrades: cachedSnapshot.filteredTrades,
                allRawTrades: rawTrades,
                dailyLogs: cachedSnapshot.filteredDailyLogs,
                allDailyLogs: cachedSnapshot.filteredDailyLogs,
                portfolioStats: cachedSnapshot.portfolioStats,
                groupedLegOutcomes,
                ...cachedSnapshot.chartData
              },
              isLoading: false
            })
            return
          }
        }

        // Cache miss or filters applied - compute normally
        const rawTrades = await getTradesByBlock(blockId)
        const trades = combineLegGroups
          ? await getTradesByBlockWithOptions(blockId, { combineLegGroups })
          : rawTrades
        const dailyLogs = await getDailyLogsByBlock(blockId)

        const updatedNormalizedStrategies = normalizeStrategyFilter(state.selectedStrategies, trades)
        const updatedFilters = buildSnapshotFilters(state.dateRange, updatedNormalizedStrategies)
        const snapshot = await buildPerformanceSnapshot({
          trades,
          dailyLogs,
          filters: updatedFilters,
          riskFreeRate: 2.0,
          normalizeTo1Lot: state.normalizeTo1Lot
        })

        const filteredRawTrades = filterTradesForSnapshot(rawTrades, updatedFilters)
        const groupedLegOutcomes = deriveGroupedLegOutcomes(filteredRawTrades)

        set({
          data: {
            blockType: 'trade-based',
            trades: snapshot.filteredTrades,
            allTrades: trades,
            allRawTrades: rawTrades,
            dailyLogs: snapshot.filteredDailyLogs,
            allDailyLogs: dailyLogs,
            portfolioStats: snapshot.portfolioStats,
            groupedLegOutcomes,
            ...snapshot.chartData
          },
          isLoading: false
        })
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load performance data',
        isLoading: false
      })
    }
  },

  applyFilters: async () => {
    const { data, dateRange, selectedStrategies, normalizeTo1Lot } = get()
    if (!data) return

    if (data.blockType === 'equity-curve') {
      // For equity curves, apply date range filter
      let filteredEntries = data.allEquityCurveEntries

      if (dateRange.from || dateRange.to) {
        filteredEntries = filteredEntries.filter(entry => {
          const entryDate = entry.date
          if (dateRange.from && entryDate < dateRange.from) return false
          if (dateRange.to && entryDate > dateRange.to) return false
          return true
        })
      }

      // Filter by strategy name if applicable
      if (selectedStrategies.length > 0) {
        filteredEntries = filteredEntries.filter(entry =>
          selectedStrategies.includes(entry.strategyName)
        )
      }

      const snapshot = buildEquityCurveSnapshot(filteredEntries, 2.0)

      set(state => ({
        data: state.data && state.data.blockType === 'equity-curve' ? {
          ...state.data,
          equityCurveEntries: filteredEntries,
          portfolioStats: snapshot.portfolioStats,
          ...snapshot.chartData
        } : state.data
      }))
    } else {
      // For trade-based blocks, use normalized filters and groupedLegOutcomes
      const normalizedStrategies = normalizeStrategyFilter(selectedStrategies, data.allTrades)
      const filters = buildSnapshotFilters(dateRange, normalizedStrategies)

      const snapshot = await buildPerformanceSnapshot({
        trades: data.allTrades,
        dailyLogs: data.allDailyLogs,
        filters,
        riskFreeRate: 2.0,
        normalizeTo1Lot
      })

      const filteredRawTrades = filterTradesForSnapshot(data.allRawTrades, filters)

      set(state => ({
        data: state.data && state.data.blockType === 'trade-based' ? {
          ...state.data,
          trades: snapshot.filteredTrades,
          dailyLogs: snapshot.filteredDailyLogs,
          portfolioStats: snapshot.portfolioStats,
          groupedLegOutcomes: deriveGroupedLegOutcomes(filteredRawTrades),
          ...snapshot.chartData
        } : state.data
      }))
    }
  },

  reset: () => {
    set({
      isLoading: false,
      error: null,
      dateRange: initialDateRange,
      selectedStrategies: [],
      data: null,
      chartSettings: initialChartSettings,
      normalizeTo1Lot: false
    })
  }
}))

// Re-export for existing unit tests that rely on chart processing helpers
export { processChartData } from '@/lib/services/performance-snapshot'

function filterTradesForSnapshot(trades: Trade[], filters: SnapshotFilters): Trade[] {
  let filtered = [...trades]

  if (filters.dateRange?.from || filters.dateRange?.to) {
    filtered = filtered.filter(trade => {
      const tradeDate = new Date(trade.dateOpened)
      if (filters.dateRange?.from && tradeDate < filters.dateRange.from) return false
      if (filters.dateRange?.to && tradeDate > filters.dateRange.to) return false
      return true
    })
  }

  if (filters.strategies && filters.strategies.length > 0) {
    const allowed = new Set(filters.strategies)
    filtered = filtered.filter(trade => allowed.has(trade.strategy || 'Unknown'))
  }

  return filtered
}
