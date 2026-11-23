import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import {
  ACCOUNT_TIERS,
  CRYPTO_WALLETS,
  SHIPPING_SERVICES,
  SUPPORTED_COUNTRIES,
  getAccountPriceUsd,
  type AccountTier,
  type SupportedCountry,
} from './src/data/shippingCatalog.ts';

dotenv.config();

const PORT = 3000;
const JWT_SECRET =
  process.env.JWT_SECRET ||
  crypto
    .createHash('sha256')
    .update(process.env.APP_URL || 'bluewhale-markethub-session-key')
    .digest('hex');
const SESSION_COOKIE_NAME = 'bw_session';
const CSRF_COOKIE_NAME = 'bw_csrf_token';
const REGISTRATION_FEE_USD = 5;
const ADMIN_EMAIL_CANONICAL = (process.env.ADMIN_EMAIL || 'johnblessing9977@gmail.com').trim().toLowerCase();
const DATA_DIR = path.resolve(process.cwd(), '.data');
const UPLOAD_DIR = path.resolve(DATA_DIR, 'uploads', 'receipts');
const STORE_PATH = path.join(DATA_DIR, 'bluewhale-jwt-store.json');

type SimpleAccountStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
type CanonicalUserStatus = 'Pending Payment' | 'Approved' | 'Rejected' | 'Suspended';
type LegacyOrCanonicalStatus = CanonicalUserStatus | 'active' | 'suspended';

function normalizeEmailInput(email: string): string {
  const clean = email.trim().toLowerCase();
  if (clean === 'johnblessing9977@gmail') {
    return ADMIN_EMAIL_CANONICAL;
  }
  return clean;
}

function isApprovedUserStatus(status?: string): boolean {
  const clean = typeof status === 'string' ? status.trim().toLowerCase() : '';
  return clean === 'approved' || clean === 'active';
}

function resolveSimpleAccountStatus(
  userOrStatus?:
    | Pick<JwtUserRecord, 'role' | 'email' | 'status' | 'account_status'>
    | string
    | null,
): SimpleAccountStatus {
  if (!userOrStatus) return 'pending';
  if (typeof userOrStatus === 'string') {
    const clean = userOrStatus.trim().toLowerCase();
    if (clean === 'approved' || clean === 'active') return 'approved';
    if (clean === 'rejected') return 'rejected';
    if (clean === 'suspended') return 'suspended';
    return 'pending';
  }
  if (
    userOrStatus.role === 'admin' &&
    normalizeEmailInput(userOrStatus.email) === ADMIN_EMAIL_CANONICAL
  ) {
    return 'approved';
  }
  const raw = String(userOrStatus.account_status || userOrStatus.status || '')
    .trim()
    .toLowerCase();
  if (raw === 'approved' || raw === 'active') return 'approved';
  if (raw === 'rejected') return 'rejected';
  if (raw === 'suspended') return 'suspended';
  return 'pending';
}

function toCanonicalStatusFromSimple(simple: SimpleAccountStatus): CanonicalUserStatus {
  if (simple === 'approved') return 'Approved';
  if (simple === 'rejected') return 'Rejected';
  if (simple === 'suspended') return 'Suspended';
  return 'Pending Payment';
}

function getLoginBlockedMessage(simple: SimpleAccountStatus): string {
  if (simple === 'pending') {
    return 'Your account is awaiting administrator approval.';
  }
  if (simple === 'rejected') {
    return 'Your registration was not approved. Please contact support.';
  }
  if (simple === 'suspended') {
    return 'Your account has been suspended. Contact support.';
  }
  return '';
}

interface JwtUserRecord {
  uid: string;
  fullName: string;
  username: string;
  email: string;
  passwordHash: string;
  country: string;
  phoneNumber: string;
  role: 'customer' | 'admin';
  status: LegacyOrCanonicalStatus;
  account_status?: SimpleAccountStatus;
  isVerified: boolean;
  emailVerificationCode: string;
  passwordResetCode: string | null;
  walletBalance: number;
  totalDeposits: number;
  totalPurchases: number;
  twoFactorEnabled: boolean;
  twoFactorSecret: string | null;
  registrationPaymentStatus?: 'Unpaid' | 'Pending Review' | 'Approved' | 'Rejected';
  registrationPaymentId?: string;
  registrationTxId?: string;
  registrationCrypto?: 'BTC' | 'ETH' | 'USDT_ERC20' | 'USDT_TRC20';
  registrationFeeAmount?: number;
  registrationReceiptDataUrl?: string;
  registrationReceiptFileName?: string;
  registrationSubmittedAt?: string;
  approvedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  adminNotes?: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface RegistrationPaymentRecord {
  id: string;
  userId: string;
  userEmail: string;
  username: string;
  fullName: string;
  amount: number;
  currency: 'BTC' | 'ETH' | 'USDT_ERC20' | 'USDT_TRC20';
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

interface DepositRecord {
  id: string;
  userId: string;
  userEmail: string;
  username: string;
  userName?: string;
  amount: number;
  currency: 'BTC' | 'ETH' | 'USDT_ERC20' | 'USDT_TRC20';
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

interface OrderRecord {
  id: string;
  userId: string;
  userEmail: string;
  username: string;
  providerId: string;
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

interface TransactionRecord {
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

interface NotificationRecord {
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

interface LoginLogRecord {
  id: string;
  userId: string;
  ipAddress: string;
  userAgent: string;
  deviceLabel: string;
  authMethod: string;
  createdAt: string;
}

interface SupportTicketRecord {
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

interface SupportMessageRecord {
  id: string;
  ticketId: string;
  ticketOwnerId: string;
  senderId: string;
  senderRole: 'customer' | 'admin';
  senderName: string;
  body: string;
  createdAt: string;
}

interface ContactSubmission {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  createdAt: string;
}

interface ServicePriceOverrideRecord {
  serviceId: string;
  personalPrice: number;
  businessPrice: number;
  corporatePrice: number;
  isPublic: boolean;
  updatedBy?: string;
  updatedAt: string;
}

interface PriceAlertRecord {
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

interface AdminLogRecord {
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

interface SiteSettingsRecord {
  id: string;
  registrationFeeUsd: number;
  minimumDepositUsd: number;
  supportEmail: string;
  marketplaceNotice: string;
  requireRegistrationApproval: boolean;
  updatedBy: string;
  updatedAt: string;
}

function defaultSiteSettings(): SiteSettingsRecord {
  return {
    id: 'global',
    registrationFeeUsd: REGISTRATION_FEE_USD,
    minimumDepositUsd: 100,
    supportEmail: 'Bluewhalemarkethub@gmail.com',
    marketplaceNotice:
      'Personal, Business & Corporate accounts across 14 countries starting from $100+ · Fund wallet via BTC, ETH & USDT.',
    requireRegistrationApproval: true,
    updatedBy: ADMIN_EMAIL_CANONICAL,
    updatedAt: new Date().toISOString(),
  };
}

interface StoreState {
  users: JwtUserRecord[];
  registrationPayments: RegistrationPaymentRecord[];
  deposits: DepositRecord[];
  orders: OrderRecord[];
  transactions: TransactionRecord[];
  notifications: NotificationRecord[];
  loginLogs: LoginLogRecord[];
  supportTickets: SupportTicketRecord[];
  supportMessages: SupportMessageRecord[];
  newsletterEmails: string[];
  contactSubmissions: ContactSubmission[];
  servicePricing: Record<string, ServicePriceOverrideRecord>;
  priceAlerts: PriceAlertRecord[];
  adminLogs: AdminLogRecord[];
  siteSettings: SiteSettingsRecord;
}

function loadStore(): StoreState {
  const fallbackSettings = defaultSiteSettings();
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreState>;
      const loadedUsers = (parsed.users || []).map((u) => {
        const normalizedRole =
          normalizeEmailInput(u.email) === ADMIN_EMAIL_CANONICAL
            ? u.role
            : ('customer' as const);
        const simpleStatus = resolveSimpleAccountStatus({ ...u, role: normalizedRole });
        return {
          ...u,
          role: normalizedRole,
          account_status: simpleStatus,
        };
      });
      return {
        users: loadedUsers,
        registrationPayments: parsed.registrationPayments || [],
        deposits: parsed.deposits || [],
        orders: parsed.orders || [],
        transactions: parsed.transactions || [],
        notifications: parsed.notifications || [],
        loginLogs: parsed.loginLogs || [],
        supportTickets: parsed.supportTickets || [],
        supportMessages: parsed.supportMessages || [],
        newsletterEmails: parsed.newsletterEmails || [],
        contactSubmissions: parsed.contactSubmissions || [],
        servicePricing: parsed.servicePricing || {},
        priceAlerts: parsed.priceAlerts || [],
        adminLogs: parsed.adminLogs || [],
        siteSettings: parsed.siteSettings
          ? { ...fallbackSettings, ...parsed.siteSettings }
          : fallbackSettings,
      };
    }
  } catch (err) {
    console.warn('Could not read local JWT store, initializing fresh state:', err);
  }
  return {
    users: [],
    registrationPayments: [],
    deposits: [],
    orders: [],
    transactions: [],
    notifications: [],
    loginLogs: [],
    supportTickets: [],
    supportMessages: [],
    newsletterEmails: [],
    contactSubmissions: [],
    servicePricing: {},
    priceAlerts: [],
    adminLogs: [],
    siteSettings: fallbackSettings,
  };
}

const store: StoreState = loadStore();

// Optionally bootstrap admin account from runtime Secrets if configured (never hardcoded)
if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 8) {
  const existingAdmin = store.users.find((u) => u.email === ADMIN_EMAIL_CANONICAL);
  if (!existingAdmin) {
    const now = new Date().toISOString();
    store.users.push({
      uid: `jwt_${crypto.randomUUID().replace(/-/g, '')}`,
      fullName: 'BlueWhale Administrator',
      username: 'bluewhale_admin',
      email: ADMIN_EMAIL_CANONICAL,
      passwordHash: bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12),
      country: 'United States',
      phoneNumber: '+1-800-555-0199',
      role: 'admin',
      status: 'Approved',
      account_status: 'approved',
      isVerified: true,
      emailVerificationCode: '000000',
      passwordResetCode: null,
      walletBalance: 0,
      totalDeposits: 0,
      totalPurchases: 0,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      registrationPaymentStatus: 'Approved',
      approvedAt: now,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
}

function appendAdminLog(params: {
  admin: Pick<JwtUserRecord, 'uid' | 'email'>;
  action: string;
  targetUser?: Pick<JwtUserRecord, 'uid' | 'email' | 'username'> | null;
  previousStatus?: string;
  newStatus?: string;
  details: string;
}): AdminLogRecord {
  const entry: AdminLogRecord = {
    id: `alog_${crypto.randomUUID().replace(/-/g, '')}`,
    adminUid: params.admin.uid,
    adminEmail: params.admin.email,
    action: params.action,
    targetUserId: params.targetUser?.uid,
    targetEmail: params.targetUser?.email,
    targetUsername: params.targetUser?.username,
    previousStatus: params.previousStatus,
    newStatus: params.newStatus,
    details: params.details.slice(0, 600),
    createdAt: new Date().toISOString(),
  };
  store.adminLogs.unshift(entry);
  if (store.adminLogs.length > 500) {
    store.adminLogs.length = 500;
  }
  return entry;
}

function saveStore(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.warn('Unable to persist local JWT store to disk:', err);
  }
}

// Live Crypto Prices cache (60s TTL)
let cachedCryptoPrices: {
  updatedAt: string;
  source: 'live' | 'cached';
  quotes: { symbol: 'BTC' | 'ETH' | 'USDT'; name: string; priceUsd: number; change24h: number }[];
} = {
  updatedAt: new Date().toISOString(),
  source: 'cached',
  quotes: [
    { symbol: 'BTC', name: 'Bitcoin', priceUsd: 91450.0, change24h: 2.14 },
    { symbol: 'ETH', name: 'Ethereum', priceUsd: 3180.5, change24h: 1.42 },
    { symbol: 'USDT', name: 'Tether USD', priceUsd: 1.0, change24h: 0.01 },
  ],
};
let lastPriceFetchMs = 0;

async function fetchLiveCryptoPrices() {
  const nowMs = Date.now();
  if (nowMs - lastPriceFetchMs < 60_000) {
    return cachedCryptoPrices;
  }
  lastPriceFetchMs = nowMs;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether&vs_currencies=usd&include_24hr_change=true',
      { signal: controller.signal },
    );
    clearTimeout(timeout);
    if (resp.ok) {
      const data = (await resp.json()) as {
        bitcoin?: { usd?: number; usd_24h_change?: number };
        ethereum?: { usd?: number; usd_24h_change?: number };
        tether?: { usd?: number; usd_24h_change?: number };
      };
      if (data.bitcoin?.usd && data.ethereum?.usd && data.tether?.usd) {
        cachedCryptoPrices = {
          updatedAt: new Date().toISOString(),
          source: 'live',
          quotes: [
            {
              symbol: 'BTC',
              name: 'Bitcoin',
              priceUsd: Number(data.bitcoin.usd),
              change24h: Number((data.bitcoin.usd_24h_change || 0).toFixed(2)),
            },
            {
              symbol: 'ETH',
              name: 'Ethereum',
              priceUsd: Number(data.ethereum.usd),
              change24h: Number((data.ethereum.usd_24h_change || 0).toFixed(2)),
            },
            {
              symbol: 'USDT',
              name: 'Tether USD',
              priceUsd: Number(data.tether.usd),
              change24h: Number((data.tether.usd_24h_change || 0).toFixed(2)),
            },
          ],
        };
      }
    }
  } catch {
    // Retain resilient fallback quotes when external network is restricted
  }
  return cachedCryptoPrices;
}

// RFC 6238 TOTP helpers using Node built-in crypto
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function generateBase32Secret(length = 20): string {
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < bytes.length; i += 1) {
    result += BASE32_ALPHABET[bytes[i] % 32];
  }
  return result;
}

function base32ToBuffer(base32: string): Buffer {
  const clean = base32.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = '';
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTotpAtCounter(secret: string, counter: number): string {
  const key = base32ToBuffer(secret);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

function verifyTotpCode(secret: string, token: string): boolean {
  const sanitized = token.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(sanitized)) return false;
  const currentCounter = Math.floor(Date.now() / 1000 / 30);
  for (let window = -1; window <= 1; window += 1) {
    if (generateTotpAtCounter(secret, currentCounter + window) === sanitized) {
      return true;
    }
  }
  return false;
}

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim().slice(0, 64);
  }
  return (req.ip || req.socket.remoteAddress || '127.0.0.1').slice(0, 64);
}

function parseDeviceLabel(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  const browser = ua.includes('edg')
    ? 'Edge'
    : ua.includes('chrome')
      ? 'Chrome'
      : ua.includes('safari')
        ? 'Safari'
        : ua.includes('firefox')
          ? 'Firefox'
          : 'Browser';
  const os = ua.includes('mac')
    ? 'macOS'
    : ua.includes('windows')
      ? 'Windows'
      : ua.includes('linux')
        ? 'Linux'
        : ua.includes('iphone') || ua.includes('ipad')
          ? 'iOS'
          : ua.includes('android')
            ? 'Android'
            : 'Desktop';
  return `${browser} on ${os}`;
}

function sanitizeUser(user: JwtUserRecord) {
  const simpleStatus = resolveSimpleAccountStatus(user);
  return {
    uid: user.uid,
    fullName: user.fullName,
    username: user.username,
    email: user.email,
    country: user.country,
    phoneNumber: user.phoneNumber,
    role: user.role,
    status: user.status,
    account_status: simpleStatus,
    isVerified: user.isVerified,
    walletBalance: user.walletBalance,
    totalDeposits: user.totalDeposits,
    totalPurchases: user.totalPurchases,
    twoFactorEnabled: user.twoFactorEnabled,
    registrationPaymentStatus: user.registrationPaymentStatus,
    registrationPaymentId: user.registrationPaymentId,
    registrationTxId: user.registrationTxId,
    registrationCrypto: user.registrationCrypto,
    registrationFeeAmount: user.registrationFeeAmount,
    registrationReceiptDataUrl: user.registrationReceiptDataUrl,
    registrationReceiptFileName: user.registrationReceiptFileName,
    registrationSubmittedAt: user.registrationSubmittedAt,
    approvedAt: user.approvedAt,
    rejectedAt: user.rejectedAt,
    rejectionReason: user.rejectionReason,
    adminNotes: user.adminNotes,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

interface JwtPayload {
  uid: string;
  email: string;
  role: 'customer' | 'admin';
}

interface AuthedRequest extends Request {
  jwtUser?: JwtUserRecord;
}

type PartitionedCookieOptions = import('express').CookieOptions & { partitioned?: boolean };

function setSessionCookie(req: Request, res: Response, token: string, rememberMe: boolean) {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const opts: PartitionedCookieOptions = {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    partitioned: isHttps,
    path: '/',
    maxAge: rememberMe ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000,
  };
  res.cookie(SESSION_COOKIE_NAME, token, opts as import('express').CookieOptions);
}

function clearSessionCookie(req: Request, res: Response) {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const opts: PartitionedCookieOptions = {
    path: '/',
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    partitioned: isHttps,
  };
  res.clearCookie(SESSION_COOKIE_NAME, opts as import('express').CookieOptions);
}

function extractJwtToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const headerTok = authHeader.slice('Bearer '.length).trim();
    if (headerTok && headerTok !== 'cookie-session') return headerTok;
  }
  const cookieTok = req.cookies?.[SESSION_COOKIE_NAME];
  return typeof cookieTok === 'string' && cookieTok.length > 0 ? cookieTok : null;
}

function requireJwtAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = extractJwtToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    const user = store.users.find((u) => u.uid === decoded.uid);
    if (!user) {
      return res.status(401).json({ error: 'Session no longer valid' });
    }
    req.jwtUser = user;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
}

function isExclusiveJwtAdminUser(user?: JwtUserRecord | null): boolean {
  return Boolean(
    user &&
      user.role === 'admin' &&
      normalizeEmailInput(user.email) === ADMIN_EMAIL_CANONICAL,
  );
}

function requireApprovedMember(req: AuthedRequest, res: Response, next: NextFunction) {
  const user = req.jwtUser;
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const simpleStatus = resolveSimpleAccountStatus(user);
  if (isExclusiveJwtAdminUser(user) || simpleStatus === 'approved') {
    return next();
  }
  return res.status(403).json({
    error: getLoginBlockedMessage(simpleStatus),
    account_status: simpleStatus,
  });
}

function requireJwtAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!isExclusiveJwtAdminUser(req.jwtUser)) {
    if (req.jwtUser) {
      appendAdminLog({
        admin: req.jwtUser,
        action: 'UNAUTHORIZED_ADMIN_ACCESS_BLOCKED',
        targetUser: req.jwtUser,
        details: `Blocked unauthorized admin API request (${req.method} ${req.originalUrl}) by ${req.jwtUser.email}`,
      });
      saveStore();
    }
    return res.status(403).json({
      error: `Admin privileges required. Access is restricted exclusively to ${ADMIN_EMAIL_CANONICAL}.`,
    });
  }
  return next();
}

function createSignedCsrfToken(): string {
  const nonce = crypto.randomBytes(24).toString('hex');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`csrf:${nonce}`).digest('hex');
  return `${nonce}.${sig}`;
}

function isValidSignedCsrfToken(token: string): boolean {
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return false;
  const nonce = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!/^[a-f0-9]{48}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(sig)) return false;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`csrf:${nonce}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function getRequestHost(req: Request): string {
  const fwdHost = req.headers['x-forwarded-host'];
  const rawHost = Array.isArray(fwdHost) ? fwdHost[0] : fwdHost || req.headers.host || '';
  return rawHost.split(',')[0].trim().toLowerCase();
}

function isSameOriginOrProxy(req: Request): boolean {
  const expectedHost = getRequestHost(req);
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.length > 0 && origin !== 'null') {
    try {
      return new URL(origin).host.toLowerCase() === expectedHost;
    } catch {
      return false;
    }
  }
  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer.length > 0) {
    try {
      return new URL(referer).host.toLowerCase() === expectedHost;
    } catch {
      return false;
    }
  }
  return true;
}

function verifyCsrf(req: Request, res: Response, next: NextFunction) {
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers['x-csrf-token'];
  if (typeof headerToken !== 'string' || headerToken.length === 0) {
    return res.status(403).json({
      error: 'CSRF security token missing. Please refresh and try again.',
      code: 'CSRF_ERROR',
    });
  }
  if (typeof cookieToken === 'string' && cookieToken.length > 0 && cookieToken === headerToken) {
    return next();
  }
  if (
    isValidSignedCsrfToken(headerToken) &&
    req.headers['x-requested-with'] === 'XMLHttpRequest' &&
    isSameOriginOrProxy(req)
  ) {
    return next();
  }
  return res.status(403).json({
    error: 'CSRF validation failed. Please refresh your session.',
    code: 'CSRF_ERROR',
  });
}

function detectAllowedUploadExtension(
  buf: Buffer,
  contentType: string,
): { ext: 'png' | 'jpg' | 'webp' | 'gif' | 'pdf'; mime: string } | null {
  if (buf.length < 12) return null;
  const ct = contentType.split(';')[0].trim().toLowerCase();

  // PNG magic: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    if (!ct || ct === 'image/png' || ct === 'application/octet-stream') {
      return { ext: 'png', mime: 'image/png' };
    }
  }

  // JPEG magic: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    if (!ct || ct === 'image/jpeg' || ct === 'image/jpg' || ct === 'application/octet-stream') {
      return { ext: 'jpg', mime: 'image/jpeg' };
    }
  }

  // GIF magic: GIF87a / GIF89a
  if (buf.subarray(0, 4).toString('ascii') === 'GIF8') {
    if (!ct || ct === 'image/gif' || ct === 'application/octet-stream') {
      return { ext: 'gif', mime: 'image/gif' };
    }
  }

  // WEBP magic: RIFF....WEBP
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    if (!ct || ct === 'image/webp' || ct === 'application/octet-stream') {
      return { ext: 'webp', mime: 'image/webp' };
    }
  }

  // PDF magic: %PDF-
  if (buf.subarray(0, 5).toString('ascii') === '%PDF-') {
    if (!ct || ct === 'application/pdf' || ct === 'application/octet-stream') {
      return { ext: 'pdf', mime: 'application/pdf' };
    }
  }

  return null;
}

const SAFE_UPLOAD_URL_RE = /^\/api\/uploads\/receipts\/[a-zA-Z0-9_\-]+\.(png|jpg|jpeg|webp|gif|pdf)$/;
const SAFE_UPLOAD_FILENAME_RE = /^[a-zA-Z0-9_\-]+\.(png|jpg|jpeg|webp|gif|pdf)$/;

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }),
  );

  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a few minutes.' },
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 40,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Try again shortly.' },
  });

  app.use('/api', apiLimiter);
  app.use('/api/auth', authLimiter);

  app.get('/api/security/csrf', (req: Request, res: Response) => {
    const existing = req.cookies?.[CSRF_COOKIE_NAME];
    const token =
      typeof existing === 'string' && isValidSignedCsrfToken(existing)
        ? existing
        : createSignedCsrfToken();
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const csrfCookieOpts: PartitionedCookieOptions = {
      httpOnly: false,
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
      partitioned: isHttps,
      path: '/',
      maxAge: 24 * 60 * 60 * 1000,
    };
    res.cookie(CSRF_COOKIE_NAME, token, csrfCookieOpts as import('express').CookieOptions);
    res.json({ csrfToken: token });
  });

  app.post(
    '/api/uploads/receipt',
    verifyCsrf,
    express.raw({
      type: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'application/pdf'],
      limit: '5mb',
    }),
    (req: Request, res: Response) => {
      const jwtTok = extractJwtToken(req);
      let isAuthedCaller = false;
      if (jwtTok) {
        try {
          const decoded = jwt.verify(jwtTok, JWT_SECRET) as JwtPayload;
          if (store.users.some((u) => u.uid === decoded.uid)) {
            isAuthedCaller = true;
          }
        } catch {
          return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
        }
      } else {
        const clientUid = req.headers['x-client-uid'];
        if (typeof clientUid === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(clientUid)) {
          isAuthedCaller = true;
        }
      }

      if (!isAuthedCaller) {
        return res.status(401).json({ error: 'Authentication required to upload payment receipts.' });
      }

      if (!Buffer.isBuffer(req.body) || req.body.length < 16) {
        return res.status(400).json({
          error: 'Please upload a valid receipt file (PNG, JPG, WEBP, GIF, or PDF up to 5 MB).',
        });
      }

      if (req.body.length > 5 * 1024 * 1024) {
        return res.status(413).json({ error: 'Receipt file size must not exceed 5 MB.' });
      }

      const detected = detectAllowedUploadExtension(
        req.body,
        String(req.headers['content-type'] || ''),
      );
      if (!detected) {
        return res.status(400).json({
          error: 'Unsupported or invalid receipt file. Only PNG, JPG, WEBP, GIF, and PDF files are accepted.',
        });
      }

      if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      }

      const storedFilename = `rcpt_${crypto.randomUUID().replace(/-/g, '')}.${detected.ext}`;
      const destPath = path.resolve(UPLOAD_DIR, storedFilename);
      if (!destPath.startsWith(UPLOAD_DIR + path.sep)) {
        return res.status(400).json({ error: 'Invalid upload destination.' });
      }

      fs.writeFileSync(destPath, req.body);

      let cleanOriginalName = `receipt.${detected.ext}`;
      const rawNameHeader = req.headers['x-file-name'];
      if (typeof rawNameHeader === 'string' && rawNameHeader.trim()) {
        try {
          cleanOriginalName = decodeURIComponent(rawNameHeader)
            .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
            .trim()
            .slice(0, 160);
        } catch {
          cleanOriginalName = `receipt.${detected.ext}`;
        }
      }

      return res.status(201).json({
        receiptUrl: `/api/uploads/receipts/${storedFilename}`,
        receiptFileName: cleanOriginalName || `receipt.${detected.ext}`,
        mimeType: detected.mime,
        sizeBytes: req.body.length,
      });
    },
  );

  app.get('/api/uploads/receipts/:filename', (req: Request, res: Response) => {
    const filename = String(req.params.filename || '');
    if (!SAFE_UPLOAD_FILENAME_RE.test(filename)) {
      return res.status(400).json({ error: 'Invalid receipt filename.' });
    }
    const resolved = path.resolve(UPLOAD_DIR, filename);
    if (!resolved.startsWith(UPLOAD_DIR + path.sep) || !fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'Receipt file not found.' });
    }
    const ext = path.extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.pdf': 'application/pdf',
    };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
    if (ext === '.pdf') {
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    }
    return res.sendFile(resolved);
  });

  app.get('/api/security/context', (req: Request, res: Response) => {
    const ipAddress = getClientIp(req);
    const userAgent = String(req.headers['user-agent'] || 'Unknown Client').slice(0, 240);
    const deviceLabel = parseDeviceLabel(userAgent);
    res.json({
      ipAddress,
      userAgent,
      deviceLabel,
      tlsActive: req.secure || req.headers['x-forwarded-proto'] === 'https',
    });
  });

  app.get('/api/crypto/prices', async (_req: Request, res: Response) => {
    const data = await fetchLiveCryptoPrices();
    res.json(data);
  });

  app.post('/api/newsletter/subscribe', verifyCsrf, (req: Request, res: Response) => {
    const { email } = req.body as { email?: string };
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }
    const clean = email.trim().toLowerCase();
    if (!store.newsletterEmails.includes(clean)) {
      store.newsletterEmails.push(clean);
      saveStore();
    }
    return res.json({ subscribed: true, email: clean });
  });

  app.post('/api/contact', verifyCsrf, (req: Request, res: Response) => {
    const { name, email, subject, message } = req.body as {
      name?: string;
      email?: string;
      subject?: string;
      message?: string;
    };
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: 'All contact fields are required.' });
    }
    const entry: ContactSubmission = {
      id: `cnt_${crypto.randomUUID().replace(/-/g, '')}`,
      name: name.trim().slice(0, 100),
      email: email.trim().toLowerCase().slice(0, 160),
      subject: subject.trim().slice(0, 140),
      message: message.trim().slice(0, 1500),
      createdAt: new Date().toISOString(),
    };
    store.contactSubmissions.unshift(entry);
    saveStore();
    return res.status(201).json({ submitted: true, ticketRef: entry.id });
  });

  app.post('/api/security/antifraud-check', verifyCsrf, (req: Request, res: Response) => {
    const { action, amount, txHash } = req.body as {
      action?: string;
      amount?: number;
      txHash?: string;
    };

    if (action === 'deposit') {
      if (typeof amount !== 'number' || Number.isNaN(amount) || amount < 100) {
        return res.status(400).json({ passed: false, reason: 'Minimum deposit is $100.00 USD.' });
      }
      if (!txHash || typeof txHash !== 'string' || txHash.trim().length < 10) {
        return res.status(400).json({ passed: false, reason: 'Valid blockchain transaction hash is required.' });
      }
      const duplicate = store.deposits.some(
        (d) => d.txHash.toLowerCase() === txHash.trim().toLowerCase() && d.status !== 'Rejected',
      );
      if (duplicate) {
        return res.status(409).json({
          passed: false,
          reason: 'Duplicate transaction hash flagged by anti-fraud monitor.',
        });
      }
    }

    return res.json({
      passed: true,
      riskLevel: 'low',
      checkedAt: new Date().toISOString(),
    });
  });

  app.post('/api/security/2fa/generate', verifyCsrf, (req: Request, res: Response) => {
    const { email } = req.body as { email?: string };
    const accountLabel = (email || 'member@bluewhalemarkethub.com').trim();
    const secret = generateBase32Secret(20);
    const issuer = 'BlueWhale Markethub';
    const otpauthUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountLabel)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    res.json({ secret, otpauthUrl });
  });

  app.post('/api/security/2fa/verify', verifyCsrf, (req: Request, res: Response) => {
    const { secret, code } = req.body as { secret?: string; code?: string };
    if (!secret || !code) {
      return res.status(400).json({ valid: false, error: 'Secret and 6-digit code are required' });
    }
    const valid = verifyTotpCode(secret, code);
    if (!valid) {
      return res.status(400).json({ valid: false, error: 'Invalid or expired 6-digit authenticator code' });
    }
    return res.json({ valid: true });
  });

  app.get('/api/catalog', (req: Request, res: Response) => {
    const countryParam =
      typeof req.query.country === 'string' && SUPPORTED_COUNTRIES.includes(req.query.country as SupportedCountry)
        ? (req.query.country as SupportedCountry)
        : undefined;
    const tierParam: AccountTier =
      typeof req.query.accountType === 'string' && ACCOUNT_TIERS.includes(req.query.accountType as AccountTier)
        ? (req.query.accountType as AccountTier)
        : 'Personal';
    const filtered = countryParam
      ? SHIPPING_SERVICES.filter((s) => s.countries.includes(countryParam))
      : SHIPPING_SERVICES;
    const services = filtered.map((s) => ({
      ...s,
      computedPriceUsd: getAccountPriceUsd(
        s,
        tierParam,
        countryParam || 'United States',
        store.servicePricing[s.id] || null,
      ),
    }));
    res.json({
      countries: SUPPORTED_COUNTRIES,
      accountTiers: ACCOUNT_TIERS,
      services,
      servicePricing: Object.values(store.servicePricing),
      cryptoWallets: CRYPTO_WALLETS,
    });
  });

  app.get('/api/catalog/pricing', (_req: Request, res: Response) => {
    res.json({
      servicePricing: Object.values(store.servicePricing),
    });
  });

  app.get('/api/settings', (_req: Request, res: Response) => {
    res.json({ siteSettings: store.siteSettings });
  });

  app.get('/api/auth/session', (req: Request, res: Response) => {
    const token = extractJwtToken(req);
    if (!token) {
      return res.json({ user: null });
    }
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
      const user = store.users.find((u) => u.uid === decoded.uid);
      if (!user) {
        clearSessionCookie(req, res);
        return res.json({ user: null });
      }
      const simpleStatus = resolveSimpleAccountStatus(user);
      if (!isExclusiveJwtAdminUser(user) && simpleStatus !== 'approved') {
        clearSessionCookie(req, res);
        return res.json({
          user: null,
          account_status: simpleStatus,
          blockedMessage: getLoginBlockedMessage(simpleStatus),
        });
      }
      return res.json({ user: sanitizeUser(user), token });
    } catch {
      clearSessionCookie(req, res);
      return res.json({ user: null });
    }
  });

  app.post('/api/auth/logout', verifyCsrf, (req: Request, res: Response) => {
    clearSessionCookie(req, res);
    return res.json({ loggedOut: true });
  });

  app.get('/api/auth/admin-status', (_req: Request, res: Response) => {
    const hasAdmin = store.users.some((u) => u.role === 'admin');
    return res.json({ hasAdmin, adminEmail: ADMIN_EMAIL_CANONICAL });
  });

  app.post('/api/auth/admin-claim', verifyCsrf, async (req: Request, res: Response) => {
    const hasAdmin = store.users.some((u) => u.role === 'admin');
    if (hasAdmin) {
      return res.status(403).json({ error: 'Administrator account is already configured.' });
    }
    const { email, password, fullName } = req.body as {
      email?: string;
      password?: string;
      fullName?: string;
    };
    const cleanEmail = normalizeEmailInput(email || '');
    if (cleanEmail !== ADMIN_EMAIL_CANONICAL) {
      return res.status(403).json({ error: `Admin setup is restricted to ${ADMIN_EMAIL_CANONICAL}.` });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Admin password must be at least 8 characters.' });
    }
    const now = new Date().toISOString();
    const uid = `jwt_${crypto.randomUUID().replace(/-/g, '')}`;
    const adminUser: JwtUserRecord = {
      uid,
      fullName: (fullName || 'BlueWhale Administrator').trim().slice(0, 100),
      username: 'bluewhale_admin',
      email: cleanEmail,
      passwordHash: await bcrypt.hash(password, 12),
      country: 'United States',
      phoneNumber: '+1-800-555-0199',
      role: 'admin',
      status: 'Approved',
      account_status: 'approved',
      isVerified: true,
      emailVerificationCode: '000000',
      passwordResetCode: null,
      walletBalance: 0,
      totalDeposits: 0,
      totalPurchases: 0,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      registrationPaymentStatus: 'Approved',
      approvedAt: now,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    };
    store.users.push(adminUser);
    appendAdminLog({
      admin: adminUser,
      action: 'ADMIN_ACCOUNT_INITIALIZED',
      targetUser: adminUser,
      newStatus: 'Approved',
      details: `Exclusive administrator account initialized for ${adminUser.email}`,
    });
    saveStore();
    const token = jwt.sign({ uid: adminUser.uid, email: adminUser.email, role: 'admin' }, JWT_SECRET, {
      expiresIn: '12h',
    });
    setSessionCookie(req, res, token, false);
    return res.status(201).json({ token, user: sanitizeUser(adminUser) });
  });

  // Express JWT Authentication & Registration
  app.post('/api/auth/register', verifyCsrf, async (req: Request, res: Response) => {
    const {
      firstName,
      lastName,
      fullName,
      username,
      email,
      password,
      confirmPassword,
      country,
      phoneNumber,
      antiSpamVerified,
      rememberMe,
    } = req.body as {
      firstName?: string;
      lastName?: string;
      fullName?: string;
      username?: string;
      email?: string;
      password?: string;
      confirmPassword?: string;
      country?: string;
      phoneNumber?: string;
      antiSpamVerified?: boolean;
      rememberMe?: boolean;
    };

    const resolvedFullName =
      fullName?.trim() || `${firstName?.trim() || ''} ${lastName?.trim() || ''}`.trim();

    if (!resolvedFullName || !username || !email || !password || !country || !phoneNumber) {
      return res.status(400).json({ error: 'All registration fields are required.' });
    }
    if (confirmPassword !== undefined && password !== confirmPassword) {
      return res.status(400).json({ error: 'Password and Confirm Password do not match.' });
    }
    if (!antiSpamVerified) {
      return res.status(400).json({ error: 'Please complete the anti-spam security check.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const cleanEmail = normalizeEmailInput(email);
    if (store.users.some((u) => u.email === cleanEmail)) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    if (store.users.some((u) => u.username.toLowerCase() === username.trim().toLowerCase())) {
      return res.status(409).json({ error: 'Username is already taken.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const verificationCode = String(crypto.randomInt(100000, 999999));
    const now = new Date().toISOString();
    const uid = `jwt_${crypto.randomUUID().replace(/-/g, '')}`;
    const isBootstrappedAdmin = cleanEmail === ADMIN_EMAIL_CANONICAL;

    const user: JwtUserRecord = {
      uid,
      fullName: resolvedFullName.slice(0, 100),
      username: username.trim().slice(0, 40),
      email: cleanEmail,
      passwordHash,
      country: country.trim(),
      phoneNumber: phoneNumber.trim().slice(0, 32),
      role: isBootstrappedAdmin ? 'admin' : 'customer',
      status: isBootstrappedAdmin ? 'Approved' : 'Pending Payment',
      account_status: isBootstrappedAdmin ? 'approved' : 'pending',
      isVerified: isBootstrappedAdmin,
      emailVerificationCode: verificationCode,
      passwordResetCode: null,
      walletBalance: 0,
      totalDeposits: 0,
      totalPurchases: 0,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      registrationPaymentStatus: isBootstrappedAdmin ? 'Approved' : 'Unpaid',
      approvedAt: isBootstrappedAdmin ? now : undefined,
      lastLoginAt: isBootstrappedAdmin ? now : undefined,
      createdAt: now,
      updatedAt: now,
    };

    store.users.push(user);

    const welcomeNotif: NotificationRecord = {
      id: `notif_${crypto.randomUUID().replace(/-/g, '')}`,
      userId: uid,
      recipientEmail: cleanEmail,
      subject: 'Welcome to BlueWhale Markethub',
      body: isBootstrappedAdmin
        ? `Welcome ${user.fullName}! Your BlueWhale Markethub administrator account is active.`
        : `Welcome ${user.fullName}! Your account (@${user.username}) has been submitted for review and approval by our administration team. You will be able to log in once your account has been approved.`,
      category: 'registration',
      read: false,
      createdAt: now,
    };
    store.notifications.unshift(welcomeNotif);

    saveStore();

    if (!isBootstrappedAdmin) {
      clearSessionCookie(req, res);
      return res.status(201).json({
        registered: true,
        requiresApproval: true,
        account_status: 'pending',
        message:
          'Registration Successful\n\nYour account has been submitted for review and approval by our administration team.\n\nYou will be able to log in once your account has been approved.',
        user: sanitizeUser(user),
        verificationPreviewCode: verificationCode,
        emailDispatch: welcomeNotif,
      });
    }

    const ipAddress = getClientIp(req);
    const userAgent = String(req.headers['user-agent'] || 'Unknown').slice(0, 240);
    store.loginLogs.unshift({
      id: `log_${crypto.randomUUID().replace(/-/g, '')}`,
      userId: uid,
      ipAddress,
      userAgent,
      deviceLabel: parseDeviceLabel(userAgent),
      authMethod: 'JWT + bcrypt',
      createdAt: now,
    });
    saveStore();

    const token = jwt.sign({ uid: user.uid, email: user.email, role: user.role }, JWT_SECRET, {
      expiresIn: rememberMe ? '30d' : '12h',
    });
    setSessionCookie(req, res, token, Boolean(rememberMe));

    return res.status(201).json({
      registered: true,
      requiresApproval: false,
      account_status: 'approved',
      token,
      user: sanitizeUser(user),
      verificationPreviewCode: verificationCode,
      emailDispatch: welcomeNotif,
    });
  });

  app.post('/api/auth/login', verifyCsrf, async (req: Request, res: Response) => {
    const { email, password, twoFactorCode, rememberMe } = req.body as {
      email?: string;
      password?: string;
      twoFactorCode?: string;
      rememberMe?: boolean;
    };

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const cleanEmail = normalizeEmailInput(email);
    const user = store.users.find((u) => u.email === cleanEmail);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const accountStatus = resolveSimpleAccountStatus(user);
    if (!isExclusiveJwtAdminUser(user) && accountStatus !== 'approved') {
      clearSessionCookie(req, res);
      return res.status(403).json({
        error: getLoginBlockedMessage(accountStatus),
        account_status: accountStatus,
      });
    }

    if (user.twoFactorEnabled && user.twoFactorSecret) {
      if (!twoFactorCode) {
        return res.status(202).json({ requires2FA: true, message: 'Enter your 6-digit 2FA code.' });
      }
      if (!verifyTotpCode(user.twoFactorSecret, twoFactorCode)) {
        return res.status(401).json({ error: 'Invalid 2FA verification code.' });
      }
    }

    const now = new Date().toISOString();
    user.lastLoginAt = now;
    user.updatedAt = now;
    const ipAddress = getClientIp(req);
    const userAgent = String(req.headers['user-agent'] || 'Unknown').slice(0, 240);
    store.loginLogs.unshift({
      id: `log_${crypto.randomUUID().replace(/-/g, '')}`,
      userId: user.uid,
      ipAddress,
      userAgent,
      deviceLabel: parseDeviceLabel(userAgent),
      authMethod: user.twoFactorEnabled ? 'JWT + 2FA' : 'JWT + bcrypt',
      createdAt: now,
    });
    saveStore();

    const token = jwt.sign({ uid: user.uid, email: user.email, role: user.role }, JWT_SECRET, {
      expiresIn: rememberMe ? '30d' : '12h',
    });
    setSessionCookie(req, res, token, Boolean(rememberMe));

    return res.json({ token, user: sanitizeUser(user) });
  });

  app.post('/api/auth/verify-email', verifyCsrf, requireJwtAuth, (req: AuthedRequest, res: Response) => {
    const { code } = req.body as { code?: string };
    const user = req.jwtUser!;
    if (!code || code.trim() !== user.emailVerificationCode) {
      return res.status(400).json({ error: 'Incorrect email verification code.' });
    }
    user.isVerified = true;
    user.updatedAt = new Date().toISOString();
    saveStore();
    return res.json({ user: sanitizeUser(user) });
  });

  app.post('/api/auth/forgot-password', verifyCsrf, (req: Request, res: Response) => {
    const { email } = req.body as { email?: string };
    if (!email) {
      return res.status(400).json({ error: 'Email address is required.' });
    }
    const cleanEmail = email.trim().toLowerCase();
    const user = store.users.find((u) => u.email === cleanEmail);
    if (!user) {
      return res.json({
        dispatched: true,
        message: 'If that email exists, a password reset code has been sent.',
      });
    }
    const resetCode = String(crypto.randomInt(100000, 999999));
    user.passwordResetCode = resetCode;
    const now = new Date().toISOString();
    const resetNotif: NotificationRecord = {
      id: `notif_${crypto.randomUUID().replace(/-/g, '')}`,
      userId: user.uid,
      recipientEmail: cleanEmail,
      subject: 'Reset Your Password',
      body: `We received a request to reset your BlueWhale Markethub password. Use verification code ${resetCode} to set a new password.`,
      category: 'security',
      read: false,
      createdAt: now,
    };
    store.notifications.unshift(resetNotif);
    saveStore();
    return res.json({
      dispatched: true,
      resetPreviewCode: resetCode,
      emailDispatch: resetNotif,
      message: 'Password reset instructions generated.',
    });
  });

  app.post('/api/auth/reset-password', verifyCsrf, async (req: Request, res: Response) => {
    const { email, code, newPassword } = req.body as {
      email?: string;
      code?: string;
      newPassword?: string;
    };
    if (!email || !code || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Valid email, reset code, and 8+ character password are required.' });
    }
    const user = store.users.find((u) => u.email === email.trim().toLowerCase());
    if (!user || !user.passwordResetCode || user.passwordResetCode !== code.trim()) {
      return res.status(400).json({ error: 'Invalid or expired reset code.' });
    }
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.passwordResetCode = null;
    user.updatedAt = new Date().toISOString();
    saveStore();
    return res.json({ success: true });
  });

  app.get('/api/jwt/dashboard', requireJwtAuth, (req: AuthedRequest, res: Response) => {
    const user = req.jwtUser!;
    const isAdmin = isExclusiveJwtAdminUser(user);
    const simpleStatus = resolveSimpleAccountStatus(user);
    const isApproved = isAdmin || simpleStatus === 'approved';

    if (!isApproved) {
      clearSessionCookie(req, res);
      return res.status(403).json({
        error: getLoginBlockedMessage(simpleStatus),
        account_status: simpleStatus,
      });
    }

    return res.json({
      user: sanitizeUser(user),
      deposits: isAdmin ? store.deposits : store.deposits.filter((d) => d.userId === user.uid),
      orders: isAdmin ? store.orders : store.orders.filter((o) => o.userId === user.uid),
      transactions: isAdmin
        ? store.transactions
        : store.transactions.filter((t) => t.userId === user.uid),
      notifications: store.notifications.filter((n) => n.userId === user.uid),
      loginLogs: isAdmin ? store.loginLogs : store.loginLogs.filter((l) => l.userId === user.uid),
      supportTickets: isAdmin
        ? store.supportTickets
        : store.supportTickets.filter((t) => t.userId === user.uid),
      supportMessages: isAdmin
        ? store.supportMessages
        : store.supportMessages.filter((m) => m.ticketOwnerId === user.uid),
      priceAlerts: isAdmin
        ? store.priceAlerts
        : store.priceAlerts.filter((a) => a.userId === user.uid),
      registrationPayments: isAdmin
        ? store.registrationPayments
        : store.registrationPayments.filter((p) => p.userId === user.uid),
      servicePricing: Object.values(store.servicePricing),
      allUsers: isAdmin ? store.users.map(sanitizeUser) : [],
      adminLogs: isAdmin ? store.adminLogs : [],
      siteSettings: store.siteSettings,
    });
  });

  app.post('/api/jwt/profile', verifyCsrf, requireJwtAuth, requireApprovedMember, (req: AuthedRequest, res: Response) => {
    const user = req.jwtUser!;
    const { fullName, username, country, phoneNumber } = req.body as {
      fullName?: string;
      username?: string;
      country?: string;
      phoneNumber?: string;
    };
    if (fullName) user.fullName = fullName.trim().slice(0, 100);
    if (username) user.username = username.trim().slice(0, 40);
    if (country) user.country = country.trim().slice(0, 64);
    if (phoneNumber) user.phoneNumber = phoneNumber.trim().slice(0, 32);
    user.updatedAt = new Date().toISOString();
    saveStore();
    return res.json({ user: sanitizeUser(user) });
  });

  app.post('/api/jwt/change-password', verifyCsrf, requireJwtAuth, async (req: AuthedRequest, res: Response) => {
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };
    const user = req.jwtUser!;
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Current password and new 8+ character password required.' });
    }
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.updatedAt = new Date().toISOString();
    saveStore();
    return res.json({ success: true });
  });

  app.post('/api/jwt/2fa/enable', verifyCsrf, requireJwtAuth, requireApprovedMember, (req: AuthedRequest, res: Response) => {
    const { secret, code } = req.body as { secret?: string; code?: string };
    const user = req.jwtUser!;
    if (!secret || !code || !verifyTotpCode(secret, code)) {
      return res.status(400).json({ error: 'Invalid 6-digit authenticator code.' });
    }
    user.twoFactorEnabled = true;
    user.twoFactorSecret = secret;
    user.updatedAt = new Date().toISOString();
    saveStore();
    return res.json({ user: sanitizeUser(user) });
  });

  app.post('/api/jwt/2fa/disable', verifyCsrf, requireJwtAuth, requireApprovedMember, (req: AuthedRequest, res: Response) => {
    const user = req.jwtUser!;
    user.twoFactorEnabled = false;
    user.twoFactorSecret = null;
    user.updatedAt = new Date().toISOString();
    saveStore();
    return res.json({ user: sanitizeUser(user) });
  });

  const SAFE_RECEIPT_RE =
    /^data:(image\/(jpeg|png|webp|gif)|application\/pdf);base64,[A-Za-z0-9+/=]+$/;

  app.post('/api/jwt/registration-payment', verifyCsrf, requireJwtAuth, (req: AuthedRequest, res: Response) => {
    const user = req.jwtUser!;
    if (isApprovedUserStatus(user.status) && user.role !== 'admin') {
      return res.status(400).json({ error: 'Your account is already approved.' });
    }
    if (user.status === 'Suspended' || user.status === 'suspended') {
      return res.status(403).json({ error: 'Suspended accounts cannot submit registration proof. Contact Bluewhalemarkethub@gmail.com.' });
    }

    const { amount, currency, txId, receiptDataUrl, receiptFileName } = req.body as {
      amount?: number;
      currency?: 'BTC' | 'ETH' | 'USDT_ERC20' | 'USDT_TRC20';
      txId?: string;
      receiptDataUrl?: string;
      receiptFileName?: string;
    };

    const wallet = CRYPTO_WALLETS.find((w) => w.code === currency);
    if (!wallet) {
      return res.status(400).json({ error: 'Unsupported cryptocurrency selected.' });
    }
    const cleanAmount = Number(amount);
    if (Number.isNaN(cleanAmount) || cleanAmount < REGISTRATION_FEE_USD) {
      return res.status(400).json({ error: `Minimum registration fee payment is $${REGISTRATION_FEE_USD.toFixed(2)} USD.` });
    }
    const cleanTxId = typeof txId === 'string' ? txId.trim().slice(0, 160) : '';
    if (cleanTxId.length < 8) {
      return res.status(400).json({ error: 'Please enter a valid Transaction ID (TXID).' });
    }
    const duplicateTx = store.registrationPayments.some(
      (p) => p.txId.toLowerCase() === cleanTxId.toLowerCase() && p.status !== 'Rejected',
    );
    if (duplicateTx) {
      return res.status(409).json({ error: 'This Transaction ID (TXID) has already been submitted.' });
    }

    const cleanReceiptUrl = typeof receiptDataUrl === 'string' ? receiptDataUrl.trim() : '';
    const cleanReceiptName = typeof receiptFileName === 'string' ? receiptFileName.trim().slice(0, 160) : '';
    if (
      cleanReceiptUrl.length < 30 ||
      cleanReceiptUrl.length > 450000 ||
      !SAFE_RECEIPT_RE.test(cleanReceiptUrl)
    ) {
      return res.status(400).json({
        error: 'Please upload a valid payment screenshot (JPG, PNG, WEBP, GIF, or PDF up to 320 KB).',
      });
    }
    if (!cleanReceiptName) {
      return res.status(400).json({ error: 'Payment screenshot file name is required.' });
    }

    const now = new Date().toISOString();
    const paymentId = `regpay_${crypto.randomUUID().replace(/-/g, '')}`;
    const record: RegistrationPaymentRecord = {
      id: paymentId,
      userId: user.uid,
      userEmail: user.email,
      username: user.username,
      fullName: user.fullName,
      amount: cleanAmount,
      currency: wallet.code,
      walletAddress: wallet.address,
      txId: cleanTxId,
      receiptDataUrl: cleanReceiptUrl,
      receiptFileName: cleanReceiptName,
      status: 'Pending',
      createdAt: now,
      updatedAt: now,
    };
    store.registrationPayments.unshift(record);

    user.status = 'Pending Payment';
    user.registrationPaymentStatus = 'Pending Review';
    user.registrationPaymentId = paymentId;
    user.registrationTxId = cleanTxId;
    user.registrationCrypto = wallet.code;
    user.registrationFeeAmount = cleanAmount;
    user.registrationReceiptDataUrl = cleanReceiptUrl;
    user.registrationReceiptFileName = cleanReceiptName;
    user.registrationSubmittedAt = now;
    user.rejectionReason = undefined;
    user.updatedAt = now;

    const notif: NotificationRecord = {
      id: `notif_${crypto.randomUUID().replace(/-/g, '')}`,
      userId: user.uid,
      recipientEmail: user.email,
      subject: 'Registration Payment Submitted',
      body: `We received your $${cleanAmount.toFixed(2)} ${wallet.name} registration payment (TXID: ${cleanTxId}). Your registration payment is currently awaiting administrator approval.`,
      category: 'registration_payment',
      read: false,
      createdAt: now,
    };
    store.notifications.unshift(notif);
    saveStore();

    return res.status(201).json({
      payment: record,
      user: sanitizeUser(user),
      notification: notif,
    });
  });

  app.post('/api/jwt/deposits', verifyCsrf, requireJwtAuth, requireApprovedMember, (req: AuthedRequest, res: Response) => {
    const user = req.jwtUser!;
    const { amount, currency, txHash, receiptUrl, receiptDataUrl, receiptFileName } = req.body as {
      amount?: number;
      currency?: 'BTC' | 'ETH' | 'USDT_ERC20' | 'USDT_TRC20';
      txHash?: string;
      receiptUrl?: string;
      receiptDataUrl?: string;
      receiptFileName?: string;
    };
    const wallet = CRYPTO_WALLETS.find((w) => w.code === currency);
    if (!wallet) {
      return res.status(400).json({ error: 'Unsupported cryptocurrency selected.' });
    }
    const minDeposit = Math.max(100, store.siteSettings?.minimumDepositUsd || 100);
    if (typeof amount !== 'number' || Number.isNaN(amount) || amount < minDeposit) {
      return res.status(400).json({ error: `Minimum deposit amount is $${minDeposit}.` });
    }
    if (!txHash || txHash.trim().length < 10) {
      return res.status(400).json({ error: 'Please submit a valid transaction hash (TXID).' });
    }
    const cleanStoredUrl = typeof receiptUrl === 'string' ? receiptUrl.trim() : '';
    const cleanDataUrl = typeof receiptDataUrl === 'string' ? receiptDataUrl.trim() : '';
    const cleanReceiptName =
      typeof receiptFileName === 'string' ? receiptFileName.trim().slice(0, 160) : '';

    const hasValidStoredUrl = SAFE_UPLOAD_URL_RE.test(cleanStoredUrl);
    const hasValidDataUrl =
      cleanDataUrl.length >= 30 &&
      cleanDataUrl.length <= 450000 &&
      SAFE_RECEIPT_RE.test(cleanDataUrl);

    if (!hasValidStoredUrl && !hasValidDataUrl) {
      return res.status(400).json({
        error: 'Please upload a valid payment receipt (JPG, PNG, WEBP, GIF, or PDF).',
      });
    }
    if (!cleanReceiptName) {
      return res.status(400).json({ error: 'Payment receipt file name is required.' });
    }
    const cleanHash = txHash.trim().slice(0, 160);
    if (store.deposits.some((d) => d.txHash.toLowerCase() === cleanHash.toLowerCase() && d.status !== 'Rejected')) {
      return res.status(409).json({ error: 'This transaction hash has already been submitted.' });
    }

    const now = new Date().toISOString();
    const depId = `dep_${crypto.randomUUID().replace(/-/g, '')}`;
    const deposit: DepositRecord = {
      id: depId,
      userId: user.uid,
      userEmail: user.email,
      username: user.username,
      userName: user.fullName,
      amount: Number(amount.toFixed(2)),
      currency: wallet.code,
      walletAddress: wallet.address,
      txHash: cleanHash,
      ...(hasValidStoredUrl ? { receiptUrl: cleanStoredUrl } : {}),
      ...(hasValidDataUrl ? { receiptDataUrl: cleanDataUrl } : {}),
      receiptFileName: cleanReceiptName,
      status: 'Pending',
      createdAt: now,
      updatedAt: now,
    };
    store.deposits.unshift(deposit);
    store.transactions.unshift({
      id: `tx_${crypto.randomUUID().replace(/-/g, '')}`,
      userId: user.uid,
      type: 'deposit',
      amount: Number(amount.toFixed(2)),
      direction: 'credit',
      referenceId: depId,
      description: `${wallet.name} Deposit (${cleanHash.slice(0, 12)}...)`,
      status: 'Pending',
      createdAt: now,
    });
    saveStore();
    return res.status(201).json({
      deposit,
      message:
        'Deposit request submitted successfully.\n\nYour payment is currently awaiting administrator review.\n\nFunds will be credited to your wallet balance after approval.',
    });
  });

  app.post('/api/jwt/orders', verifyCsrf, requireJwtAuth, requireApprovedMember, (req: AuthedRequest, res: Response) => {
    const user = req.jwtUser!;
    const { serviceId, accountType, country, recipientName, destinationCity } = req.body as {
      serviceId?: string;
      accountType?: AccountTier;
      country?: string;
      recipientName?: string;
      destinationCity?: string;
    };
    const service = SHIPPING_SERVICES.find((s) => s.id === serviceId);
    if (!service) {
      return res.status(404).json({ error: 'Selected account package not found.' });
    }
    if (!country || !service.countries.includes(country as SupportedCountry)) {
      return res.status(400).json({ error: 'Account package is not available in the selected country.' });
    }
    const resolvedTier: AccountTier =
      accountType && ACCOUNT_TIERS.includes(accountType) ? accountType : 'Personal';
    const override = store.servicePricing[service.id] || null;
    const unitPrice = getAccountPriceUsd(
      service,
      resolvedTier,
      country as SupportedCountry,
      override,
    );

    if (user.walletBalance < unitPrice) {
      return res.status(400).json({
        error: `Insufficient wallet balance ($${user.walletBalance.toFixed(2)}). Required: $${unitPrice.toFixed(2)}. Please deposit funds first.`,
      });
    }

    const now = new Date().toISOString();
    const orderId = `ord_${crypto.randomUUID().replace(/-/g, '')}`;
    const trackingCode = `BW-${service.providerId.toUpperCase().replace(/[^A-Z]/g, '')}-${resolvedTier.slice(0, 3).toUpperCase()}-${crypto.randomInt(100000, 999999)}`;

    user.walletBalance = Number((user.walletBalance - unitPrice).toFixed(2));
    user.totalPurchases = Number((user.totalPurchases + unitPrice).toFixed(2));
    user.updatedAt = now;

    const order: OrderRecord = {
      id: orderId,
      userId: user.uid,
      userEmail: user.email,
      username: user.username,
      providerId: service.providerId,
      providerName: service.providerName,
      serviceName: `${service.providerName} ${resolvedTier} Account`,
      accountType: resolvedTier,
      country,
      price: unitPrice,
      trackingCode,
      status: 'Processing',
      recipientName: recipientName?.trim() || user.fullName,
      destinationCity: destinationCity?.trim() || country,
      createdAt: now,
      updatedAt: now,
    };

    store.orders.unshift(order);
    store.transactions.unshift({
      id: `tx_${crypto.randomUUID().replace(/-/g, '')}`,
      userId: user.uid,
      type: 'purchase',
      amount: unitPrice,
      direction: 'debit',
      referenceId: orderId,
      description: `${service.providerName} ${resolvedTier} Account (${country})`,
      status: 'Completed',
      createdAt: now,
    });

    const notif: NotificationRecord = {
      id: `notif_${crypto.randomUUID().replace(/-/g, '')}`,
      userId: user.uid,
      recipientEmail: user.email,
      subject: 'Service Purchase Completed',
      body: `Your order for a verified ${service.providerName} ${resolvedTier} Account ($${unitPrice.toFixed(2)}) in ${country} is confirmed. Activation Reference: ${trackingCode}.`,
      category: 'purchase',
      read: false,
      createdAt: now,
    };
    store.notifications.unshift(notif);
    saveStore();

    return res.status(201).json({ order, user: sanitizeUser(user), notification: notif });
  });

  // Support Tickets & Live Chat (JWT)
  app.post('/api/jwt/support/tickets', verifyCsrf, requireJwtAuth, requireApprovedMember, (req: AuthedRequest, res: Response) => {
    const user = req.jwtUser!;
    const { subject, category, priority, message } = req.body as {
      subject?: string;
      category?: SupportTicketRecord['category'];
      priority?: SupportTicketRecord['priority'];
      message?: string;
    };
    if (!subject || !message) {
      return res.status(400).json({ error: 'Subject and initial message are required.' });
    }
    const now = new Date().toISOString();
    const ticketId = `tkt_${crypto.randomUUID().replace(/-/g, '')}`;
    const ticket: SupportTicketRecord = {
      id: ticketId,
      userId: user.uid,
      userEmail: user.email,
      username: user.username,
      subject: subject.trim().slice(0, 160),
      category: category || 'Account Provisioning',
      priority: priority || 'Normal',
      status: 'Open',
      lastMessage: message.trim().slice(0, 600),
      createdAt: now,
      updatedAt: now,
    };
    const msg: SupportMessageRecord = {
      id: `msg_${crypto.randomUUID().replace(/-/g, '')}`,
      ticketId,
      ticketOwnerId: user.uid,
      senderId: user.uid,
      senderRole: 'customer',
      senderName: user.fullName,
      body: message.trim().slice(0, 1200),
      createdAt: now,
    };
    store.supportTickets.unshift(ticket);
    store.supportMessages.push(msg);
    saveStore();
    return res.status(201).json({ ticket, message: msg });
  });

  app.post('/api/jwt/support/tickets/:id/messages', verifyCsrf, requireJwtAuth, requireApprovedMember, (req: AuthedRequest, res: Response) => {
    const user = req.jwtUser!;
    const ticket = store.supportTickets.find((t) => t.id === req.params.id);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }
    if (ticket.userId !== user.uid && user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden.' });
    }
    const { body } = req.body as { body?: string };
    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'Message body is required.' });
    }
    const now = new Date().toISOString();
    const msg: SupportMessageRecord = {
      id: `msg_${crypto.randomUUID().replace(/-/g, '')}`,
      ticketId: ticket.id,
      ticketOwnerId: ticket.userId,
      senderId: user.uid,
      senderRole: user.role === 'admin' ? 'admin' : 'customer',
      senderName: user.fullName,
      body: body.trim().slice(0, 1200),
      createdAt: now,
    };
    store.supportMessages.push(msg);
    ticket.lastMessage = msg.body.slice(0, 600);
    ticket.status = user.role === 'admin' ? 'Replied' : 'Open';
    ticket.updatedAt = now;
    saveStore();
    return res.status(201).json({ message: msg, ticket });
  });

  app.post('/api/jwt/admin/support/tickets/:id/status', verifyCsrf, requireJwtAuth, requireJwtAdmin, (req: AuthedRequest, res: Response) => {
    const adminUser = req.jwtUser!;
    const { status } = req.body as { status?: SupportTicketRecord['status'] };
    const ticket = store.supportTickets.find((t) => t.id === req.params.id);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }
    if (!status || !['Open', 'Replied', 'Resolved', 'Closed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid ticket status.' });
    }
    const prevStatus = ticket.status;
    ticket.status = status;
    ticket.updatedAt = new Date().toISOString();
    appendAdminLog({
      admin: adminUser,
      action: 'TICKET_STATUS_UPDATED',
      previousStatus: prevStatus,
      newStatus: status,
      details: `Support ticket ${ticket.id} (@${ticket.username}) status changed from ${prevStatus} to ${status}`,
    });
    saveStore();
    return res.json({ ticket });
  });

  // Admin routes for JWT store
  app.post('/api/jwt/admin/deposits/:id/review', verifyCsrf, requireJwtAuth, requireJwtAdmin, (req: AuthedRequest, res: Response) => {
    const adminUser = req.jwtUser!;
    const { decision, adminNote, rejectionReason } = req.body as {
      decision?: 'Approved' | 'Rejected';
      adminNote?: string;
      rejectionReason?: string;
    };
    const dep = store.deposits.find((d) => d.id === req.params.id);
    if (!dep || dep.status !== 'Pending') {
      return res.status(404).json({ error: 'Pending deposit not found.' });
    }
    if (decision !== 'Approved' && decision !== 'Rejected') {
      return res.status(400).json({ error: 'Invalid decision.' });
    }
    const now = new Date().toISOString();
    dep.status = decision;
    dep.reviewedBy = adminUser.email;
    dep.updatedAt = now;

    const tx = store.transactions.find((t) => t.referenceId === dep.id && t.type === 'deposit');
    if (tx) {
      tx.status = decision === 'Approved' ? 'Completed' : 'Rejected';
    }

    let updatedTargetUser: JwtUserRecord | undefined;
    const targetUser = store.users.find((u) => u.uid === dep.userId);
    if (decision === 'Approved') {
      dep.approvedAt = now;
      dep.adminNote = (adminNote || 'Receipt & on-chain transfer verified manually').trim().slice(0, 300);
      if (targetUser) {
        targetUser.walletBalance = Number((targetUser.walletBalance + dep.amount).toFixed(2));
        targetUser.totalDeposits = Number((targetUser.totalDeposits + dep.amount).toFixed(2));
        targetUser.updatedAt = now;
        updatedTargetUser = targetUser;
        store.notifications.unshift({
          id: `notif_${crypto.randomUUID().replace(/-/g, '')}`,
          userId: targetUser.uid,
          recipientEmail: targetUser.email,
          subject: 'Deposit Successfully Added',
          body: `Your deposit has been approved and funds have been credited to your wallet. ($${dep.amount.toFixed(2)} ${dep.currency.replace('_', ' ')}, TXID: ${dep.txHash.slice(0, 14)}...)`,
          category: 'deposit',
          read: false,
          createdAt: now,
        });
      }
    } else {
      const reasonText = (
        rejectionReason ||
        adminNote ||
        'Payment receipt or transaction hash could not be verified.'
      )
        .trim()
        .slice(0, 400);
      dep.rejectedAt = now;
      dep.rejectionReason = reasonText;
      dep.adminNote = (adminNote || reasonText).trim().slice(0, 300);
      if (targetUser) {
        updatedTargetUser = targetUser;
        store.notifications.unshift({
          id: `notif_${crypto.randomUUID().replace(/-/g, '')}`,
          userId: targetUser.uid,
          recipientEmail: targetUser.email,
          subject: 'Deposit Rejected',
          body: `Your deposit has been rejected. Please review the reason provided by support. Reason: ${reasonText}`,
          category: 'deposit',
          read: false,
          createdAt: now,
        });
      }
    }
    appendAdminLog({
      admin: adminUser,
      action: decision === 'Approved' ? 'DEPOSIT_APPROVED' : 'DEPOSIT_REJECTED',
      targetUser: { uid: dep.userId, email: dep.userEmail, username: dep.username },
      previousStatus: 'Pending',
      newStatus: decision,
      details: `${decision} $${dep.amount.toFixed(2)} ${dep.currency} deposit (${dep.txHash.slice(0, 16)}...)${decision === 'Rejected' && dep.rejectionReason ? ` — Reason: ${dep.rejectionReason}` : ''}`,
    });
    saveStore();
    return res.json({
      deposit: dep,
      user: updatedTargetUser ? sanitizeUser(updatedTargetUser) : undefined,
    });
  });

  app.post('/api/jwt/admin/orders/:id/status', verifyCsrf, requireJwtAuth, requireJwtAdmin, (req: AuthedRequest, res: Response) => {
    const adminUser = req.jwtUser!;
    const { status } = req.body as { status?: 'Processing' | 'Completed' | 'Cancelled' };
    const order = store.orders.find((o) => o.id === req.params.id);
    if (!order || !['Pending', 'Processing'].includes(order.status)) {
      return res.status(404).json({ error: 'Active order not found.' });
    }
    const prevStatus = order.status;
    const now = new Date().toISOString();
    order.updatedAt = now;

    if (status === 'Processing' || status === 'Completed') {
      order.status = status;
    } else if (status === 'Cancelled') {
      order.status = 'Refunded';
      const targetUser = store.users.find((u) => u.uid === order.userId);
      if (targetUser) {
        targetUser.walletBalance = Number((targetUser.walletBalance + order.price).toFixed(2));
        targetUser.updatedAt = now;
        store.transactions.unshift({
          id: `tx_${crypto.randomUUID().replace(/-/g, '')}`,
          userId: targetUser.uid,
          type: 'refund',
          amount: order.price,
          direction: 'credit',
          referenceId: order.id,
          description: `Refund: ${order.serviceName}`,
          status: 'Refunded',
          createdAt: now,
        });
      }
    } else {
      return res.status(400).json({ error: 'Invalid status update.' });
    }
    appendAdminLog({
      admin: adminUser,
      action: status === 'Cancelled' ? 'ORDER_REFUNDED' : 'ORDER_STATUS_UPDATED',
      targetUser: { uid: order.userId, email: order.userEmail, username: order.username },
      previousStatus: prevStatus,
      newStatus: order.status,
      details: `Order ${order.trackingCode} (${order.serviceName}) changed from ${prevStatus} to ${order.status}`,
    });
    saveStore();
    return res.json({ order });
  });

  app.post('/api/jwt/admin/registrations/:uid/review', verifyCsrf, requireJwtAuth, requireJwtAdmin, (req: AuthedRequest, res: Response) => {
    const adminUser = req.jwtUser!;
    const { decision, rejectionReason, adminNotes } = req.body as {
      decision?: 'Approved' | 'Rejected' | 'Suspended';
      rejectionReason?: string;
      adminNotes?: string;
    };
    const target = store.users.find((u) => u.uid === req.params.uid);
    if (!target) {
      return res.status(404).json({ error: 'User not found.' });
    }
    if (!decision || !['Approved', 'Rejected', 'Suspended'].includes(decision)) {
      return res.status(400).json({ error: 'Invalid review decision.' });
    }

    const previousStatus = String(target.status);
    const now = new Date().toISOString();
    target.status = decision;
    target.account_status = resolveSimpleAccountStatus(decision);
    target.updatedAt = now;
    if (typeof adminNotes === 'string') {
      target.adminNotes = adminNotes.trim().slice(0, 1000);
    }

    const latestPayment = store.registrationPayments.find(
      (p) => p.userId === target.uid && p.status === 'Pending',
    );

    let notif: NotificationRecord | undefined;
    if (decision === 'Approved') {
      target.registrationPaymentStatus = 'Approved';
      target.isVerified = true;
      target.approvedAt = now;
      target.rejectionReason = undefined;
      if (latestPayment) {
        latestPayment.status = 'Approved';
        latestPayment.reviewedAt = now;
        latestPayment.updatedAt = now;
        if (typeof adminNotes === 'string') latestPayment.adminNote = adminNotes.trim().slice(0, 500);
      }
      notif = {
        id: `notif_${crypto.randomUUID().replace(/-/g, '')}`,
        userId: target.uid,
        recipientEmail: target.email,
        subject: 'Account Approved & Activated',
        body: 'Congratulations! Your account has been approved. You may now log in and access your dashboard.',
        category: 'registration_payment',
        read: false,
        createdAt: now,
      };
      store.notifications.unshift(notif);
    } else if (decision === 'Rejected') {
      const reason =
        (rejectionReason || 'Your registration was not approved. Please contact support.')
          .trim()
          .slice(0, 500);
      target.registrationPaymentStatus = 'Rejected';
      target.rejectedAt = now;
      target.rejectionReason = reason;
      if (latestPayment) {
        latestPayment.status = 'Rejected';
        latestPayment.rejectionReason = reason;
        latestPayment.reviewedAt = now;
        latestPayment.updatedAt = now;
        if (typeof adminNotes === 'string') latestPayment.adminNote = adminNotes.trim().slice(0, 500);
      }
      notif = {
        id: `notif_${crypto.randomUUID().replace(/-/g, '')}`,
        userId: target.uid,
        recipientEmail: target.email,
        subject: 'Registration Payment Rejected',
        body: `Your registration was not approved. Please contact support. Reason: ${reason}`,
        category: 'registration_payment',
        read: false,
        createdAt: now,
      };
      store.notifications.unshift(notif);
    } else if (decision === 'Suspended') {
      notif = {
        id: `notif_${crypto.randomUUID().replace(/-/g, '')}`,
        userId: target.uid,
        recipientEmail: target.email,
        subject: 'Account Suspended',
        body: `Your account has been suspended. Contact support at ${store.siteSettings.supportEmail}.`,
        category: 'security',
        read: false,
        createdAt: now,
      };
      store.notifications.unshift(notif);
    }

    const actionMap = {
      Approved: 'ACCOUNT_APPROVED',
      Rejected: 'ACCOUNT_REJECTED',
      Suspended: 'ACCOUNT_SUSPENDED',
    } as const;
    appendAdminLog({
      admin: adminUser,
      action: actionMap[decision],
      targetUser: target,
      previousStatus,
      newStatus: decision,
      details: `${decision} registration for ${target.fullName} (@${target.username}, ${target.email})`,
    });

    saveStore();
    return res.json({
      user: sanitizeUser(target),
      registrationPayments: store.registrationPayments,
      notification: notif,
    });
  });

  app.post('/api/jwt/admin/users/:uid/update', verifyCsrf, requireJwtAuth, requireJwtAdmin, (req: AuthedRequest, res: Response) => {
    const adminUser = req.jwtUser!;
    const { status, account_status, isVerified, adminNotes, rejectionReason } = req.body as {
      status?: LegacyOrCanonicalStatus;
      account_status?: SimpleAccountStatus;
      isVerified?: boolean;
      adminNotes?: string;
      rejectionReason?: string;
    };
    const target = store.users.find((u) => u.uid === req.params.uid);
    if (!target) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const allowedStatuses: LegacyOrCanonicalStatus[] = [
      'Pending Payment',
      'Approved',
      'Rejected',
      'Suspended',
      'active',
      'suspended',
    ];
    const allowedSimpleStatuses: SimpleAccountStatus[] = ['pending', 'approved', 'rejected', 'suspended'];
    const previousStatus = String(target.status);
    const previousSimple = resolveSimpleAccountStatus(target);
    const now = new Date().toISOString();
    let notif: NotificationRecord | undefined;

    const resolvedNewStatus: LegacyOrCanonicalStatus | undefined =
      account_status && allowedSimpleStatuses.includes(account_status)
        ? toCanonicalStatusFromSimple(account_status)
        : status && allowedStatuses.includes(status)
          ? status
          : undefined;

    if (resolvedNewStatus) {
      const nextSimple = resolveSimpleAccountStatus(resolvedNewStatus);
      target.status = resolvedNewStatus;
      target.account_status = nextSimple;
      if (nextSimple === 'approved') {
        target.approvedAt = target.approvedAt || now;
        target.isVerified = true;
        target.registrationPaymentStatus = 'Approved';
        target.rejectionReason = undefined;
        if (previousSimple !== 'approved') {
          notif = {
            id: `notif_${crypto.randomUUID().replace(/-/g, '')}`,
            userId: target.uid,
            recipientEmail: target.email,
            subject: 'Account Approved & Activated',
            body: 'Congratulations! Your account has been approved. You may now log in and access your dashboard.',
            category: 'registration_payment',
            read: false,
            createdAt: now,
          };
          store.notifications.unshift(notif);
        }
      } else if (nextSimple === 'rejected') {
        target.rejectedAt = now;
        target.registrationPaymentStatus = 'Rejected';
        notif = {
          id: `notif_${crypto.randomUUID().replace(/-/g, '')}`,
          userId: target.uid,
          recipientEmail: target.email,
          subject: 'Registration Payment Rejected',
          body: `Your registration was not approved. Please contact support. Reason: ${(rejectionReason || target.rejectionReason || 'Verification failed.').trim()}`,
          category: 'registration_payment',
          read: false,
          createdAt: now,
        };
        store.notifications.unshift(notif);
      } else if (nextSimple === 'suspended') {
        notif = {
          id: `notif_${crypto.randomUUID().replace(/-/g, '')}`,
          userId: target.uid,
          recipientEmail: target.email,
          subject: 'Account Suspended',
          body: `Your account has been suspended. Contact support at ${store.siteSettings.supportEmail}.`,
          category: 'security',
          read: false,
          createdAt: now,
        };
        store.notifications.unshift(notif);
      }
    }
    if (typeof isVerified === 'boolean') {
      target.isVerified = isVerified;
    }
    if (typeof adminNotes === 'string') {
      target.adminNotes = adminNotes.trim().slice(0, 1000);
    }
    if (typeof rejectionReason === 'string') {
      target.rejectionReason = rejectionReason.trim().slice(0, 500);
    }
    target.updatedAt = now;

    const actionLabel =
      target.account_status === 'suspended'
        ? 'ACCOUNT_SUSPENDED'
        : target.account_status === 'approved'
          ? 'ACCOUNT_APPROVED'
          : target.account_status === 'rejected'
            ? 'ACCOUNT_REJECTED'
            : 'USER_UPDATED';
    appendAdminLog({
      admin: adminUser,
      action: actionLabel,
      targetUser: target,
      previousStatus,
      newStatus: String(target.status),
      details: resolvedNewStatus
        ? `Changed @${target.username} status from ${previousStatus} to ${target.status}`
        : `Updated admin notes or verification state for @${target.username}`,
    });

    saveStore();
    return res.json({ user: sanitizeUser(target), notification: notif });
  });

  app.delete('/api/jwt/admin/users/:uid', verifyCsrf, requireJwtAuth, requireJwtAdmin, (req: AuthedRequest, res: Response) => {
    const adminUser = req.jwtUser!;
    const targetIndex = store.users.findIndex((u) => u.uid === req.params.uid);
    if (targetIndex === -1) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const target = store.users[targetIndex];
    if (target.uid === adminUser.uid || isExclusiveJwtAdminUser(target)) {
      return res.status(403).json({ error: 'Cannot delete the exclusive administrator account.' });
    }

    store.users.splice(targetIndex, 1);
    store.priceAlerts = store.priceAlerts.filter((a) => a.userId !== target.uid);
    appendAdminLog({
      admin: adminUser,
      action: 'USER_DELETED',
      targetUser: target,
      previousStatus: String(target.status),
      newStatus: 'Deleted',
      details: `Deleted registered user ${target.fullName} (@${target.username}, ${target.email})`,
    });

    saveStore();
    return res.json({ deleted: true, uid: target.uid });
  });

  app.post('/api/jwt/notifications/:id/read', verifyCsrf, requireJwtAuth, (req: AuthedRequest, res: Response) => {
    const user = req.jwtUser!;
    const notif = store.notifications.find((n) => n.id === req.params.id && n.userId === user.uid);
    if (!notif) {
      return res.status(404).json({ error: 'Notification not found.' });
    }
    notif.read = true;
    saveStore();
    return res.json({ notification: notif });
  });

  app.post('/api/jwt/price-alerts', verifyCsrf, requireJwtAuth, requireApprovedMember, (req: AuthedRequest, res: Response) => {
    const user = req.jwtUser!;
    const { serviceId, accountType, country, targetPrice, existingAlertId } = req.body as {
      serviceId?: string;
      accountType?: AccountTier;
      country?: SupportedCountry;
      targetPrice?: number;
      existingAlertId?: string;
    };

    const service = SHIPPING_SERVICES.find((s) => s.id === serviceId);
    if (!service) {
      return res.status(404).json({ error: 'Selected account service not found.' });
    }
    const resolvedTier: AccountTier =
      accountType && ACCOUNT_TIERS.includes(accountType) ? accountType : 'Personal';
    const resolvedCountry: SupportedCountry =
      country && SUPPORTED_COUNTRIES.includes(country) && service.countries.includes(country)
        ? country
        : service.countries[0];
    const override = store.servicePricing[service.id] || null;
    const currentPrice = getAccountPriceUsd(service, resolvedTier, resolvedCountry, override);
    const cleanTarget = Number(Number(targetPrice).toFixed(2));

    if (Number.isNaN(cleanTarget) || cleanTarget <= 100 || cleanTarget >= currentPrice) {
      return res.status(400).json({
        error: `Target price must be above $100.00 and strictly below the current price ($${currentPrice.toFixed(2)}).`,
      });
    }

    const now = new Date().toISOString();
    if (existingAlertId) {
      const existing = store.priceAlerts.find(
        (a) => a.id === existingAlertId && a.userId === user.uid && a.status !== 'Cancelled',
      );
      if (!existing) {
        return res.status(404).json({ error: 'Price alert not found.' });
      }
      existing.accountType = resolvedTier;
      existing.country = resolvedCountry;
      existing.targetPrice = cleanTarget;
      existing.initialPrice = currentPrice;
      existing.status = 'Active';
      existing.updatedAt = now;
      saveStore();
      return res.json({ alert: existing });
    }

    const alert: PriceAlertRecord = {
      id: `pa_${crypto.randomUUID().replace(/-/g, '')}`,
      userId: user.uid,
      userEmail: user.email,
      username: user.username,
      serviceId: service.id,
      providerName: service.providerName,
      serviceName: service.serviceName,
      accountType: resolvedTier,
      country: resolvedCountry,
      targetPrice: cleanTarget,
      initialPrice: currentPrice,
      status: 'Active',
      createdAt: now,
      updatedAt: now,
    };
    store.priceAlerts.unshift(alert);
    saveStore();
    return res.status(201).json({ alert });
  });

  app.post('/api/jwt/price-alerts/:id/cancel', verifyCsrf, requireJwtAuth, requireApprovedMember, (req: AuthedRequest, res: Response) => {
    const user = req.jwtUser!;
    const alert = store.priceAlerts.find((a) => a.id === req.params.id && a.userId === user.uid);
    if (!alert) {
      return res.status(404).json({ error: 'Price alert not found.' });
    }
    alert.status = 'Cancelled';
    alert.updatedAt = new Date().toISOString();
    saveStore();
    return res.json({ alert });
  });

  app.delete('/api/jwt/price-alerts/:id', verifyCsrf, requireJwtAuth, requireApprovedMember, (req: AuthedRequest, res: Response) => {
    const user = req.jwtUser!;
    const idx = store.priceAlerts.findIndex(
      (a) => a.id === req.params.id && (a.userId === user.uid || user.role === 'admin'),
    );
    if (idx === -1) {
      return res.status(404).json({ error: 'Price alert not found.' });
    }
    store.priceAlerts.splice(idx, 1);
    saveStore();
    return res.json({ deleted: true });
  });

  app.post('/api/jwt/admin/pricing', verifyCsrf, requireJwtAuth, requireJwtAdmin, (req: AuthedRequest, res: Response) => {
    const adminUser = req.jwtUser!;
    const { serviceId, personalPrice, businessPrice, corporatePrice, resetToDefault } = req.body as {
      serviceId?: string;
      personalPrice?: number;
      businessPrice?: number;
      corporatePrice?: number;
      resetToDefault?: boolean;
    };

    const service = SHIPPING_SERVICES.find((s) => s.id === serviceId);
    if (!service) {
      return res.status(404).json({ error: 'Service not found.' });
    }

    const now = new Date().toISOString();
    let activeOverride: ServicePriceOverrideRecord | null = null;
    if (resetToDefault) {
      delete store.servicePricing[service.id];
    } else {
      const p = Number(personalPrice);
      const b = Number(businessPrice);
      const c = Number(corporatePrice);
      if ([p, b, c].some((n) => Number.isNaN(n) || n < 100 || n > 100000)) {
        return res.status(400).json({ error: 'All tier prices must be between $100 and $100,000.' });
      }
      activeOverride = {
        serviceId: service.id,
        personalPrice: Number(p.toFixed(2)),
        businessPrice: Number(b.toFixed(2)),
        corporatePrice: Number(c.toFixed(2)),
        isPublic: true,
        updatedBy: adminUser.uid,
        updatedAt: now,
      };
      store.servicePricing[service.id] = activeOverride;
    }

    let triggeredCount = 0;
    for (const alert of store.priceAlerts) {
      if (alert.serviceId !== service.id || alert.status !== 'Active') continue;
      const livePrice = getAccountPriceUsd(
        service,
        alert.accountType,
        alert.country,
        activeOverride,
      );
      if (livePrice < alert.targetPrice) {
        triggeredCount += 1;
        alert.status = 'Triggered';
        alert.triggeredPrice = livePrice;
        alert.triggeredAt = now;
        alert.updatedAt = now;

        store.notifications.unshift({
          id: `notif_${crypto.randomUUID().replace(/-/g, '')}`,
          userId: alert.userId,
          recipientEmail: alert.userEmail,
          subject: 'Price Drop Alert Triggered',
          body: `Price Drop Alert: ${alert.providerName} ${alert.accountType} Account (${alert.country}) dropped to $${livePrice.toFixed(2)}, below your $${alert.targetPrice.toFixed(2)} threshold.`,
          category: 'price_alert',
          read: false,
          createdAt: now,
        });
      }
    }

    appendAdminLog({
      admin: adminUser,
      action: resetToDefault ? 'PRICING_RESET' : 'PRICING_UPDATED',
      details: resetToDefault
        ? `Restored default catalog pricing for ${service.providerName}`
        : `Updated ${service.providerName} pricing (Personal $${Number(personalPrice).toFixed(0)}, Business $${Number(businessPrice).toFixed(0)}, Corporate $${Number(corporatePrice).toFixed(0)})`,
    });

    saveStore();
    return res.json({
      servicePricing: Object.values(store.servicePricing),
      triggeredCount,
    });
  });

  app.post('/api/jwt/admin/settings', verifyCsrf, requireJwtAuth, requireJwtAdmin, (req: AuthedRequest, res: Response) => {
    const adminUser = req.jwtUser!;
    const {
      registrationFeeUsd,
      minimumDepositUsd,
      supportEmail,
      marketplaceNotice,
      requireRegistrationApproval,
    } = req.body as Partial<SiteSettingsRecord>;

    const fee = Number(registrationFeeUsd ?? store.siteSettings.registrationFeeUsd);
    const minDep = Number(minimumDepositUsd ?? store.siteSettings.minimumDepositUsd);
    if (Number.isNaN(fee) || fee < 0 || fee > 1000) {
      return res.status(400).json({ error: 'Registration fee must be between $0 and $1,000.' });
    }
    if (Number.isNaN(minDep) || minDep < 10 || minDep > 10000) {
      return res.status(400).json({ error: 'Minimum deposit must be between $10 and $10,000.' });
    }

    const now = new Date().toISOString();
    store.siteSettings = {
      id: 'global',
      registrationFeeUsd: Number(fee.toFixed(2)),
      minimumDepositUsd: Number(minDep.toFixed(2)),
      supportEmail: (supportEmail || store.siteSettings.supportEmail).trim().slice(0, 160),
      marketplaceNotice: (marketplaceNotice ?? store.siteSettings.marketplaceNotice).trim().slice(0, 300),
      requireRegistrationApproval:
        typeof requireRegistrationApproval === 'boolean'
          ? requireRegistrationApproval
          : store.siteSettings.requireRegistrationApproval,
      updatedBy: adminUser.uid,
      updatedAt: now,
    };

    appendAdminLog({
      admin: adminUser,
      action: 'SITE_SETTINGS_UPDATED',
      details: `Updated website settings (Reg fee $${store.siteSettings.registrationFeeUsd}, Min deposit $${store.siteSettings.minimumDepositUsd}, Support ${store.siteSettings.supportEmail})`,
    });
    saveStore();
    return res.json({ siteSettings: store.siteSettings });
  });

  app.use(['/api/jwt/admin', '/api/admin'], requireJwtAuth, requireJwtAdmin, (_req: Request, res: Response) => {
    return res.status(404).json({ error: 'Admin endpoint not found.' });
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`BlueWhale Markethub server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
