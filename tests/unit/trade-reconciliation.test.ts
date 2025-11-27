import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import type { StoredReportingTrade } from '@/lib/db/reporting-logs-store'
import type { StoredTrade } from '@/lib/db/trades-store'
import type { ReportingTrade } from '@/lib/models/reporting-trade'
import type { StrategyAlignment } from '@/lib/models/strategy-alignment'
import type { Trade } from '@/lib/models/trade'
import { buildTradeReconciliation } from '@/lib/services/trade-reconciliation'

jest.mock('@/lib/db', () => ({
  getTradesByBlock: jest.fn(),
  getReportingTradesByBlock: jest.fn(),
}))

const { getTradesByBlock, getReportingTradesByBlock } = jest.requireMock('@/lib/db') as {
  getTradesByBlock: jest.MockedFunction<(blockId: string) => Promise<StoredTrade[]>>
  getReportingTradesByBlock: jest.MockedFunction<(blockId: string) => Promise<StoredReportingTrade[]>>
}

describe('trade reconciliation matching', () => {
  const alignment: StrategyAlignment = {
    id: 'alignment-1',
    liveStrategies: ['Live Strategy'],
    reportingStrategies: ['Backtest Strategy'],
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  }

  const buildBacktestedTrade = (overrides: Partial<Trade> = {}): Trade => ({
    dateOpened: new Date('2025-09-17'),
    timeOpened: '09:35:00',
    openingPrice: 100,
    legs: 'SPY 0DTE',
    premium: 655,
    pl: 211.91,
    numContracts: 1,
    fundsAtClose: 100000,
    marginReq: 5000,
    strategy: 'Live Strategy',
    openingCommissionsFees: 0,
    closingCommissionsFees: 0,
    openingShortLongRatio: 0,
    ...overrides,
  })

  const buildReportedTrade = (overrides: Partial<ReportingTrade> = {}): ReportingTrade => ({
    strategy: 'Backtest Strategy',
    dateOpened: new Date('2025-09-17T09:35:00'),
    openingPrice: 100,
    legs: 'SPY 0DTE',
    initialPremium: 655,
    numContracts: 1,
    pl: 211.91,
    ...overrides,
  })

  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('should auto match trades that share a session even when time parsing shifts the Date backward by timezone', async () => {
    const backtestedTrade = buildBacktestedTrade()
    const reportedTrade = buildReportedTrade()

    getTradesByBlock.mockResolvedValue([{ ...backtestedTrade, blockId: 'block-1' }])
    getReportingTradesByBlock.mockResolvedValue([
      { ...reportedTrade, blockId: 'block-1' },
    ])

    const result = await buildTradeReconciliation('block-1', [alignment])
    const [alignedSet] = result.alignments

    const expectedBacktestedId = [
      backtestedTrade.strategy,
      backtestedTrade.dateOpened.toISOString(),
      backtestedTrade.timeOpened,
      backtestedTrade.numContracts,
      Number(backtestedTrade.pl.toFixed(2)),
    ].join('|')

    const expectedReportedId = [
      reportedTrade.strategy,
      reportedTrade.dateOpened.toISOString(),
      'na',
      reportedTrade.numContracts,
      Number(reportedTrade.pl.toFixed(2)),
    ].join('|')

    expect(alignedSet.autoSelectedBacktestedIds).toContain(expectedBacktestedId)
    expect(alignedSet.autoSelectedReportedIds).toContain(expectedReportedId)
    expect(alignedSet.sessions).toHaveLength(1)

    const [session] = alignedSet.sessions
    expect(session.session).toBe('2025-09-17')

    const [item] = session.items
    expect(item.backtested?.id).toBe(expectedBacktestedId)
    expect(item.reported?.id).toBe(expectedReportedId)
    expect(item.autoBacktested).toBe(true)
    expect(item.autoReported).toBe(true)
  })

  it('should match calls with calls and puts with puts when trades occur simultaneously', async () => {
    // Simulate MEIC strategy with concurrent Call and Put spreads
    const backtestedCallTrade = buildBacktestedTrade({
      dateOpened: new Date('2025-05-16'),
      timeOpened: '09:32:00',
      legs: '1 May 16 5960 C STO 2.88 | 1 May 16 6040 C BTO 0.15',
      premium: 273,
      pl: -285.12,
      numContracts: 1,
    })

    const backtestedPutTrade = buildBacktestedTrade({
      dateOpened: new Date('2025-05-16'),
      timeOpened: '09:32:00',
      legs: '2 May 16 5875 P STO 3.00 | 2 May 16 5795 P BTO 0.32',
      premium: 536,
      pl: 344.44,
      numContracts: 2,
    })

    const reportedPutTrade = buildReportedTrade({
      dateOpened: new Date('2025-05-16T09:32:14'),
      legs: '2 May 16 5875 P STO 3.80 | 2 May 16 5795 P BTO 0.32',
      initialPremium: 3.48,
      numContracts: 2,
      pl: 688.87,
    })

    const reportedCallTrade = buildReportedTrade({
      dateOpened: new Date('2025-05-16T09:32:14'),
      legs: '2 May 16 5960 C STO 2.74 | 2 May 16 6040 C BTO 0.12',
      initialPremium: 2.62,
      numContracts: 2,
      pl: -356.25,
    })

    getTradesByBlock.mockResolvedValue([
      { ...backtestedCallTrade, blockId: 'block-1' },
      { ...backtestedPutTrade, blockId: 'block-1' },
    ])
    getReportingTradesByBlock.mockResolvedValue([
      { ...reportedPutTrade, blockId: 'block-1' },
      { ...reportedCallTrade, blockId: 'block-1' },
    ])

    const result = await buildTradeReconciliation('block-1', [alignment])
    const [alignedSet] = result.alignments

    // Should have 2 sessions with 2 matched pairs each
    expect(alignedSet.sessions).toHaveLength(1)
    const [session] = alignedSet.sessions
    expect(session.items).toHaveLength(2)

    // Find the Call pair and Put pair
    const callItem = session.items.find(item => item.backtested?.legs?.includes(' C '))
    const putItem = session.items.find(item => item.backtested?.legs?.includes(' P '))

    // Verify Call matched with Call
    expect(callItem).toBeDefined()
    expect(callItem?.backtested?.legs).toContain(' C ')
    expect(callItem?.reported?.legs).toContain(' C ')

    // Verify Put matched with Put
    expect(putItem).toBeDefined()
    expect(putItem?.backtested?.legs).toContain(' P ')
    expect(putItem?.reported?.legs).toContain(' P ')
  })
})
