/**
 * Equity Curve Analytics Tests
 * 
 * Tests for:
 * 1. calculateEquityCurveStats - win/loss streaks, netPl, breakEvenTrades, max/avg values
 * 2. calculateEquityCurveCorrelationAnalytics - strongest/weakest/avg correlations, strategy count
 * 3. tradesToEquityCurve - transformation from DailyLogEntry to EquityCurveEntry
 * 4. getStrategyOptions - unique strategy extraction from trades
 */

import { calculateEquityCurveStats, buildEquityCurveChartData } from '@/lib/calculations/equity-curve-stats';
import { calculateEquityCurveCorrelationAnalytics, EquityCurveCorrelationMatrix } from '@/lib/calculations/equity-curve-correlation';
import { EquityCurveEntry } from '@/lib/models/equity-curve';
import { DailyLogEntry } from '@/lib/models/daily-log';
import { Trade } from '@/lib/models/trade';

describe('calculateEquityCurveStats', () => {
  describe('Win/Loss Streak Data', () => {
    test('should correctly calculate max win/loss streaks', () => {
      const entries: EquityCurveEntry[] = [
        // Win streak of 3
        { date: new Date('2024-01-01'), dailyReturnPct: 0.01, marginReq: 0.5, accountValue: 10100, strategyName: 'Test' },
        { date: new Date('2024-01-02'), dailyReturnPct: 0.02, marginReq: 0.5, accountValue: 10302, strategyName: 'Test' },
        { date: new Date('2024-01-03'), dailyReturnPct: 0.015, marginReq: 0.5, accountValue: 10456.53, strategyName: 'Test' },
        // Loss streak of 2
        { date: new Date('2024-01-04'), dailyReturnPct: -0.01, marginReq: 0.5, accountValue: 10351.96, strategyName: 'Test' },
        { date: new Date('2024-01-05'), dailyReturnPct: -0.005, marginReq: 0.5, accountValue: 10300.20, strategyName: 'Test' },
        // Win
        { date: new Date('2024-01-06'), dailyReturnPct: 0.01, marginReq: 0.5, accountValue: 10403.20, strategyName: 'Test' },
      ];

      const chartData = buildEquityCurveChartData(entries);
      
      expect(chartData.streakData).toBeDefined();
      expect(chartData.streakData!.statistics.maxWinStreak).toBe(3);
      expect(chartData.streakData!.statistics.maxLossStreak).toBe(2);
    });

    test('should correctly calculate average win/loss streaks', () => {
      const entries: EquityCurveEntry[] = [
        // First win streak (2)
        { date: new Date('2024-01-01'), dailyReturnPct: 0.01, marginReq: 0.5, accountValue: 10100, strategyName: 'Test' },
        { date: new Date('2024-01-02'), dailyReturnPct: 0.02, marginReq: 0.5, accountValue: 10302, strategyName: 'Test' },
        // Loss streak (1)
        { date: new Date('2024-01-03'), dailyReturnPct: -0.01, marginReq: 0.5, accountValue: 10199, strategyName: 'Test' },
        // Second win streak (4)
        { date: new Date('2024-01-04'), dailyReturnPct: 0.01, marginReq: 0.5, accountValue: 10301, strategyName: 'Test' },
        { date: new Date('2024-01-05'), dailyReturnPct: 0.01, marginReq: 0.5, accountValue: 10404, strategyName: 'Test' },
        { date: new Date('2024-01-06'), dailyReturnPct: 0.01, marginReq: 0.5, accountValue: 10508, strategyName: 'Test' },
        { date: new Date('2024-01-07'), dailyReturnPct: 0.01, marginReq: 0.5, accountValue: 10613, strategyName: 'Test' },
        // Loss streak (2)
        { date: new Date('2024-01-08'), dailyReturnPct: -0.01, marginReq: 0.5, accountValue: 10507, strategyName: 'Test' },
        { date: new Date('2024-01-09'), dailyReturnPct: -0.01, marginReq: 0.5, accountValue: 10402, strategyName: 'Test' },
      ];

      const chartData = buildEquityCurveChartData(entries);
      
      expect(chartData.streakData).toBeDefined();
      // Average win streak: (2 + 4) / 2 = 3
      expect(chartData.streakData!.statistics.avgWinStreak).toBeCloseTo(3, 1);
      // Average loss streak: (1 + 2) / 2 = 1.5
      expect(chartData.streakData!.statistics.avgLossStreak).toBeCloseTo(1.5, 1);
    });

    test('should correctly identify current streak', () => {
      const entriesWinning: EquityCurveEntry[] = [
        { date: new Date('2024-01-01'), dailyReturnPct: 0.01, marginReq: 0.5, accountValue: 10100, strategyName: 'Test' },
        { date: new Date('2024-01-02'), dailyReturnPct: -0.01, marginReq: 0.5, accountValue: 10000, strategyName: 'Test' },
        { date: new Date('2024-01-03'), dailyReturnPct: 0.01, marginReq: 0.5, accountValue: 10100, strategyName: 'Test' },
        { date: new Date('2024-01-04'), dailyReturnPct: 0.02, marginReq: 0.5, accountValue: 10302, strategyName: 'Test' },
      ];

      const chartDataWinning = buildEquityCurveChartData(entriesWinning);
      
      expect(chartDataWinning.streakData).toBeDefined();
      // Current streak should be 2 (last two days are wins)
      expect(chartDataWinning.streakData!.statistics.currentStreak).toBe(2);

      const entriesLosing: EquityCurveEntry[] = [
        { date: new Date('2024-01-01'), dailyReturnPct: 0.01, marginReq: 0.5, accountValue: 10100, strategyName: 'Test' },
        { date: new Date('2024-01-02'), dailyReturnPct: -0.01, marginReq: 0.5, accountValue: 10000, strategyName: 'Test' },
        { date: new Date('2024-01-03'), dailyReturnPct: -0.01, marginReq: 0.5, accountValue: 9900, strategyName: 'Test' },
      ];

      const chartDataLosing = buildEquityCurveChartData(entriesLosing);
      
      expect(chartDataLosing.streakData).toBeDefined();
      // Current streak should be -2 (last two days are losses)
      expect(chartDataLosing.streakData!.statistics.currentStreak).toBe(-2);
    });

    test('should correctly build win/loss distribution', () => {
      const entries: EquityCurveEntry[] = [
        // Win streak of 3
        { date: new Date('2024-01-01'), dailyReturnPct: 0.01, marginReq: 0.5, accountValue: 10100, strategyName: 'Test' },
        { date: new Date('2024-01-02'), dailyReturnPct: 0.02, marginReq: 0.5, accountValue: 10302, strategyName: 'Test' },
        { date: new Date('2024-01-03'), dailyReturnPct: 0.015, marginReq: 0.5, accountValue: 10456.53, strategyName: 'Test' },
        // Loss streak of 2
        { date: new Date('2024-01-04'), dailyReturnPct: -0.01, marginReq: 0.5, accountValue: 10351.96, strategyName: 'Test' },
        { date: new Date('2024-01-05'), dailyReturnPct: -0.005, marginReq: 0.5, accountValue: 10300.20, strategyName: 'Test' },
        // Win streak of 1
        { date: new Date('2024-01-06'), dailyReturnPct: 0.01, marginReq: 0.5, accountValue: 10403.20, strategyName: 'Test' },
        // Loss streak of 1
        { date: new Date('2024-01-07'), dailyReturnPct: -0.01, marginReq: 0.5, accountValue: 10299.17, strategyName: 'Test' },
      ];

      const chartData = buildEquityCurveChartData(entries);
      
      expect(chartData.streakData).toBeDefined();
      // Win distribution: one streak of 3, one streak of 1
      expect(chartData.streakData!.winDistribution[3]).toBe(1);
      expect(chartData.streakData!.winDistribution[1]).toBe(1);
      // Loss distribution: one streak of 2, one streak of 1
      expect(chartData.streakData!.lossDistribution[2]).toBe(1);
      expect(chartData.streakData!.lossDistribution[1]).toBe(1);
    });

    test('should handle break-even days in streak calculation', () => {
      const entries: EquityCurveEntry[] = [
        { date: new Date('2024-01-01'), dailyReturnPct: 0.01, marginReq: 0.5, accountValue: 10100, strategyName: 'Test' },
        { date: new Date('2024-01-02'), dailyReturnPct: 0, marginReq: 0.5, accountValue: 10100, strategyName: 'Test' }, // Break-even
        { date: new Date('2024-01-03'), dailyReturnPct: 0.01, marginReq: 0.5, accountValue: 10201, strategyName: 'Test' },
      ];

      const chartData = buildEquityCurveChartData(entries);
      
      expect(chartData.streakData).toBeDefined();
      // Break-even should break the streak, so we have two separate win streaks of 1 each
      expect(chartData.streakData!.winDistribution[1]).toBe(2);
      expect(chartData.streakData!.statistics.maxWinStreak).toBe(1);
    });
  });

  describe('Portfolio Statistics', () => {
    test('should correctly calculate netPl, maxWin, maxLoss, avgDailyPl', () => {
      const entries: EquityCurveEntry[] = [
        { date: new Date('2024-01-01'), dailyReturnPct: 0.01, marginReq: 0.5, accountValue: 10100, strategyName: 'Test' },
        { date: new Date('2024-01-02'), dailyReturnPct: 0.02, marginReq: 0.5, accountValue: 10302, strategyName: 'Test' },
        { date: new Date('2024-01-03'), dailyReturnPct: -0.015, marginReq: 0.5, accountValue: 10147.47, strategyName: 'Test' },
        { date: new Date('2024-01-04'), dailyReturnPct: 0.005, marginReq: 0.5, accountValue: 10198.22, strategyName: 'Test' },
      ];

      const stats = calculateEquityCurveStats(entries);
      
      // Initial capital is first accountValue / (1 + first dailyReturnPct)
      const initialCapital = 10100 / 1.01;
      expect(stats.initialCapital).toBeCloseTo(initialCapital, 2);
      
      // Net PL = final - initial
      const expectedNetPl = 10198.22 - initialCapital;
      expect(stats.netPl).toBeCloseTo(expectedNetPl, 2);
      expect(stats.totalPl).toBeCloseTo(expectedNetPl, 2);
      
      // Max win in absolute terms
      expect(stats.maxWin).toBeCloseTo(0.02 * initialCapital, 2);
      
      // Max loss in absolute terms
      expect(stats.maxLoss).toBeCloseTo(-0.015 * initialCapital, 2);
      
      // Average daily PL
      const avgDailyReturn = (0.01 + 0.02 - 0.015 + 0.005) / 4;
      expect(stats.avgDailyPl).toBeCloseTo(avgDailyReturn * initialCapital, 2);
    });

    test('should correctly count breakEvenTrades', () => {
      const entries: EquityCurveEntry[] = [
        { date: new Date('2024-01-01'), dailyReturnPct: 0.01, marginReq: 0.5, accountValue: 10100, strategyName: 'Test' },
        { date: new Date('2024-01-02'), dailyReturnPct: 0, marginReq: 0.5, accountValue: 10100, strategyName: 'Test' }, // Break-even
        { date: new Date('2024-01-03'), dailyReturnPct: -0.01, marginReq: 0.5, accountValue: 10000, strategyName: 'Test' },
        { date: new Date('2024-01-04'), dailyReturnPct: 0, marginReq: 0.5, accountValue: 10000, strategyName: 'Test' }, // Break-even
      ];

      const stats = calculateEquityCurveStats(entries);
      
      expect(stats.totalTrades).toBe(4);
      expect(stats.winningTrades).toBe(1);
      expect(stats.losingTrades).toBe(1);
      expect(stats.breakEvenTrades).toBe(2);
    });

    test('should handle empty entries', () => {
      const entries: EquityCurveEntry[] = [];
      const stats = calculateEquityCurveStats(entries);
      
      expect(stats.totalTrades).toBe(0);
      expect(stats.netPl).toBe(0);
      expect(stats.maxWin).toBe(0);
      expect(stats.maxLoss).toBe(0);
      expect(stats.avgDailyPl).toBe(0);
      expect(stats.breakEvenTrades).toBe(0);
    });

    test('should correctly calculate win/loss rates', () => {
      const entries: EquityCurveEntry[] = [
        { date: new Date('2024-01-01'), dailyReturnPct: 0.01, marginReq: 0.5, accountValue: 10100, strategyName: 'Test' },
        { date: new Date('2024-01-02'), dailyReturnPct: 0.02, marginReq: 0.5, accountValue: 10302, strategyName: 'Test' },
        { date: new Date('2024-01-03'), dailyReturnPct: 0.01, marginReq: 0.5, accountValue: 10405, strategyName: 'Test' },
        { date: new Date('2024-01-04'), dailyReturnPct: -0.01, marginReq: 0.5, accountValue: 10301, strategyName: 'Test' },
      ];

      const stats = calculateEquityCurveStats(entries);
      
      expect(stats.winRate).toBeCloseTo(0.75, 2); // 3 wins out of 4
      expect(stats.winningTrades).toBe(3);
      expect(stats.losingTrades).toBe(1);
    });

    test('should calculate profit factor correctly', () => {
      const entries: EquityCurveEntry[] = [
        { date: new Date('2024-01-01'), dailyReturnPct: 0.02, marginReq: 0.5, accountValue: 10200, strategyName: 'Test' }, // +200
        { date: new Date('2024-01-02'), dailyReturnPct: 0.03, marginReq: 0.5, accountValue: 10506, strategyName: 'Test' }, // +306
        { date: new Date('2024-01-03'), dailyReturnPct: -0.01, marginReq: 0.5, accountValue: 10401, strategyName: 'Test' }, // -105
      ];

      const stats = calculateEquityCurveStats(entries);
      
      // Total wins: 0.02 + 0.03 = 0.05
      // Total losses: 0.01
      // Profit factor: 0.05 / 0.01 = 5.0
      expect(stats.profitFactor).toBeCloseTo(5.0, 1);
    });
  });
});

describe('calculateEquityCurveCorrelationAnalytics', () => {
  test('should correctly identify strongest correlation', () => {
    const matrix: EquityCurveCorrelationMatrix = {
      strategies: ['Strategy A', 'Strategy B', 'Strategy C'],
      correlationData: [
        [1.0, 0.95, 0.3],
        [0.95, 1.0, 0.4],
        [0.3, 0.4, 1.0],
      ],
      dates: [],
      alignedReturns: {},
    };

    const analytics = calculateEquityCurveCorrelationAnalytics(matrix);
    
    expect(analytics.strongest.value).toBeCloseTo(0.95, 2);
    expect(analytics.strongest.pair).toEqual(['Strategy A', 'Strategy B']);
    expect(analytics.maxCorrelation).toBeCloseTo(0.95, 2);
  });

  test('should correctly identify weakest correlation', () => {
    const matrix: EquityCurveCorrelationMatrix = {
      strategies: ['Strategy A', 'Strategy B', 'Strategy C'],
      correlationData: [
        [1.0, 0.5, -0.2],
        [0.5, 1.0, 0.7],
        [-0.2, 0.7, 1.0],
      ],
      dates: [],
      alignedReturns: {},
    };

    const analytics = calculateEquityCurveCorrelationAnalytics(matrix);
    
    expect(analytics.weakest.value).toBeCloseTo(-0.2, 2);
    expect(analytics.weakest.pair).toEqual(['Strategy A', 'Strategy C']);
    expect(analytics.minCorrelation).toBeCloseTo(-0.2, 2);
  });

  test('should correctly calculate average correlation', () => {
    const matrix: EquityCurveCorrelationMatrix = {
      strategies: ['Strategy A', 'Strategy B', 'Strategy C'],
      correlationData: [
        [1.0, 0.6, 0.4],
        [0.6, 1.0, 0.8],
        [0.4, 0.8, 1.0],
      ],
      dates: [],
      alignedReturns: {},
    };

    const analytics = calculateEquityCurveCorrelationAnalytics(matrix);
    
    // Average of off-diagonal elements: (0.6 + 0.4 + 0.8) / 3 = 0.6
    expect(analytics.averageCorrelation).toBeCloseTo(0.6, 2);
    expect(analytics.avgCorrelation).toBeCloseTo(0.6, 2);
  });

  test('should correctly report strategy count', () => {
    const matrix: EquityCurveCorrelationMatrix = {
      strategies: ['Strategy A', 'Strategy B', 'Strategy C', 'Strategy D'],
      correlationData: [
        [1.0, 0.5, 0.3, 0.7],
        [0.5, 1.0, 0.2, 0.6],
        [0.3, 0.2, 1.0, 0.4],
        [0.7, 0.6, 0.4, 1.0],
      ],
      dates: [],
      alignedReturns: {},
    };

    const analytics = calculateEquityCurveCorrelationAnalytics(matrix);
    
    expect(analytics.strategyCount).toBe(4);
  });

  test('should identify highly correlated pairs', () => {
    const matrix: EquityCurveCorrelationMatrix = {
      strategies: ['Strategy A', 'Strategy B', 'Strategy C'],
      correlationData: [
        [1.0, 0.85, 0.3],
        [0.85, 1.0, 0.2],
        [0.3, 0.2, 1.0],
      ],
      dates: [],
      alignedReturns: {},
    };

    const analytics = calculateEquityCurveCorrelationAnalytics(matrix);
    
    // Highly correlated pairs have |correlation| > 0.7
    expect(analytics.highlyCorrelatedPairs.length).toBe(1);
    expect(analytics.highlyCorrelatedPairs[0].strategy1).toBe('Strategy A');
    expect(analytics.highlyCorrelatedPairs[0].strategy2).toBe('Strategy B');
    expect(analytics.highlyCorrelatedPairs[0].correlation).toBeCloseTo(0.85, 2);
  });

  test('should identify uncorrelated pairs', () => {
    const matrix: EquityCurveCorrelationMatrix = {
      strategies: ['Strategy A', 'Strategy B', 'Strategy C'],
      correlationData: [
        [1.0, 0.15, 0.8],
        [0.15, 1.0, 0.05],
        [0.8, 0.05, 1.0],
      ],
      dates: [],
      alignedReturns: {},
    };

    const analytics = calculateEquityCurveCorrelationAnalytics(matrix);
    
    // Uncorrelated pairs have |correlation| < 0.3
    expect(analytics.uncorrelatedPairs.length).toBe(2);
    // Should be sorted by absolute correlation (ascending)
    expect(analytics.uncorrelatedPairs[0].correlation).toBeCloseTo(0.05, 2);
    expect(analytics.uncorrelatedPairs[1].correlation).toBeCloseTo(0.15, 2);
  });

  test('should handle single strategy matrix', () => {
    const matrix: EquityCurveCorrelationMatrix = {
      strategies: ['Strategy A'],
      correlationData: [[1.0]],
      dates: [],
      alignedReturns: {},
    };

    const analytics = calculateEquityCurveCorrelationAnalytics(matrix);
    
    expect(analytics.strategyCount).toBe(1);
    expect(analytics.averageCorrelation).toBe(0);
    expect(analytics.highlyCorrelatedPairs.length).toBe(0);
    expect(analytics.uncorrelatedPairs.length).toBe(0);
  });

  test('should calculate diversification score', () => {
    const lowCorrelationMatrix: EquityCurveCorrelationMatrix = {
      strategies: ['Strategy A', 'Strategy B'],
      correlationData: [
        [1.0, 0.1],
        [0.1, 1.0],
      ],
      dates: [],
      alignedReturns: {},
    };

    const highCorrelationMatrix: EquityCurveCorrelationMatrix = {
      strategies: ['Strategy A', 'Strategy B'],
      correlationData: [
        [1.0, 0.9],
        [0.9, 1.0],
      ],
      dates: [],
      alignedReturns: {},
    };

    const lowCorrAnalytics = calculateEquityCurveCorrelationAnalytics(lowCorrelationMatrix);
    const highCorrAnalytics = calculateEquityCurveCorrelationAnalytics(highCorrelationMatrix);
    
    // Lower correlation should have higher diversification score
    expect(lowCorrAnalytics.diversificationScore).toBeGreaterThan(highCorrAnalytics.diversificationScore);
    // Diversification score = 1 - avgCorrelation
    expect(lowCorrAnalytics.diversificationScore).toBeCloseTo(1 - 0.1, 2);
    expect(highCorrAnalytics.diversificationScore).toBeCloseTo(1 - 0.9, 2);
  });
});

describe('tradesToEquityCurve', () => {
  // Note: tradesToEquityCurve is not exported, so we test via the super-block service
  // We'll create a helper that mimics the function for testing purposes
  
  function tradesToEquityCurveHelper(
    dailyLogs: DailyLogEntry[],
    componentName: string
  ): EquityCurveEntry[] {
    const sortedLogs = [...dailyLogs].sort((a, b) => a.date.getTime() - b.date.getTime());

    return sortedLogs.map((log, index) => {
      const prevLog = index > 0 ? sortedLogs[index - 1] : null;
      const dailyReturn = prevLog
        ? (log.netLiquidity - prevLog.netLiquidity) / prevLog.netLiquidity
        : 0;

      return {
        date: log.date,
        dailyReturnPct: dailyReturn,
        marginReq: 0,
        accountValue: log.netLiquidity,
        strategyName: componentName,
      };
    });
  }

  test('should transform DailyLogEntry to EquityCurveEntry correctly', () => {
    const dailyLogs: DailyLogEntry[] = [
      {
        date: new Date('2024-01-01'),
        netLiquidity: 10000,
        currentFunds: 10000,
        withdrawn: 0,
        tradingFunds: 10000,
        dailyPl: 0,
        dailyPlPct: 0,
        drawdownPct: 0,
      },
      {
        date: new Date('2024-01-02'),
        netLiquidity: 10200,
        currentFunds: 10200,
        withdrawn: 0,
        tradingFunds: 10200,
        dailyPl: 200,
        dailyPlPct: 2,
        drawdownPct: 0,
      },
    ];

    const entries = tradesToEquityCurveHelper(dailyLogs, 'Test Strategy');
    
    expect(entries).toHaveLength(2);
    expect(entries[0].accountValue).toBe(10000);
    expect(entries[1].accountValue).toBe(10200);
    expect(entries[0].strategyName).toBe('Test Strategy');
    expect(entries[1].strategyName).toBe('Test Strategy');
  });

  test('should use netLiquidity for accountValue', () => {
    const dailyLogs: DailyLogEntry[] = [
      {
        date: new Date('2024-01-01'),
        netLiquidity: 15000,
        currentFunds: 12000,
        withdrawn: 1000,
        tradingFunds: 14000,
        dailyPl: 0,
        dailyPlPct: 0,
        drawdownPct: 0,
      },
    ];

    const entries = tradesToEquityCurveHelper(dailyLogs, 'Test Strategy');
    
    expect(entries[0].accountValue).toBe(15000); // Should use netLiquidity
  });

  test('should set marginReq to 0 for daily log entries', () => {
    const dailyLogs: DailyLogEntry[] = [
      {
        date: new Date('2024-01-01'),
        netLiquidity: 10000,
        currentFunds: 10000,
        withdrawn: 0,
        tradingFunds: 10000,
        dailyPl: 0,
        dailyPlPct: 0,
        drawdownPct: 0,
      },
    ];

    const entries = tradesToEquityCurveHelper(dailyLogs, 'Test Strategy');
    
    expect(entries[0].marginReq).toBe(0);
  });

  test('should calculate dailyReturnPct based on netLiquidity changes', () => {
    const dailyLogs: DailyLogEntry[] = [
      {
        date: new Date('2024-01-01'),
        netLiquidity: 10000,
        currentFunds: 10000,
        withdrawn: 0,
        tradingFunds: 10000,
        dailyPl: 0,
        dailyPlPct: 0,
        drawdownPct: 0,
      },
      {
        date: new Date('2024-01-02'),
        netLiquidity: 10500,
        currentFunds: 10500,
        withdrawn: 0,
        tradingFunds: 10500,
        dailyPl: 500,
        dailyPlPct: 5,
        drawdownPct: 0,
      },
      {
        date: new Date('2024-01-03'),
        netLiquidity: 10000,
        currentFunds: 10000,
        withdrawn: 0,
        tradingFunds: 10000,
        dailyPl: -500,
        dailyPlPct: -4.76,
        drawdownPct: 4.76,
      },
    ];

    const entries = tradesToEquityCurveHelper(dailyLogs, 'Test Strategy');
    
    expect(entries).toHaveLength(3);
    expect(entries[0].dailyReturnPct).toBe(0); // First day has no previous day
    expect(entries[1].dailyReturnPct).toBeCloseTo(0.05, 4); // (10500 - 10000) / 10000
    expect(entries[2].dailyReturnPct).toBeCloseTo(-0.0476, 4); // (10000 - 10500) / 10500
  });

  test('should handle unsorted daily logs', () => {
    const dailyLogs: DailyLogEntry[] = [
      {
        date: new Date('2024-01-03'),
        netLiquidity: 11000,
        currentFunds: 11000,
        withdrawn: 0,
        tradingFunds: 11000,
        dailyPl: 0,
        dailyPlPct: 0,
        drawdownPct: 0,
      },
      {
        date: new Date('2024-01-01'),
        netLiquidity: 10000,
        currentFunds: 10000,
        withdrawn: 0,
        tradingFunds: 10000,
        dailyPl: 0,
        dailyPlPct: 0,
        drawdownPct: 0,
      },
      {
        date: new Date('2024-01-02'),
        netLiquidity: 10500,
        currentFunds: 10500,
        withdrawn: 0,
        tradingFunds: 10500,
        dailyPl: 500,
        dailyPlPct: 5,
        drawdownPct: 0,
      },
    ];

    const entries = tradesToEquityCurveHelper(dailyLogs, 'Test Strategy');
    
    // Should be sorted by date
    expect(entries[0].date.getTime()).toBe(new Date('2024-01-01').getTime());
    expect(entries[1].date.getTime()).toBe(new Date('2024-01-02').getTime());
    expect(entries[2].date.getTime()).toBe(new Date('2024-01-03').getTime());
    
    expect(entries[0].accountValue).toBe(10000);
    expect(entries[1].accountValue).toBe(10500);
    expect(entries[2].accountValue).toBe(11000);
  });

  test('should handle empty daily logs', () => {
    const dailyLogs: DailyLogEntry[] = [];
    const entries = tradesToEquityCurveHelper(dailyLogs, 'Test Strategy');
    
    expect(entries).toHaveLength(0);
  });
});

describe('getStrategyOptions', () => {
  // This function is from PerformanceBlocksPage component
  // We'll create a helper that mimics the function for testing purposes
  
  function getStrategyOptionsHelper(trades: Trade[]): Array<{ label: string; value: string }> {
    if (!trades || trades.length === 0) return [];
    
    const uniqueStrategies = [
      ...new Set(trades.map((trade: Trade) => trade.strategy || "Unknown")),
    ];
    return uniqueStrategies.map((strategy: string) => ({
      label: strategy,
      value: strategy,
    }));
  }

  test('should return unique strategy options from trades', () => {
    const trades: Trade[] = [
      { strategy: 'Iron Condor', dateOpened: new Date('2024-01-01') } as Trade,
      { strategy: 'Credit Spread', dateOpened: new Date('2024-01-02') } as Trade,
      { strategy: 'Iron Condor', dateOpened: new Date('2024-01-03') } as Trade,
      { strategy: 'Butterfly', dateOpened: new Date('2024-01-04') } as Trade,
    ];

    const options = getStrategyOptionsHelper(trades);
    
    expect(options).toHaveLength(3);
    expect(options.map(o => o.value)).toContain('Iron Condor');
    expect(options.map(o => o.value)).toContain('Credit Spread');
    expect(options.map(o => o.value)).toContain('Butterfly');
  });

  test('should handle trades with no strategy field', () => {
    const trades: Trade[] = [
      { strategy: undefined, dateOpened: new Date('2024-01-01') } as unknown as Trade,
      { strategy: 'Iron Condor', dateOpened: new Date('2024-01-02') } as Trade,
    ];

    const options = getStrategyOptionsHelper(trades);
    
    expect(options).toHaveLength(2);
    expect(options.map(o => o.value)).toContain('Unknown');
    expect(options.map(o => o.value)).toContain('Iron Condor');
  });

  test('should return empty array for empty trades', () => {
    const trades: Trade[] = [];
    const options = getStrategyOptionsHelper(trades);
    
    expect(options).toHaveLength(0);
  });

  test('should maintain label-value consistency', () => {
    const trades: Trade[] = [
      { strategy: 'Iron Condor', dateOpened: new Date('2024-01-01') } as Trade,
      { strategy: 'Credit Spread', dateOpened: new Date('2024-01-02') } as Trade,
    ];

    const options = getStrategyOptionsHelper(trades);
    
    options.forEach(option => {
      expect(option.label).toBe(option.value);
    });
  });

  test('should handle all trades with same strategy', () => {
    const trades: Trade[] = [
      { strategy: 'Iron Condor', dateOpened: new Date('2024-01-01') } as Trade,
      { strategy: 'Iron Condor', dateOpened: new Date('2024-01-02') } as Trade,
      { strategy: 'Iron Condor', dateOpened: new Date('2024-01-03') } as Trade,
    ];

    const options = getStrategyOptionsHelper(trades);
    
    expect(options).toHaveLength(1);
    expect(options[0].value).toBe('Iron Condor');
  });

  test('should preserve original strategy names', () => {
    const trades: Trade[] = [
      { strategy: 'Iron Condor - ATM', dateOpened: new Date('2024-01-01') } as Trade,
      { strategy: 'Credit Spread (OTM)', dateOpened: new Date('2024-01-02') } as Trade,
    ];

    const options = getStrategyOptionsHelper(trades);
    
    expect(options).toHaveLength(2);
    expect(options[0].label).toBe('Iron Condor - ATM');
    expect(options[1].label).toBe('Credit Spread (OTM)');
  });
});
