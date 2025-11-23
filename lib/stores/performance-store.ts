import { create } from 'zustand'
import { Trade } from '@/lib/models/trade'
import { DailyLogEntry } from '@/lib/models/daily-log'
import { EquityCurveEntry } from '@/lib/models/equity-curve'
import { PortfolioStats } from '@/lib/models/portfolio-stats'
import {
  buildPerformanceSnapshot,
  SnapshotFilters,
  SnapshotChartData
} from '@/lib/services/performance-snapshot'
import { buildEquityCurveSnapshot, EquityCurveChartData } from '@/lib/calculations/equity-curve-stats'

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
  dailyLogs: DailyLogEntry[]
  allDailyLogs: DailyLogEntry[]
  portfolioStats: PortfolioStats | null
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
    set({ isLoading: true, error: null })

    try {
      const { getBlock, getTradesByBlock, getDailyLogsByBlock, getEquityCurvesByBlock } = await import('@/lib/db')
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
        // Load trade-based data
        const [trades, dailyLogs] = await Promise.all([
          getTradesByBlock(blockId),
          getDailyLogsByBlock(blockId)
        ])

        const state = get()
        const filters = buildSnapshotFilters(state.dateRange, state.selectedStrategies)
        const snapshot = await buildPerformanceSnapshot({
          trades,
          dailyLogs,
          filters,
          riskFreeRate: 2.0,
          normalizeTo1Lot: state.normalizeTo1Lot
        })

        set({
          data: {
            blockType: 'trade-based',
            trades: snapshot.filteredTrades,
            allTrades: trades,
            dailyLogs: snapshot.filteredDailyLogs,
            allDailyLogs: dailyLogs,
            portfolioStats: snapshot.portfolioStats,
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
      // For trade-based blocks, use existing logic
      const filters = buildSnapshotFilters(dateRange, selectedStrategies)

      const snapshot = await buildPerformanceSnapshot({
        trades: data.allTrades,
        dailyLogs: data.allDailyLogs,
        filters,
        riskFreeRate: 2.0,
        normalizeTo1Lot
      })

      set(state => ({
        data: state.data && state.data.blockType === 'trade-based' ? {
          ...state.data,
          trades: snapshot.filteredTrades,
          dailyLogs: snapshot.filteredDailyLogs,
          portfolioStats: snapshot.portfolioStats,
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
