'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  connectWallet,
  disconnectWallet,
  getAvailableWallets,
  signTransactionStub,
} from '@/lib/wallet';
import type { SupportedWallet, WalletSession } from '@/lib/wallet/types';

// Storage keys for persistence
const WALLET_SESSION_STORAGE_KEY = 'stellar_route:wallet_session';
const AUTO_RECONNECT_PREF_STORAGE_KEY = 'stellar_route:wallet_auto_reconnect';
const LAST_WALLET_ID_STORAGE_KEY = 'stellar_route:last_wallet_id';

const initialState: WalletSession = {
  walletId: null,
  address: null,
  network: null,
  isConnected: false,
};

export interface UseWalletState extends WalletSession {
  availableWallets: { id: SupportedWallet; label: string }[];
  loading: boolean;
  error: string | null;
  shortAddress: string;
  isAutoReconnectEnabled: boolean;
  isRecovering: boolean;
  reconnectAttempts: number;
  connect: (walletId: SupportedWallet, enableAutoReconnect?: boolean) => Promise<void>;
  disconnect: (clearPreference?: boolean) => void;
  copyAddress: () => Promise<void>;
  signTransactionStub: (tx: string) => Promise<string>;
  setAutoReconnectEnabled: (enabled: boolean) => void;
  attemptReconnect: () => Promise<void>;
}

export function useWallet(): UseWalletState {
  const [session, setSession] = useState<WalletSession>(initialState);
  const [availableWallets, setAvailableWallets] = useState<
    { id: SupportedWallet; label: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAutoReconnectEnabled, setIsAutoReconnectEnabled] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [lastConnectedWalletId, setLastConnectedWalletId] = useState<SupportedWallet | null>(null);

  // 🔹 Load available wallets on mount
  useEffect(() => {
    loadWallets();
    loadPersistedState();
  }, []);

  // 🔹 Auto-reconnect on mount if preference is enabled and not already connected
  useEffect(() => {
    if (isAutoReconnectEnabled && !session.isConnected && lastConnectedWalletId && !isRecovering) {
      attemptReconnect();
    }
  }, [isAutoReconnectEnabled, lastConnectedWalletId, session.isConnected]);

  // 🔹 Listen for wallet disconnect events
  useEffect(() => {
    const handleWalletDisconnect = () => {
      if (session.isConnected) {
        setError('Wallet disconnected. Attempting to reconnect...');
        if (isAutoReconnectEnabled) {
          attemptReconnect();
        }
      }
    };

    // Listen for visibility changes to trigger reconnect when app regains focus
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isAutoReconnectEnabled && !session.isConnected) {
        attemptReconnect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleWalletDisconnect);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleWalletDisconnect);
    };
  }, [session.isConnected, isAutoReconnectEnabled, lastConnectedWalletId]);

  const loadWallets = async () => {
    try {
      const wallets = await getAvailableWallets();
      setAvailableWallets(wallets);
      return wallets;
    } catch {
      setAvailableWallets([]);
    }
  };

  /** Load persisted preferences and previous session from localStorage */
  const loadPersistedState = useCallback(() => {
    try {
      const savedAutoReconnect = localStorage.getItem(AUTO_RECONNECT_PREF_STORAGE_KEY);
      const savedWalletId = localStorage.getItem(LAST_WALLET_ID_STORAGE_KEY);
      const savedSession = localStorage.getItem(WALLET_SESSION_STORAGE_KEY);

      if (savedAutoReconnect === 'true' && savedWalletId) {
        setIsAutoReconnectEnabled(true);
        setLastConnectedWalletId(savedWalletId as SupportedWallet);
      }

      // Restore session state if available
      if (savedSession) {
        try {
          const session = JSON.parse(savedSession);
          setSession(session);
        } catch {
          // Invalid JSON, skip restoration
        }
      }
    } catch {
      // localStorage not available or other error
    }
  }, []);

  // 🔹 Connect wallet
  const connect = useCallback(
    async (walletId: SupportedWallet, enableAutoReconnect = false) => {
      try {
        setLoading(true);
        setError(null);

        const next = await connectWallet(walletId);

        setSession({
          walletId: next.walletId,
          address: next.address,
          network: next.network,
          isConnected: true,
        });

        // Persist session and preferences
        try {
          localStorage.setItem(
            WALLET_SESSION_STORAGE_KEY,
            JSON.stringify({
              walletId: next.walletId,
              address: next.address,
              network: next.network,
              isConnected: true,
            })
          );
          localStorage.setItem(LAST_WALLET_ID_STORAGE_KEY, next.walletId);
          if (enableAutoReconnect) {
            localStorage.setItem(AUTO_RECONNECT_PREF_STORAGE_KEY, 'true');
            setIsAutoReconnectEnabled(true);
          }
        } catch {
          // localStorage not available, continue without persistence
        }

        setReconnectAttempts(0);
        setIsRecovering(false);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message.toLowerCase() : '';

        if (msg.includes('reject')) {
          setError('Connection request was rejected.');
        } else if (msg.includes('lock')) {
          setError('Wallet is locked. Unlock it and try again.');
        } else if (msg.includes('not installed')) {
          setError('Wallet not installed.');
        } else {
          setError('Unable to connect wallet.');
        }
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /** Attempt to reconnect to previously connected wallet */
  const attemptReconnect = useCallback(async () => {
    if (!lastConnectedWalletId || reconnectAttempts >= 3) {
      setIsRecovering(false);
      return;
    }

    setIsRecovering(true);
    setReconnectAttempts((prev) => prev + 1);

    try {
      await connect(lastConnectedWalletId);
    } catch {
      // Reconnect failed, will retry on next attempt or manual trigger
      // After max retries, user must manually reconnect
      if (reconnectAttempts >= 2) {
        setIsRecovering(false);
        setError('Failed to reconnect wallet. Please try again manually.');
      }
    }
  }, [lastConnectedWalletId, reconnectAttempts, connect]);

  // 🔹 Disconnect wallet
  const disconnect = useCallback((clearPreference = false) => {
    disconnectWallet();
    setSession(initialState);
    setError(null);
    setReconnectAttempts(0);

    // Clear localStorage if requested
    if (clearPreference) {
      try {
        localStorage.removeItem(WALLET_SESSION_STORAGE_KEY);
        localStorage.removeItem(AUTO_RECONNECT_PREF_STORAGE_KEY);
        localStorage.removeItem(LAST_WALLET_ID_STORAGE_KEY);
        setIsAutoReconnectEnabled(false);
        setLastConnectedWalletId(null);
      } catch {
        // localStorage not available
      }
    }
  }, []);

  // 🔹 Short address (GABC...WXYZ)
  const shortAddress = useMemo(() => {
    if (!session.address) return '';
    return `${session.address.slice(0, 4)}...${session.address.slice(-4)}`;
  }, [session.address]);

  // 🔹 Copy full address
  const copyAddress = useCallback(async () => {
    if (!session.address) return;

    try {
      await navigator.clipboard.writeText(session.address);
    } catch {
      setError('Failed to copy address.');
    }
  }, [session.address]);

  /** Toggle auto-reconnect preference */
  const setAutoReconnectPreference = useCallback((enabled: boolean) => {
    try {
      if (enabled) {
        localStorage.setItem(AUTO_RECONNECT_PREF_STORAGE_KEY, 'true');
      } else {
        localStorage.removeItem(AUTO_RECONNECT_PREF_STORAGE_KEY);
      }
      setIsAutoReconnectEnabled(enabled);
    } catch {
      // localStorage not available
      setIsAutoReconnectEnabled(enabled);
    }
  }, []);

  return {
    ...session,
    availableWallets,
    loading,
    error,
    shortAddress,
    connect,
    disconnect,
    copyAddress,
    signTransactionStub,
    isAutoReconnectEnabled,
    isRecovering,
    reconnectAttempts,
    setAutoReconnectEnabled: setAutoReconnectPreference,
    attemptReconnect,
  };
}