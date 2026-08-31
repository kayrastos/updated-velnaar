/**
 * @file worker/ai/evaluation/evaluationCostCalculator.ts
 * @description Deterministic integer microUSD cost calculations & pricing schedules for Phase A.12B.2B
 */

import {
  A12B2B_PRICING_CATALOG_VERSION,
  DeepSeekPricingRate,
  GeminiPricingRate,
  PricingWindow,
  UsageSource,
} from './evaluationLiveTypes';

/**
 * Official verified rates (snapshot: 2026-08-31)
 */
export const DEEPSEEK_V4_FLASH_PRICING: DeepSeekPricingRate = {
  offPeakCacheHitMicroUsdPer1M: 7000,     // $0.007 / 1M
  offPeakCacheMissMicroUsdPer1M: 220000,  // $0.22 / 1M
  offPeakOutputMicroUsdPer1M: 660000,     // $0.66 / 1M
  peakCacheHitMicroUsdPer1M: 14000,       // $0.014 / 1M
  peakCacheMissMicroUsdPer1M: 440000,     // $0.44 / 1M
  peakOutputMicroUsdPer1M: 1320000,       // $1.32 / 1M
};

export const GEMINI_35_FLASH_LITE_PRICING: GeminiPricingRate = {
  standardInputMicroUsdPer1M: 300000,     // $0.30 / 1M
  standardOutputMicroUsdPer1M: 2500000,   // $2.50 / 1M (includes thinking)
  flexInputMicroUsdPer1M: 150000,         // $0.15 / 1M (50% discount)
  flexOutputMicroUsdPer1M: 1250000,       // $1.25 / 1M (50% discount, includes thinking)
};

export class EvaluationCostCalculator {
  /**
   * Evaluates if the current UTC time falls in the DeepSeek Peak window.
   * Peak Windows (Mon-Fri only):
   * 1. 01:00 - 04:00 UTC
   * 2. 06:00 - 10:00 UTC
   */
  public static getDeepSeekPricingWindow(date: Date = new Date()): PricingWindow {
    const utcDay = date.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 5 = Fri, 6 = Sat
    const isWeekday = utcDay >= 1 && utcDay <= 5;
    if (!isWeekday) {
      return 'OFF_PEAK';
    }

    const utcHour = date.getUTCHours();
    const isPeak1 = utcHour >= 1 && utcHour < 4;
    const isPeak2 = utcHour >= 6 && utcHour < 10;

    return isPeak1 || isPeak2 ? 'PEAK' : 'OFF_PEAK';
  }

  /**
   * Validates DeepSeek token telemetry consistency:
   * prompt_tokens === prompt_cache_hit_tokens + prompt_cache_miss_tokens
   */
  public static validateDeepSeekTokenIntegrity(
    promptTokens: number,
    cacheHitTokens: number,
    cacheMissTokens: number
  ): boolean {
    if (promptTokens < 0 || cacheHitTokens < 0 || cacheMissTokens < 0) return false;
    return promptTokens === cacheHitTokens + cacheMissTokens;
  }

  /**
   * Calculates integer microUSD cost for DeepSeek V4 Flash invocation.
   */
  public static calculateDeepSeekCost(params: {
    cacheHitTokens: number;
    cacheMissTokens: number;
    completionTokens: number;
    pricingWindow: PricingWindow;
    usageSource: UsageSource;
  }): {
    actualCostMicroUsd: number;
    normalizedColdOffPeakCostMicroUsd: number;
    normalizedColdPeakCostMicroUsd: number;
  } {
    if (params.usageSource !== 'PROVIDER_REPORTED') {
      throw new Error('TELEMETRY_INCOMPLETE: Cost calculations require PROVIDER_REPORTED usage.');
    }

    const totalPrompt = params.cacheHitTokens + params.cacheMissTokens;
    const rates = DEEPSEEK_V4_FLASH_PRICING;

    // Actual cost based on actual cache split & actual pricing window
    const inputRate =
      params.pricingWindow === 'PEAK'
        ? { hit: rates.peakCacheHitMicroUsdPer1M, miss: rates.peakCacheMissMicroUsdPer1M }
        : { hit: rates.offPeakCacheHitMicroUsdPer1M, miss: rates.offPeakCacheMissMicroUsdPer1M };

    const outputRate =
      params.pricingWindow === 'PEAK'
        ? rates.peakOutputMicroUsdPer1M
        : rates.offPeakOutputMicroUsdPer1M;

    const actualInputCost = Math.round(
      (params.cacheHitTokens * inputRate.hit + params.cacheMissTokens * inputRate.miss) / 1000000
    );
    const actualOutputCost = Math.round((params.completionTokens * outputRate) / 1000000);
    const actualCostMicroUsd = actualInputCost + actualOutputCost;

    // Cold off-peak: all prompt tokens as cache miss at off-peak rates
    const coldOffPeakInput = Math.round(
      (totalPrompt * rates.offPeakCacheMissMicroUsdPer1M) / 1000000
    );
    const coldOffPeakOutput = Math.round(
      (params.completionTokens * rates.offPeakOutputMicroUsdPer1M) / 1000000
    );
    const normalizedColdOffPeakCostMicroUsd = coldOffPeakInput + coldOffPeakOutput;

    // Cold peak: all prompt tokens as cache miss at peak rates
    const coldPeakInput = Math.round((totalPrompt * rates.peakCacheMissMicroUsdPer1M) / 1000000);
    const coldPeakOutput = Math.round(
      (params.completionTokens * rates.peakOutputMicroUsdPer1M) / 1000000
    );
    const normalizedColdPeakCostMicroUsd = coldPeakInput + coldPeakOutput;

    return {
      actualCostMicroUsd,
      normalizedColdOffPeakCostMicroUsd,
      normalizedColdPeakCostMicroUsd,
    };
  }

  /**
   * Calculates integer microUSD cost for Gemini 3.5 Flash-Lite invocation.
   * Note: Total billed output tokens = completionTokens + thinkingTokens.
   */
  public static calculateGeminiCost(params: {
    promptTokens: number;
    completionTokens: number;
    thinkingTokens: number;
    serviceTier: 'flex' | 'standard';
    usageSource: UsageSource;
  }): {
    actualCostMicroUsd: number;
    normalizedStandardCostMicroUsd: number;
  } {
    if (params.usageSource !== 'PROVIDER_REPORTED') {
      throw new Error('TELEMETRY_INCOMPLETE: Cost calculations require PROVIDER_REPORTED usage.');
    }

    const rates = GEMINI_35_FLASH_LITE_PRICING;
    const totalOutputTokens = params.completionTokens + params.thinkingTokens;

    const inputRate =
      params.serviceTier === 'flex'
        ? rates.flexInputMicroUsdPer1M
        : rates.standardInputMicroUsdPer1M;

    const outputRate =
      params.serviceTier === 'flex'
        ? rates.flexOutputMicroUsdPer1M
        : rates.standardOutputMicroUsdPer1M;

    const actualInputCost = Math.round((params.promptTokens * inputRate) / 1000000);
    const actualOutputCost = Math.round((totalOutputTokens * outputRate) / 1000000);
    const actualCostMicroUsd = actualInputCost + actualOutputCost;

    const standardInputCost = Math.round(
      (params.promptTokens * rates.standardInputMicroUsdPer1M) / 1000000
    );
    const standardOutputCost = Math.round(
      (totalOutputTokens * rates.standardOutputMicroUsdPer1M) / 1000000
    );
    const normalizedStandardCostMicroUsd = standardInputCost + standardOutputCost;

    return {
      actualCostMicroUsd,
      normalizedStandardCostMicroUsd,
    };
  }

  /**
   * Calculates realized discount basis points (0..10000).
   * discountBps = Math.round(((baseline - actual) / baseline) * 10000)
   */
  public static calculateDiscountBps(baselineCost: number, actualCost: number): number {
    if (baselineCost <= 0) return 0;
    if (actualCost >= baselineCost) return 0;
    return Math.round(((baselineCost - actualCost) / baselineCost) * 10000);
  }
}
