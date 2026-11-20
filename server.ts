import express from 'express';
import type { Request, Response, NextFunction } from 'express';
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
const CSRF_COOKIE_NAME = 'bw_csrf_token';
const DATA_DIR = path.resolve(process.cwd(), '.data');
const STORE_PATH = path.join(DATA_DIR, 'bluewhale-jwt-store.json');

interface JwtUserRecord {
  uid: string;
  fullName: string;
  username: string;
  email: string;
  passwordHash: string;
  country: string;
  phoneNumber: string;
  role: 'customer' | 'admin';
  status: 'active' | 'suspended';
  isVerified: boolean;
  emailVerificationCode: string;
  passwordResetCode: string | null;
  walletBalance: number;
  totalDeposits: number;
  totalPurchases: number;
  twoFactorEnabled: boolean;
  twoFactorSecret: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DepositRecord {
  id: string;
  userId: string;
  userEmail: string;
  username: string;
  amount: number;
  currency: 'BTC' | 'ETH' | 'USDT_ERC20' | 'USDT_TRC20';
  walletAddress: string;
  txHash: string;
  receiptDataUrl?: string;
  receiptFileName?: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  adminNote?: string;
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
    | 'Deposit Successfully Added'
    | 'Service Purchase Completed'
    | 'Reset Your Password'
    | 'Price Drop Alert Triggered';
  body: string;
  category: 'registration' | 'deposit' | 'purchase' | 'security' | 'price_alert';
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

interface StoreState {
  users: JwtUserRecord[];
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
}

function loadStore(): StoreState {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreState>;
      return {
        users: parsed.users || [],
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
      };
    }
  } catch (err) {
    console.warn('Could not read local JWT store, initializing fresh state:', err);
  }
  return {
    users: [],
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
  };
}

const store: StoreState = loadStore();

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
  return {
    uid: user.uid,
    fullName: user.fullName,
    username: user.username,
    email: user.email,
    country: user.country,
    phoneNumber: user.phoneNumber,
    role: user.role,
    status: user.status,
    isVerified: user.isVerified,
    walletBalance: user.walletBalance,
    totalDeposits: user.totalDeposits,
    totalPurchases: user.totalPurchases,
    twoFactorEnabled: user.twoFactorEnabled,
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

function requireJwtAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = authHeader.slice('Bearer '.length).trim();
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    const user = store.users.find((u) => u.uid === decoded.uid);
    if (!user) {
      return res.status(401).json({ error: 'Session no longer valid' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Account is suspended or banned. Contact support.' });
    }
    req.jwtUser = user;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
}

function requireJwtAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.jwtUser || req.jwtUser.role !== 'admin') {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  return next();
}

function verifyCsrf(req: Request, res: Response, next: NextFunction) {
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || typeof headerToken !== 'string' || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'CSRF validation failed. Please refresh your session.' });
  }
  return next();
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
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
    const token = req.cookies?.[CSRF_COOKIE_NAME] || crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      sameSite: 'lax',
      secure: req.protocol === 'https',
      maxAge: 24 * 60 * 60 * 1000,
    });
    res.json({ csrfToken: token });
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
        (d) => d.txHash.toLowerCase() === txHash.trim().toLowerCase(),
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
    const cleanEmail = email.trim().toLowerCase();
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
    const isBootstrappedAdmin = cleanEmail === 'johnblessing9977@gmail.com';

    const user: JwtUserRecord = {
      uid,
      fullName: resolvedFullName.slice(0, 100),
      username: username.trim().slice(0, 40),
      email: cleanEmail,
      passwordHash,
      country: country.trim(),
      phoneNumber: phoneNumber.trim().slice(0, 32),
      role: isBootstrappedAdmin ? 'admin' : 'customer',
      status: 'active',
      isVerified: isBootstrappedAdmin,
      emailVerificationCode: verificationCode,
      passwordResetCode: null,
      walletBalance: 0,
      totalDeposits: 0,
      totalPurchases: 0,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      createdAt: now,
      updatedAt: now,
    };

    store.users.push(user);

    const welcomeNotif: NotificationRecord = {
      id: `notif_${crypto.randomUUID().replace(/-/g, '')}`,
      userId: uid,
      recipientEmail: cleanEmail,
      subject: 'Welcome to BlueWhale Markethub',
      body: `Welcome ${user.fullName}! Your BlueWhale Markethub account (@${user.username}) has been created for ${user.country}. Verify your email address using verification code: ${verificationCode}.`,
      category: 'registration',
      read: false,
      createdAt: now,
    };
    store.notifications.unshift(welcomeNotif);

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
      expiresIn: '7d',
    });

    return res.status(201).json({
      token,
      user: sanitizeUser(user),
      verificationPreviewCode: verificationCode,
      emailDispatch: welcomeNotif,
    });
  });

  app.post('/api/auth/login', verifyCsrf, async (req: Request, res: Response) => {
    const { email, password, twoFactorCode } = req.body as {
      email?: string;
      password?: string;
      twoFactorCode?: string;
    };

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const cleanEmail = email.trim().toLowerCase();
    const user = store.users.find((u) => u.email === cleanEmail);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'This account has been suspended or banned.' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password.' });
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
      expiresIn: '7d',
    });

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
    const isAdmin = user.role === 'admin';
    return res.json({
      user: sanitizeUser(user),
      deposits: isAdmin ? store.deposits : store.deposits.filter((d) => d.userId === user.uid),
      orders: isAdmin ? store.orders : store.orders.filter((o) => o.userId === user.uid),
      transactions: store.transactions.filter((t) => t.userId === user.uid),
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
      servicePricing: Object.values(store.servicePricing),
      allUsers: isAdmin ? store.users.map(sanitizeUser) : [],
    });
  });

  app.post('/api/jwt/profile', verifyCsrf, requireJwtAuth, (req: AuthedRequest, res: Response) => {
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

  app.post('/api/jwt/2fa/enable', verifyCsrf, requireJwtAuth, (req: AuthedRequest, res: Response) => {
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

  app.post('/api/jwt/2fa/disable', verifyCsrf, requireJwtAuth, (req: AuthedRequest, res: Response) => {
    const user = req.jwtUser!;
    user.twoFactorEnabled = false;
    user.twoFactorSecret = null;
    user.updatedAt = new Date().toISOString();
    saveStore();
    return res.json({ user: sanitizeUser(user) });
  });

  const SAFE_RECEIPT_RE =
    /^data:(image\/(jpeg|png|webp|gif)|application\/pdf);base64,[A-Za-z0-9+/=]+$/;

  app.post('/api/jwt/deposits', verifyCsrf, requireJwtAuth, (req: AuthedRequest, res: Response) => {
    const user = req.jwtUser!;
    const { amount, currency, txHash, receiptDataUrl, receiptFileName } = req.body as {
      amount?: number;
      currency?: 'BTC' | 'ETH' | 'USDT_ERC20' | 'USDT_TRC20';
      txHash?: string;
      receiptDataUrl?: string;
      receiptFileName?: string;
    };
    const wallet = CRYPTO_WALLETS.find((w) => w.code === currency);
    if (!wallet) {
      return res.status(400).json({ error: 'Unsupported cryptocurrency selected.' });
    }
    if (typeof amount !== 'number' || Number.isNaN(amount) || amount < 100) {
      return res.status(400).json({ error: 'Minimum deposit amount is $100.' });
    }
    if (!txHash || txHash.trim().length < 10) {
      return res.status(400).json({ error: 'Please submit a valid transaction hash.' });
    }
    const cleanReceiptUrl = typeof receiptDataUrl === 'string' ? receiptDataUrl.trim() : '';
    const cleanReceiptName =
      typeof receiptFileName === 'string' ? receiptFileName.trim().slice(0, 160) : '';
    if (
      cleanReceiptUrl.length < 30 ||
      cleanReceiptUrl.length > 450000 ||
      !SAFE_RECEIPT_RE.test(cleanReceiptUrl)
    ) {
      return res.status(400).json({
        error: 'Please upload a valid payment receipt (JPG, PNG, WEBP, GIF, or PDF up to 320 KB).',
      });
    }
    if (!cleanReceiptName) {
      return res.status(400).json({ error: 'Payment receipt file name is required.' });
    }
    const cleanHash = txHash.trim();
    if (store.deposits.some((d) => d.txHash.toLowerCase() === cleanHash.toLowerCase())) {
      return res.status(409).json({ error: 'This transaction hash has already been submitted.' });
    }

    const now = new Date().toISOString();
    const depId = `dep_${crypto.randomUUID().replace(/-/g, '')}`;
    const deposit: DepositRecord = {
      id: depId,
      userId: user.uid,
      userEmail: user.email,
      username: user.username,
      amount,
      currency: wallet.code,
      walletAddress: wallet.address,
      txHash: cleanHash,
      receiptDataUrl: cleanReceiptUrl,
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
      amount,
      direction: 'credit',
      referenceId: depId,
      description: `${wallet.name} Deposit (${cleanHash.slice(0, 12)}...)`,
      status: 'Pending',
      createdAt: now,
    });
    saveStore();
    return res.status(201).json({ deposit });
  });

  app.post('/api/jwt/orders', verifyCsrf, requireJwtAuth, (req: AuthedRequest, res: Response) => {
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
  app.post('/api/jwt/support/tickets', verifyCsrf, requireJwtAuth, (req: AuthedRequest, res: Response) => {
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

  app.post('/api/jwt/support/tickets/:id/messages', verifyCsrf, requireJwtAuth, (req: AuthedRequest, res: Response) => {
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
    const { status } = req.body as { status?: SupportTicketRecord['status'] };
    const ticket = store.supportTickets.find((t) => t.id === req.params.id);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }
    if (!status || !['Open', 'Replied', 'Resolved', 'Closed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid ticket status.' });
    }
    ticket.status = status;
    ticket.updatedAt = new Date().toISOString();
    saveStore();
    return res.json({ ticket });
  });

  // Admin routes for JWT store
  app.post('/api/jwt/admin/deposits/:id/review', verifyCsrf, requireJwtAuth, requireJwtAdmin, (req: AuthedRequest, res: Response) => {
    const { decision, adminNote } = req.body as { decision?: 'Approved' | 'Rejected'; adminNote?: string };
    const dep = store.deposits.find((d) => d.id === req.params.id);
    if (!dep || dep.status !== 'Pending') {
      return res.status(404).json({ error: 'Pending deposit not found.' });
    }
    if (decision !== 'Approved' && decision !== 'Rejected') {
      return res.status(400).json({ error: 'Invalid decision.' });
    }
    const now = new Date().toISOString();
    dep.status = decision;
    dep.adminNote = adminNote || '';
    dep.updatedAt = now;

    const tx = store.transactions.find((t) => t.referenceId === dep.id && t.type === 'deposit');
    if (tx) {
      tx.status = decision === 'Approved' ? 'Completed' : 'Rejected';
    }

    let updatedTargetUser: JwtUserRecord | undefined;
    if (decision === 'Approved') {
      const targetUser = store.users.find((u) => u.uid === dep.userId);
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
          body: `Your ${dep.currency} deposit of $${dep.amount.toFixed(2)} (Tx: ${dep.txHash.slice(0, 14)}...) has been verified and credited to your BlueWhale Markethub wallet.`,
          category: 'deposit',
          read: false,
          createdAt: now,
        });
      }
    }
    saveStore();
    return res.json({
      deposit: dep,
      user: updatedTargetUser ? sanitizeUser(updatedTargetUser) : undefined,
    });
  });

  app.post('/api/jwt/admin/orders/:id/status', verifyCsrf, requireJwtAuth, requireJwtAdmin, (req: AuthedRequest, res: Response) => {
    const { status } = req.body as { status?: 'Processing' | 'Completed' | 'Cancelled' };
    const order = store.orders.find((o) => o.id === req.params.id);
    if (!order || !['Pending', 'Processing'].includes(order.status)) {
      return res.status(404).json({ error: 'Active order not found.' });
    }
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
    saveStore();
    return res.json({ order });
  });

  app.post('/api/jwt/admin/users/:uid/update', verifyCsrf, requireJwtAuth, requireJwtAdmin, (req: AuthedRequest, res: Response) => {
    const { status, isVerified } = req.body as { status?: 'active' | 'suspended'; isVerified?: boolean };
    const target = store.users.find((u) => u.uid === req.params.uid);
    if (!target) {
      return res.status(404).json({ error: 'User not found.' });
    }
    if (status === 'active' || status === 'suspended') {
      target.status = status;
    }
    if (typeof isVerified === 'boolean') {
      target.isVerified = isVerified;
    }
    target.updatedAt = new Date().toISOString();
    saveStore();
    return res.json({ user: sanitizeUser(target) });
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

  app.post('/api/jwt/price-alerts', verifyCsrf, requireJwtAuth, (req: AuthedRequest, res: Response) => {
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

  app.post('/api/jwt/price-alerts/:id/cancel', verifyCsrf, requireJwtAuth, (req: AuthedRequest, res: Response) => {
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

  app.delete('/api/jwt/price-alerts/:id', verifyCsrf, requireJwtAuth, (req: AuthedRequest, res: Response) => {
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

    saveStore();
    return res.json({
      servicePricing: Object.values(store.servicePricing),
      triggeredCount,
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BlueWhale Markethub server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
