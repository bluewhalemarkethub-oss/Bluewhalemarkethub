import type {
  AccountTier,
  CryptoCurrencyCode,
  ProviderId,
  SupportedCountry,
} from '../data/shippingCatalog';

export type AuthMode = 'firebase' | 'jwt';

export interface UserAccount {
  uid: string;
  fullName: string;
  username: string;
  email: string;
  phoneNumber: string;
  country: string;
  role: 'customer' | 'admin';
  status: 'active' | 'suspended';
  isVerified: boolean;
  walletBalance: number;
  totalDeposits: number;
  totalPurchases: number;
  twoFactorEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DepositRecord {
  id: string;
  userId: string;
  userEmail: string;
  username: string;
  amount: number;
  currency: CryptoCurrencyCode;
  walletAddress: string;
  txHash: string;
  receiptDataUrl?: string;
  receiptFileName?: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  adminNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShippingOrder {
  id: string;
  userId: string;
  userEmail: string;
  username: string;
  providerId: ProviderId | string;
  providerName: string;
  serviceName: string;
  accountType?: AccountTier;
  country: string;
  price: number;
  trackingCode: string;
  status: 'Pending' | 'Processing' | 'Completed' | 'Cancelled' | 'Refunded';
  recipientName?: string;
  destinationCity?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WalletTransaction {
  id: string;
  userId: string;
  type: 'deposit' | 'purchase' | 'refund';
  amount: number;
  direction: 'credit' | 'debit';
  referenceId: string;
  description: string;
  status: 'Pending' | 'Completed' | 'Rejected' | 'Refunded';
  createdAt: string;
}

export interface EmailNotification {
  id: string;
  userId: string;
  recipientEmail: string;
  subject:
    | 'Welcome to BlueWhale Markethub'
    | 'Deposit Successfully Added'
    | 'Service Purchase Completed'
    | 'Reset Your Password'
    | 'Price Drop Alert Triggered';
  body: string;
  category: 'registration' | 'deposit' | 'purchase' | 'security' | 'price_alert';
  read: boolean;
  createdAt: string;
}

export interface LoginActivity {
  id: string;
  userId: string;
  ipAddress: string;
  userAgent: string;
  deviceLabel: string;
  authMethod: string;
  createdAt: string;
}

export interface SecurityContextInfo {
  ipAddress: string;
  userAgent: string;
  deviceLabel: string;
  tlsActive: boolean;
}

export interface SupportTicket {
  id: string;
  userId: string;
  userEmail: string;
  username: string;
  subject: string;
  category:
    | 'Account Provisioning'
    | 'Carrier Onboarding'
    | 'Crypto Deposit'
    | 'Order Support'
    | 'Live Chat'
    | 'Technical';
  priority: 'Normal' | 'High' | 'Urgent';
  status: 'Open' | 'Replied' | 'Resolved' | 'Closed';
  lastMessage: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupportMessage {
  id: string;
  ticketId: string;
  ticketOwnerId: string;
  senderId: string;
  senderRole: 'customer' | 'admin';
  senderName: string;
  body: string;
  createdAt: string;
}

export interface CryptoPriceQuote {
  symbol: 'BTC' | 'ETH' | 'USDT';
  name: string;
  priceUsd: number;
  change24h: number;
}

export interface ServicePriceOverride {
  serviceId: string;
  personalPrice: number;
  businessPrice: number;
  corporatePrice: number;
  isPublic: boolean;
  updatedBy?: string;
  updatedAt: string;
}

export interface PriceAlert {
  id: string;
  userId: string;
  userEmail: string;
  username: string;
  serviceId: string;
  providerName: string;
  serviceName: string;
  accountType: AccountTier;
  country: SupportedCountry;
  targetPrice: number;
  initialPrice: number;
  triggeredPrice?: number;
  status: 'Active' | 'Triggered' | 'Cancelled';
  createdAt: string;
  updatedAt: string;
  triggeredAt?: string;
}
