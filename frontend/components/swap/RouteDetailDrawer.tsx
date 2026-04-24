'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface RouteDetailHop {
  fromAsset: string;
  toAsset: string;
  venue: string;
  price?: string;
  fee?: string;
}

export interface RouteDetailData {
  label: string;
  outputAmount?: string;
  priceImpact?: string;
  hops: RouteDetailHop[];
}

export interface RouteDetailDrawerProps {
  bestRoute: RouteDetailData;
  alternativeRoute?: RouteDetailData;
  open: boolean;
  onClose: () => void;
  initialRoute?: 'best' | 'alternative';
}

interface HopDisplayProps {
  hop: RouteDetailHop;
  stepNumber: number;
  isExpanded: boolean;
  onToggle: () => void;
}

function HopDetail({ hop, stepNumber, isExpanded, onToggle }: HopDisplayProps) {
  const formattedPrice = hop.price?.trim() || 'Unavailable';
  const formattedFee = hop.fee?.trim() || 'Unavailable';

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg mb-3 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
      >
        <div className="flex items-center gap-3 flex-1">
          <span className="font-medium text-sm text-gray-600 dark:text-gray-400 min-w-8">
            Hop {stepNumber}
          </span>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900 dark:text-white">{hop.fromAsset}</span>
            <span className="text-gray-400">→</span>
            <span className="font-semibold text-gray-900 dark:text-white">{hop.toAsset}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs text-gray-500 dark:text-gray-400">Fee</p>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{formattedFee}</p>
          </div>
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-600 dark:text-gray-400 mb-1">Venue</p>
              <p className="font-medium text-gray-900 dark:text-white">{hop.venue}</p>
            </div>
            <div>
              <p className="text-gray-600 dark:text-gray-400 mb-1">Price</p>
              <p className="font-medium text-gray-900 dark:text-white">{formattedPrice}</p>
            </div>
            <div>
              <p className="text-gray-600 dark:text-gray-400 mb-1">From Asset</p>
              <p className="font-medium text-gray-900 dark:text-white">{hop.fromAsset}</p>
            </div>
            <div>
              <p className="text-gray-600 dark:text-gray-400 mb-1">To Asset</p>
              <p className="font-medium text-gray-900 dark:text-white">{hop.toAsset}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function RouteDetailDrawer({
  bestRoute,
  alternativeRoute,
  open,
  onClose,
  initialRoute = 'best',
}: RouteDetailDrawerProps) {
  const [expandedHop, setExpandedHop] = useState<number | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<'best' | 'alternative'>(initialRoute);

  useEffect(() => {
    if (!open) {
      setExpandedHop(null);
      return;
    }

    setSelectedRoute(initialRoute);
  }, [initialRoute, open]);

  if (!open) return null;

  const displayRoute = selectedRoute === 'alternative' && alternativeRoute ? alternativeRoute : bestRoute;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="route-drawer-title"
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative w-full bg-white dark:bg-gray-900 rounded-t-2xl shadow-lg max-h-[90vh] overflow-y-auto">
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

        {alternativeRoute && (
          <div className="px-6 pt-4 pb-3">
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedRoute('best')}
                data-testid="route-detail-tab-best"
                className={cn(
                  'px-4 py-2 rounded-lg font-medium text-sm transition-colors',
                  selectedRoute === 'best'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                )}
              >
                {bestRoute.label}
              </button>
              <button
                onClick={() => setSelectedRoute('alternative')}
                data-testid="route-detail-tab-alternative"
                className={cn(
                  'px-4 py-2 rounded-lg font-medium text-sm transition-colors',
                  selectedRoute === 'alternative'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                )}
              >
                {alternativeRoute.label}
              </button>
            </div>
          </div>
        )}

        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                Output Amount
              </p>
              <p className="text-lg font-bold text-gray-900 dark:text-white mt-1">
                {displayRoute.outputAmount?.trim() || 'Unavailable'}
              </p>
            </div>
            {displayRoute.priceImpact && (
              <div>
                <p className="text-xs text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                  Price Impact
                </p>
                <p className="text-lg font-bold text-red-600 dark:text-red-400 mt-1">
                  {displayRoute.priceImpact}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-6">
          {displayRoute.hops.length > 0 ? (
            <>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4">
                Trading Path ({displayRoute.hops.length} hop{displayRoute.hops.length !== 1 ? 's' : ''})
              </h3>
              {displayRoute.hops.map((hop, index) => (
                <HopDetail
                  key={`${hop.venue}-${index}`}
                  hop={hop}
                  stepNumber={index + 1}
                  isExpanded={expandedHop === index}
                  onToggle={() => setExpandedHop(expandedHop === index ? null : index)}
                />
              ))}
            </>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-600 dark:text-gray-400">
                No hop data available for this route.
              </p>
            </div>
          )}
        </div>

        <div className="h-6" />
      </div>
    </div>
  );
}

export default RouteDetailDrawer;
