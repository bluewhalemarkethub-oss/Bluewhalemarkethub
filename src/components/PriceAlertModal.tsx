import React, { useEffect, useState } from 'react';
import { Bell, BellRing, CheckCircle2, Globe, Lock, Trash2, X } from 'lucide-react';
import {
  ACCOUNT_TIERS,
  getAccountPriceUsd,
  type AccountTier,
  type BaseTierPriceOverride,
  type ShippingServiceItem,
  type SupportedCountry,
} from '../data/shippingCatalog';
import type { PriceAlert } from '../types/marketplace';
import { ProviderLogo } from './ProviderLogo';

interface PriceAlertModalProps {
  service: ShippingServiceItem | null;
  initialCountry: SupportedCountry;
  initialAccountType: AccountTier;
  priceOverrides: Record<string, BaseTierPriceOverride>;
  existingAlerts: PriceAlert[];
  isAuthenticated: boolean;
  onClose: () => void;
  onOpenAuth: () => void;
  onSaveAlert: (payload: {
    service: ShippingServiceItem;
    accountType: AccountTier;
    country: SupportedCountry;
    targetPrice: number;
    currentPrice: number;
    existingAlertId?: string;
  }) => Promise<void>;
  onDeleteAlert?: (alertId: string) => Promise<void>;
}

export function PriceAlertModal({
  service,
  initialCountry,
  initialAccountType,
  priceOverrides,
  existingAlerts,
  isAuthenticated,
  onClose,
  onOpenAuth,
  onSaveAlert,
  onDeleteAlert,
}: PriceAlertModalProps) {
  const [tier, setTier] = useState<AccountTier>(initialAccountType);
  const [country, setCountry] = useState<SupportedCountry>(initialCountry);
  const [targetPriceInput, setTargetPriceInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  const override = service ? priceOverrides[service.id] || null : null;
  const resolvedCountry =
    service && service.countries.includes(country)
      ? country
      : service?.countries[0] || initialCountry;
  const currentPrice = service
    ? getAccountPriceUsd(service, tier, resolvedCountry, override)
    : 100;

  const matchingAlert = service
    ? existingAlerts.find(
        (a) =>
          a.serviceId === service.id &&
          a.accountType === tier &&
          a.country === resolvedCountry &&
          a.status !== 'Cancelled',
      )
    : undefined;

  useEffect(() => {
    if (!service) return;
    setTier(initialAccountType);
    const nextCountry = service.countries.includes(initialCountry)
      ? initialCountry
      : service.countries[0];
    setCountry(nextCountry);
    setError('');
    setSavedMsg('');
  }, [service?.id, initialAccountType, initialCountry, service]);

  useEffect(() => {
    if (!service) return;
    if (matchingAlert && matchingAlert.targetPrice < currentPrice) {
      setTargetPriceInput(matchingAlert.targetPrice.toFixed(0));
    } else if (currentPrice > 105) {
      const suggested = Math.max(101, Math.floor(currentPrice * 0.9));
      setTargetPriceInput(String(suggested));
    } else if (currentPrice > 101) {
      setTargetPriceInput('101');
    } else {
      setTargetPriceInput('');
    }
    setError('');
  }, [service, tier, resolvedCountry, currentPrice, matchingAlert?.id]);

  if (!service) return null;

  const atMinimumFloor = currentPrice <= 101;
  const parsedTarget = Number(targetPriceInput);
  const presetPercentages = [5, 10, 15];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!service) return;
    setError('');
    setSavedMsg('');

    if (atMinimumFloor) {
      setError(
        `This configuration is already at $${currentPrice.toFixed(2)} (platform minimum floor is $100.00). Select Business or Corporate tier or another region to set a price-drop alert.`,
      );
      return;
    }
    if (Number.isNaN(parsedTarget) || parsedTarget <= 100 || parsedTarget >= currentPrice) {
      setError(
        `Enter a target price strictly above $100.00 and below the current price ($${currentPrice.toFixed(2)}).`,
      );
      return;
    }

    setSubmitting(true);
    try {
      await onSaveAlert({
        service,
        accountType: tier,
        country: resolvedCountry,
        targetPrice: parsedTarget,
        currentPrice,
        existingAlertId: matchingAlert?.id,
      });
      setSavedMsg(
        `Alert set! You will be notified as soon as ${service.providerName} ${tier} (${resolvedCountry}) drops below $${parsedTarget.toFixed(2)}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save price alert.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove() {
    if (!matchingAlert || !onDeleteAlert) return;
    setSubmitting(true);
    setError('');
    try {
      await onDeleteAlert(matchingAlert.id);
      setSavedMsg('Price alert removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove alert.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="price-alert-modal-title"
    >
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-7 my-8">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close price alert modal"
          className="absolute top-5 right-5 p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="space-y-5">
          <div className="pr-8 space-y-2">
            <ProviderLogo providerId={service.providerId} />
            <div className="flex items-center gap-2 pt-1 text-xs font-medium text-blue-600 dark:text-blue-400">
              <Bell className="w-3.5 h-3.5" />
              <span>Price Drop Watch · Alert Me</span>
            </div>
            <h2
              id="price-alert-modal-title"
              className="font-display text-xl font-bold text-slate-900 dark:text-white"
            >
              Set Target Price Alert
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Receive an automatic notification in your dashboard whenever {service.providerName} account pricing drops below your chosen threshold.
            </p>
          </div>

          {!isAuthenticated ? (
            <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center space-y-3">
              <Lock className="w-7 h-7 text-blue-600 mx-auto" />
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                Sign in to create price alerts
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Alerts are saved to your account so notifications appear across your sessions and devices.
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAuth();
                }}
                className="w-full py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
              >
                Sign In / Create Account
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Account Tier */}
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Account Tier
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {ACCOUNT_TIERS.map((t) => {
                    const price = getAccountPriceUsd(service, t, resolvedCountry, override);
                    const active = tier === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTier(t)}
                        className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                          active
                            ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/50'
                            : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <div className="text-xs font-semibold text-slate-900 dark:text-white">
                          {t}
                        </div>
                        <div className="font-mono text-xs font-bold tabular-nums text-blue-700 dark:text-blue-300 mt-0.5">
                          ${price.toFixed(2)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Country */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Country
                  </label>
                  <div className="relative">
                    <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <select
                      value={resolvedCountry}
                      onChange={(e) => setCountry(e.target.value as SupportedCountry)}
                      className="w-full pl-9 pr-3 py-2 text-xs font-medium bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                    >
                      {service.countries.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col justify-center">
                  <div className="text-[11px] text-slate-500">Live Account Price</div>
                  <div className="font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                    ${currentPrice.toFixed(2)} USD
                  </div>
                </div>
              </div>

              {matchingAlert && (
                <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 flex items-center justify-between gap-2 text-xs text-blue-800 dark:text-blue-200">
                  <div className="flex items-center gap-2">
                    <BellRing className="w-4 h-4 shrink-0" />
                    <span>
                      {matchingAlert.status === 'Triggered'
                        ? `Previous alert triggered at $${(matchingAlert.triggeredPrice || matchingAlert.targetPrice).toFixed(2)}. Save to re-arm.`
                        : `Active alert watching below $${matchingAlert.targetPrice.toFixed(2)}.`}
                    </span>
                  </div>
                  {onDeleteAlert && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleRemove}
                      className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 hover:underline shrink-0 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remove</span>
                    </button>
                  )}
                </div>
              )}

              {/* Target Price Input */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="target-price-input"
                    className="text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Notify Me When Price Drops Below (USD)
                  </label>
                  <span className="text-[11px] font-mono text-slate-500">
                    Range: $101 – ${(currentPrice - 1).toFixed(0)}
                  </span>
                </div>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm font-semibold text-slate-500">
                    $
                  </span>
                  <input
                    id="target-price-input"
                    type="number"
                    step="1"
                    min="101"
                    max={Math.max(101, Math.floor(currentPrice - 1))}
                    disabled={atMinimumFloor}
                    required
                    value={targetPriceInput}
                    onChange={(e) => setTargetPriceInput(e.target.value)}
                    placeholder={atMinimumFloor ? 'At $100 floor' : 'Enter target USD price'}
                    className="w-full pl-8 pr-16 py-2.5 font-mono text-sm font-semibold tabular-nums bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-50"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400">
                    USD
                  </span>
                </div>

                {!atMinimumFloor && (
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <span className="text-[11px] text-slate-500">Quick presets:</span>
                    {presetPercentages.map((pct) => {
                      const val = Math.floor(currentPrice * (1 - pct / 100));
                      if (val <= 100 || val >= currentPrice) return null;
                      return (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => setTargetPriceInput(String(val))}
                          className="px-2.5 py-1 text-[11px] font-mono font-medium bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/60 hover:text-blue-700 dark:hover:text-blue-300 border border-slate-200 dark:border-slate-700 rounded-md transition-colors cursor-pointer"
                        >
                          -{pct}% (${val})
                        </button>
                      );
                    })}
                  </div>
                )}

                {atMinimumFloor && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {service.providerName} {tier} ({resolvedCountry}) is already at the $100–$101 platform minimum. Choose Business or Corporate tier above to track a price drop.
                  </p>
                )}
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
                  {error}
                </div>
              )}

              {savedMsg && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-start gap-2 text-xs text-emerald-800 dark:text-emerald-200">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <span>{savedMsg}</span>
                </div>
              )}

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={submitting || atMinimumFloor}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                >
                  <Bell className="w-3.5 h-3.5" />
                  <span>
                    {submitting
                      ? 'Saving...'
                      : matchingAlert
                        ? 'Update Price Alert'
                        : 'Save Price Alert'}
                  </span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
