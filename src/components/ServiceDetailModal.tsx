import { useEffect, useState } from 'react';
import { X, Check, ArrowRight, Globe, ShieldCheck, Bell } from 'lucide-react';
import {
  ACCOUNT_TIERS,
  COUNTRY_PRICE_MODIFIERS,
  getAccountPriceUsd,
  type AccountTier,
  type BaseTierPriceOverride,
  type ShippingServiceItem,
  type SupportedCountry,
} from '../data/shippingCatalog';
import { ProviderLogo } from './ProviderLogo';

interface ServiceDetailModalProps {
  service: ShippingServiceItem | null;
  selectedCountry: SupportedCountry;
  selectedAccountType: AccountTier;
  priceOverride?: BaseTierPriceOverride | null;
  hasActiveAlert?: boolean;
  onClose: () => void;
  onOrderService: (service: ShippingServiceItem, accountType: AccountTier) => void;
  onOpenPriceAlert?: (service: ShippingServiceItem, accountType: AccountTier) => void;
}

export function ServiceDetailModal({
  service,
  selectedCountry,
  selectedAccountType,
  priceOverride,
  hasActiveAlert = false,
  onClose,
  onOrderService,
  onOpenPriceAlert,
}: ServiceDetailModalProps) {
  const [tier, setTier] = useState<AccountTier>(selectedAccountType);

  useEffect(() => {
    setTier(selectedAccountType);
  }, [selectedAccountType, service?.id]);

  if (!service) return null;

  const activePrice = getAccountPriceUsd(service, tier, selectedCountry, priceOverride);
  const countryTierInfo = COUNTRY_PRICE_MODIFIERS[selectedCountry];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="service-detail-title"
    >
      <div className="relative w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 my-8">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close account details"
          className="absolute top-5 right-5 p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="space-y-5">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div>
              <ProviderLogo providerId={service.providerId} />
              <div className="mt-3 text-xs font-medium text-blue-600 dark:text-blue-400">
                {service.providerName} · {service.category}
              </div>
              <h2
                id="service-detail-title"
                className="mt-1 font-display text-xl font-bold text-slate-900 dark:text-white"
              >
                {service.serviceName}
              </h2>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs text-slate-500">
                {tier} · {selectedCountry}
              </div>
              <div className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                ${activePrice.toFixed(2)}
              </div>
            </div>
          </div>

          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {service.summary}
          </p>

          {/* Tier Price Comparison */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Select Account Type ({selectedCountry} · {countryTierInfo.regionLabel})
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {ACCOUNT_TIERS.map((t) => {
                const priceForTier = getAccountPriceUsd(service, t, selectedCountry, priceOverride);
                const active = tier === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTier(t)}
                    className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                      active
                        ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/50'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">{t}</div>
                    <div className="mt-1 font-mono text-base font-bold tabular-nums text-blue-700 dark:text-blue-300">
                      ${priceForTier.toFixed(2)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5">
            <div className="text-xs font-semibold text-slate-900 dark:text-white">
              Included Account Deliverables
            </div>
            <ul className="space-y-2">
              {service.deliverables.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300">
                  <Check className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="text-slate-500">Activation Timeframe</div>
              <div className="mt-1 font-semibold text-slate-900 dark:text-white">
                {service.activationWindow}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="text-slate-500">Verification Status</div>
              <div className="mt-1 font-semibold text-slate-900 dark:text-white">
                {service.verificationLevel}
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-600 dark:text-slate-400 flex items-start gap-2">
            <Globe className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <span>
              <strong className="text-slate-900 dark:text-white">Supported Countries:</strong>{' '}
              {service.countries.join(', ')}
            </span>
          </div>

          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <ShieldCheck className="w-4 h-4 text-blue-600" />
              <span>Country: {selectedCountry}</span>
            </div>
            <div className="flex items-center gap-2.5">
              {onOpenPriceAlert && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenPriceAlert(service, tier);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded-lg transition-colors cursor-pointer"
                >
                  <Bell className="w-3.5 h-3.5" />
                  <span>{hasActiveAlert ? 'Edit Alert' : 'Alert Me'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOrderService(service, tier);
                }}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
              >
                <span>Buy {tier} Account · ${activePrice.toFixed(2)}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
