'use client';

import React, { useState } from 'react';
import type { PriceQuote, PathStep } from '@/types';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RouteDetailDrawerProps {
  /** The price quote containing the route data */
  quote: PriceQuote | undefined;
  /** Alternative route quote for comparison */
  alternativeQuote?: PriceQuote;
  /** Whether the drawer is open */
  open: boolean;
  /** Callback when drawer closes */
  onClose: () => void;
}

interface HopDisplayProps {
  step: PathStep;
  stepNumber: number;
  estimatedFee?: string;
  isExpanded: boolean;
  onToggle: () => void;
}

/** Format asset identifier for display */
function formatAssetCode(assetCode?: string, assetIssuer?: string): string {
  if (!assetCode) return 'XLM';
  if (assetCode === 'XLM') return 'XLM';
  return `${assetCode}`;
}

/** Extract venue name from source identifier */
function getVenueName(source: string): string {
  if (source === 'sdex') return 'Stellar DEX (SDEX)';
  if (source.startsWith('amm:')) {
    const poolId = source.slice(4);
    return `AMM Pool (${poolId.slice(0, 8)}...)`;
  }
  return 'Unknown Venue';
}

/** Display a single hop in the route */
function HopDetail({ step, stepNumber, estimatedFee, isExpanded, onToggle }: HopDisplayProps) {
  const fromAsset = formatAssetCode(step.from_asset.asset_code, step.from_asset.asset_issuer);
  const toAsset = formatAssetCode(step.to_asset.asset_code, step.to_asset.asset_issuer);
  const venue = getVenueName(step.source);
  const price = parseFloat(step.price);
  const formattedPrice = price > 0 ? price.toFixed(6) : '0';

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg mb-3 overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
      >
        <div className="flex items-center gap-3 flex-1">
          <span className="font-medium text-sm text-gray-600 dark:text-gray-400 min-w-8">
            Hop {stepNumber}
          </span>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900 dark:text-white">
              {fromAsset}
            </span>
            <span className="text-gray-400">→</span>
            <span className="font-semibold text-gray-900 dark:text-white">
              {toAsset}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {estimatedFee && (
            <div className="text-right">
              <p className="text-xs text-gray-500 dark:text-gray-400">Fee</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {estimatedFee}
              </p>
            </div>
          )}
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-600 dark:text-gray-400 mb-1">Venue</p>
              <p className="font-medium text-gray-900 dark:text-white">{venue}</p>
            </div>
            <div>
              <p className="text-gray-600 dark:text-gray-400 mb-1">Price</p>
              <p className="font-medium text-gray-900 dark:text-white">{formattedPrice}</p>
            </div>
            <div>
              <p className="text-gray-600 dark:text-gray-400 mb-1">From Asset</p>
              <p className="font-medium text-gray-900 dark:text-white">{fromAsset}</p>
            </div>
            <div>
              <p className="text-gray-600 dark:text-gray-400 mb-1">To Asset</p>
              <p className="font-medium text-gray-900 dark:text-white">{toAsset}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Main RouteDetailDrawer component */
export function RouteDetailDrawer({
  quote,
  alternativeQuote,
  open,
  onClose,
}: RouteDetailDrawerProps) {
  const [expandedHop, setExpandedHop] = useState<number | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<'best' | 'alternative'>('best');

  if (!open || !quote) return null;

  const displayQuote = selectedRoute === 'alternative' && alternativeQuote ? alternativeQuote : quote;
  const path = displayQuote.path || [];
  const totalOutput = displayQuote.total || '0';
  const priceImpact = displayQuote.price_impact || displayQuote.priceImpact;

  // Calculate estimated fees per hop (rough estimate based on total impact)
  const hopeCount = path.length > 0 ? path.length : 1;
  const avgFeePerHop = priceImpact ? (parseFloat(priceImpact) / hopeCount).toFixed(4) : '0.0000';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="route-drawer-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer content */}
      <div className="relative w-full bg-white dark:bg-gray-900 rounded-t-2xl shadow-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <div className="flex items-center justify-between">
            <div>
              <h2
                id="route-drawer-title"
                className="text-xl font-bold text-gray-900 dark:text-white"
              >
                Route Details
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Hop-by-hop venue breakdown
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              aria-label="Close drawer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Route selector tabs */}
        {alternativeQuote && (
          <div className="px-6 pt-4 pb-3">
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedRoute('best')}
                className={cn(
                  'px-4 py-2 rounded-lg font-medium text-sm transition-colors',
                  selectedRoute === 'best'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                )}
              >
                Best Route
              </button>
              <button
                onClick={() => setSelectedRoute('alternative')}
                className={cn(
                  'px-4 py-2 rounded-lg font-medium text-sm transition-colors',
                  selectedRoute === 'alternative'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                )}
              >
                Alternative
              </button>
            </div>
          </div>
        )}

        {/* Route summary */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                Output Amount
              </p>
              <p className="text-lg font-bold text-gray-900 dark:text-white mt-1">
                {totalOutput}
              </p>
            </div>
            {priceImpact && (
              <div>
                <p className="text-xs text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                  Price Impact
                </p>
                <p className="text-lg font-bold text-red-600 dark:text-red-400 mt-1">
                  {priceImpact}%
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Hops list */}
        <div className="px-6 py-6">
          {path.length > 0 ? (
            <>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4">
                Trading Path ({path.length} hop{path.length !== 1 ? 's' : ''})
              </h3>
              {path.map((step, index) => (
                <HopDetail
                  key={index}
                  step={step}
                  stepNumber={index + 1}
                  estimatedFee={avgFeePerHop}
                  isExpanded={expandedHop === index}
                  onToggle={() => setExpandedHop(expandedHop === index ? null : index)}
                />
              ))}
            </>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-600 dark:text-gray-400">
                No route data available
              </p>
            </div>
          )}
        </div>

        {/* Footer padding */}
        <div className="h-6" />
      </div>
    </div>
  );
}

export default RouteDetailDrawer;
