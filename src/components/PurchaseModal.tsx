import React, { useEffect, useState } from 'react';
import { X, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import {
  ACCOUNT_TIERS,
  getAccountPriceUsd,
  type AccountTier,
  type BaseTierPriceOverride,
  type ShippingServiceItem,
  type SupportedCountry,
} from '../data/shippingCatalog';
import { ProviderLogo } from './ProviderLogo';

interface PurchaseModalProps {
  service: ShippingServiceItem | null;
  country: SupportedCountry;
  initialAccountType: AccountTier;
  priceOverride?: BaseTierPriceOverride | null;
  walletBalance: number;
  isAuthenticated: boolean;
  defaultRecipientName: string;
  onClose: () => void;
  onOpenAuth: () => void;
  onOpenDeposit: () => void;
  onConfirmPurchase: (payload: {
    service: ShippingServiceItem;
    accountType: AccountTier;
    country: SupportedCountry;
    recipientName: string;
    destinationCity: string;
  }) => Promise<{ trackingCode: string }>;
}

export function PurchaseModal({
  service,
  country,
  initialAccountType,
  priceOverride,
  walletBalance,
  isAuthenticated,
  defaultRecipientName,
  onClose,
  onOpenAuth,
  onOpenDeposit,
  onConfirmPurchase,
}: PurchaseModalProps) {
  const [accountType, setAccountType] = useState<AccountTier>(initialAccountType);
  const [recipientName, setRecipientName] = useState(defaultRecipientName || '');
  const [destinationCity, setDestinationCity] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activationRef, setActivationRef] = useState<string | null>(null);

  useEffect(() => {
    setAccountType(initialAccountType);
    setActivationRef(null);
    setError('');
  }, [initialAccountType, service?.id]);

  if (!service) return null;

  const activePrice = getAccountPriceUsd(service, accountType, country, priceOverride);
  const hasSufficientBalance = walletBalance >= activePrice;
  const remainingBalance = Number((walletBalance - activePrice).toFixed(2));

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!service) return;
    setError('');
    setLoading(true);
    try {
      const result = await onConfirmPurchase({
        service,
        accountType,
        country,
        recipientName: recipientName.trim() || defaultRecipientName || 'Verified Account Holder',
        destinationCity: destinationCity.trim() || country,
      });
      setActivationRef(result.trackingCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Account purchase could not be completed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="purchase-modal-title"
    >
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 my-8">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close purchase modal"
          className="absolute top-5 right-5 p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="mb-5">
          <ProviderLogo providerId={service.providerId} />
          <h2 id="purchase-modal-title" className="mt-3 font-display text-xl font-bold text-slate-900 dark:text-white">
            Buy {service.providerName} {accountType} Account
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Jurisdiction: {country} · {service.activationWindow} · {service.verificationLevel}
          </p>
        </div>

        {activationRef ? (
          <div className="space-y-5">
            <div className="p-5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 space-y-2">
              <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-200 font-semibold text-sm">
                <CheckCircle2 className="w-5 h-5" />
                <span>Account Purchase Completed</span>
              </div>
              <p className="text-xs text-emerald-700 dark:text-emerald-300 leading-relaxed">
                ${activePrice.toFixed(2)} was deducted from your wallet for your {service.providerName} {accountType} Account ({country}), and your confirmation notice has been dispatched.
              </p>
              <div className="pt-2 border-t border-emerald-200 dark:border-emerald-800/60 flex items-center justify-between text-xs">
                <span className="text-emerald-700 dark:text-emerald-300">Activation Reference</span>
                <code className="font-mono font-semibold text-emerald-900 dark:text-emerald-100">
                  {activationRef}
                </code>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleConfirm} className="space-y-4">
            {/* Account Type Selection */}
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Account Type ({country})
              </label>
              <div className="grid grid-cols-3 gap-2">
                {ACCOUNT_TIERS.map((tier) => {
                  const tierPrice = getAccountPriceUsd(service, tier, country, priceOverride);
                  const active = accountType === tier;
                  return (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => setAccountType(tier)}
                      className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                        active
                          ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/50'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <div className="text-xs font-semibold text-slate-900 dark:text-white">{tier}</div>
                      <div className="font-mono text-xs font-bold tabular-nums text-blue-600 dark:text-blue-400 mt-0.5">
                        ${tierPrice.toFixed(2)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Account Price ({accountType})</span>
                <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                  ${activePrice.toFixed(2)}
                </span>
              </div>
              {isAuthenticated && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Available Wallet Balance</span>
                    <span className="font-mono tabular-nums text-slate-900 dark:text-white">
                      ${walletBalance.toFixed(2)}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Remaining After Purchase</span>
                    <span
                      className={`font-mono font-semibold tabular-nums ${
                        hasSufficientBalance
                          ? 'text-slate-900 dark:text-white'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      ${remainingBalance.toFixed(2)}
                    </span>
                  </div>
                </>
              )}
            </div>

            {!isAuthenticated ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Sign in or create an account to purchase this verified {accountType} account from your wallet balance.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAuth();
                  }}
                  className="w-full py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                >
                  Sign In to Continue
                </button>
              </div>
            ) : !hasSufficientBalance ? (
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Your wallet balance (${walletBalance.toFixed(2)}) is below the account price (${activePrice.toFixed(2)}). Deposit at least $100 via crypto to fund this purchase.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenDeposit();
                  }}
                  className="w-full py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                >
                  Deposit Funds Now
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      {accountType === 'Personal' ? 'Account Holder Name' : 'Registered Company / Holder'}
                    </label>
                    <input
                      type="text"
                      required
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      placeholder={accountType === 'Personal' ? 'Full legal name' : 'Company or entity name'}
                      className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Registration City / Region
                    </label>
                    <input
                      type="text"
                      required
                      value={destinationCity}
                      onChange={(e) => setDestinationCity(e.target.value)}
                      placeholder={`City in ${country}`}
                      className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                {error && (
                  <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-sm text-rose-700 dark:text-rose-300">
                    {error}
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors"
                  >
                    <span>{loading ? 'Provisioning...' : `Confirm & Pay $${activePrice.toFixed(2)}`}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
