import type {
  AccountTier,
  CryptoCurrencyCode,
  ProviderId,
  SupportedCountry,
} from '../data/shippingCatalog';

export type AuthMode = 'firebase' | 'jwt';

export const ADMIN_EMAIL = 'johnblessing9977@gmail.com';
export const SUPPORT_EMAIL = 'Bluewhalemarkethub@gmail.com';
export const REGISTRATION_FEE_USD = 10;

export type SimpleAccountStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export type PaymentStatus =
  | 'unpaid'
  | 'pending_verification'
  | 'verified'
  | 'rejected';

export type AccountStatus =
  | 'Pending Payment'
  | 'Approved'
  | 'Rejected'
  | 'Suspended'
  | 'active'
  | 'suspended';

export type CanonicalAccountStatus =
  | 'Pending Payment'
  | 'Approved'
  | 'Rejected'
  | 'Suspended';

export type RegistrationPaymentStatus =
  | 'Unpaid'
  | 'Pending Review'
  | 'Approved'
  | 'Rejected';

export type DisplayUserRole = 'ADMIN' | 'USER';

export function getDisplayRole(role?: UserAccount['role'] | string): DisplayUserRole {
  return role === 'admin' ? 'ADMIN' : 'USER';
}

export function isExclusiveAdmin(
  user: Pick<UserAccount, 'role' | 'email'> | null | undefined,
): boolean {
  if (!user) return false;
  return user.role === 'admin' && user.email.trim().toLowerCase() === ADMIN_EMAIL;
}

export function normalizeAccountStatus(status?: string): CanonicalAccountStatus {
  const s = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (s === 'approved' || s === 'active') return 'Approved';
  if (s === 'suspended') return 'Suspended';
  if (s === 'rejected') return 'Rejected';
  return 'Pending Payment';
}

export function getSimpleAccountStatus(
  userOrStatus?:
    | Pick<UserAccount, 'role' | 'email' | 'status' | 'account_status'>
    | string
    | null,
): SimpleAccountStatus {
  if (!userOrStatus) return 'pending';
  if (typeof userOrStatus === 'string') {
    const s = userOrStatus.trim().toLowerCase();
    if (s === 'approved' || s === 'active') return 'approved';
    if (s === 'rejected') return 'rejected';
    if (s === 'suspended') return 'suspended';
    return 'pending';
  }
  if (isExclusiveAdmin(userOrStatus)) return 'approved';
  const raw = (userOrStatus.account_status || userOrStatus.status || '').trim().toLowerCase();
  if (raw === 'approved' || raw === 'active') return 'approved';
  if (raw === 'rejected') return 'rejected';
  if (raw === 'suspended') return 'suspended';
  return 'pending';
}

export function getPaymentStatus(
  userOrStatus?:
    | Pick<
        UserAccount,
        | 'role'
        | 'email'
        | 'status'
        | 'account_status'
        | 'payment_status'
        | 'registrationPaymentStatus'
      >
    | string
    | null,
): PaymentStatus {
  if (!userOrStatus) return 'unpaid';
  if (typeof userOrStatus === 'string') {
    const s = userOrStatus.trim().toLowerCase();
    if (s === 'verified' || s === 'approved' || s === 'paid') return 'verified';
    if (s === 'pending_verification' || s === 'pending review' || s === 'pending') {
      return 'pending_verification';
    }
    if (s === 'rejected') return 'rejected';
    return 'unpaid';
  }
  if (isExclusiveAdmin(userOrStatus)) return 'verified';
  if (userOrStatus.payment_status) {
    const explicit = userOrStatus.payment_status.trim().toLowerCase();
    if (explicit === 'verified') return 'verified';
    if (explicit === 'pending_verification') return 'pending_verification';
    if (explicit === 'rejected') return 'rejected';
    if (explicit === 'unpaid') return 'unpaid';
  }
  const legacyPayment = (userOrStatus.registrationPaymentStatus || '').trim().toLowerCase();
  if (legacyPayment === 'approved') return 'verified';
  if (legacyPayment === 'pending review') return 'pending_verification';
  if (legacyPayment === 'rejected') return 'rejected';
  if (!userOrStatus.payment_status && !userOrStatus.registrationPaymentStatus) {
    const legacyAccount = (userOrStatus.account_status || userOrStatus.status || '')
      .trim()
      .toLowerCase();
    if (legacyAccount === 'approved' || legacyAccount === 'active') return 'verified';
  }
  return 'unpaid';
}

export function toCanonicalFromSimpleStatus(status: SimpleAccountStatus): CanonicalAccountStatus {
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  if (status === 'suspended') return 'Suspended';
  return 'Pending Payment';
}

export function getAccountStatusLoginMessage(status: SimpleAccountStatus): string {
  if (status === 'pending') {
    return 'Your account is awaiting administrator approval.';
  }
  if (status === 'rejected') {
    return 'Your registration was not approved. Please contact support.';
  }
  if (status === 'suspended') {
    return 'Your account has been suspended. Contact support.';
  }
  return '';
}

export function hasDashboardAccess(
  user:
    | Pick<
        UserAccount,
        | 'role'
        | 'email'
        | 'status'
        | 'account_status'
        | 'payment_status'
        | 'registrationPaymentStatus'
        | 'dashboard_access'
      >
    | null
    | undefined,
): boolean {
  if (!user) return false;
  if (isExclusiveAdmin(user)) return true;
  const accountApproved = getSimpleAccountStatus(user) === 'approved';
  const paymentVerified = getPaymentStatus(user) === 'verified';
  if (typeof user.dashboard_access === 'boolean') {
    return accountApproved && paymentVerified && user.dashboard_access === true;
  }
  return accountApproved && paymentVerified;
}

export function getActivationBlockedMessage(
  user:
    | Pick<
        UserAccount,
        | 'role'
        | 'email'
        | 'status'
        | 'account_status'
        | 'payment_status'
        | 'registrationPaymentStatus'
        | 'dashboard_access'
      >
    | null
    | undefined,
): string {
  if (!user || isExclusiveAdmin(user)) return '';
  const accountStatus = getSimpleAccountStatus(user);
  const paymentStatus = getPaymentStatus(user);
  if (accountStatus === 'rejected') {
    return 'Your registration was not approved. Please contact support.';
  }
  if (accountStatus === 'suspended') {
    return 'Your account has been suspended. Contact support.';
  }
  if (paymentStatus === 'unpaid') {
    return 'Registration fee payment is required before account activation.';
  }
  if (paymentStatus === 'rejected') {
    return 'Your registration payment was rejected. Please submit new payment proof or contact support.';
  }
  if (paymentStatus === 'pending_verification') {
    return 'Your payment is under review. Dashboard access will be activated after payment verification.';
  }
  if (accountStatus === 'pending') {
    return 'Your account is awaiting administrator approval.';
  }
  if (!hasDashboardAccess(user)) {
    return 'Dashboard access will be activated once both account approval and payment verification are completed.';
  }
  return '';
}

export function isUserAccountApproved(
  user:
    | Pick<
        UserAccount,
        | 'role'
        | 'email'
        | 'status'
        | 'account_status'
        | 'payment_status'
        | 'registrationPaymentStatus'
        | 'dashboard_access'
      >
    | null
    | undefined,
): boolean {
  return hasDashboardAccess(user);
}

export interface UserAccount {
  uid: string;
  fullName: string;
  username: string;
  email: string;
  phoneNumber: string;
  country: string;
  role: 'customer' | 'admin';
  status: AccountStatus;
  account_status?: SimpleAccountStatus;
  payment_status?: PaymentStatus;
  dashboard_access?: boolean;
  isVerified: boolean;
  walletBalance: number;
  totalDeposits: number;
  totalPurchases: number;
  twoFactorEnabled: boolean;
  registrationPaymentStatus?: RegistrationPaymentStatus;
  registrationPaymentId?: string;
  registrationTxId?: string;
  registrationCrypto?: CryptoCurrencyCode;
  registrationFeeAmount?: number;
  registrationReceiptDataUrl?: string;
  registrationReceiptFileName?: string;
  registrationSubmittedAt?: string;
  paymentVerifiedAt?: string;
  approvedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  adminNotes?: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegistrationPayment {
  id: string;
  userId: string;
  userEmail: string;
  username: string;
  fullName: string;
  amount: number;
  currency: CryptoCurrencyCode;
  walletAddress: string;
  txId: string;
  receiptDataUrl: string;
  receiptFileName: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  rejectionReason?: string;
  adminNote?: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
}

export interface DepositRecord {
  id: string;
  userId: string;
  userEmail: string;
  username: string;
  userName?: string;
  amount: number;
  currency: CryptoCurrencyCode;
  walletAddress: string;
  txHash: string;
  receiptUrl?: string;
  receiptDataUrl?: string;
  receiptFileName?: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  adminNote?: string;
  rejectionReason?: string;
  reviewedBy?: string;
  approvedAt?: string;
  rejectedAt?: string;
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
    | 'Registration Payment Submitted'
    | 'Account Approved & Activated'
    | 'Registration Payment Rejected'
    | 'Account Suspended'
    | 'Deposit Successfully Added'
    | 'Deposit Rejected'
    | 'Service Purchase Completed'
    | 'Reset Your Password'
    | 'Price Drop Alert Triggered';
  body: string;
  category:
    | 'registration'
    | 'registration_payment'
    | 'deposit'
    | 'purchase'
    | 'security'
    | 'price_alert';
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

export interface AdminLogEntry {
  id: string;
  adminUid: string;
  adminEmail: string;
  action: string;
  targetUserId?: string;
  targetEmail?: string;
  targetUsername?: string;
  previousStatus?: string;
  newStatus?: string;
  details: string;
  createdAt: string;
}

export interface WebsiteSettings {
  id: string;
  registrationFeeUsd: number;
  minimumDepositUsd: number;
  supportEmail: string;
  marketplaceNotice: string;
  requireRegistrationApproval: boolean;
  updatedBy: string;
  updatedAt: string;
}
