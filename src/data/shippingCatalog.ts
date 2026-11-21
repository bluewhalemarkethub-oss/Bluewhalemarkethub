/**
 * Shipping marketplace catalog.
 *
 * PLACEHOLDER DATA: this file was rebuilt because the original was never
 * committed. Service listings, prices, country modifiers and FAQ copy are
 * sample values. The crypto wallet addresses below are NOT real. Replace them
 * with your own receiving addresses before accepting any deposits.
 */

export type AccountTier = 'Personal' | 'Business' | 'Corporate';

export const ACCOUNT_TIERS: AccountTier[] = ['Personal', 'Business', 'Corporate'];

export type ProviderId =
  | 'ups'
  | 'fedex'
  | 'usps'
  | 'royal-mail'
  | 'shipstation'
  | 'easypost'
  | 'easyship'
  | 'stamps';

export type SupportedCountry =
  | 'United States'
  | 'United Kingdom'
  | 'Canada'
  | 'Australia'
  | 'Germany'
  | 'France'
  | 'Spain'
  | 'Italy'
  | 'Netherlands'
  | 'Ireland'
  | 'Mexico'
  | 'Singapore'
  | 'United Arab Emirates'
  | 'Japan';

export const SUPPORTED_COUNTRIES: SupportedCountry[] = [
  'United States',
  'United Kingdom',
  'Canada',
  'Australia',
  'Germany',
  'France',
  'Spain',
  'Italy',
  'Netherlands',
  'Ireland',
  'Mexico',
  'Singapore',
  'United Arab Emirates',
  'Japan',
];

export interface CountryPriceModifier {
  multiplier: number;
  regionLabel: string;
}

export const COUNTRY_PRICE_MODIFIERS: Record<SupportedCountry, CountryPriceModifier> = {
  'United States': { multiplier: 1.0, regionLabel: 'North America · Standard' },
  'United Kingdom': { multiplier: 1.1, regionLabel: 'Europe · Premium' },
  Canada: { multiplier: 1.05, regionLabel: 'North America · Standard+' },
  Australia: { multiplier: 1.15, regionLabel: 'Oceania · Premium' },
  Germany: { multiplier: 1.1, regionLabel: 'Europe · Premium' },
  France: { multiplier: 1.1, regionLabel: 'Europe · Premium' },
  Spain: { multiplier: 1.05, regionLabel: 'Europe · Standard+' },
  Italy: { multiplier: 1.05, regionLabel: 'Europe · Standard+' },
  Netherlands: { multiplier: 1.1, regionLabel: 'Europe · Premium' },
  Ireland: { multiplier: 1.05, regionLabel: 'Europe · Standard+' },
  Mexico: { multiplier: 1.0, regionLabel: 'Latin America · Standard' },
  Singapore: { multiplier: 1.2, regionLabel: 'Asia Pacific · Elite' },
  'United Arab Emirates': { multiplier: 1.2, regionLabel: 'Middle East · Elite' },
  Japan: { multiplier: 1.15, regionLabel: 'Asia Pacific · Premium' },
};

export interface TierPrices {
  Personal: number;
  Business: number;
  Corporate: number;
}

/** Admin-set base prices that replace a service's default tier prices. */
export interface BaseTierPriceOverride {
  personalPrice: number;
  businessPrice: number;
  corporatePrice: number;
}

export interface ShippingServiceItem {
  id: string;
  providerId: ProviderId;
  providerName: string;
  serviceName: string;
  category: string;
  summary: string;
  verificationLevel: string;
  activationWindow: string;
  deliverables: string[];
  countries: SupportedCountry[];
  tierPrices: TierPrices;
}

const ALL_COUNTRIES = SUPPORTED_COUNTRIES;

export const SHIPPING_SERVICES: ShippingServiceItem[] = [
  {
    id: 'ups-account',
    providerId: 'ups',
    providerName: 'UPS',
    serviceName: 'UPS Verified Shipping Account',
    category: 'Carrier',
    summary: 'Verified UPS account with label creation and pickup scheduling.',
    verificationLevel: 'Fully Verified',
    activationWindow: 'Instant',
    deliverables: ['Account login credentials', 'Billing profile set up', 'Label printing enabled'],
    countries: ALL_COUNTRIES,
    tierPrices: { Personal: 150, Business: 250, Corporate: 400 },
  },
  {
    id: 'fedex-account',
    providerId: 'fedex',
    providerName: 'FedEx',
    serviceName: 'FedEx Verified Shipping Account',
    category: 'Carrier',
    summary: 'Verified FedEx account for domestic and international shipments.',
    verificationLevel: 'Fully Verified',
    activationWindow: 'Instant',
    deliverables: ['Account login credentials', 'Billing profile set up', 'Ship Manager access'],
    countries: ALL_COUNTRIES,
    tierPrices: { Personal: 150, Business: 250, Corporate: 400 },
  },
  {
    id: 'usps-account',
    providerId: 'usps',
    providerName: 'USPS',
    serviceName: 'USPS Business Shipping Account',
    category: 'Carrier',
    summary: 'Verified USPS account with Click-N-Ship access.',
    verificationLevel: 'Fully Verified',
    activationWindow: 'Instant',
    deliverables: ['Account login credentials', 'Click-N-Ship enabled', 'Pickup scheduling'],
    countries: ['United States'],
    tierPrices: { Personal: 100, Business: 180, Corporate: 300 },
  },
  {
    id: 'royal-mail-account',
    providerId: 'royal-mail',
    providerName: 'Royal Mail',
    serviceName: 'Royal Mail Click & Drop Account',
    category: 'Carrier',
    summary: 'Verified Royal Mail account for UK and international parcels.',
    verificationLevel: 'Fully Verified',
    activationWindow: 'Instant',
    deliverables: ['Account login credentials', 'Click & Drop access', 'Business billing profile'],
    countries: ['United Kingdom', 'Ireland'],
    tierPrices: { Personal: 120, Business: 200, Corporate: 320 },
  },
  {
    id: 'shipstation-account',
    providerId: 'shipstation',
    providerName: 'ShipStation',
    serviceName: 'ShipStation Multi-Carrier Account',
    category: 'Shipping Platform',
    summary: 'Verified ShipStation workspace with multi-carrier rate shopping.',
    verificationLevel: 'Fully Verified',
    activationWindow: 'Instant',
    deliverables: ['Workspace login credentials', 'Carrier connections', 'Store integrations'],
    countries: ALL_COUNTRIES,
    tierPrices: { Personal: 130, Business: 220, Corporate: 360 },
  },
  {
    id: 'easypost-account',
    providerId: 'easypost',
    providerName: 'EasyPost',
    serviceName: 'EasyPost API Account',
    category: 'Shipping API',
    summary: 'Verified EasyPost account with production API keys.',
    verificationLevel: 'Fully Verified',
    activationWindow: 'Instant',
    deliverables: ['Dashboard login credentials', 'Production API access', 'Carrier accounts linked'],
    countries: ALL_COUNTRIES,
    tierPrices: { Personal: 130, Business: 220, Corporate: 360 },
  },
  {
    id: 'easyship-account',
    providerId: 'easyship',
    providerName: 'EasyShip',
    serviceName: 'EasyShip Global Shipping Account',
    category: 'Shipping Platform',
    summary: 'Verified EasyShip account with discounted global courier rates.',
    verificationLevel: 'Fully Verified',
    activationWindow: 'Instant',
    deliverables: ['Account login credentials', 'Courier rate access', 'Store integrations'],
    countries: ALL_COUNTRIES,
    tierPrices: { Personal: 120, Business: 200, Corporate: 340 },
  },
  {
    id: 'stamps-account',
    providerId: 'stamps',
    providerName: 'Stamps.com',
    serviceName: 'Stamps.com Postage Account',
    category: 'Postage',
    summary: 'Verified Stamps.com account for discounted USPS and UPS postage.',
    verificationLevel: 'Fully Verified',
    activationWindow: 'Instant',
    deliverables: ['Account login credentials', 'Postage printing enabled', 'Billing profile set up'],
    countries: ['United States'],
    tierPrices: { Personal: 100, Business: 180, Corporate: 300 },
  },
];

/** All accounts start at $100 USD. */
export const MINIMUM_ACCOUNT_PRICE_USD = 100;

export function getAccountPriceUsd(
  service: Pick<ShippingServiceItem, 'tierPrices'>,
  tier: AccountTier,
  country: SupportedCountry | string,
  override?: BaseTierPriceOverride | null,
): number {
  const fromOverride = override
    ? tier === 'Business'
      ? override.businessPrice
      : tier === 'Corporate'
        ? override.corporatePrice
        : override.personalPrice
    : undefined;
  const base =
    typeof fromOverride === 'number' && Number.isFinite(fromOverride) && fromOverride > 0
      ? fromOverride
      : service.tierPrices[tier] ?? service.tierPrices.Personal;
  const modifier = COUNTRY_PRICE_MODIFIERS[country as SupportedCountry]?.multiplier ?? 1;
  const price = Math.round(base * modifier * 100) / 100;
  return Math.max(MINIMUM_ACCOUNT_PRICE_USD, price);
}

export type CryptoCurrencyCode = 'BTC' | 'ETH' | 'USDT_ERC20' | 'USDT_TRC20';

export interface CryptoWallet {
  code: CryptoCurrencyCode;
  symbol: string;
  name: string;
  networkLabel: string;
  /** PLACEHOLDER: replace with your real receiving address. */
  address: string;
  confirmationsRequired: number;
}

export const CRYPTO_WALLETS: CryptoWallet[] = [
  {
    code: 'BTC',
    symbol: 'BTC',
    name: 'Bitcoin',
    networkLabel: 'Bitcoin Network',
    address: 'REPLACE_WITH_YOUR_BTC_ADDRESS',
    confirmationsRequired: 2,
  },
  {
    code: 'ETH',
    symbol: 'ETH',
    name: 'Ethereum',
    networkLabel: 'Ethereum (ERC20)',
    address: 'REPLACE_WITH_YOUR_ETH_ADDRESS',
    confirmationsRequired: 12,
  },
  {
    code: 'USDT_ERC20',
    symbol: 'USDT',
    name: 'Tether USD (ERC20)',
    networkLabel: 'Ethereum (ERC20)',
    address: 'REPLACE_WITH_YOUR_USDT_ERC20_ADDRESS',
    confirmationsRequired: 12,
  },
  {
    code: 'USDT_TRC20',
    symbol: 'USDT',
    name: 'Tether USD (TRC20)',
    networkLabel: 'Tron (TRC20)',
    address: 'REPLACE_WITH_YOUR_USDT_TRC20_ADDRESS',
    confirmationsRequired: 20,
  },
];

export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: 'What account types are available and how are they priced?',
    answer:
      'All accounts start at $100 USD upward and are priced according to tier (Personal, Business, or Corporate) and your selected country.',
  },
  {
    question: 'What payment methods are accepted?',
    answer: 'Bitcoin, Ethereum, USDT ERC20 and USDT TRC20.',
  },
  {
    question: 'Minimum deposit?',
    answer: '$100.',
  },
  {
    question: 'How quickly are deposits and account orders processed?',
    answer:
      'Deposits are credited after transaction verification, and all verified accounts are instant and ready to use immediately upon purchase.',
  },
];

export interface KnowledgeBaseArticle {
  id: string;
  category: string;
  title: string;
  summary: string;
}

export const KNOWLEDGE_BASE_ARTICLES: KnowledgeBaseArticle[] = [
  {
    id: 'kb-deposits',
    category: 'Payments',
    title: 'How to fund your wallet with crypto',
    summary: 'Choose a currency, send to the listed address, then submit your TxID and receipt for approval.',
  },
  {
    id: 'kb-tiers',
    category: 'Accounts',
    title: 'Personal vs Business vs Corporate tiers',
    summary: 'Compare what each account tier includes and how country pricing affects the final cost.',
  },
  {
    id: 'kb-orders',
    category: 'Orders',
    title: 'Tracking your account orders',
    summary: 'Find order status, tracking codes and delivery details in your dashboard.',
  },
  {
    id: 'kb-security',
    category: 'Security',
    title: 'Enabling two-factor authentication',
    summary: 'Protect your marketplace account with an authenticator app.',
  },
];
