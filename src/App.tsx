import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import {
  AlertCircle,
  ArrowRight,
  Bell,
  BellRing,
  CheckCircle2,
  ChevronDown,
  Clock,
  Globe,
  Headphones,
  Lock,
  Mail,
  Menu,
  Moon,
  RefreshCw,
  ShieldCheck,
  Star,
  Sun,
  TrendingDown,
  TrendingUp,
  Verified,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase';
import { apiRequest, ensureCsrfToken } from './lib/apiClient';
import {
  ACCOUNT_TIERS,
  COUNTRY_PRICE_MODIFIERS,
  FAQ_ITEMS,
  getAccountPriceUsd,
  SHIPPING_SERVICES,
  SUPPORTED_COUNTRIES,
  type AccountTier,
  type BaseTierPriceOverride,
  type CryptoCurrencyCode,
  type ShippingServiceItem,
  type SupportedCountry,
} from './data/shippingCatalog';
import {
  adminDeleteFirebaseUser,
  adminReviewFirebaseDeposit,
  adminReviewFirebaseRegistration,
  adminUpdateFirebaseOrder,
  adminUpdateFirebaseServicePrice,
  adminUpdateFirebaseTicketStatus,
  adminUpdateFirebaseUser,
  cancelFirebasePriceAlert,
  createFirebaseSupportTicket,
  createOrUpdateFirebasePriceAlert,
  deleteFirebasePriceAlert,
  ensureFirebaseUserProfile,
  fetchFirebaseUserPrivateInfo,
  logFirebaseResetEmailNotification,
  mapFirestoreAdminLog,
  mapFirestoreDeposit,
  mapFirestoreLoginLog,
  mapFirestoreNotification,
  mapFirestoreOrder,
  mapFirestorePriceAlert,
  mapFirestoreRegistrationPayment,
  mapFirestoreServicePriceOverride,
  mapFirestoreSupportTicket,
  mapFirestoreTransaction,
  mapFirestoreUserAccount,
  mapFirestoreWebsiteSettings,
  markFirebaseNotificationRead,
  purchaseFirebaseService,
  saveFirebaseWebsiteSettings,
  sendFirebaseSupportMessage,
  submitFirebaseDeposit,
  submitFirebaseRegistrationPayment,
  triggerFirebasePriceAlert,
  updateFirebaseProfile,
} from './services/firestoreMarketplace';
import {
  ADMIN_EMAIL,
  getAccountStatusLoginMessage,
  getSimpleAccountStatus,
  isExclusiveAdmin,
  isUserAccountApproved,
  REGISTRATION_FEE_USD,
  SUPPORT_EMAIL,
  type AdminLogEntry,
  type AuthMode,
  type CryptoPriceQuote,
  type DepositRecord,
  type EmailNotification,
  type LoginActivity,
  type PriceAlert,
  type RegistrationPayment,
  type SecurityContextInfo,
  type ServicePriceOverride,
  type ShippingOrder,
  type SupportMessage,
  type SupportTicket,
  type UserAccount,
  type WalletTransaction,
  type WebsiteSettings,
} from './types/marketplace';
import { ProviderLogo } from './components/ProviderLogo';
import { AuthModal } from './components/AuthModal';
import { DepositModal } from './components/DepositModal';
import {
  PaymentInstructionsModal,
  type InstructionAssetTab,
} from './components/PaymentInstructionsModal';
import { PurchaseModal } from './components/PurchaseModal';
import { ServiceDetailModal } from './components/ServiceDetailModal';
import { PriceAlertModal } from './components/PriceAlertModal';
import { FooterInfoModal, type FooterPageId } from './components/FooterInfoModal';
import { UserDashboard, type DashboardTab } from './components/UserDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { RegistrationVerificationView } from './components/RegistrationVerificationView';

type ActiveView = 'marketplace' | 'dashboard' | 'admin';

const DEFAULT_SITE_SETTINGS: WebsiteSettings = {
  id: 'global',
  registrationFeeUsd: REGISTRATION_FEE_USD,
  minimumDepositUsd: 100,
  supportEmail: SUPPORT_EMAIL,
  marketplaceNotice:
    'Personal, Business & Corporate accounts across 14 countries starting from $100+ · Fund wallet via BTC, ETH & USDT.',
  requireRegistrationApproval: true,
  updatedBy: 'system',
  updatedAt: '',
};

const TESTIMONIALS = [
  {
    name: 'Michael T.',
    location: 'Texas, USA',
    quote:
      'Extremely professional platform. The ordering process was smooth and customer support was excellent.',
  },
  {
    name: 'James R.',
    location: 'London, UK',
    quote:
      'Very transparent pricing and a secure wallet system. Highly recommended.',
  },
  {
    name: 'Emily W.',
    location: 'Toronto, Canada',
    quote:
      'The dashboard is clean and easy to navigate. Great customer experience.',
  },
  {
    name: 'Carlos M.',
    location: 'Spain',
    quote: 'Fast processing and responsive support team. Five stars.',
  },
];

const HOW_IT_WORKS_STEPS = [
  {
    step: '01',
    title: 'Register Account',
    description:
      'Create your BlueWhale profile with country preferences, phone verification, and anti-spam protection.',
  },
  {
    step: '02',
    title: 'Verify Email',
    description:
      'Confirm your email verification code and enable optional TOTP two-factor authentication.',
  },
  {
    step: '03',
    title: 'Fund Wallet',
    description:
      'Deposit $100 or more via Bitcoin, Ethereum, USDT ERC20, or USDT TRC20 using QR code and transaction hash verification.',
  },
  {
    step: '04',
    title: 'Choose Country & Tier',
    description:
      'Select your preferred country and Personal, Business, or Corporate account tier starting from $100 upward.',
  },
  {
    step: '05',
    title: 'Receive Verified Account',
    description:
      'Your wallet deducts transparently, an invoice is generated, and your verified account credentials activate.',
  },
];

export default function App() {
  // Theme state (Light / Dark)
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('bw_theme') === 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('bw_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('bw_theme', 'light');
    }
  }, [darkMode]);

  // Navigation & Modals
  const [activeView, setActiveView] = useState<ActiveView>('marketplace');
  const [adminAccessError, setAdminAccessError] = useState<string>('');
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>('dashboard');
  const [announcementVisible, setAnnouncementVisible] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authInitialTab, setAuthInitialTab] = useState<'login' | 'register'>('login');
  const [authInitialMessage, setAuthInitialMessage] = useState<string>('');
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [paymentGuideOpen, setPaymentGuideOpen] = useState(false);
  const [paymentGuideAsset, setPaymentGuideAsset] = useState<InstructionAssetTab>('BTC');
  const [selectedService, setSelectedService] = useState<ShippingServiceItem | null>(null);
  const [detailService, setDetailService] = useState<ShippingServiceItem | null>(null);
  const [alertModalService, setAlertModalService] = useState<ShippingServiceItem | null>(null);
  const [alertModalInitialTier, setAlertModalInitialTier] = useState<AccountTier>('Personal');
  const [alertModalInitialCountry, setAlertModalInitialCountry] = useState<SupportedCountry>('United States');
  const [footerPage, setFooterPage] = useState<FooterPageId | null>(null);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  // Marketplace Filters & Live Crypto Prices
  const [preferredCountry, setPreferredCountry] = useState<SupportedCountry>('United States');
  const [selectedAccountType, setSelectedAccountType] = useState<AccountTier>('Personal');
  const [quickBuyLoadingId, setQuickBuyLoadingId] = useState<string | null>(null);
  const [quickBuyResult, setQuickBuyResult] = useState<{
    providerName: string;
    accountType: AccountTier;
    country: SupportedCountry;
    price: number;
    trackingCode: string;
  } | null>(null);
  const [quickBuyError, setQuickBuyError] = useState<string>('');
  const [cryptoQuotes, setCryptoQuotes] = useState<CryptoPriceQuote[]>([
    { symbol: 'BTC', name: 'Bitcoin', priceUsd: 94850, change24h: 1.84 },
    { symbol: 'ETH', name: 'Ethereum', priceUsd: 3320, change24h: 1.22 },
    { symbol: 'USDT', name: 'Tether USD', priceUsd: 1.0, change24h: 0.01 },
  ]);
  const [cryptoUpdatedAt, setCryptoUpdatedAt] = useState<string>('');
  const [refreshingPrices, setRefreshingPrices] = useState(false);

  // Newsletter state
  const [newsletterEmail, setNewsletterEmail] = useState('');
  const [newsletterStatus, setNewsletterStatus] = useState<'idle' | 'submitting' | 'subscribed' | 'error'>('idle');
  const [newsletterMessage, setNewsletterMessage] = useState('');

  // Auth & Security Context (JWT kept in memory + HttpOnly session cookie, never localStorage)
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('firebase');
  const [jwtToken, setJwtToken] = useState<string | null>(null);
  const jwtTokenRef = useRef<string | null>(null);
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [verificationPreviewCode, setVerificationPreviewCode] = useState<string>('');
  const [securityCtx, setSecurityCtx] = useState<SecurityContextInfo>({
    ipAddress: '127.0.0.1',
    userAgent: 'Browser',
    deviceLabel: 'Desktop Browser',
    tlsActive: true,
  });

  useEffect(() => {
    jwtTokenRef.current = jwtToken;
  }, [jwtToken]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('bw_jwt_token');
    }
  }, []);

  // Account & Admin Data
  const [deposits, setDeposits] = useState<DepositRecord[]>([]);
  const [registrationPayments, setRegistrationPayments] = useState<RegistrationPayment[]>([]);
  const [orders, setOrders] = useState<ShippingOrder[]>([]);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [notifications, setNotifications] = useState<EmailNotification[]>([]);
  const [loginLogs, setLoginLogs] = useState<LoginActivity[]>([]);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [supportMessages, setSupportMessages] = useState<SupportMessage[]>([]);
  const [adminUsers, setAdminUsers] = useState<UserAccount[]>([]);
  const [adminLogs, setAdminLogs] = useState<AdminLogEntry[]>([]);
  const [siteSettings, setSiteSettings] = useState<WebsiteSettings>(DEFAULT_SITE_SETTINGS);
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([]);
  const [servicePricingMap, setServicePricingMap] = useState<Record<string, BaseTierPriceOverride>>({});
  const triggeredAlertIdsRef = useRef<Set<string>>(new Set());

  const applyServicePricingList = useCallback((list: ServicePriceOverride[]) => {
    const next: Record<string, BaseTierPriceOverride> = {};
    for (const item of list) {
      if (item && item.serviceId) {
        next[item.serviceId] = {
          personalPrice: Number(item.personalPrice),
          businessPrice: Number(item.businessPrice),
          corporatePrice: Number(item.corporatePrice),
        };
      }
    }
    setServicePricingMap(next);
  }, []);

  const loadCryptoPrices = useCallback(async () => {
    setRefreshingPrices(true);
    try {
      const res = await apiRequest<{
        updatedAt: string;
        quotes: CryptoPriceQuote[];
      }>('/api/crypto/prices');
      if (Array.isArray(res.quotes) && res.quotes.length > 0) {
        setCryptoQuotes(res.quotes);
        setCryptoUpdatedAt(res.updatedAt || new Date().toISOString());
      }
    } catch {
      // Keep fallback quotes quietly
    } finally {
      setRefreshingPrices(false);
    }
  }, []);

  // Fetch CSRF, IP security context, live crypto prices, and public pricing overrides on boot
  useEffect(() => {
    void ensureCsrfToken().catch(() => {});
    void loadCryptoPrices();
    apiRequest<{ servicePricing: ServicePriceOverride[] }>('/api/catalog/pricing')
      .then((res) => {
        if (Array.isArray(res.servicePricing) && res.servicePricing.length > 0) {
          applyServicePricingList(res.servicePricing);
        }
      })
      .catch(() => {});
    apiRequest<{ siteSettings: WebsiteSettings }>('/api/settings')
      .then((res) => {
        if (res.siteSettings) setSiteSettings(res.siteSettings);
      })
      .catch(() => {});
    apiRequest<SecurityContextInfo>('/api/security/context')
      .then((ctx) => setSecurityCtx(ctx))
      .catch(() => {});
  }, [loadCryptoPrices, applyServicePricingList]);

  // Hydrate Express JWT dashboard when cookie/memory session is active
  const refreshJwtDashboard = useCallback(
    async (token?: string | null) => {
      try {
        const res = await apiRequest<{
          user: UserAccount;
          deposits: DepositRecord[];
          registrationPayments: RegistrationPayment[];
          orders: ShippingOrder[];
          transactions: WalletTransaction[];
          notifications: EmailNotification[];
          loginLogs: LoginActivity[];
          supportTickets: SupportTicket[];
          supportMessages: SupportMessage[];
          priceAlerts: PriceAlert[];
          servicePricing: ServicePriceOverride[];
          allUsers: UserAccount[];
          adminLogs?: AdminLogEntry[];
          siteSettings?: WebsiteSettings;
        }>('/api/jwt/dashboard', { jwtToken: token || jwtTokenRef.current || undefined });
        setAuthMode('jwt');
        setCurrentUser(res.user);
        setDeposits(res.deposits || []);
        setRegistrationPayments(res.registrationPayments || []);
        setOrders(res.orders || []);
        setTransactions(res.transactions || []);
        setNotifications(res.notifications || []);
        setLoginLogs(res.loginLogs || []);
        setSupportTickets(res.supportTickets || []);
        setSupportMessages(res.supportMessages || []);
        setPriceAlerts(res.priceAlerts || []);
        applyServicePricingList(res.servicePricing || []);
        setAdminUsers(res.allUsers || []);
        setAdminLogs(res.adminLogs || []);
        if (res.siteSettings) {
          setSiteSettings(res.siteSettings);
        }
        if (SUPPORTED_COUNTRIES.includes(res.user.country as SupportedCountry)) {
          setPreferredCountry(res.user.country as SupportedCountry);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (
          msg === 'Your account is awaiting administrator approval.' ||
          msg === 'Your registration was not approved. Please contact support.' ||
          msg === 'Your account has been suspended. Contact support.'
        ) {
          setAdminAccessError(msg);
        }
        jwtTokenRef.current = null;
        setJwtToken(null);
        setCurrentUser(null);
        setRegistrationPayments([]);
        setAdminLogs([]);
        setActiveView('marketplace');
      } finally {
        setAuthReady(true);
      }
    },
    [applyServicePricingList],
  );

  // Listen to Firebase Auth state & restore HttpOnly session cookie if signed out of Firebase
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        try {
          const profile = await ensureFirebaseUserProfile({
            uid: fbUser.uid,
            email: fbUser.email || '',
            fullName: fbUser.displayName || 'BlueWhale Member',
            username: (fbUser.email || 'member').split('@')[0],
            country: preferredCountry,
            phoneNumber: fbUser.phoneNumber || '+1-555-0100',
            ipAddress: securityCtx.ipAddress,
            userAgent: securityCtx.userAgent,
            deviceLabel: securityCtx.deviceLabel,
          });
          if (!isUserAccountApproved(profile)) {
            const blockedMsg = getAccountStatusLoginMessage(getSimpleAccountStatus(profile));
            if (!authModalOpen) {
              await signOut(auth).catch(() => {});
              setCurrentUser(null);
              setAdminAccessError(blockedMsg);
              setActiveView('marketplace');
            }
            return;
          }
          setAuthMode('firebase');
          setCurrentUser(profile);
          if (SUPPORTED_COUNTRIES.includes(profile.country as SupportedCountry)) {
            setPreferredCountry(profile.country as SupportedCountry);
          }
        } catch (err) {
          console.error('Failed to sync Firebase user profile:', err);
        } finally {
          setAuthReady(true);
        }
      } else if (jwtTokenRef.current) {
        void refreshJwtDashboard(jwtTokenRef.current);
      } else {
        try {
          const sessionRes = await apiRequest<{
            user: UserAccount | null;
            token?: string;
            blockedMessage?: string;
          }>('/api/auth/session');
          if (sessionRes.user && isUserAccountApproved(sessionRes.user)) {
            const restoredToken = sessionRes.token || 'cookie-session';
            jwtTokenRef.current = restoredToken;
            setJwtToken(restoredToken);
            setAuthMode('jwt');
            setCurrentUser(sessionRes.user);
            await refreshJwtDashboard(restoredToken);
            return;
          }
          if (sessionRes.blockedMessage) {
            setAdminAccessError(sessionRes.blockedMessage);
          }
        } catch {
          // No active Express cookie session
        }
        setCurrentUser(null);
        setDeposits([]);
        setRegistrationPayments([]);
        setOrders([]);
        setTransactions([]);
        setNotifications([]);
        setLoginLogs([]);
        setSupportTickets([]);
        setSupportMessages([]);
        setPriceAlerts([]);
        setAdminUsers([]);
        setAdminLogs([]);
        setAuthReady(true);
      }
    });

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [securityCtx.ipAddress]);

  // Attach real-time Firestore listeners when authenticated via Firebase
  useEffect(() => {
    if (!authReady || authMode !== 'firebase' || !currentUser?.uid) return;

    let active = true;
    const uid = currentUser.uid;
    const isAdmin = isExclusiveAdmin(currentUser);

    const unsubUser = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data() as Record<string, unknown>;
          setCurrentUser((prev) => {
            if (!prev) return prev;
            const nextProfile = mapFirestoreUserAccount(d, {
              email: prev.email,
              phoneNumber: prev.phoneNumber,
            });
            if (!isUserAccountApproved(nextProfile)) {
              const blockedMsg = getAccountStatusLoginMessage(getSimpleAccountStatus(nextProfile));
              setAdminAccessError(blockedMsg);
              setActiveView('marketplace');
              void signOut(auth).catch(() => {});
              return null;
            }
            return nextProfile;
          });
        } else {
          setCurrentUser(null);
          setActiveView('marketplace');
          void signOut(auth).catch(() => {});
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}`),
    );

    const depQuery = isAdmin
      ? collection(db, 'deposits')
      : query(collection(db, 'deposits'), where('userId', '==', uid));
    const unsubDeposits = onSnapshot(
      depQuery,
      (snap) => {
        const list = snap.docs
          .map((d) => mapFirestoreDeposit(d.id, d.data() as Record<string, unknown>))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setDeposits(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'deposits'),
    );

    const ordQuery = isAdmin
      ? collection(db, 'orders')
      : query(collection(db, 'orders'), where('userId', '==', uid));
    const unsubOrders = onSnapshot(
      ordQuery,
      (snap) => {
        const list = snap.docs
          .map((d) => mapFirestoreOrder(d.id, d.data() as Record<string, unknown>))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setOrders(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'orders'),
    );

    const txQuery = isAdmin
      ? collection(db, 'transactions')
      : query(collection(db, 'transactions'), where('userId', '==', uid));
    const unsubTx = onSnapshot(
      txQuery,
      (snap) => {
        const list = snap.docs
          .map((d) => mapFirestoreTransaction(d.id, d.data() as Record<string, unknown>))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setTransactions(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'transactions'),
    );

    const notifQuery = query(collection(db, 'notifications'), where('userId', '==', uid));
    const unsubNotifs = onSnapshot(
      notifQuery,
      (snap) => {
        const list = snap.docs
          .map((d) => mapFirestoreNotification(d.id, d.data() as Record<string, unknown>))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setNotifications(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'notifications'),
    );

    const logsQuery = isAdmin
      ? collection(db, 'loginLogs')
      : query(collection(db, 'loginLogs'), where('userId', '==', uid));
    const unsubLogs = onSnapshot(
      logsQuery,
      (snap) => {
        const list = snap.docs
          .map((d) => mapFirestoreLoginLog(d.id, d.data() as Record<string, unknown>))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setLoginLogs(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'loginLogs'),
    );

    const ticketQuery = isAdmin
      ? collection(db, 'supportTickets')
      : query(collection(db, 'supportTickets'), where('userId', '==', uid));
    const unsubTickets = onSnapshot(
      ticketQuery,
      (snap) => {
        const list = snap.docs
          .map((d) => mapFirestoreSupportTicket(d.id, d.data() as Record<string, unknown>))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setSupportTickets(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'supportTickets'),
    );

    const alertsQuery = isAdmin
      ? collection(db, 'priceAlerts')
      : query(collection(db, 'priceAlerts'), where('userId', '==', uid));
    const unsubAlerts = onSnapshot(
      alertsQuery,
      (snap) => {
        const list = snap.docs
          .map((d) => mapFirestorePriceAlert(d.id, d.data() as Record<string, unknown>))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setPriceAlerts(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'priceAlerts'),
    );

    const pricingQuery = query(collection(db, 'servicePricing'), where('isPublic', '==', true));
    const unsubPricing = onSnapshot(
      pricingQuery,
      (snap) => {
        const list = snap.docs.map((d) =>
          mapFirestoreServicePriceOverride(d.id, d.data() as Record<string, unknown>),
        );
        applyServicePricingList(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'servicePricing'),
    );

    const regPayQuery = isAdmin
      ? collection(db, 'registrationPayments')
      : query(collection(db, 'registrationPayments'), where('userId', '==', uid));
    const unsubRegPay = onSnapshot(
      regPayQuery,
      (snap) => {
        const list = snap.docs
          .map((d) => mapFirestoreRegistrationPayment(d.id, d.data() as Record<string, unknown>))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setRegistrationPayments(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'registrationPayments'),
    );

    let unsubAdminUsers: (() => void) | undefined;
    let unsubAdminLogs: (() => void) | undefined;
    if (isAdmin) {
      unsubAdminUsers = onSnapshot(
        collection(db, 'users'),
        (snap) => {
          void Promise.all(
            snap.docs.map(async (d) => {
              const data = d.data() as Record<string, unknown>;
              const uidVal = String(data.uid || d.id);
              const priv = await fetchFirebaseUserPrivateInfo(uidVal);
              return mapFirestoreUserAccount(data, priv);
            }),
          ).then((list) => {
            if (active) setAdminUsers(list);
          });
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'users'),
      );

      unsubAdminLogs = onSnapshot(
        collection(db, 'adminLogs'),
        (snap) => {
          const list = snap.docs
            .map((d) => mapFirestoreAdminLog(d.id, d.data() as Record<string, unknown>))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          setAdminLogs(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'adminLogs'),
      );
    }

    const unsubSiteSettings = onSnapshot(
      doc(db, 'siteSettings', 'global'),
      (snap) => {
        if (snap.exists()) {
          setSiteSettings(mapFirestoreWebsiteSettings(snap.id, snap.data() as Record<string, unknown>));
        }
      },
      () => {
        // Ignore if global settings document has not been created yet
      },
    );

    return () => {
      active = false;
      unsubUser();
      unsubDeposits();
      unsubOrders();
      unsubTx();
      unsubNotifs();
      unsubLogs();
      unsubTickets();
      unsubAlerts();
      unsubPricing();
      unsubRegPay();
      unsubSiteSettings();
      if (unsubAdminUsers) unsubAdminUsers();
      if (unsubAdminLogs) unsubAdminLogs();
    };
  }, [authReady, authMode, currentUser?.uid, currentUser?.role, currentUser?.email, applyServicePricingList]);

  // Listen to public Firestore servicePricing updates when using Firebase without an active session
  useEffect(() => {
    if (jwtToken || authMode !== 'firebase' || currentUser?.uid) return;
    const pricingQuery = query(collection(db, 'servicePricing'), where('isPublic', '==', true));
    const unsub = onSnapshot(
      pricingQuery,
      (snap) => {
        if (!snap.empty) {
          const list = snap.docs.map((d) =>
            mapFirestoreServicePriceOverride(d.id, d.data() as Record<string, unknown>),
          );
          applyServicePricingList(list);
        }
      },
      () => {
        // Public pricing falls back cleanly to catalog / API defaults if Firestore isn't populated
      },
    );
    return () => unsub();
  }, [jwtToken, authMode, currentUser?.uid, applyServicePricingList]);

  // Automatic Firebase-mode Price Drop Alert evaluator for the approved signed-in user
  useEffect(() => {
    if (authMode !== 'firebase' || !currentUser?.uid || !isUserAccountApproved(currentUser)) return;
    for (const alert of priceAlerts) {
      if (alert.userId !== currentUser.uid || alert.status !== 'Active') continue;
      if (triggeredAlertIdsRef.current.has(alert.id)) continue;
      const svc = SHIPPING_SERVICES.find((s) => s.id === alert.serviceId);
      if (!svc) continue;
      const livePrice = getAccountPriceUsd(
        svc,
        alert.accountType,
        alert.country,
        servicePricingMap[alert.serviceId] || null,
      );
      if (livePrice < alert.targetPrice) {
        triggeredAlertIdsRef.current.add(alert.id);
        void triggerFirebasePriceAlert({ alert, livePrice }).catch(() => {
          triggeredAlertIdsRef.current.delete(alert.id);
        });
      }
    }
  }, [authMode, currentUser?.uid, priceAlerts, servicePricingMap]);

  const memberLocked = Boolean(currentUser && !isUserAccountApproved(currentUser));

  const navigateToView = useCallback(
    (target: ActiveView) => {
      if (target === 'admin') {
        if (!currentUser) {
          setActiveView('marketplace');
          if (typeof window !== 'undefined' && window.location.pathname !== '/') {
            window.history.replaceState({}, '', '/');
          }
          setAuthInitialTab('login');
          setAuthInitialMessage('');
          setAuthModalOpen(true);
          return;
        }
        if (!isExclusiveAdmin(currentUser)) {
          setAdminAccessError(
            `Access Denied: The administrator portal (/admin) is restricted exclusively to ${ADMIN_EMAIL}.`,
          );
          setActiveView('marketplace');
          if (typeof window !== 'undefined' && window.location.pathname !== '/') {
            window.history.replaceState({}, '', '/');
          }
          return;
        }
        setAdminAccessError('');
        setActiveView('admin');
        if (typeof window !== 'undefined' && window.location.pathname !== '/admin') {
          window.history.pushState({}, '', '/admin');
        }
        return;
      }

      if (target === 'dashboard') {
        if (!currentUser) {
          setActiveView('marketplace');
          if (typeof window !== 'undefined' && window.location.pathname !== '/') {
            window.history.replaceState({}, '', '/');
          }
          setAuthInitialTab('login');
          setAuthInitialMessage('');
          setAuthModalOpen(true);
          return;
        }
        if (!isUserAccountApproved(currentUser)) {
          const blockedMsg = getAccountStatusLoginMessage(getSimpleAccountStatus(currentUser));
          setAdminAccessError(blockedMsg);
          setActiveView('marketplace');
          if (typeof window !== 'undefined' && window.location.pathname !== '/') {
            window.history.replaceState({}, '', '/');
          }
          return;
        }
        setAdminAccessError('');
        setActiveView('dashboard');
        if (typeof window !== 'undefined' && window.location.pathname !== '/dashboard') {
          window.history.pushState({}, '', '/dashboard');
        }
        return;
      }

      setAdminAccessError('');
      setActiveView(target);
      if (
        typeof window !== 'undefined' &&
        (window.location.pathname.startsWith('/admin') ||
          window.location.pathname.startsWith('/dashboard'))
      ) {
        window.history.pushState({}, '', '/');
      }
    },
    [currentUser],
  );

  // Enforce strict /dashboard and /admin URL routing access control even if manually entered
  useEffect(() => {
    if (!authReady || typeof window === 'undefined') return;

    const evaluateRoute = () => {
      const pathname = window.location.pathname;
      if (pathname.startsWith('/admin')) {
        if (!currentUser) {
          setActiveView('marketplace');
          window.history.replaceState({}, '', '/');
          setAuthInitialTab('login');
          setAuthInitialMessage('');
          setAuthModalOpen(true);
        } else if (isExclusiveAdmin(currentUser)) {
          setAdminAccessError('');
          setActiveView('admin');
        } else {
          setActiveView('marketplace');
          setAdminAccessError(
            `Access Denied: The administrator portal (/admin) is restricted exclusively to ${ADMIN_EMAIL}.`,
          );
          window.history.replaceState({}, '', '/');
        }
      } else if (pathname.startsWith('/dashboard') || pathname.startsWith('/user-dashboard')) {
        if (!currentUser) {
          setActiveView('marketplace');
          window.history.replaceState({}, '', '/');
          setAuthInitialTab('login');
          setAuthInitialMessage('');
          setAuthModalOpen(true);
        } else if (!isUserAccountApproved(currentUser)) {
          setActiveView('marketplace');
          setAdminAccessError(getAccountStatusLoginMessage(getSimpleAccountStatus(currentUser)));
          window.history.replaceState({}, '', '/');
        } else {
          setAdminAccessError('');
          setActiveView('dashboard');
        }
      } else if (activeView === 'admin' && !isExclusiveAdmin(currentUser)) {
        setActiveView('marketplace');
      } else if (activeView === 'dashboard' && (!currentUser || !isUserAccountApproved(currentUser))) {
        setActiveView('marketplace');
      }
    };

    evaluateRoute();
    window.addEventListener('popstate', evaluateRoute);
    return () => window.removeEventListener('popstate', evaluateRoute);
  }, [authReady, currentUser, activeView]);

  // Keep JWT status/wallet balance/approvals synchronized when signed in under JWT mode
  useEffect(() => {
    if (!authReady || authMode !== 'jwt' || !jwtToken) return;
    const hasPendingDeposit = deposits.some((d) => d.status === 'Pending');
    if (activeView === 'marketplace' && !hasPendingDeposit && !memberLocked) return;

    const timer = window.setInterval(() => {
      void refreshJwtDashboard(jwtToken);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [authReady, authMode, jwtToken, activeView, deposits, memberLocked, refreshJwtDashboard]);

  const filteredServices = useMemo(() => {
    return SHIPPING_SERVICES.filter((svc) => svc.countries.includes(preferredCountry));
  }, [preferredCountry]);

  async function handleSignOut() {
    if (authMode === 'firebase') {
      await signOut(auth);
    }
    if (authMode === 'jwt' || jwtTokenRef.current) {
      await apiRequest('/api/auth/logout', {
        method: 'POST',
        jwtToken: jwtTokenRef.current || undefined,
      }).catch(() => {});
    }
    localStorage.removeItem('bw_jwt_token');
    jwtTokenRef.current = null;
    setJwtToken(null);
    setCurrentUser(null);
    setRegistrationPayments([]);
    setAdminLogs([]);
    setAdminAccessError('');
    setVerificationPreviewCode('');
    navigateToView('marketplace');
  }

  function handleOpenDepositFlow() {
    if (!currentUser) {
      setAuthInitialTab('login');
      setAuthInitialMessage('');
      setAuthModalOpen(true);
      return;
    }
    if (!isUserAccountApproved(currentUser)) {
      setAdminAccessError(getAccountStatusLoginMessage(getSimpleAccountStatus(currentUser)));
      navigateToView('marketplace');
      return;
    }
    setDepositModalOpen(true);
  }

  function openDashboard(targetTab: DashboardTab = 'dashboard') {
    if (!currentUser) {
      setAuthInitialTab('login');
      setAuthInitialMessage('');
      setAuthModalOpen(true);
      return;
    }
    if (!isUserAccountApproved(currentUser)) {
      setAdminAccessError(getAccountStatusLoginMessage(getSimpleAccountStatus(currentUser)));
      navigateToView('marketplace');
      return;
    }
    setDashboardTab(targetTab);
    navigateToView('dashboard');
  }

  async function handleSubmitRegistrationPayment(payload: {
    amount: number;
    currency: CryptoCurrencyCode;
    walletAddress: string;
    txId: string;
    receiptDataUrl: string;
    receiptFileName: string;
  }) {
    if (!currentUser) throw new Error('Authentication required');
    if (authMode === 'firebase') {
      await submitFirebaseRegistrationPayment({
        user: currentUser,
        ...payload,
      });
    } else if (jwtToken) {
      await apiRequest('/api/jwt/registration-payment', {
        method: 'POST',
        jwtToken,
        body: {
          amount: payload.amount,
          currency: payload.currency,
          txId: payload.txId,
          receiptDataUrl: payload.receiptDataUrl,
          receiptFileName: payload.receiptFileName,
        },
      });
      await refreshJwtDashboard(jwtToken);
    }
  }

  async function handleVerifyOptionalEmail(code: string) {
    if (authMode !== 'jwt' || !jwtToken) return;
    const res = await apiRequest<{ user: UserAccount }>('/api/auth/verify-email', {
      method: 'POST',
      jwtToken,
      body: { code },
    });
    setCurrentUser(res.user);
    await refreshJwtDashboard(jwtToken);
  }

  async function handleDepositSubmit(payload: {
    amount: number;
    currency: CryptoCurrencyCode;
    walletAddress: string;
    txHash: string;
    receiptUrl?: string;
    receiptDataUrl?: string;
    receiptFileName: string;
  }) {
    if (!currentUser) throw new Error('Authentication required');
    if (!isUserAccountApproved(currentUser)) {
      throw new Error('Your registration payment is currently awaiting administrator approval.');
    }
    if (authMode === 'firebase') {
      await submitFirebaseDeposit({
        user: currentUser,
        ...payload,
      });
    } else {
      await apiRequest('/api/jwt/deposits', {
        method: 'POST',
        jwtToken,
        body: {
          amount: payload.amount,
          currency: payload.currency,
          txHash: payload.txHash,
          ...(payload.receiptUrl ? { receiptUrl: payload.receiptUrl } : {}),
          ...(payload.receiptDataUrl ? { receiptDataUrl: payload.receiptDataUrl } : {}),
          receiptFileName: payload.receiptFileName,
        },
      });
      await refreshJwtDashboard(jwtToken || 'cookie-session');
    }
  }

  async function handleConfirmPurchase(payload: {
    service: ShippingServiceItem;
    accountType: AccountTier;
    country: SupportedCountry;
    recipientName: string;
    destinationCity: string;
  }): Promise<{ trackingCode: string }> {
    if (!currentUser) throw new Error('Please sign in first.');
    if (!isUserAccountApproved(currentUser)) {
      throw new Error('Your registration payment is currently awaiting administrator approval.');
    }
    if (authMode === 'firebase') {
      return purchaseFirebaseService({
        user: currentUser,
        ...payload,
      });
    }
    if (jwtToken) {
      const res = await apiRequest<{ order: ShippingOrder }>('/api/jwt/orders', {
        method: 'POST',
        jwtToken,
        body: {
          serviceId: payload.service.id,
          accountType: payload.accountType,
          country: payload.country,
          recipientName: payload.recipientName,
          destinationCity: payload.destinationCity,
        },
      });
      await refreshJwtDashboard(jwtToken);
      return { trackingCode: res.order.trackingCode };
    }
    throw new Error('Authentication session missing.');
  }

  async function handleQuickBuy(service: ShippingServiceItem) {
    if (memberLocked) return;
    const activePrice = getAccountPriceUsd(
      service,
      selectedAccountType,
      preferredCountry,
      servicePricingMap[service.id] || null,
    );
    if (!currentUser || currentUser.walletBalance < activePrice) {
      setSelectedService(service);
      return;
    }

    setQuickBuyError('');
    setQuickBuyResult(null);
    setQuickBuyLoadingId(service.id);
    try {
      const result = await handleConfirmPurchase({
        service,
        accountType: selectedAccountType,
        country: preferredCountry,
        recipientName: currentUser.fullName || currentUser.username || 'Verified Account Holder',
        destinationCity: preferredCountry,
      });
      setQuickBuyResult({
        providerName: service.providerName,
        accountType: selectedAccountType,
        country: preferredCountry,
        price: activePrice,
        trackingCode: result.trackingCode,
      });
    } catch (error) {
      setQuickBuyError(
        error instanceof Error ? error.message : 'Quick Buy could not be completed.',
      );
    } finally {
      setQuickBuyLoadingId(null);
    }
  }

  function handleOpenPriceAlertModal(
    service: ShippingServiceItem,
    tier: AccountTier = selectedAccountType,
    country: SupportedCountry = preferredCountry,
  ) {
    if (memberLocked) return;
    setAlertModalInitialTier(tier);
    setAlertModalInitialCountry(country);
    setAlertModalService(service);
  }

  async function handleSavePriceAlert(payload: {
    service: ShippingServiceItem;
    accountType: AccountTier;
    country: SupportedCountry;
    targetPrice: number;
    currentPrice: number;
    existingAlertId?: string;
  }) {
    if (!currentUser) throw new Error('Please sign in first.');
    if (authMode === 'firebase') {
      await createOrUpdateFirebasePriceAlert({
        user: currentUser,
        ...payload,
      });
      return;
    }
    if (jwtToken) {
      await apiRequest('/api/jwt/price-alerts', {
        method: 'POST',
        jwtToken,
        body: {
          serviceId: payload.service.id,
          accountType: payload.accountType,
          country: payload.country,
          targetPrice: payload.targetPrice,
          existingAlertId: payload.existingAlertId,
        },
      });
      await refreshJwtDashboard(jwtToken);
      return;
    }
    throw new Error('Authentication session missing.');
  }

  async function handleCancelPriceAlert(alertId: string) {
    if (authMode === 'firebase') {
      await cancelFirebasePriceAlert(alertId);
      return;
    }
    if (jwtToken) {
      await apiRequest(`/api/jwt/price-alerts/${alertId}/cancel`, {
        method: 'POST',
        jwtToken,
      });
      await refreshJwtDashboard(jwtToken);
    }
  }

  async function handleDeletePriceAlert(alertId: string) {
    if (authMode === 'firebase') {
      await deleteFirebasePriceAlert(alertId);
      return;
    }
    if (jwtToken) {
      await apiRequest(`/api/jwt/price-alerts/${alertId}`, {
        method: 'DELETE',
        jwtToken,
      });
      await refreshJwtDashboard(jwtToken);
    }
  }

  async function handleMarkNotificationRead(notifId: string) {
    if (authMode === 'firebase') {
      await markFirebaseNotificationRead(notifId);
      return;
    }
    setNotifications((prev) =>
      prev.map((n) => (n.id === notifId ? { ...n, read: true } : n)),
    );
    if (jwtToken) {
      await apiRequest(`/api/jwt/notifications/${notifId}/read`, {
        method: 'POST',
        jwtToken,
      }).catch(() => {});
    }
  }

  function handleBuyFromAlert(alert: PriceAlert) {
    const svc = SHIPPING_SERVICES.find((s) => s.id === alert.serviceId);
    if (!svc) return;
    setSelectedAccountType(alert.accountType);
    if (SUPPORTED_COUNTRIES.includes(alert.country)) {
      setPreferredCountry(alert.country);
    }
    setActiveView('marketplace');
    setSelectedService(svc);
  }

  const unreadPriceAlertNotifs = useMemo(
    () => notifications.filter((n) => n.category === 'price_alert' && !n.read),
    [notifications],
  );

  async function handleNewsletterSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNewsletterStatus('submitting');
    setNewsletterMessage('');
    try {
      const res = await apiRequest<{ subscribed: boolean; email: string }>('/api/newsletter/subscribe', {
        method: 'POST',
        body: { email: newsletterEmail },
      });
      setNewsletterStatus('subscribed');
      setNewsletterMessage(`Subscribed ${res.email} to verified account inventory & pricing updates.`);
      setNewsletterEmail('');
    } catch (error) {
      setNewsletterStatus('error');
      setNewsletterMessage(error instanceof Error ? error.message : 'Unable to subscribe.');
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      {/* Top Navigation Bar — 3-Zone Contract */}
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-slate-950/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={() => navigateToView('marketplace')}
            className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            BlueWhale Markethub
          </button>

          {/* Zone 2: Single-line text nav links (Hidden while non-approved member gate is active) */}
          {!memberLocked ? (
            <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
              <button
                type="button"
                onClick={() => navigateToView('marketplace')}
                className={`hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeView === 'marketplace' ? 'text-blue-600 dark:text-blue-400 font-semibold' : ''
                }`}
              >
                Marketplace
              </button>
              <a
                href="#providers"
                onClick={() => navigateToView('marketplace')}
                className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0"
              >
                Providers
              </a>
              <a
                href="#how-it-works"
                onClick={() => navigateToView('marketplace')}
                className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0"
              >
                How It Works
              </a>
              <button
                type="button"
                onClick={handleOpenDepositFlow}
                className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Wallet
              </button>
              <button
                type="button"
                onClick={() => openDashboard('dashboard')}
                className={`hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeView === 'dashboard' ? 'text-blue-600 dark:text-blue-400 font-semibold' : ''
                }`}
              >
                Dashboard
              </button>
              {isExclusiveAdmin(currentUser) && (
                <button
                  type="button"
                  onClick={() => navigateToView('admin')}
                  className={`hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeView === 'admin' ? 'text-blue-600 dark:text-blue-400 font-semibold' : ''
                  }`}
                >
                  Admin
                </button>
              )}
            </nav>
          ) : (
            <div className="hidden md:flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
              <Lock className="w-3.5 h-3.5" />
              <span>Account Approval Required ($5 Registration Verification)</span>
            </div>
          )}

          {/* Zone 3: Theme Toggle + Primary Action */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setDarkMode((prev) => !prev)}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {currentUser ? (
              <div className="hidden sm:flex items-center gap-2">
                {!memberLocked && (
                  <button
                    type="button"
                    onClick={() => openDashboard('wallet')}
                    className="px-3.5 py-2 text-xs font-mono font-semibold tabular-nums text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    ${currentUser.walletBalance.toFixed(2)}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAuthInitialTab('register');
                  setAuthModalOpen(true);
                }}
                className="hidden sm:inline-flex px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Get Started
              </button>
            )}

            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle navigation menu"
              className="md:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-4 space-y-2">
            {!memberLocked ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    navigateToView('marketplace');
                    setMobileMenuOpen(false);
                  }}
                  className="block w-full text-left px-3 py-2 text-sm font-medium rounded-lg hover:bg-slate-100 dark:hover:bg-slate-900"
                >
                  Marketplace
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    handleOpenDepositFlow();
                  }}
                  className="block w-full text-left px-3 py-2 text-sm font-medium rounded-lg hover:bg-slate-100 dark:hover:bg-slate-900"
                >
                  Wallet & Crypto Deposit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    openDashboard('dashboard');
                  }}
                  className="block w-full text-left px-3 py-2 text-sm font-medium rounded-lg hover:bg-slate-100 dark:hover:bg-slate-900"
                >
                  User Dashboard
                </button>
                {isExclusiveAdmin(currentUser) && (
                  <button
                    type="button"
                    onClick={() => {
                      navigateToView('admin');
                      setMobileMenuOpen(false);
                    }}
                    className="block w-full text-left px-3 py-2 text-sm font-medium rounded-lg hover:bg-slate-100 dark:hover:bg-slate-900"
                  >
                    Admin Dashboard
                  </button>
                )}
              </>
            ) : (
              <div className="px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                Verification Gate Active — Awaiting Administrator Approval
              </div>
            )}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              {currentUser ? (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    void handleSignOut();
                  }}
                  className="w-full px-3 py-2 text-sm font-medium text-rose-600 text-left"
                >
                  Sign Out ({currentUser.username})
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setAuthInitialTab('register');
                    setAuthModalOpen(true);
                  }}
                  className="w-full py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg"
                >
                  Get Started
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Unauthorized Admin Route Access Alert */}
      {adminAccessError && (
        <div className="bg-rose-700 text-white border-b border-rose-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="font-medium">{adminAccessError}</span>
            </div>
            <button
              type="button"
              onClick={() => setAdminAccessError('')}
              aria-label="Dismiss access alert"
              className="p-1 text-rose-100 hover:text-white shrink-0 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Non-sticky Announcement Bar */}
      {!memberLocked && announcementVisible && activeView === 'marketplace' && (
        <div className="bg-slate-900 dark:bg-blue-950 text-slate-100 border-b border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-blue-300 shrink-0">Verified Accounts:</span>
              <span className="truncate text-slate-200">
                {siteSettings.marketplaceNotice || DEFAULT_SITE_SETTINGS.marketplaceNotice}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setAnnouncementVisible(false)}
              aria-label="Dismiss announcement"
              className="p-1 text-slate-400 hover:text-white shrink-0 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Price Drop Alert Banner */}
      {!memberLocked && currentUser && unreadPriceAlertNotifs.length > 0 && (
        <div className="bg-emerald-600 dark:bg-emerald-900 text-white border-b border-emerald-700 dark:border-emerald-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <BellRing className="w-4 h-4 shrink-0 text-emerald-100" />
              <span className="font-semibold shrink-0">Price Drop Alert:</span>
              <span className="truncate text-emerald-50">
                {unreadPriceAlertNotifs[0].body}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => openDashboard('alerts')}
                className="px-2.5 py-1 text-xs font-semibold bg-white text-emerald-800 hover:bg-emerald-50 rounded-md transition-colors cursor-pointer"
              >
                View Alerts ({unreadPriceAlertNotifs.length})
              </button>
              <button
                type="button"
                onClick={() => void handleMarkNotificationRead(unreadPriceAlertNotifs[0].id)}
                aria-label="Mark price alert notification read"
                className="p-1 text-emerald-100 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Router */}
      <main className="flex-1">
        {memberLocked && currentUser ? (
          <RegistrationVerificationView
            user={currentUser}
            authMode={authMode}
            latestPayment={
              registrationPayments.find((p) => p.id === currentUser.registrationPaymentId) ||
              registrationPayments.find((p) => p.userId === currentUser.uid) ||
              null
            }
            notifications={notifications}
            verificationPreviewCode={verificationPreviewCode}
            onSubmitPayment={handleSubmitRegistrationPayment}
            onVerifyOptionalEmail={
              authMode === 'jwt' ? handleVerifyOptionalEmail : undefined
            }
            onRefreshStatus={async () => {
              if (authMode === 'jwt') {
                await refreshJwtDashboard(jwtToken);
              }
            }}
            onOpenPaymentGuide={(asset) => {
              setPaymentGuideAsset(asset);
              setPaymentGuideOpen(true);
            }}
            onLogout={handleSignOut}
          />
        ) : activeView === 'dashboard' && currentUser && isUserAccountApproved(currentUser) ? (
          <UserDashboard
            user={currentUser}
            authMode={authMode}
            jwtToken={jwtToken}
            initialTab={dashboardTab}
            deposits={deposits}
            orders={orders}
            transactions={transactions}
            notifications={notifications}
            loginLogs={loginLogs}
            supportTickets={supportTickets}
            supportMessages={supportMessages}
            priceAlerts={priceAlerts}
            priceOverrides={servicePricingMap}
            onOpenDeposit={() => setDepositModalOpen(true)}
            onBrowseServices={() => setActiveView('marketplace')}
            onRefreshDashboard={
              authMode === 'jwt' && jwtToken
                ? () => refreshJwtDashboard(jwtToken)
                : undefined
            }
            onOpenPaymentGuide={() => {
              setPaymentGuideAsset('BTC');
              setPaymentGuideOpen(true);
            }}
            onEditPriceAlert={(alert) => {
              const svc = SHIPPING_SERVICES.find((s) => s.id === alert.serviceId);
              if (svc) {
                handleOpenPriceAlertModal(svc, alert.accountType, alert.country);
              }
            }}
            onCancelPriceAlert={handleCancelPriceAlert}
            onDeletePriceAlert={handleDeletePriceAlert}
            onBuyFromAlert={handleBuyFromAlert}
            onUpdateProfile={async (updates) => {
              if (authMode === 'firebase') {
                await updateFirebaseProfile(currentUser.uid, updates);
              } else if (jwtToken) {
                await apiRequest('/api/jwt/profile', {
                  method: 'POST',
                  jwtToken,
                  body: {
                    fullName: updates.fullName,
                    username: updates.username,
                    country: updates.country,
                    phoneNumber: updates.phoneNumber,
                  },
                });
                await refreshJwtDashboard(jwtToken);
              }
            }}
            onEnable2faJwt={async (secret, code) => {
              if (!jwtToken) return;
              await apiRequest('/api/jwt/2fa/enable', {
                method: 'POST',
                jwtToken,
                body: { secret, code },
              });
              await refreshJwtDashboard(jwtToken);
            }}
            onDisable2faJwt={async () => {
              if (!jwtToken) return;
              await apiRequest('/api/jwt/2fa/disable', {
                method: 'POST',
                jwtToken,
              });
              await refreshJwtDashboard(jwtToken);
            }}
            onMarkNotificationRead={handleMarkNotificationRead}
            onTriggerPasswordResetEmail={async () => {
              if (authMode === 'firebase') {
                await logFirebaseResetEmailNotification(currentUser);
              }
            }}
            onCreateTicket={async (payload) => {
              if (authMode === 'firebase') {
                return createFirebaseSupportTicket({
                  user: currentUser,
                  ...payload,
                });
              }
              if (jwtToken) {
                const res = await apiRequest<{ ticket: SupportTicket }>('/api/jwt/support/tickets', {
                  method: 'POST',
                  jwtToken,
                  body: payload,
                });
                await refreshJwtDashboard(jwtToken);
                return res.ticket.id;
              }
              throw new Error('Authentication required');
            }}
            onSendTicketMessage={async (ticket, body) => {
              if (authMode === 'firebase') {
                await sendFirebaseSupportMessage({
                  ticket,
                  sender: currentUser,
                  body,
                });
              } else if (jwtToken) {
                await apiRequest(`/api/jwt/support/tickets/${ticket.id}/messages`, {
                  method: 'POST',
                  jwtToken,
                  body: { body },
                });
                await refreshJwtDashboard(jwtToken);
              }
            }}
          />
        ) : activeView === 'admin' && isExclusiveAdmin(currentUser) && currentUser ? (
          <AdminDashboard
            authMode={authMode}
            users={adminUsers}
            registrationPayments={registrationPayments}
            deposits={deposits}
            orders={orders}
            transactions={transactions}
            supportTickets={supportTickets}
            supportMessages={supportMessages}
            loginLogs={loginLogs}
            adminLogs={adminLogs}
            siteSettings={siteSettings}
            priceOverrides={servicePricingMap}
            priceAlerts={priceAlerts}
            onReviewRegistration={async (payload) => {
              if (authMode === 'firebase') {
                await adminReviewFirebaseRegistration({
                  userId: payload.user.uid,
                  userEmail: payload.user.email,
                  fullName: payload.user.fullName,
                  username: payload.user.username,
                  previousStatus: String(payload.user.status),
                  paymentId: payload.paymentId,
                  decision: payload.decision,
                  rejectionReason: payload.rejectionReason,
                  adminNotes: payload.adminNotes,
                  adminUser: { uid: currentUser.uid, email: currentUser.email },
                });
              } else if (jwtToken) {
                await apiRequest(`/api/jwt/admin/registrations/${payload.user.uid}/review`, {
                  method: 'POST',
                  jwtToken,
                  body: {
                    decision: payload.decision,
                    rejectionReason: payload.rejectionReason,
                    adminNotes: payload.adminNotes,
                  },
                });
                await refreshJwtDashboard(jwtToken);
              }
            }}
            onReviewDeposit={async (deposit, decision, note, rejectionReason) => {
              if (authMode === 'firebase') {
                await adminReviewFirebaseDeposit({
                  deposit,
                  decision,
                  adminNote: note,
                  rejectionReason,
                  adminUser: { uid: currentUser.uid, email: currentUser.email },
                });
              } else {
                await apiRequest(`/api/jwt/admin/deposits/${deposit.id}/review`, {
                  method: 'POST',
                  jwtToken,
                  body: { decision, adminNote: note, rejectionReason },
                });
                await refreshJwtDashboard(jwtToken || 'cookie-session');
              }
            }}
            onUpdateOrderStatus={async (order, action) => {
              if (authMode === 'firebase') {
                await adminUpdateFirebaseOrder({
                  order,
                  action,
                  adminUser: { uid: currentUser.uid, email: currentUser.email },
                });
              } else if (jwtToken) {
                await apiRequest(`/api/jwt/admin/orders/${order.id}/status`, {
                  method: 'POST',
                  jwtToken,
                  body: { status: action },
                });
                await refreshJwtDashboard(jwtToken);
              }
            }}
            onUpdateUser={async (uid, updates) => {
              if (authMode === 'firebase') {
                await adminUpdateFirebaseUser(uid, updates, {
                  targetUser: adminUsers.find((u) => u.uid === uid),
                  adminUser: { uid: currentUser.uid, email: currentUser.email },
                });
              } else if (jwtToken) {
                await apiRequest(`/api/jwt/admin/users/${uid}/update`, {
                  method: 'POST',
                  jwtToken,
                  body: updates,
                });
                await refreshJwtDashboard(jwtToken);
              }
            }}
            onDeleteUser={async (targetUser) => {
              if (authMode === 'firebase') {
                await adminDeleteFirebaseUser(targetUser.uid, {
                  targetUser,
                  adminUser: { uid: currentUser.uid, email: currentUser.email },
                });
              } else if (jwtToken) {
                await apiRequest(`/api/jwt/admin/users/${targetUser.uid}`, {
                  method: 'DELETE',
                  jwtToken,
                });
                await refreshJwtDashboard(jwtToken);
              }
            }}
            onReplyTicket={async (ticket, body) => {
              if (authMode === 'firebase') {
                await sendFirebaseSupportMessage({
                  ticket,
                  sender: currentUser,
                  body,
                });
              } else if (jwtToken) {
                await apiRequest(`/api/jwt/support/tickets/${ticket.id}/messages`, {
                  method: 'POST',
                  jwtToken,
                  body: { body },
                });
                await refreshJwtDashboard(jwtToken);
              }
            }}
            onUpdateTicketStatus={async (ticketId, status) => {
              if (authMode === 'firebase') {
                await adminUpdateFirebaseTicketStatus(ticketId, status, {
                  uid: currentUser.uid,
                  email: currentUser.email,
                });
              } else if (jwtToken) {
                await apiRequest(`/api/jwt/admin/support/tickets/${ticketId}/status`, {
                  method: 'POST',
                  jwtToken,
                  body: { status },
                });
                await refreshJwtDashboard(jwtToken);
              }
            }}
            onUpdateServicePrice={async (payload) => {
              if (authMode === 'firebase') {
                return adminUpdateFirebaseServicePrice({
                  adminUid: currentUser.uid,
                  adminEmail: currentUser.email,
                  ...payload,
                });
              }
              if (jwtToken) {
                const res = await apiRequest<{
                  servicePricing: ServicePriceOverride[];
                  triggeredCount: number;
                }>('/api/jwt/admin/pricing', {
                  method: 'POST',
                  jwtToken,
                  body: payload,
                });
                applyServicePricingList(res.servicePricing || []);
                await refreshJwtDashboard(jwtToken);
                return { triggeredCount: res.triggeredCount || 0 };
              }
              throw new Error('Authentication session missing.');
            }}
            onSaveSiteSettings={async (settings) => {
              if (authMode === 'firebase') {
                await saveFirebaseWebsiteSettings({
                  adminUser: { uid: currentUser.uid, email: currentUser.email },
                  ...settings,
                });
              } else if (jwtToken) {
                const res = await apiRequest<{ siteSettings: WebsiteSettings }>('/api/jwt/admin/settings', {
                  method: 'POST',
                  jwtToken,
                  body: settings,
                });
                if (res.siteSettings) setSiteSettings(res.siteSettings);
                await refreshJwtDashboard(jwtToken);
              }
            }}
          />
        ) : (
          /* Marketplace Homepage */
          <div>
            {/* SECTION 1 — HERO */}
            <section className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
                <div className="max-w-3xl flex flex-col justify-center space-y-6">
                  <div className="text-xs font-medium text-blue-600 dark:text-blue-400">
                    BlueWhale Markethub · Verified Account Marketplace
                  </div>
                  <h1
                    className="font-display font-extrabold tracking-tight text-slate-900 dark:text-white leading-[1.08]"
                    style={{ fontSize: 'clamp(2.25rem, 4vw, 3.65rem)', textWrap: 'balance' }}
                  >
                    Verified Accounts for Personal, Business &amp; Corporate Use
                  </h1>
                  <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
                    Purchase pre-verified UPS, FedEx, USPS, Royal Mail, ShipStation, EasyPost, EasyShip, and Stamps.com accounts starting from $100 upward, scaled by account tier and country.
                  </p>
                  <div className="flex flex-wrap items-center gap-3.5 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (currentUser) {
                          const el = document.getElementById('providers');
                          el?.scrollIntoView({ behavior: 'smooth' });
                        } else {
                          setAuthInitialTab('register');
                          setAuthModalOpen(true);
                        }
                      }}
                      className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <span>Get Started</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenDepositFlow}
                      className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Wallet className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <span>Deposit Funds</span>
                    </button>
                  </div>
                </div>

                {/* SECTION 2 — TRUST INDICATORS & COUNTERS */}
                <div className="mt-10 pt-8 border-t border-slate-200 dark:border-slate-800 space-y-8">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                    <div className="flex items-center gap-2.5 text-xs font-medium text-slate-700 dark:text-slate-200">
                      <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                      <span>Secure Platform</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-xs font-medium text-slate-700 dark:text-slate-200">
                      <Verified className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                      <span>Verified Business</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-xs font-medium text-slate-700 dark:text-slate-200">
                      <Headphones className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                      <span>24/7 Support</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-xs font-medium text-slate-700 dark:text-slate-200">
                      <Globe className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                      <span>Global Coverage</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-xs font-medium text-slate-700 dark:text-slate-200">
                      <Lock className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                      <span>Encrypted Transactions</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 pt-6 border-t border-slate-100 dark:border-slate-800/80">
                    <div>
                      <div className="font-mono text-2xl sm:text-3xl font-bold tabular-nums text-slate-900 dark:text-white">
                        18,000+
                      </div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Registered Users
                      </div>
                    </div>
                    <div>
                      <div className="font-mono text-2xl sm:text-3xl font-bold tabular-nums text-slate-900 dark:text-white">
                        70+
                      </div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Supported Countries
                      </div>
                    </div>
                    <div>
                      <div className="font-mono text-2xl sm:text-3xl font-bold tabular-nums text-slate-900 dark:text-white">
                        12,000+
                      </div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Orders Completed
                      </div>
                    </div>
                    <div>
                      <div className="font-mono text-2xl sm:text-3xl font-bold tabular-nums text-slate-900 dark:text-white">
                        99.9%
                      </div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Uptime
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* SECTION 3 & 4 — ACCOUNT TIER, COUNTRY SELECTION & VERIFIED ACCOUNT PROVIDERS */}
            <section id="providers" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-8">
              <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
                <div className="space-y-2 max-w-2xl">
                  <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                    Verified Account Providers
                  </h2>
                  <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300">
                    Select your account tier (Personal, Business, or Corporate) and country below. Prices start from $100 upward depending on tier and jurisdiction.
                  </p>
                </div>

                {/* Account Tier & Preferred Country Controls */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-4 shrink-0">
                  <div>
                    <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                      Account Type
                    </div>
                    <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
                      {ACCOUNT_TIERS.map((tier) => {
                        const active = selectedAccountType === tier;
                        return (
                          <button
                            key={tier}
                            type="button"
                            onClick={() => setSelectedAccountType(tier)}
                            className={`px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                              active
                                ? 'bg-blue-600 text-white'
                                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                            }`}
                          >
                            {tier}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="w-full sm:w-64">
                    <label
                      htmlFor="preferred-country-select"
                      className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
                    >
                      Preferred Country
                    </label>
                    <div className="relative">
                      <Globe className="w-4 h-4 text-blue-600 dark:text-blue-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <select
                        id="preferred-country-select"
                        value={preferredCountry}
                        onChange={(e) => setPreferredCountry(e.target.value as SupportedCountry)}
                        className="w-full pl-10 pr-4 py-2.5 text-sm font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                      >
                        {SUPPORTED_COUNTRIES.map((countryName) => (
                          <option key={countryName} value={countryName}>
                            {countryName}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Interactive Country Segmented Selector (14 Countries) */}
              <div className="flex items-center gap-1.5 flex-wrap p-1.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                {SUPPORTED_COUNTRIES.map((countryName) => {
                  const active = preferredCountry === countryName;
                  return (
                    <button
                      key={countryName}
                      type="button"
                      onClick={() => setPreferredCountry(countryName)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        active
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'
                      }`}
                    >
                      {countryName}
                    </button>
                  );
                })}
              </div>

              <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center justify-between gap-2">
                <span>
                  Showing{' '}
                  <span className="font-mono font-semibold text-slate-900 dark:text-white">
                    {filteredServices.length}
                  </span>{' '}
                  verified <span className="font-semibold text-slate-900 dark:text-white">{selectedAccountType}</span> accounts available for{' '}
                  <span className="font-semibold text-slate-900 dark:text-white">{preferredCountry}</span>
                  {currentUser && (
                    <>
                      {' · '}Wallet:{' '}
                      <span className="font-mono font-semibold tabular-nums text-blue-600 dark:text-blue-400">
                        ${currentUser.walletBalance.toFixed(2)}
                      </span>
                    </>
                  )}
                </span>
                <span className="font-mono text-slate-500 dark:text-slate-400">
                  {COUNTRY_PRICE_MODIFIERS[preferredCountry].regionLabel}
                </span>
              </div>

              {quickBuyResult && (
                <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5 text-xs text-emerald-900 dark:text-emerald-100">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold">
                        Quick Buy Complete — {quickBuyResult.providerName} {quickBuyResult.accountType} Account ({quickBuyResult.country})
                      </div>
                      <div className="mt-0.5 text-emerald-800 dark:text-emerald-300">
                        <span className="font-mono tabular-nums font-semibold">${quickBuyResult.price.toFixed(2)}</span> deducted · Activation Ref:{' '}
                        <code className="font-mono font-semibold">{quickBuyResult.trackingCode}</code> · Instant · Ready to Use
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => openDashboard('orders')}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                    >
                      View in Orders
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuickBuyResult(null)}
                      aria-label="Dismiss purchase confirmation"
                      className="p-1.5 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 rounded-lg cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {quickBuyError && (
                <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center justify-between gap-3 text-xs text-rose-800 dark:text-rose-200">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{quickBuyError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setQuickBuyError('')}
                    aria-label="Dismiss error"
                    className="p-1 hover:bg-rose-100 dark:hover:bg-rose-900/50 rounded-lg cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Provider Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
                {filteredServices.map((service) => {
                  const override = servicePricingMap[service.id] || null;
                  const activePrice = getAccountPriceUsd(
                    service,
                    selectedAccountType,
                    preferredCountry,
                    override,
                  );
                  const defaultPrice = getAccountPriceUsd(
                    service,
                    selectedAccountType,
                    preferredCountry,
                    null,
                  );
                  const hasPriceDrop = activePrice < defaultPrice;
                  const canQuickBuy = Boolean(currentUser && currentUser.walletBalance >= activePrice);
                  const isQuickBuying = quickBuyLoadingId === service.id;
                  const userServiceAlert = currentUser
                    ? priceAlerts.find(
                        (a) =>
                          a.userId === currentUser.uid &&
                          a.serviceId === service.id &&
                          a.accountType === selectedAccountType &&
                          a.country === preferredCountry &&
                          a.status !== 'Cancelled',
                      )
                    : undefined;
                  return (
                    <article
                      key={service.id}
                      className="flex flex-col justify-between p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 transition-colors"
                    >
                      <div className="space-y-4">
                        <div className="flex items-start justify-between gap-3">
                          <ProviderLogo providerId={service.providerId} />
                          <div className="text-right">
                            <div className="text-[11px] text-slate-500">
                              {selectedAccountType} · {preferredCountry}
                            </div>
                            <div className="font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-white">
                              ${activePrice.toFixed(2)}
                            </div>
                            {hasPriceDrop && (
                              <div className="text-[11px] font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                                <span className="line-through text-slate-400 mr-1">
                                  ${defaultPrice.toFixed(2)}
                                </span>
                                Price Drop
                              </div>
                            )}
                          </div>
                        </div>

                        <div>
                          <div className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                            {service.providerName} · {service.category}
                          </div>
                          <h3 className="mt-1 font-display text-base font-bold text-slate-900 dark:text-white">
                            {service.serviceName}
                          </h3>
                          <p className="mt-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                            {service.summary}
                          </p>
                        </div>

                        {/* 3-Tier Country Pricing Matrix */}
                        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1.5 text-xs">
                          {ACCOUNT_TIERS.map((tier) => {
                            const tierPrice = getAccountPriceUsd(
                              service,
                              tier,
                              preferredCountry,
                              override,
                            );
                            const isSelectedTier = tier === selectedAccountType;
                            return (
                              <div
                                key={tier}
                                className={`flex items-center justify-between ${
                                  isSelectedTier
                                    ? 'font-semibold text-blue-700 dark:text-blue-300'
                                    : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                <span>{tier} Account</span>
                                <span className="font-mono tabular-nums">${tierPrice.toFixed(2)}</span>
                              </div>
                            );
                          })}
                        </div>

                        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2 text-xs">
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                            <span>Activation</span>
                            <span className="font-medium text-slate-900 dark:text-white">
                              {service.activationWindow}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                            <span>Verification</span>
                            <span className="font-medium text-slate-900 dark:text-white">
                              {service.verificationLevel}
                            </span>
                          </div>
                          <div className="pt-1 text-slate-500 dark:text-slate-400 leading-relaxed">
                            <span className="font-medium text-slate-700 dark:text-slate-300">
                              Available Countries ({service.countries.length}):{' '}
                            </span>
                            {service.countries.join(', ')}
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 space-y-2">
                        <div className="grid grid-cols-2 gap-2.5">
                          <button
                            type="button"
                            onClick={() => setDetailService(service)}
                            className="inline-flex items-center justify-center px-3 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                          >
                            Learn More
                          </button>
                          {canQuickBuy ? (
                            <button
                              type="button"
                              disabled={quickBuyLoadingId !== null}
                              onClick={() => void handleQuickBuy(service)}
                              title={`Instant 1-click purchase from wallet ($${activePrice.toFixed(2)})`}
                              className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                            >
                              <Zap className="w-3.5 h-3.5 shrink-0" />
                              <span>{isQuickBuying ? 'Buying...' : 'Quick Buy'}</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setSelectedService(service)}
                              className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                            >
                              <span>Buy Account</span>
                              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                            </button>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            handleOpenPriceAlertModal(service, selectedAccountType, preferredCountry)
                          }
                          className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                            userServiceAlert?.status === 'Triggered'
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                              : userServiceAlert?.status === 'Active'
                                ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
                                : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-blue-400 dark:hover:border-blue-600 hover:text-blue-600 dark:hover:text-blue-400'
                          }`}
                        >
                          {userServiceAlert?.status === 'Triggered' ? (
                            <>
                              <BellRing className="w-3.5 h-3.5 shrink-0" />
                              <span>
                                Target Hit! (${(userServiceAlert.triggeredPrice || userServiceAlert.targetPrice).toFixed(0)})
                              </span>
                            </>
                          ) : userServiceAlert?.status === 'Active' ? (
                            <>
                              <BellRing className="w-3.5 h-3.5 shrink-0" />
                              <span>Alert &lt; ${userServiceAlert.targetPrice.toFixed(0)}</span>
                            </>
                          ) : (
                            <>
                              <Bell className="w-3.5 h-3.5 shrink-0" />
                              <span>Alert Me</span>
                            </>
                          )}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            {/* SECTION 5 — HOW IT WORKS + WALLET FUNDING */}
            <section
              id="how-it-works"
              className="bg-white dark:bg-slate-900 border-t border-b border-slate-200 dark:border-slate-800"
            >
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-12">
                <div className="max-w-2xl">
                  <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
                    How BlueWhale Markethub Works
                  </h2>
                  <p className="mt-2 text-sm sm:text-base text-slate-600 dark:text-slate-300">
                    Five structured steps from registration to verified crypto funding and Personal, Business, or Corporate account delivery.
                  </p>
                </div>

                {/* 5-Step Process Strip */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  {HOW_IT_WORKS_STEPS.map((item) => (
                    <div
                      key={item.step}
                      className="p-5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5"
                    >
                      <div className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                        Step {item.step}
                      </div>
                      <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                        {item.title}
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        {item.description}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="pt-2">
                  <div className="h-[260px] sm:h-[340px] w-full rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-900">
                    <img
                      src="/src/assets/images/corporate_account_desk_1795166735020.jpg"
                      alt="Corporate verification desk and multi-region account provisioning"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* SECTION 6 — CUSTOMER TESTIMONIALS */}
            <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 space-y-8">
              <div className="max-w-2xl">
                <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
                  Trusted by Account Buyers Worldwide
                </h2>
                <p className="mt-2 text-sm sm:text-base text-slate-600 dark:text-slate-300">
                  Verified feedback from individuals, businesses, and corporate teams purchasing verified accounts on BlueWhale Markethub.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                {TESTIMONIALS.map((review) => (
                  <article
                    key={review.name}
                    className="flex flex-col justify-between p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center gap-1 text-amber-500" aria-label="5 out of 5 stars">
                        {Array.from({ length: 5 }).map((_, idx) => (
                          <Star key={idx} className="w-4 h-4 fill-current" />
                        ))}
                      </div>
                      <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                        &ldquo;{review.quote}&rdquo;
                      </p>
                    </div>
                    <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">
                        {review.name}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {review.location}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            {/* SECTION 7 — FAQ & LIVE CRYPTOCURRENCY PRICE WIDGET */}
            <section className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                  {/* FAQ Column */}
                  <div className="lg:col-span-7 space-y-6">
                    <div>
                      <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
                        Frequently Asked Questions
                      </h2>
                      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                        Clear answers on Personal, Business, and Corporate tiers, $100+ country pricing, crypto deposits, and activation speed.
                      </p>
                    </div>

                    <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-slate-50 dark:bg-slate-950">
                      {FAQ_ITEMS.map((item, idx) => {
                        const isOpen = openFaqIndex === idx;
                        return (
                          <div key={item.question}>
                            <button
                              type="button"
                              onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                              className="w-full px-5 py-4 flex items-center justify-between gap-4 text-left hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors cursor-pointer"
                            >
                              <span className="text-sm font-semibold text-slate-900 dark:text-white">
                                {item.question}
                              </span>
                              <ChevronDown
                                className={`w-4 h-4 text-slate-500 transition-transform shrink-0 ${
                                  isOpen ? 'rotate-180' : ''
                                }`}
                              />
                            </button>
                            {isOpen && (
                              <div className="px-5 pb-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                                {item.answer}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Live Cryptocurrency Price Widget */}
                  <div className="lg:col-span-5">
                    <div className="p-6 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                            Live Cryptocurrency Rates
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Reference USD market quotes for wallet deposits
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void loadCryptoPrices()}
                          disabled={refreshingPrices}
                          aria-label="Refresh crypto prices"
                          className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <RefreshCw className={`w-4 h-4 ${refreshingPrices ? 'animate-spin' : ''}`} />
                        </button>
                      </div>

                      <div className="space-y-3">
                        {cryptoQuotes.map((q) => {
                          const positive = q.change24h >= 0;
                          return (
                            <div
                              key={q.symbol}
                              className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4"
                            >
                              <div>
                                <div className="font-display text-sm font-bold text-slate-900 dark:text-white">
                                  {q.name}
                                </div>
                                <div className="text-xs font-mono text-slate-500">{q.symbol} / USD</div>
                              </div>
                              <div className="text-right">
                                <div className="font-mono text-base font-bold tabular-nums text-slate-900 dark:text-white">
                                  ${q.priceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                                <div
                                  className={`inline-flex items-center gap-1 text-xs font-mono tabular-nums ${
                                    positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                                  }`}
                                >
                                  {positive ? (
                                    <TrendingUp className="w-3 h-3" />
                                  ) : (
                                    <TrendingDown className="w-3 h-3" />
                                  )}
                                  <span>
                                    {positive ? '+' : ''}
                                    {q.change24h.toFixed(2)}%
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="pt-2 flex items-center justify-between text-[11px] text-slate-500">
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5" />
                          <span>
                            {cryptoUpdatedAt
                              ? `Updated ${new Date(cryptoUpdatedAt).toLocaleTimeString()}`
                              : 'Live market feed'}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={handleOpenDepositFlow}
                          className="font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          Deposit from $100 →
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Corporate Footer with Newsletter & 8 Page Links */}
      <footer className="bg-slate-950 text-slate-300 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Brand Message */}
            <div className="lg:col-span-5 space-y-3">
              <div className="font-display text-lg font-bold text-white">BlueWhale Markethub</div>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed max-w-md">
                BlueWhale Markethub is a verified account marketplace offering Personal, Business, and Corporate accounts across 8 providers and 14 countries starting from $100+.
              </p>
              <div className="flex items-center gap-2 text-xs text-slate-400 pt-1">
                <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0" />
                <span>Encrypted Transactions · Compliance Verified · 24/7 Support Desk</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-300 pt-1">
                <Mail className="w-4 h-4 text-blue-400 shrink-0" />
                <span>Support Email:</span>
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="font-semibold text-blue-400 hover:underline"
                >
                  {SUPPORT_EMAIL}
                </a>
              </div>
            </div>

            {/* Footer Page Links */}
            <div className="lg:col-span-3 grid grid-cols-2 gap-2.5 text-xs">
              {(
                [
                  { id: 'about', label: 'About Us' },
                  { id: 'contact', label: 'Contact Us' },
                  { id: 'privacy', label: 'Privacy Policy' },
                  { id: 'terms', label: 'Terms Of Service' },
                  { id: 'refund', label: 'Refund Policy' },
                  { id: 'aml', label: 'AML Policy' },
                  { id: 'faq', label: 'FAQ' },
                  { id: 'support', label: 'Support' },
                ] as const
              ).map((link) => (
                <button
                  key={link.id}
                  type="button"
                  onClick={() => setFooterPage(link.id)}
                  className="text-left text-slate-400 hover:text-white transition-colors cursor-pointer py-1"
                >
                  {link.label}
                </button>
              ))}
            </div>

            {/* Newsletter Subscription */}
            <div className="lg:col-span-4 space-y-3">
              <div className="text-xs font-semibold text-white">Newsletter Subscription</div>
              <p className="text-xs text-slate-400">
                Receive verified account inventory alerts, country additions, and pricing announcements.
              </p>
              <form onSubmit={handleNewsletterSubmit} className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="email"
                    required
                    value={newsletterEmail}
                    onChange={(e) => setNewsletterEmail(e.target.value)}
                    placeholder="business@company.com"
                    className="w-full pl-9 pr-3 py-2.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <button
                  type="submit"
                  disabled={newsletterStatus === 'submitting'}
                  className="px-4 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  {newsletterStatus === 'submitting' ? 'Saving...' : 'Subscribe'}
                </button>
              </form>
              {newsletterMessage && (
                <div
                  className={`text-xs ${
                    newsletterStatus === 'error' ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {newsletterMessage}
                </div>
              )}
            </div>
          </div>

          <div className="pt-6 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
            <span>© {new Date().getFullYear()} BlueWhale Markethub. All rights reserved.</span>
            <span>
              Support:{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-slate-300 hover:text-white underline">
                {SUPPORT_EMAIL}
              </a>{' '}
              · BTC · ETH · USDT ERC20 · USDT TRC20
            </span>
          </div>
        </div>
      </footer>

      {/* Modals */}
      <AuthModal
        isOpen={authModalOpen}
        initialTab={authInitialTab}
        initialMessage={authInitialMessage}
        onClose={() => {
          setAuthInitialMessage('');
          setAuthModalOpen(false);
        }}
        onJwtSuccess={({ token, user, verificationPreviewCode: vCode }) => {
          jwtTokenRef.current = token;
          setJwtToken(token);
          setAuthMode('jwt');
          setCurrentUser(user);
          if (vCode) setVerificationPreviewCode(vCode);
          void refreshJwtDashboard(token);
          if (isExclusiveAdmin(user)) {
            navigateToView('admin');
          } else if (isUserAccountApproved(user)) {
            setDashboardTab('dashboard');
            navigateToView('dashboard');
          } else {
            navigateToView('marketplace');
          }
        }}
        onGoogleSuccess={async (extra) => {
          const fbUser = auth.currentUser;
          if (!fbUser) return;
          const profile = await ensureFirebaseUserProfile({
            uid: fbUser.uid,
            email: fbUser.email || '',
            fullName: extra.fullName,
            username: extra.username,
            country: extra.country,
            phoneNumber: extra.phoneNumber,
            ipAddress: securityCtx.ipAddress,
            userAgent: securityCtx.userAgent,
            deviceLabel: securityCtx.deviceLabel,
          });
          if (!isUserAccountApproved(profile)) {
            return profile;
          }
          setAuthMode('firebase');
          setCurrentUser(profile);
          if (isExclusiveAdmin(profile)) {
            navigateToView('admin');
          } else {
            setDashboardTab('dashboard');
            navigateToView('dashboard');
          }
          return profile;
        }}
      />

      <DepositModal
        isOpen={depositModalOpen && !memberLocked}
        jwtToken={jwtToken}
        clientUid={currentUser?.uid}
        onClose={() => setDepositModalOpen(false)}
        onOpenInstructions={(asset) => {
          setPaymentGuideAsset(asset);
          setPaymentGuideOpen(true);
        }}
        onSubmitDeposit={handleDepositSubmit}
      />

      <PaymentInstructionsModal
        isOpen={paymentGuideOpen}
        onClose={() => setPaymentGuideOpen(false)}
        initialAsset={paymentGuideAsset}
        onProceedToDeposit={
          depositModalOpen || memberLocked ? undefined : handleOpenDepositFlow
        }
      />

      <ServiceDetailModal
        service={memberLocked ? null : detailService}
        selectedCountry={preferredCountry}
        selectedAccountType={selectedAccountType}
        priceOverride={detailService ? servicePricingMap[detailService.id] || null : null}
        hasActiveAlert={Boolean(
          currentUser &&
            detailService &&
            priceAlerts.some(
              (a) =>
                a.userId === currentUser.uid &&
                a.serviceId === detailService.id &&
                a.country === preferredCountry &&
                a.status === 'Active',
            ),
        )}
        onClose={() => setDetailService(null)}
        onOrderService={(svc, tier) => {
          setSelectedAccountType(tier);
          setSelectedService(svc);
        }}
        onOpenPriceAlert={(svc, tier) => handleOpenPriceAlertModal(svc, tier, preferredCountry)}
      />

      <PriceAlertModal
        service={memberLocked ? null : alertModalService}
        initialCountry={alertModalInitialCountry}
        initialAccountType={alertModalInitialTier}
        priceOverrides={servicePricingMap}
        existingAlerts={
          currentUser ? priceAlerts.filter((a) => a.userId === currentUser.uid) : []
        }
        isAuthenticated={Boolean(currentUser)}
        onClose={() => setAlertModalService(null)}
        onOpenAuth={() => {
          setAuthInitialTab('login');
          setAuthModalOpen(true);
        }}
        onSaveAlert={handleSavePriceAlert}
        onDeleteAlert={handleDeletePriceAlert}
      />

      <PurchaseModal
        service={memberLocked ? null : selectedService}
        country={preferredCountry}
        initialAccountType={selectedAccountType}
        priceOverride={selectedService ? servicePricingMap[selectedService.id] || null : null}
        walletBalance={currentUser?.walletBalance || 0}
        isAuthenticated={Boolean(currentUser)}
        defaultRecipientName={currentUser?.fullName || ''}
        onClose={() => setSelectedService(null)}
        onOpenAuth={() => {
          setAuthInitialTab('login');
          setAuthModalOpen(true);
        }}
        onOpenDeposit={() => setDepositModalOpen(true)}
        onConfirmPurchase={handleConfirmPurchase}
      />

      <FooterInfoModal
        page={footerPage}
        onClose={() => setFooterPage(null)}
        onOpenSupportCenter={() => {
          setFooterPage(null);
          openDashboard('support');
        }}
      />
    </div>
  );
}
