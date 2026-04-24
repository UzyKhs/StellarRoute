'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  connectWallet,
  disconnectWallet,
  getAvailableWallets,
  signTransactionStub,
} from '@/lib/wallet';
import type { SupportedWallet, WalletSession } from '@/lib/wallet/types';

const WALLET_SESSION_STORAGE_KEY = 'stellar_route:wallet_session';
const AUTO_RECONNECT_PREF_STORAGE_KEY = 'stellar_route:wallet_auto_reconnect';
const LAST_WALLET_ID_STORAGE_KEY = 'stellar_route:last_wallet_id';
const MAX_RECONNECT_ATTEMPTS = 3;

const initialState: WalletSession = {
  walletId: null,
  address: null,
  network: null,
  isConnected: false,
};

export interface UseWalletState {
  session: WalletSession;
  walletId: WalletSession['walletId'];
  address: WalletSession['address'];
  network: WalletSession['network'];
  isConnected: WalletSession['isConnected'];
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
  signTransactionStub: typeof signTransactionStub;
  setAutoReconnectEnabled: (enabled: boolean) => void;
  attemptReconnect: () => Promise<void>;
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readStorage(key: string): string | null {
  if (!canUseStorage()) {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures and keep runtime state authoritative.
  }
}

function removeStorage(key: string) {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures and keep runtime state authoritative.
  }
}

function getErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';

  if (message.includes('reject')) {
    return 'Connection request was rejected.';
  }
  if (message.includes('lock')) {
    return 'Wallet is locked. Unlock it and try again.';
  }
  if (message.includes('not installed')) {
    return 'Wallet not installed.';
  }

  return 'Unable to connect wallet.';
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

  const loadWallets = useCallback(async () => {
    try {
      const wallets = await getAvailableWallets();
      setAvailableWallets(wallets.map(({ id, label }) => ({ id, label })));
      return wallets;
    } catch {
      setAvailableWallets([]);
      return [];
    }
  }, []);

  const persistSession = useCallback((nextSession: WalletSession) => {
    writeStorage(WALLET_SESSION_STORAGE_KEY, JSON.stringify(nextSession));
    if (nextSession.walletId) {
      writeStorage(LAST_WALLET_ID_STORAGE_KEY, nextSession.walletId);
    }
  }, []);

  const performConnect = useCallback(
    async (walletId: SupportedWallet) => {
      const nextSession = await connectWallet(walletId);
      setSession(nextSession);
      setLastConnectedWalletId(nextSession.walletId);
      setReconnectAttempts(0);
      setIsRecovering(false);
      persistSession(nextSession);
      return nextSession;
    },
    [persistSession],
  );

  const loadPersistedState = useCallback(() => {
    const savedWalletId = readStorage(LAST_WALLET_ID_STORAGE_KEY) as SupportedWallet | null;
    const savedAutoReconnect = readStorage(AUTO_RECONNECT_PREF_STORAGE_KEY);
    const savedSession = readStorage(WALLET_SESSION_STORAGE_KEY);

    if (savedWalletId) {
      setLastConnectedWalletId(savedWalletId);
    }

    if (savedAutoReconnect === 'true') {
      setIsAutoReconnectEnabled(true);
    }

    if (!savedSession) {
      return;
    }

    try {
      const parsedSession = JSON.parse(savedSession) as WalletSession;
      if (!parsedSession.isConnected) {
        setSession(parsedSession);
      }
    } catch {
      removeStorage(WALLET_SESSION_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    loadWallets();
    loadPersistedState();
  }, [loadPersistedState, loadWallets]);

  const connect = useCallback(
    async (walletId: SupportedWallet, enableAutoReconnect = false) => {
      try {
        setLoading(true);
        setError(null);

        const nextSession = await performConnect(walletId);
        if (enableAutoReconnect) {
          writeStorage(AUTO_RECONNECT_PREF_STORAGE_KEY, 'true');
          setIsAutoReconnectEnabled(true);
        }

        persistSession(nextSession);
      } catch (connectError) {
        setSession(initialState);
        setError(getErrorMessage(connectError));
      } finally {
        setLoading(false);
      }
    },
    [performConnect, persistSession],
  );

  const attemptReconnect = useCallback(async () => {
    if (!lastConnectedWalletId || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      setIsRecovering(false);
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        setError('Failed to reconnect wallet. Please try again manually.');
      }
      return;
    }

    setLoading(true);
    setIsRecovering(true);
    setError('Wallet disconnected. Attempting to reconnect...');

    try {
      await performConnect(lastConnectedWalletId);
      setError(null);
    } catch {
      setReconnectAttempts((currentAttempts) => currentAttempts + 1);
      setSession(initialState);
    } finally {
      setLoading(false);
      setIsRecovering(false);
    }
  }, [lastConnectedWalletId, performConnect, reconnectAttempts]);

  useEffect(() => {
    if (!isAutoReconnectEnabled || session.isConnected || !lastConnectedWalletId || isRecovering) {
      return;
    }

    void attemptReconnect();
  }, [attemptReconnect, isAutoReconnectEnabled, isRecovering, lastConnectedWalletId, session.isConnected]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isAutoReconnectEnabled && !session.isConnected) {
        void attemptReconnect();
      }
    };

    const handleOnline = () => {
      if (isAutoReconnectEnabled && !session.isConnected) {
        void attemptReconnect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [attemptReconnect, isAutoReconnectEnabled, session.isConnected]);

  const disconnect = useCallback((clearPreference = false) => {
    disconnectWallet();
    setSession(initialState);
    setError(null);
    setIsRecovering(false);
    setReconnectAttempts(0);
    removeStorage(WALLET_SESSION_STORAGE_KEY);

    if (clearPreference) {
      removeStorage(AUTO_RECONNECT_PREF_STORAGE_KEY);
      removeStorage(LAST_WALLET_ID_STORAGE_KEY);
      setIsAutoReconnectEnabled(false);
      setLastConnectedWalletId(null);
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

  const setAutoReconnectPreference = useCallback((enabled: boolean) => {
    if (enabled) {
      writeStorage(AUTO_RECONNECT_PREF_STORAGE_KEY, 'true');
    } else {
      removeStorage(AUTO_RECONNECT_PREF_STORAGE_KEY);
    }
    setIsAutoReconnectEnabled(enabled);
  }, []);

  return {
    session,
    walletId: session.walletId,
    address: session.address,
    network: session.network,
    isConnected: session.isConnected,
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