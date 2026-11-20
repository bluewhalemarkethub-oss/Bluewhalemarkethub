import React, { useEffect, useState } from 'react';
import {
  X,
  BookOpen,
  ExternalLink,
  Copy,
  Check,
  ShieldAlert,
  ArrowRight,
} from 'lucide-react';
import { CRYPTO_WALLETS, type CryptoCurrencyCode } from '../data/shippingCatalog';

export type InstructionAssetTab = 'BTC' | 'ETH' | 'USDT';

interface PaymentInstructionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialAsset?: InstructionAssetTab;
  onProceedToDeposit?: () => void;
}

interface ExchangeOption {
  name: string;
  url: string;
  regions: string;
  methods: string;
  bestFor: string;
}

const REPUTABLE_EXCHANGES: ExchangeOption[] = [
  {
    name: 'Coinbase',
    url: 'https://www.coinbase.com/',
    regions: 'US · UK · EU · Canada · Australia',
    methods: 'Debit Card, Bank Transfer (ACH / Faster Payments / SEPA)',
    bestFor: 'First-time buyers purchasing Bitcoin, Ethereum, and USDT ERC20',
  },
  {
    name: 'Kraken',
    url: 'https://www.kraken.com/',
    regions: 'US · UK · EU · Canada · Australia',
    methods: 'Wire, SEPA, ACH, Debit / Credit Card',
    bestFor: 'Low withdrawal fees and multi-network USDT (ERC20 & TRC20) transfers',
  },
  {
    name: 'Binance',
    url: 'https://www.binance.com/',
    regions: 'International (Europe, UK, LATAM, Asia-Pacific)',
    methods: 'Card, P2P, SEPA & Bank Deposit',
    bestFor: 'Fast USDT TRC20 withdrawals with minimal TRON network fees',
  },
  {
    name: 'Crypto.com',
    url: 'https://crypto.com/',
    regions: 'US · UK · EU · Canada · Australia',
    methods: 'Apple Pay, Google Pay, Debit Card, Bank Transfer',
    bestFor: 'Mobile app onboarding and instant BTC, ETH, or USDT transfers',
  },
  {
    name: 'MoonPay',
    url: 'https://www.moonpay.com/',
    regions: '160+ Countries Worldwide',
    methods: 'Visa, Mastercard, Apple Pay, SEPA',
    bestFor: 'Direct card-to-wallet checkout without managing an exchange order book',
  },
];

const ASSET_CONTENT: Record<
  InstructionAssetTab,
  {
    title: string;
    shortLabel: string;
    networkSummary: string;
    feeTip: string;
    confirmationsNote: string;
    steps: { title: string; detail: string }[];
  }
> = {
  BTC: {
    title: 'Bitcoin (BTC)',
    shortLabel: 'Bitcoin (BTC)',
    networkSummary: 'Network: Bitcoin Mainnet (Native SegWit bc1q...)',
    feeTip:
      'Add ~$5–$12 extra when buying to cover your exchange withdrawal fee so at least $100.00 USD arrives.',
    confirmationsNote: 'Requires 2 Bitcoin network confirmations (typically 15–30 minutes).',
    steps: [
      {
        title: 'Create & verify an account on a trusted exchange',
        detail:
          'Sign up on Coinbase, Kraken, Binance, or Crypto.com and complete quick photo ID verification so card or bank purchases are unlocked.',
      },
      {
        title: 'Purchase Bitcoin (BTC) for $100+ USD',
        detail:
          'Buy at least $100.00 USD worth of BTC (include a small buffer for the exchange withdrawal fee) using your debit card, Apple Pay, or bank transfer.',
      },
      {
        title: 'Copy the BlueWhale Bitcoin (BTC) deposit address',
        detail:
          'Copy the Native SegWit (bc1q...) address shown below or scan the QR code inside the Deposit Funds modal.',
      },
      {
        title: 'Withdraw BTC on the Bitcoin network',
        detail:
          'Open Withdraw / Send Crypto on your exchange, choose Bitcoin (BTC), paste the address, select the standard Bitcoin network, and confirm with 2FA.',
      },
      {
        title: 'Submit your TxID & payment receipt on BlueWhale',
        detail:
          'Take a screenshot or PDF of your exchange withdrawal confirmation containing the Transaction Hash (TxID), then submit both inside Deposit Funds for manual admin approval.',
      },
    ],
  },
  ETH: {
    title: 'Ethereum (ETH)',
    shortLabel: 'Ethereum (ETH)',
    networkSummary: 'Network: Ethereum Mainnet (ERC20)',
    feeTip:
      'Keep ~$5–$15 extra in ETH for Ethereum gas and withdrawal fees so the received value remains at least $100.00 USD.',
    confirmationsNote: 'Requires 12 Ethereum block confirmations (typically 3–5 minutes).',
    steps: [
      {
        title: 'Open an account on a supported exchange',
        detail:
          'Register and complete identity verification on Coinbase, Kraken, Binance, or MoonPay to enable instant crypto purchases.',
      },
      {
        title: 'Buy Ethereum (ETH) covering $100+ USD plus gas',
        detail:
          'Purchase your desired deposit amount ($100.00 minimum) plus a small ETH fee buffer using your card or bank account.',
      },
      {
        title: 'Copy the BlueWhale Ethereum (ETH) address',
        detail:
          'Copy the 0x... Ethereum Mainnet address shown below. Do not send over Layer-2 networks (Arbitrum, Optimism, Base) unless sending on Ethereum Mainnet.',
      },
      {
        title: 'Send ETH via Ethereum Mainnet (ERC20)',
        detail:
          'Select Withdraw / Send in your exchange or wallet (e.g., MetaMask or Coinbase), select the Ethereum (ERC20) network, paste the 0x... address, and authorize the transfer.',
      },
      {
        title: 'Upload your receipt & TxHash in Deposit Funds',
        detail:
          'Once broadcast, copy the transaction hash (0x...) and upload a screenshot or PDF of the transfer confirmation in the Deposit Funds form so an admin can verify and credit your wallet.',
      },
    ],
  },
  USDT: {
    title: 'Tether (USDT · ERC20 & TRC20)',
    shortLabel: 'USDT (ERC20 / TRC20)',
    networkSummary: 'Supported Networks: TRON (TRC20 — lowest fees) or Ethereum (ERC20)',
    feeTip:
      'USDT stays pegged 1:1 to USD. TRON TRC20 typically charges ~$1 withdrawal fee, while Ethereum ERC20 charges ~$4–$12 depending on gas.',
    confirmationsNote:
      'TRC20 requires 20 confirmations (~1–2 min). ERC20 requires 12 confirmations (~3–5 min).',
    steps: [
      {
        title: 'Choose a USDT-supported exchange',
        detail:
          'Use Kraken, Binance, Coinbase (ERC20), or Crypto.com to buy Tether (USDT) directly with USD, EUR, GBP, or CAD.',
      },
      {
        title: 'Buy at least $100+ USDT plus the network fee',
        detail:
          'For example, to deposit $100.00 via USDT TRC20 on an exchange with a $1 withdrawal fee, purchase at least 101 USDT so 100.00 USDT arrives.',
      },
      {
        title: 'Match the exact network address (TRC20 vs. ERC20)',
        detail:
          'If withdrawing on TRON (TRC20), use the address starting with "T...". If withdrawing on Ethereum (ERC20), use the address starting with "0x...". Never mix networks.',
      },
      {
        title: 'Send USDT and copy your Transaction Hash (TxID)',
        detail:
          'Complete the withdrawal on your exchange, double-checking that the selected network matches the address you copied, and copy the resulting TxID.',
      },
      {
        title: 'Submit TxID & payment proof on BlueWhale',
        detail:
          'Select the matching USDT network in Deposit Funds, enter your USD amount, paste the TxID, and upload your receipt screenshot or PDF for manual admin approval.',
      },
    ],
  },
};

export function mapCurrencyCodeToAssetTab(code?: CryptoCurrencyCode): InstructionAssetTab {
  if (code === 'ETH') return 'ETH';
  if (code === 'USDT_ERC20' || code === 'USDT_TRC20') return 'USDT';
  return 'BTC';
}

export function PaymentInstructionsModal({
  isOpen,
  onClose,
  initialAsset = 'BTC',
  onProceedToDeposit,
}: PaymentInstructionsModalProps) {
  const [activeAsset, setActiveAsset] = useState<InstructionAssetTab>(initialAsset);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveAsset(initialAsset);
    }
  }, [isOpen, initialAsset]);

  if (!isOpen) return null;

  const content = ASSET_CONTENT[activeAsset];
  const matchingWallets = CRYPTO_WALLETS.filter((w) =>
    activeAsset === 'USDT' ? w.code === 'USDT_TRC20' || w.code === 'USDT_ERC20' : w.code === activeAsset,
  );

  async function handleCopyAddress(code: string, address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 1800);
    } catch {
      // Clipboard blocked
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-guide-title"
    >
      <div className="relative w-full max-w-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 my-8 space-y-6">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close payment instructions modal"
          className="absolute top-5 right-5 p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-start gap-3 pr-8">
          <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h2
              id="payment-guide-title"
              className="font-display text-xl font-bold text-slate-900 dark:text-white"
            >
              How to Buy &amp; Send Cryptocurrency
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Step-by-step walkthrough for first-time buyers funding a BlueWhale Markethub wallet ($100.00 minimum deposit).
            </p>
          </div>
        </div>

        {/* Asset Segmented Control */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
          {(['BTC', 'ETH', 'USDT'] as InstructionAssetTab[]).map((tab) => {
            const active = activeAsset === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveAsset(tab)}
                className={`flex-1 px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {ASSET_CONTENT[tab].shortLabel}
              </button>
            );
          })}
        </div>

        {/* Selected Asset Network & Wallet Address */}
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">
              {content.title}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {content.confirmationsNote}
            </div>
          </div>
          <div className="text-xs text-blue-700 dark:text-blue-300 font-medium">
            {content.networkSummary}
          </div>

          <div className="space-y-2 pt-1">
            {matchingWallets.map((wallet) => {
              const copied = copiedCode === wallet.code;
              return (
                <div
                  key={wallet.code}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                >
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {wallet.name} · {wallet.networkLabel}
                    </div>
                    <code className="block text-xs font-mono text-slate-900 dark:text-slate-100 break-all mt-0.5">
                      {wallet.address}
                    </code>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopyAddress(wallet.code, wallet.address)}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md shrink-0 whitespace-nowrap"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copied ? 'Copied' : 'Copy Address'}</span>
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex items-start gap-2 pt-1 text-xs text-amber-800 dark:text-amber-300">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{content.feeTip}</span>
          </div>
        </div>

        {/* 5-Step Instructions */}
        <div className="space-y-3">
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            Step-by-Step Guide for {content.title}
          </h3>
          <ol className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            {content.steps.map((step, index) => (
              <li
                key={step.title}
                className="p-4 bg-white dark:bg-slate-900 flex items-start gap-3.5"
              >
                <span className="font-mono text-xs font-bold tabular-nums text-blue-600 dark:text-blue-400 pt-0.5 shrink-0">
                  0{index + 1}.
                </span>
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    {step.title}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {step.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Reputable Exchanges */}
        <div className="space-y-3">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              Reputable Cryptocurrency Exchanges &amp; On-Ramps
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Purchase BTC, ETH, or USDT using a debit card, Apple Pay, or bank transfer, then withdraw directly to your BlueWhale address.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {REPUTABLE_EXCHANGES.map((ex) => (
              <a
                key={ex.name}
                href={ex.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-blue-500 dark:hover:border-blue-500 transition-colors flex flex-col justify-between gap-2"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-sm font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {ex.name}
                    </span>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 shrink-0" />
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {ex.regions}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed">
                    {ex.bestFor}
                  </p>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 pt-1.5 border-t border-slate-200 dark:border-slate-800">
                  {ex.methods}
                </div>
              </a>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Always verify the network before sending and keep your receipt screenshot or PDF.
          </span>
          <div className="flex items-center gap-2.5 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg"
            >
              Close
            </button>
            {onProceedToDeposit && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onProceedToDeposit();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                <span>Open Deposit Form</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
