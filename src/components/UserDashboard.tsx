import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import {
  LayoutDashboard,
  Wallet,
  ArrowUpRight,
  Package,
  MessageSquare,
  ShieldCheck,
  UserCog,
  Plus,
  Search,
  CheckCircle2,
  Clock,
  XCircle,
  RefreshCw,
  Download,
  Send,
  Gift,
  Copy,
  Check,
  KeyRound,
  Monitor,
  BookOpen,
  FileText,
  Award,
  Bell,
  BellRing,
  Trash2,
  Edit3,
  MapPin,
  Truck,
} from 'lucide-react';
import { LOYALTY_TIERS, evaluateLoyaltyStatus } from '../data/loyaltyRewards';
import {
  CRYPTO_WALLETS,
  KNOWLEDGE_BASE_ARTICLES,
  SHIPPING_SERVICES,
  SUPPORTED_COUNTRIES,
  getAccountPriceUsd,
  type BaseTierPriceOverride,
} from '../data/shippingCatalog';
import { apiRequest } from '../lib/apiClient';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { downloadOrderInvoice, downloadTransactionReceipt } from '../lib/invoiceGenerator';
import { mapFirestoreSupportMessage } from '../services/firestoreMarketplace';
import { QrCodeCanvas } from './QrCodeCanvas';
import { ReceiptPreviewModal } from './ReceiptPreviewModal';
import { OrderVolumeChart } from './OrderVolumeChart';
import {
  getDisplayRole,
  normalizeAccountStatus,
  type AuthMode,
  type DepositRecord,
  type EmailNotification,
  type LoginActivity,
  type PriceAlert,
  type ShippingOrder,
  type SupportMessage,
  type SupportTicket,
  type UserAccount,
  type WalletTransaction,
} from '../types/marketplace';

export type DashboardTab =
  | 'dashboard'
  | 'wallet'
  | 'transactions'
  | 'orders'
  | 'track'
  | 'alerts'
  | 'loyalty'
  | 'support'
  | 'security'
  | 'profile';

type TxFilter = 'all' | 'deposit' | 'purchase' | 'refund';

interface UserDashboardProps {
  user: UserAccount;
  authMode: AuthMode;
  jwtToken: string | null;
  initialTab?: DashboardTab;
  deposits: DepositRecord[];
  orders: ShippingOrder[];
  transactions: WalletTransaction[];
  notifications: EmailNotification[];
  loginLogs: LoginActivity[];
  supportTickets: SupportTicket[];
  supportMessages: SupportMessage[];
  priceAlerts: PriceAlert[];
  priceOverrides: Record<string, BaseTierPriceOverride>;
  onOpenDeposit: () => void;
  onBrowseServices: () => void;
  onRefreshDashboard?: () => Promise<void>;
  onOpenPaymentGuide?: () => void;
  onEditPriceAlert: (alert: PriceAlert) => void;
  onCancelPriceAlert: (alertId: string) => Promise<void>;
  onDeletePriceAlert: (alertId: string) => Promise<void>;
  onBuyFromAlert: (alert: PriceAlert) => void;
  onUpdateProfile: (updates: {
    fullName: string;
    username: string;
    country: string;
    phoneNumber: string;
    twoFactorEnabled: boolean;
  }) => Promise<void>;
  onEnable2faJwt: (secret: string, code: string) => Promise<void>;
  onDisable2faJwt: () => Promise<void>;
  onMarkNotificationRead: (notifId: string) => Promise<void>;
  onTriggerPasswordResetEmail: () => Promise<void>;
  onCreateTicket: (payload: {
    subject: string;
    category: SupportTicket['category'];
    priority: SupportTicket['priority'];
    message: string;
  }) => Promise<string>;
  onSendTicketMessage: (ticket: SupportTicket, body: string) => Promise<void>;
}

function StatusLabel({ status }: { status: string }) {
  if (status === 'Approved' || status === 'Completed' || status === 'Resolved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span>{status}</span>
      </span>
    );
  }
  if (status === 'Pending' || status === 'Processing' || status === 'Open') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        <Clock className="w-3.5 h-3.5" />
        <span>{status}</span>
      </span>
    );
  }
  if (status === 'Refunded' || status === 'Replied') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-400">
        <RefreshCw className="w-3.5 h-3.5" />
        <span>{status}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700 dark:text-rose-400">
      <XCircle className="w-3.5 h-3.5" />
      <span>{status}</span>
    </span>
  );
}

export function UserDashboard({
  user,
  authMode,
  jwtToken,
  initialTab = 'dashboard',
  deposits,
  orders,
  transactions,
  notifications,
  loginLogs,
  supportTickets,
  supportMessages,
  priceAlerts,
  priceOverrides,
  onOpenDeposit,
  onBrowseServices,
  onRefreshDashboard,
  onOpenPaymentGuide,
  onEditPriceAlert,
  onCancelPriceAlert,
  onDeletePriceAlert,
  onBuyFromAlert,
  onUpdateProfile,
  onEnable2faJwt,
  onDisable2faJwt,
  onMarkNotificationRead,
  onTriggerPasswordResetEmail,
  onCreateTicket,
  onSendTicketMessage,
}: UserDashboardProps) {
  const [activeTab, setActiveTab] = useState<DashboardTab>(initialTab);
  const [txFilter, setTxFilter] = useState<TxFilter>('all');
  const [txSearch, setTxSearch] = useState('');
  const [previewDeposit, setPreviewDeposit] = useState<DepositRecord | null>(null);
  const [depositStatusFilter, setDepositStatusFilter] = useState<'All' | 'Pending' | 'Approved' | 'Rejected'>('All');
  const [refreshingWallet, setRefreshingWallet] = useState(false);
  const [alertBusyId, setAlertBusyId] = useState<string | null>(null);
  const [trackOrderInput, setTrackOrderInput] = useState('');
  const [selectedTrackOrderId, setSelectedTrackOrderId] = useState<string>(() => orders[0]?.id || '');
  const [trackLookupError, setTrackLookupError] = useState('');
  const [copiedTrackId, setCopiedTrackId] = useState(false);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (orders.length === 0) {
      setSelectedTrackOrderId('');
      return;
    }
    if (!selectedTrackOrderId || !orders.some((o) => o.id === selectedTrackOrderId)) {
      setSelectedTrackOrderId(orders[0].id);
    }
  }, [orders, selectedTrackOrderId]);

  // Profile fields (First Name / Last Name split cleanly)
  const nameParts = user.fullName.trim().split(/\s+/);
  const [firstName, setFirstName] = useState(nameParts[0] || '');
  const [lastName, setLastName] = useState(nameParts.slice(1).join(' ') || '');
  const [username, setUsername] = useState(user.username);
  const [country, setCountry] = useState(user.country);
  const [phoneNumber, setPhoneNumber] = useState(user.phoneNumber);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileErr, setProfileErr] = useState('');

  // Security fields
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [totpSetup, setTotpSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpMsg, setTotpMsg] = useState('');
  const [totpErr, setTotpErr] = useState('');

  // Referral copy state
  const [copiedRef, setCopiedRef] = useState(false);

  // Support Tickets & Live Chat
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(
    supportTickets[0]?.id || null,
  );
  const [ticketMessages, setTicketMessages] = useState<SupportMessage[]>([]);
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketCategory, setTicketCategory] =
    useState<SupportTicket['category']>('Account Provisioning');
  const [ticketPriority, setTicketPriority] = useState<SupportTicket['priority']>('Normal');
  const [ticketMessage, setTicketMessage] = useState('');
  const [replyText, setReplyText] = useState('');
  const [supportStatus, setSupportStatus] = useState('');
  const [supportErr, setSupportErr] = useState('');

  const activeTicket = supportTickets.find((t) => t.id === selectedTicketId) || supportTickets[0] || null;

  // Listen to messages for active ticket in Firebase mode, or filter from props in JWT mode
  useEffect(() => {
    if (!activeTicket) {
      setTicketMessages([]);
      return;
    }
    if (authMode === 'jwt') {
      setTicketMessages(supportMessages.filter((m) => m.ticketId === activeTicket.id));
      return;
    }
    const q = query(
      collection(db, 'supportTickets', activeTicket.id, 'messages'),
      orderBy('createdAt', 'asc'),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setTicketMessages(
          snap.docs.map((d) => mapFirestoreSupportMessage(d.id, d.data() as Record<string, unknown>)),
        );
      },
      (err) =>
        handleFirestoreError(err, OperationType.LIST, `supportTickets/${activeTicket.id}/messages`),
    );
    return () => unsub();
  }, [activeTicket?.id, authMode, supportMessages]);

  const unreadNotifs = notifications.filter((n) => !n.read).length;
  const loyalty = evaluateLoyaltyStatus(user.totalPurchases);
  const referralCode = `BW-${user.username.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'PARTNER'}`;
  const trackedOrder = orders.find((o) => o.id === selectedTrackOrderId) || null;

  function handleSelectOrderForTracking(order: ShippingOrder) {
    setSelectedTrackOrderId(order.id);
    setTrackOrderInput(order.id);
    setTrackLookupError('');
    setActiveTab('track');
  }

  function handleTrackOrderLookup(e: React.FormEvent) {
    e.preventDefault();
    const raw = trackOrderInput.trim().toLowerCase();
    if (!raw) {
      setTrackLookupError('Please enter an Order ID or Activation Reference to track.');
      return;
    }
    const matched = orders.find(
      (o) =>
        o.id.toLowerCase() === raw ||
        o.trackingCode.toLowerCase() === raw ||
        o.id.toLowerCase().includes(raw) ||
        o.trackingCode.toLowerCase().includes(raw),
    );
    if (!matched) {
      setTrackLookupError(
        'No matching order found under your account. Check the Order ID or select one from the list below.',
      );
      return;
    }
    setTrackLookupError('');
    setSelectedTrackOrderId(matched.id);
  }

  const filteredTransactions = transactions.filter((tx) => {
    if (txFilter !== 'all' && tx.type !== txFilter) return false;
    if (txSearch.trim()) {
      const q = txSearch.toLowerCase();
      return (
        tx.description.toLowerCase().includes(q) ||
        tx.id.toLowerCase().includes(q) ||
        tx.referenceId.toLowerCase().includes(q) ||
        tx.status.toLowerCase().includes(q)
      );
    }
    return true;
  });

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileMsg('');
    setProfileErr('');
    try {
      const combined = `${firstName.trim()} ${lastName.trim()}`.trim() || user.fullName;
      await onUpdateProfile({
        fullName: combined,
        username,
        country,
        phoneNumber,
        twoFactorEnabled: user.twoFactorEnabled,
      });
      setProfileMsg('Profile settings saved.');
    } catch (err) {
      setProfileErr(err instanceof Error ? err.message : 'Unable to save profile.');
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg('');
    setPwErr('');
    if (authMode === 'firebase') {
      try {
        await onTriggerPasswordResetEmail();
        setPwMsg('Security email logged ("Reset Your Password").');
      } catch (err) {
        setPwErr(err instanceof Error ? err.message : 'Failed to send reset notice.');
      }
      return;
    }
    try {
      await apiRequest('/api/jwt/change-password', {
        method: 'POST',
        jwtToken,
        body: { currentPassword, newPassword },
      });
      setCurrentPassword('');
      setNewPassword('');
      setPwMsg('Password updated with bcrypt encryption.');
    } catch (err) {
      setPwErr(err instanceof Error ? err.message : 'Password update failed.');
    }
  }

  async function handleStart2faSetup() {
    setTotpErr('');
    setTotpMsg('');
    try {
      const res = await apiRequest<{ secret: string; otpauthUrl: string }>('/api/security/2fa/generate', {
        method: 'POST',
        body: { email: user.email },
      });
      setTotpSetup(res);
    } catch (err) {
      setTotpErr(err instanceof Error ? err.message : 'Unable to initialize 2FA.');
    }
  }

  async function handleVerify2fa(e: React.FormEvent) {
    e.preventDefault();
    if (!totpSetup) return;
    setTotpErr('');
    setTotpMsg('');
    try {
      if (authMode === 'jwt') {
        await onEnable2faJwt(totpSetup.secret, totpCode);
      } else {
        await apiRequest('/api/security/2fa/verify', {
          method: 'POST',
          body: { secret: totpSetup.secret, code: totpCode },
        });
        await onUpdateProfile({
          fullName: user.fullName,
          username: user.username,
          country: user.country,
          phoneNumber: user.phoneNumber,
          twoFactorEnabled: true,
        });
      }
      setTotpSetup(null);
      setTotpCode('');
      setTotpMsg('Two-factor authentication is now enabled.');
    } catch (err) {
      setTotpErr(err instanceof Error ? err.message : 'Verification failed.');
    }
  }

  async function handleDisable2fa() {
    setTotpErr('');
    setTotpMsg('');
    try {
      if (authMode === 'jwt') {
        await onDisable2faJwt();
      } else {
        await onUpdateProfile({
          fullName: user.fullName,
          username: user.username,
          country: user.country,
          phoneNumber: user.phoneNumber,
          twoFactorEnabled: false,
        });
      }
      setTotpMsg('Two-factor authentication disabled.');
    } catch (err) {
      setTotpErr(err instanceof Error ? err.message : 'Could not disable 2FA.');
    }
  }

  async function handleCreateTicket(e: React.FormEvent) {
    e.preventDefault();
    setSupportErr('');
    setSupportStatus('');
    try {
      const newId = await onCreateTicket({
        subject: ticketSubject,
        category: ticketCategory,
        priority: ticketPriority,
        message: ticketMessage,
      });
      setSelectedTicketId(newId);
      setTicketSubject('');
      setTicketMessage('');
      setSupportStatus('Support ticket opened. Our operations desk replies promptly.');
    } catch (err) {
      setSupportErr(err instanceof Error ? err.message : 'Could not open ticket.');
    }
  }

  async function handleSendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!activeTicket || !replyText.trim()) return;
    setSupportErr('');
    try {
      await onSendTicketMessage(activeTicket, replyText);
      setReplyText('');
    } catch (err) {
      setSupportErr(err instanceof Error ? err.message : 'Unable to send message.');
    }
  }

  const menuItems: { id: DashboardTab; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'wallet', label: 'Wallet', icon: <Wallet className="w-4 h-4" /> },
    { id: 'transactions', label: 'Transactions', icon: <ArrowUpRight className="w-4 h-4" />, count: transactions.length },
    { id: 'orders', label: 'Orders', icon: <Package className="w-4 h-4" />, count: orders.length },
    { id: 'track', label: 'Track Order', icon: <MapPin className="w-4 h-4" /> },
    {
      id: 'alerts',
      label: 'Price Alerts',
      icon: <Bell className="w-4 h-4" />,
      count: priceAlerts.filter((a) => a.status !== 'Cancelled').length,
    },
    { id: 'loyalty', label: 'Loyalty Rewards', icon: <Award className="w-4 h-4" /> },
    { id: 'support', label: 'Support Tickets', icon: <MessageSquare className="w-4 h-4" />, count: supportTickets.length },
    { id: 'security', label: 'Security', icon: <ShieldCheck className="w-4 h-4" /> },
    { id: 'profile', label: 'Profile Settings', icon: <UserCog className="w-4 h-4" /> },
  ];

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar */}
        <aside className="w-full lg:w-64 shrink-0 space-y-5">
          <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center gap-3">
              <img
                src="/src/assets/images/avatar_admin_director_1795164622326.jpg"
                alt={user.fullName}
                referrerPolicy="no-referrer"
                className="w-11 h-11 rounded-full object-cover border border-slate-200 dark:border-slate-700"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-display font-semibold text-sm text-slate-900 dark:text-white truncate">
                    {user.fullName}
                  </span>
                  <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 shrink-0">
                    {getDisplayRole(user.role)}
                  </span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  @{user.username} · {user.country}
                </div>
              </div>
            </div>
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Loyalty Tier</span>
                <button
                  type="button"
                  onClick={() => setActiveTab('loyalty')}
                  className={`font-semibold hover:underline cursor-pointer ${loyalty.currentTier.accentTextClass}`}
                >
                  {loyalty.currentTier.name}
                </button>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${loyalty.currentTier.barFillClass}`}
                  style={{ width: `${loyalty.progressPercent}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                {loyalty.nextTier
                  ? `$${loyalty.amountToNextTier.toFixed(2)} to ${loyalty.nextTier.name}`
                  : 'Top partner tier unlocked'}
              </div>
            </div>
          </div>

          <nav className="flex lg:flex-col gap-1 overflow-x-auto pb-2 lg:pb-0">
            {menuItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    {item.icon}
                    <span>{item.label}</span>
                  </span>
                  {item.count !== undefined && (
                    <span
                      className={`text-xs font-mono tabular-nums ${
                        active ? 'text-blue-100' : 'text-slate-400'
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main Viewport */}
        <div className="flex-1 min-w-0 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                BlueWhale Markethub · {user.email} · {user.isVerified ? 'Verified Business' : 'Pending Verification'}
              </div>
              <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
                {menuItems.find((m) => m.id === activeTab)?.label}
              </h1>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={onBrowseServices}
                className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
              >
                Browse Accounts
              </button>
              <button
                type="button"
                onClick={onOpenDeposit}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Deposit Funds</span>
              </button>
            </div>
          </div>

          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              {/* Overview KPIs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-xs text-slate-500">Current Wallet Balance</div>
                  <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                    ${user.walletBalance.toFixed(2)}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Available USD Credit</div>
                </div>
                <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-xs text-slate-500">Recent Deposits</div>
                  <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                    ${user.totalDeposits.toFixed(2)}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {deposits.filter((d) => d.status === 'Pending').length} pending approval
                  </div>
                </div>
                <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-xs text-slate-500">Recent Orders</div>
                  <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                    {orders.length}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    ${user.totalPurchases.toFixed(2)} total volume
                  </div>
                </div>
                <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-xs text-slate-500">Loyalty Rewards</div>
                  <div className={`mt-2 font-display text-2xl font-bold ${loyalty.currentTier.accentTextClass}`}>
                    {loyalty.currentTier.name}
                  </div>
                  <div className="mt-1 text-xs font-mono tabular-nums text-slate-500">
                    {loyalty.pointsEarned.toLocaleString()} pts · {loyalty.currentTier.pointsMultiplier}x rate
                  </div>
                </div>
              </div>

              {/* Loyalty Rewards Status & Benefits */}
              <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <Award className={`w-5 h-5 shrink-0 mt-0.5 ${loyalty.currentTier.accentTextClass}`} />
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">
                        Loyalty Rewards · {loyalty.currentTier.name} Status
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {loyalty.currentTier.summary} Qualifying purchase volume:{' '}
                        <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                          ${loyalty.totalPurchases.toFixed(2)}
                        </span>
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('loyalty')}
                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0 self-start sm:self-center cursor-pointer"
                  >
                    Compare All Tiers →
                  </button>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">
                      {loyalty.nextTier
                        ? `Progress to ${loyalty.nextTier.name} ($${loyalty.nextTier.minPurchaseUsd.toLocaleString()}+ volume)`
                        : 'Maximum partner tier reached'}
                    </span>
                    <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300 font-medium">
                      {loyalty.nextTier
                        ? `$${loyalty.amountToNextTier.toFixed(2)} remaining`
                        : `${loyalty.progressPercent}%`}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${loyalty.currentTier.barFillClass}`}
                      style={{ width: `${loyalty.progressPercent}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-2 border-t border-slate-200 dark:border-slate-800 items-center">
                  <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {loyalty.currentTier.benefits.map((benefit) => (
                      <div
                        key={benefit}
                        className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                        <span>{benefit}</span>
                      </div>
                    ))}
                  </div>
                  <div className="lg:col-span-5 flex flex-col sm:flex-row lg:justify-end items-start sm:items-center gap-2.5">
                    <div className="text-xs text-slate-500">
                      Partner Code ({loyalty.currentTier.referralBonusPercent}% credit):
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="px-3 py-1.5 text-xs font-mono font-semibold bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
                        {referralCode}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(referralCode);
                          setCopiedRef(true);
                          setTimeout(() => setCopiedRef(false), 1800);
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg"
                      >
                        {copiedRef ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedRef ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent Deposits & Recent Orders */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                      Recent Deposits
                    </h2>
                    <button
                      type="button"
                      onClick={() => setActiveTab('wallet')}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Open Wallet
                    </button>
                  </div>
                  {deposits.length === 0 ? (
                    <div className="p-6 text-sm text-slate-500">No deposits submitted yet. Minimum deposit is $100.</div>
                  ) : (
                    <div className="divide-y divide-slate-200 dark:divide-slate-800">
                      {deposits.slice(0, 4).map((dep) => (
                        <div key={dep.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-slate-900 dark:text-white">
                                {dep.currency.replace('_', ' ')}
                              </span>
                              {dep.receiptDataUrl && (
                                <button
                                  type="button"
                                  onClick={() => setPreviewDeposit(dep)}
                                  className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                  <FileText className="w-3 h-3" />
                                  <span>Receipt</span>
                                </button>
                              )}
                            </div>
                            <div className="text-xs font-mono text-slate-500 truncate max-w-[200px]">{dep.txHash}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-mono text-sm font-semibold tabular-nums">+${dep.amount.toFixed(2)}</div>
                            <StatusLabel status={dep.status} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                      Recent Orders
                    </h2>
                    <button
                      type="button"
                      onClick={() => setActiveTab('orders')}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      View All Orders
                    </button>
                  </div>
                  {orders.length === 0 ? (
                    <div className="p-6 text-sm text-slate-500">No verified account orders yet.</div>
                  ) : (
                    <div className="divide-y divide-slate-200 dark:divide-slate-800">
                      {orders.slice(0, 4).map((ord) => (
                        <div key={ord.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-900 dark:text-white truncate">{ord.serviceName}</div>
                            <div className="text-xs text-slate-500">
                              {ord.accountType || 'Personal'} · {ord.country} · <span className="font-mono">{ord.trackingCode}</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-mono text-sm font-semibold tabular-nums">-${ord.price.toFixed(2)}</div>
                            <StatusLabel status={ord.status} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Notifications & Support Messages */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                      Notifications
                    </h2>
                    <span className="text-xs text-slate-500">{unreadNotifs} unread</span>
                  </div>
                  {notifications.length === 0 ? (
                    <div className="p-6 text-sm text-slate-500">No notifications yet.</div>
                  ) : (
                    <div className="divide-y divide-slate-200 dark:divide-slate-800">
                      {notifications.slice(0, 5).map((n) => (
                        <div key={n.id} className="p-4 space-y-1">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
                              {n.category === 'price_alert' && (
                                <BellRing className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                              )}
                              <span>{n.subject}</span>
                            </span>
                            {!n.read && (
                              <button
                                type="button"
                                onClick={() => onMarkNotificationRead(n.id)}
                                className="text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                              >
                                Mark read
                              </button>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400">{n.body}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                      Support Messages
                    </h2>
                    <button
                      type="button"
                      onClick={() => setActiveTab('support')}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Open Live Chat
                    </button>
                  </div>
                  {supportTickets.length === 0 ? (
                    <div className="p-6 text-sm text-slate-500">
                      No active support threads. Need help with account provisioning or billing? Open a ticket anytime.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200 dark:divide-slate-800">
                      {supportTickets.slice(0, 4).map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            setSelectedTicketId(t.id);
                            setActiveTab('support');
                          }}
                          className="w-full text-left p-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">{t.subject}</div>
                            <div className="text-xs text-slate-500 truncate mt-0.5">{t.lastMessage}</div>
                          </div>
                          <StatusLabel status={t.status} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'wallet' && (
            <div className="space-y-6">
              <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="text-xs text-slate-500">Available Wallet Balance</div>
                  <div className="mt-1 font-mono text-3xl font-bold tabular-nums text-slate-900 dark:text-white">
                    ${user.walletBalance.toFixed(2)} USD
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Minimum Deposit: $100 · Maximum Deposit: Unlimited · Credited once admin confirms receipt &amp; payment
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  {onOpenPaymentGuide && (
                    <button
                      type="button"
                      onClick={onOpenPaymentGuide}
                      className="inline-flex items-center gap-1.5 px-4 py-3 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded-lg"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>Payment Guide</span>
                    </button>
                  )}
                  {onRefreshDashboard && (
                    <button
                      type="button"
                      disabled={refreshingWallet}
                      onClick={async () => {
                        setRefreshingWallet(true);
                        try {
                          await onRefreshDashboard();
                        } finally {
                          setRefreshingWallet(false);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-4 py-3 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg disabled:opacity-60"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${refreshingWallet ? 'animate-spin' : ''}`} />
                      <span>{refreshingWallet ? 'Syncing...' : 'Refresh Balance'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onOpenDeposit}
                    className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Deposit Crypto Funds</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {CRYPTO_WALLETS.map((w) => (
                  <div
                    key={w.code}
                    className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5"
                  >
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">{w.name}</div>
                    <div className="text-[11px] text-slate-500">{w.networkLabel}</div>
                    <code className="block p-2 rounded bg-slate-50 dark:bg-slate-950 font-mono text-xs break-all text-slate-800 dark:text-slate-200">
                      {w.address}
                    </code>
                  </div>
                ))}
              </div>

              {/* Deposit History & Uploaded Receipts */}
              {(() => {
                const pendingDepositsList = deposits.filter((d) => d.status === 'Pending');
                const approvedDepositsList = deposits.filter((d) => d.status === 'Approved');
                const rejectedDepositsList = deposits.filter((d) => d.status === 'Rejected');
                const visibleDeposits =
                  depositStatusFilter === 'All'
                    ? deposits
                    : deposits.filter((d) => d.status === depositStatusFilter);

                return (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <button
                        type="button"
                        onClick={() => setDepositStatusFilter(depositStatusFilter === 'Pending' ? 'All' : 'Pending')}
                        className={`p-4 rounded-xl border text-left transition-colors ${
                          depositStatusFilter === 'Pending'
                            ? 'border-amber-500 bg-amber-50/70 dark:bg-amber-950/30'
                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>Pending Deposits</span>
                          <Clock className="w-3.5 h-3.5 text-amber-600" />
                        </div>
                        <div className="mt-1 font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-white">
                          {pendingDepositsList.length}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          ${pendingDepositsList.reduce((acc, d) => acc + d.amount, 0).toFixed(2)} awaiting review
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setDepositStatusFilter(depositStatusFilter === 'Approved' ? 'All' : 'Approved')}
                        className={`p-4 rounded-xl border text-left transition-colors ${
                          depositStatusFilter === 'Approved'
                            ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30'
                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>Approved Deposits</span>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        </div>
                        <div className="mt-1 font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-white">
                          {approvedDepositsList.length}
                        </div>
                        <div className="mt-0.5 text-[11px] text-emerald-700 dark:text-emerald-400">
                          ${approvedDepositsList.reduce((acc, d) => acc + d.amount, 0).toFixed(2)} credited
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setDepositStatusFilter(depositStatusFilter === 'Rejected' ? 'All' : 'Rejected')}
                        className={`p-4 rounded-xl border text-left transition-colors ${
                          depositStatusFilter === 'Rejected'
                            ? 'border-rose-500 bg-rose-50/70 dark:bg-rose-950/30'
                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>Rejected Deposits</span>
                          <XCircle className="w-3.5 h-3.5 text-rose-600" />
                        </div>
                        <div className="mt-1 font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-white">
                          {rejectedDepositsList.length}
                        </div>
                        <div className="mt-0.5 text-[11px] text-rose-600 dark:text-rose-400">
                          ${rejectedDepositsList.reduce((acc, d) => acc + d.amount, 0).toFixed(2)} declined
                        </div>
                      </button>
                    </div>

                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                      <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                        <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                          Deposit History &amp; Payment Receipts
                        </h2>
                        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
                          {(
                            [
                              { id: 'All', label: `All (${deposits.length})` },
                              { id: 'Pending', label: `Pending Deposits (${pendingDepositsList.length})` },
                              { id: 'Approved', label: `Approved Deposits (${approvedDepositsList.length})` },
                              { id: 'Rejected', label: `Rejected Deposits (${rejectedDepositsList.length})` },
                            ] as const
                          ).map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => setDepositStatusFilter(item.id)}
                              className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                                depositStatusFilter === item.id
                                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                                  : 'text-slate-600 dark:text-slate-400'
                              }`}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {visibleDeposits.length === 0 ? (
                        <div className="p-8 text-center text-sm text-slate-500">
                          {deposits.length === 0
                            ? 'No deposits submitted yet. Submit a deposit with your payment receipt to fund your wallet.'
                            : `No ${depositStatusFilter.toLowerCase()} deposits found.`}
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-500">
                              <tr>
                                <th className="px-5 py-3 font-medium">Submission Date</th>
                                <th className="px-5 py-3 font-medium">Network</th>
                                <th className="px-5 py-3 font-medium">Transaction Hash</th>
                                <th className="px-5 py-3 font-medium">Receipt</th>
                                <th className="px-5 py-3 font-medium">Status</th>
                                <th className="px-5 py-3 font-medium text-right">Amount</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                              {visibleDeposits.map((dep) => {
                                const hasReceipt = Boolean(dep.receiptUrl || dep.receiptDataUrl);
                                return (
                                  <tr key={dep.id}>
                                    <td className="px-5 py-3.5 text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap">
                                      {new Date(dep.createdAt).toLocaleString()}
                                    </td>
                                    <td className="px-5 py-3.5 text-xs font-medium text-slate-900 dark:text-white whitespace-nowrap">
                                      {dep.currency.replace('_', ' ')}
                                    </td>
                                    <td className="px-5 py-3.5 font-mono text-xs text-slate-600 dark:text-slate-300 max-w-[200px] truncate">
                                      {dep.txHash}
                                    </td>
                                    <td className="px-5 py-3.5 text-xs">
                                      {hasReceipt ? (
                                        <button
                                          type="button"
                                          onClick={() => setPreviewDeposit(dep)}
                                          className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                                        >
                                          <FileText className="w-3.5 h-3.5" />
                                          <span>View Receipt</span>
                                        </button>
                                      ) : (
                                        <span className="text-slate-400">—</span>
                                      )}
                                    </td>
                                    <td className="px-5 py-3.5">
                                      <StatusLabel status={dep.status} />
                                      {dep.status === 'Pending' && (
                                        <div className="text-[11px] text-slate-500 mt-0.5">
                                          Awaiting administrator review
                                        </div>
                                      )}
                                      {dep.status === 'Approved' && (
                                        <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                                          Credited to wallet
                                          {dep.approvedAt ? ` · ${new Date(dep.approvedAt).toLocaleDateString()}` : ''}
                                        </div>
                                      )}
                                      {dep.status === 'Rejected' && (
                                        <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5 max-w-[240px]">
                                          {dep.rejectionReason || dep.adminNote || 'Rejected by support. Contact support for details.'}
                                        </div>
                                      )}
                                    </td>
                                    <td className="px-5 py-3.5 font-mono tabular-nums text-right font-semibold text-slate-900 dark:text-white">
                                      +${dep.amount.toFixed(2)}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {activeTab === 'transactions' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
                  {(
                    [
                      { id: 'all', label: 'All' },
                      { id: 'deposit', label: 'Deposits' },
                      { id: 'purchase', label: 'Purchases' },
                      { id: 'refund', label: 'Refunds' },
                    ] as { id: TxFilter; label: string }[]
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setTxFilter(f.id)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        txFilter === f.id
                          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={txSearch}
                    onChange={(e) => setTxSearch(e.target.value)}
                    placeholder="Search Transaction ID..."
                    className="w-full pl-9 pr-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                {filteredTransactions.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">No transactions found.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-500">
                        <tr>
                          <th className="px-5 py-3 font-medium">Date</th>
                          <th className="px-5 py-3 font-medium">Transaction ID</th>
                          <th className="px-5 py-3 font-medium">Currency / Description</th>
                          <th className="px-5 py-3 font-medium">Status</th>
                          <th className="px-5 py-3 font-medium text-right">Amount</th>
                          <th className="px-5 py-3 font-medium text-right">Receipt</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {filteredTransactions.map((tx) => (
                          <tr key={tx.id}>
                            <td className="px-5 py-3.5 text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap">
                              {new Date(tx.createdAt).toLocaleString()}
                            </td>
                            <td className="px-5 py-3.5 text-xs font-mono text-slate-600 dark:text-slate-300">
                              {tx.id.slice(0, 14)}
                            </td>
                            <td className="px-5 py-3.5 text-slate-900 dark:text-white">{tx.description}</td>
                            <td className="px-5 py-3.5">
                              <StatusLabel status={tx.status} />
                            </td>
                            <td
                              className={`px-5 py-3.5 font-mono tabular-nums text-right font-medium ${
                                tx.direction === 'credit'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-slate-900 dark:text-white'
                              }`}
                            >
                              {tx.direction === 'credit' ? '+' : '-'}${tx.amount.toFixed(2)} USD
                            </td>
                            <td className="px-5 py-3.5 text-right">
                              <button
                                type="button"
                                onClick={() => downloadTransactionReceipt(tx, user.username)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Receipt</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'orders' && (
            <div className="space-y-6">
              <OrderVolumeChart orders={orders} />

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    Verified Account Orders
                  </h2>
                  <button
                    type="button"
                    onClick={onBrowseServices}
                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    + Buy New Account
                  </button>
                </div>
              {orders.length === 0 ? (
                <div className="p-8 text-center space-y-3">
                  <Package className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-sm text-slate-500">No verified account orders yet.</p>
                  <button
                    type="button"
                    onClick={onBrowseServices}
                    className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                  >
                    Browse Accounts &amp; Pricing
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-500">
                      <tr>
                        <th className="px-5 py-3 font-medium">Account Package</th>
                        <th className="px-5 py-3 font-medium">Country</th>
                        <th className="px-5 py-3 font-medium">Activation Ref</th>
                        <th className="px-5 py-3 font-medium">Status</th>
                        <th className="px-5 py-3 font-medium text-right">Price</th>
                        <th className="px-5 py-3 font-medium text-right">Invoice</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {orders.map((ord) => (
                        <tr key={ord.id}>
                          <td className="px-5 py-3.5">
                            <div className="font-medium text-slate-900 dark:text-white">{ord.serviceName}</div>
                            <div className="text-xs text-slate-500">{ord.accountType || 'Personal'} Tier</div>
                          </td>
                          <td className="px-5 py-3.5 text-slate-600 dark:text-slate-300">{ord.country}</td>
                          <td className="px-5 py-3.5 font-mono text-xs text-slate-600 dark:text-slate-300">
                            {ord.trackingCode}
                          </td>
                          <td className="px-5 py-3.5">
                            <StatusLabel status={ord.status} />
                          </td>
                          <td className="px-5 py-3.5 font-mono tabular-nums text-right">
                            ${ord.price.toFixed(2)}
                          </td>
                          <td className="px-5 py-3.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => handleSelectOrderForTracking(ord)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                              >
                                <MapPin className="w-3.5 h-3.5" />
                                <span>Track</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => downloadOrderInvoice(ord)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Invoice</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              </div>
            </div>
          )}

          {activeTab === 'track' && (
            <div className="space-y-6">
              {/* Order ID Lookup & Quick Switcher */}
              <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                      Order Status Lookup
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Enter an Order ID or Activation Reference to view its real-time fulfillment timeline.
                    </p>
                  </div>
                  {orders.length > 0 && (
                    <div className="flex items-center gap-2">
                      <label htmlFor="track-order-select" className="text-xs text-slate-500 whitespace-nowrap">
                        Quick Select:
                      </label>
                      <select
                        id="track-order-select"
                        value={selectedTrackOrderId}
                        onChange={(e) => {
                          setSelectedTrackOrderId(e.target.value);
                          setTrackOrderInput(e.target.value);
                          setTrackLookupError('');
                        }}
                        className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white font-mono"
                      >
                        {orders.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.id.slice(0, 14)} · {o.serviceName} ({o.status})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <form onSubmit={handleTrackOrderLookup} className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={trackOrderInput}
                      onChange={(e) => {
                        setTrackOrderInput(e.target.value);
                        if (trackLookupError) setTrackLookupError('');
                      }}
                      placeholder="Enter Order ID (e.g. ord_...) or Activation Ref (e.g. BW-...)"
                      className="w-full pl-10 pr-4 py-2.5 text-sm font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white"
                    />
                  </div>
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span>Track Order</span>
                  </button>
                </form>

                {trackLookupError && (
                  <div className="px-4 py-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300">
                    {trackLookupError}
                  </div>
                )}
              </div>

              {orders.length === 0 ? (
                <div className="p-10 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-3">
                  <Truck className="w-9 h-9 text-slate-400 mx-auto" />
                  <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    No Orders to Track Yet
                  </h3>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Once you purchase a verified account package, your order ID and live provisioning timeline will appear here automatically.
                  </p>
                  <button
                    type="button"
                    onClick={onBrowseServices}
                    className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
                  >
                    Browse Accounts &amp; Pricing
                  </button>
                </div>
              ) : trackedOrder ? (
                (() => {
                  const ord = trackedOrder;
                  const isCancelledOrRefunded =
                    ord.status === 'Cancelled' || ord.status === 'Refunded';
                  const createdLabel = new Date(ord.createdAt).toLocaleString();
                  const updatedLabel = new Date(ord.updatedAt).toLocaleString();

                  type StepState = 'completed' | 'current' | 'upcoming' | 'cancelled' | 'refunded';
                  interface TimelineMilestone {
                    id: string;
                    title: string;
                    description: string;
                    timestamp: string;
                    state: StepState;
                    icon: React.ReactNode;
                  }

                  const milestones: TimelineMilestone[] = isCancelledOrRefunded
                    ? [
                        {
                          id: 'placed',
                          title: 'Order Placed & Wallet Authorized',
                          description: `Order ${ord.id} created for ${ord.serviceName} (${ord.accountType || 'Personal'} Tier · ${ord.country}). $${ord.price.toFixed(2)} USD authorized from wallet.`,
                          timestamp: createdLabel,
                          state: 'completed',
                          icon: <CheckCircle2 className="w-4 h-4" />,
                        },
                        {
                          id: 'review',
                          title: 'Order Verification & Fulfillment Queue',
                          description: `Queued for ${ord.providerName} verification under Activation Ref ${ord.trackingCode}.`,
                          timestamp: createdLabel,
                          state: 'completed',
                          icon: <ShieldCheck className="w-4 h-4" />,
                        },
                        ord.status === 'Refunded'
                          ? {
                              id: 'refunded',
                              title: 'Order Refunded to Wallet',
                              description: `Order fulfillment was halted and $${ord.price.toFixed(2)} USD has been credited back to your wallet balance.`,
                              timestamp: updatedLabel,
                              state: 'refunded',
                              icon: <RefreshCw className="w-4 h-4" />,
                            }
                          : {
                              id: 'cancelled',
                              title: 'Order Cancelled',
                              description: `Order was cancelled prior to activation completion. Contact support if you need assistance placing a replacement order.`,
                              timestamp: updatedLabel,
                              state: 'cancelled',
                              icon: <XCircle className="w-4 h-4" />,
                            },
                      ]
                    : [
                        {
                          id: 'placed',
                          title: 'Order Placed & Payment Confirmed',
                          description: `Order ${ord.id} confirmed for ${ord.serviceName} (${ord.accountType || 'Personal'} Tier) and $${ord.price.toFixed(2)} USD settled from wallet.`,
                          timestamp: createdLabel,
                          state: 'completed',
                          icon: <CheckCircle2 className="w-4 h-4" />,
                        },
                        {
                          id: 'pending',
                          title: 'Compliance & Account Verification',
                          description:
                            ord.status === 'Pending'
                              ? `Awaiting initial verification check for ${ord.country} onboarding.`
                              : `Verification check cleared for ${ord.country} account provisioning.`,
                          timestamp: ord.status === 'Pending' ? updatedLabel : createdLabel,
                          state: ord.status === 'Pending' ? 'current' : 'completed',
                          icon: <ShieldCheck className="w-4 h-4" />,
                        },
                        {
                          id: 'processing',
                          title: 'Carrier Onboarding & Account Provisioning',
                          description:
                            ord.status === 'Processing'
                              ? `Actively configuring your verified ${ord.providerName} credentials (${ord.trackingCode}).`
                              : ord.status === 'Completed'
                                ? `${ord.providerName} account credentials provisioned under reference ${ord.trackingCode}.`
                                : `Scheduled once verification review clears.`,
                          timestamp: ord.status === 'Processing' ? updatedLabel : ord.status === 'Completed' ? updatedLabel : 'Pending',
                          state:
                            ord.status === 'Completed'
                              ? 'completed'
                              : ord.status === 'Processing'
                                ? 'current'
                                : 'upcoming',
                          icon: <Truck className="w-4 h-4" />,
                        },
                        {
                          id: 'completed',
                          title: 'Delivered & Ready to Use',
                          description:
                            ord.status === 'Completed'
                              ? `Verified ${ord.serviceName} account is active and ready. Invoice available for download.`
                              : `Final activation notice and verified credentials will unlock upon completion.`,
                          timestamp: ord.status === 'Completed' ? updatedLabel : 'Awaiting completion',
                          state: ord.status === 'Completed' ? 'completed' : 'upcoming',
                          icon: <Package className="w-4 h-4" />,
                        },
                      ];

                  return (
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                      {/* Tracked Order Summary Header */}
                      <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-50/70 dark:bg-slate-950/40">
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Order ID
                            </span>
                            <code className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-mono text-xs text-slate-900 dark:text-white">
                              {ord.id}
                            </code>
                            <button
                              type="button"
                              onClick={() => {
                                 void navigator.clipboard?.writeText(ord.id).catch(() => {});
                                 setCopiedTrackId(true);
                                 setTimeout(() => setCopiedTrackId(false), 1800);
                              }}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                            >
                              {copiedTrackId ? (
                                <>
                                  <Check className="w-3 h-3" />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Copy ID</span>
                                </>
                              )}
                            </button>
                            <StatusLabel status={ord.status} />
                          </div>
                          <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                            {ord.serviceName} · {ord.accountType || 'Personal'} Tier ({ord.country})
                          </h3>
                          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
                            <span>
                              Activation Ref:{' '}
                              <span className="font-mono text-slate-700 dark:text-slate-300">
                                {ord.trackingCode}
                              </span>
                            </span>
                            <span>
                              Amount:{' '}
                              <span className="font-mono font-semibold text-slate-900 dark:text-white">
                                ${ord.price.toFixed(2)} USD
                              </span>
                            </span>
                            <span>Last Updated: {updatedLabel}</span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => downloadOrderInvoice(ord)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download Invoice</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setTicketCategory('Order Support');
                              setTicketSubject(`Order ${ord.id.slice(0, 14)} Tracking Inquiry`);
                              setActiveTab('support');
                            }}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 hover:bg-blue-100 dark:hover:bg-blue-950/60 rounded-lg cursor-pointer"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            <span>Order Support</span>
                          </button>
                        </div>
                      </div>

                      {/* Vertical Timeline View */}
                      <div className="p-6 sm:p-8">
                        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-6">
                          Fulfillment Timeline
                        </div>
                        <ol className="relative">
                          {milestones.map((step, idx) => {
                            const isLast = idx === milestones.length - 1;
                            const badgeClasses =
                              step.state === 'completed'
                                ? 'bg-emerald-600 text-white border-emerald-600'
                                : step.state === 'current'
                                  ? 'bg-blue-600 text-white border-blue-600 ring-4 ring-blue-100 dark:ring-blue-950/70'
                                  : step.state === 'refunded'
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : step.state === 'cancelled'
                                      ? 'bg-rose-600 text-white border-rose-600'
                                      : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border-slate-300 dark:border-slate-700';

                            const lineClasses =
                              step.state === 'completed'
                                ? 'bg-emerald-500/70 dark:bg-emerald-600/60'
                                : 'bg-slate-200 dark:bg-slate-800';

                            const stateBadgeLabel =
                              step.state === 'completed'
                                ? 'Completed'
                                : step.state === 'current'
                                  ? 'In Progress'
                                  : step.state === 'refunded'
                                    ? 'Refunded'
                                    : step.state === 'cancelled'
                                      ? 'Cancelled'
                                      : 'Pending';

                            const stateBadgeColor =
                              step.state === 'completed'
                                ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/60'
                                : step.state === 'current'
                                  ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900/60'
                                  : step.state === 'refunded'
                                    ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900/60'
                                    : step.state === 'cancelled'
                                      ? 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/60'
                                      : 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700';

                            return (
                              <li key={step.id} className={`relative flex gap-4 ${isLast ? '' : 'pb-8'}`}>
                                {!isLast && (
                                  <span
                                    aria-hidden="true"
                                    className={`absolute left-[15px] top-8 bottom-0 w-0.5 ${lineClasses}`}
                                  />
                                )}
                                <div
                                  className={`relative z-10 w-8 h-8 rounded-full border flex items-center justify-center shrink-0 ${badgeClasses}`}
                                >
                                  {step.icon}
                                </div>
                                <div className="flex-1 min-w-0 pt-0.5">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2.5">
                                      <h4
                                        className={`font-display text-sm font-semibold ${
                                          step.state === 'upcoming'
                                            ? 'text-slate-500 dark:text-slate-400'
                                            : 'text-slate-900 dark:text-white'
                                        }`}
                                      >
                                        {step.title}
                                      </h4>
                                      <span
                                        className={`px-2 py-0.5 text-[11px] font-medium rounded border ${stateBadgeColor}`}
                                      >
                                        {stateBadgeLabel}
                                      </span>
                                    </div>
                                    <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                                      {step.timestamp}
                                    </span>
                                  </div>
                                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                                    {step.description}
                                  </p>
                                </div>
                              </li>
                            );
                          })}
                        </ol>

                        {(ord.recipientName || ord.destinationCity) && (
                          <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800 flex flex-wrap gap-6 text-xs text-slate-600 dark:text-slate-400">
                            {ord.recipientName && (
                              <div>
                                <span className="text-slate-500">Account Holder / Recipient:</span>{' '}
                                <span className="font-medium text-slate-900 dark:text-white">
                                  {ord.recipientName}
                                </span>
                              </div>
                            )}
                            {ord.destinationCity && (
                              <div>
                                <span className="text-slate-500">Region / Destination City:</span>{' '}
                                <span className="font-medium text-slate-900 dark:text-white">
                                  {ord.destinationCity}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()
              ) : null}
            </div>
          )}

          {activeTab === 'alerts' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-xs text-slate-500">Active Watches</div>
                  <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-blue-600 dark:text-blue-400">
                    {priceAlerts.filter((a) => a.status === 'Active').length}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Monitoring live account pricing</div>
                </div>
                <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-xs text-slate-500">Target Thresholds Hit</div>
                  <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {priceAlerts.filter((a) => a.status === 'Triggered').length}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Ready to purchase at lower price</div>
                </div>
                <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-xs text-slate-500">Total Price Alerts</div>
                  <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                    {priceAlerts.length}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Across all providers &amp; tiers</div>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                      Service Price Alerts (&lsquo;Alert Me&rsquo;)
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Notifications dispatch automatically when an account price drops below your threshold.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onBrowseServices}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
                  >
                    <Bell className="w-3.5 h-3.5" />
                    <span>+ Set New Price Alert</span>
                  </button>
                </div>

                {priceAlerts.length === 0 ? (
                  <div className="p-8 text-center space-y-3">
                    <Bell className="w-8 h-8 text-slate-400 mx-auto" />
                    <p className="text-sm text-slate-500">
                      You have no price drop alerts configured yet. Click &ldquo;Alert Me&rdquo; on any provider card to watch for price drops.
                    </p>
                    <button
                      type="button"
                      onClick={onBrowseServices}
                      className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
                    >
                      Browse Account Providers
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-500">
                        <tr>
                          <th className="px-5 py-3 font-medium">Service</th>
                          <th className="px-5 py-3 font-medium">Tier &amp; Country</th>
                          <th className="px-5 py-3 font-medium text-right">Live Price</th>
                          <th className="px-5 py-3 font-medium text-right">Target Threshold</th>
                          <th className="px-5 py-3 font-medium">Status</th>
                          <th className="px-5 py-3 font-medium text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {priceAlerts.map((alert) => {
                          const svc = SHIPPING_SERVICES.find((s) => s.id === alert.serviceId);
                          const livePrice = svc
                            ? getAccountPriceUsd(
                                svc,
                                alert.accountType,
                                alert.country,
                                priceOverrides[svc.id] || null,
                              )
                            : alert.initialPrice;
                          const isBusy = alertBusyId === alert.id;
                          return (
                            <tr key={alert.id}>
                              <td className="px-5 py-3.5">
                                <div className="font-medium text-slate-900 dark:text-white">
                                  {alert.providerName}
                                </div>
                                <div className="text-xs text-slate-500">{alert.serviceName}</div>
                              </td>
                              <td className="px-5 py-3.5 text-xs text-slate-600 dark:text-slate-300">
                                <div>{alert.accountType} Account</div>
                                <div className="text-slate-500">{alert.country}</div>
                              </td>
                              <td className="px-5 py-3.5 font-mono tabular-nums text-right">
                                <div className="font-semibold text-slate-900 dark:text-white">
                                  ${livePrice.toFixed(2)}
                                </div>
                                {livePrice < alert.initialPrice && (
                                  <div className="text-[11px] text-emerald-600 dark:text-emerald-400">
                                    Down from ${alert.initialPrice.toFixed(2)}
                                  </div>
                                )}
                              </td>
                              <td className="px-5 py-3.5 font-mono tabular-nums text-right font-semibold text-blue-700 dark:text-blue-300">
                                &lt; ${alert.targetPrice.toFixed(2)}
                              </td>
                              <td className="px-5 py-3.5 text-xs font-medium">
                                {alert.status === 'Triggered' ? (
                                  <div>
                                    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                                      <BellRing className="w-3.5 h-3.5" />
                                      <span>Target Hit</span>
                                    </span>
                                    {alert.triggeredPrice !== undefined && (
                                      <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                                        Hit at ${alert.triggeredPrice.toFixed(2)}
                                      </div>
                                    )}
                                  </div>
                                ) : alert.status === 'Active' ? (
                                  <span className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400">
                                    <Clock className="w-3.5 h-3.5" />
                                    <span>Watching</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-slate-500">
                                    <XCircle className="w-3.5 h-3.5" />
                                    <span>Cancelled</span>
                                  </span>
                                )}
                              </td>
                              <td className="px-5 py-3.5 text-right">
                                <div className="inline-flex items-center gap-2">
                                  {alert.status === 'Triggered' && (
                                    <button
                                      type="button"
                                      onClick={() => onBuyFromAlert(alert)}
                                      className="px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer"
                                    >
                                      Buy Now
                                    </button>
                                  )}
                                  {alert.status !== 'Cancelled' && (
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() => onEditPriceAlert(alert)}
                                      title="Edit or re-arm threshold"
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md cursor-pointer"
                                    >
                                      <Edit3 className="w-3 h-3" />
                                      <span>{alert.status === 'Triggered' ? 'Re-arm' : 'Edit'}</span>
                                    </button>
                                  )}
                                  {alert.status === 'Active' && (
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={async () => {
                                        setAlertBusyId(alert.id);
                                        try {
                                          await onCancelPriceAlert(alert.id);
                                        } finally {
                                          setAlertBusyId(null);
                                        }
                                      }}
                                      className="px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-md cursor-pointer"
                                    >
                                      Pause
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={async () => {
                                      setAlertBusyId(alert.id);
                                      try {
                                        await onDeletePriceAlert(alert.id);
                                      } finally {
                                        setAlertBusyId(null);
                                      }
                                    }}
                                    aria-label="Delete price alert"
                                    className="p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-md cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'loyalty' && (
            <div className="space-y-6">
              {/* Current Loyalty Tier Summary */}
              <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-xs text-slate-500">Current Loyalty Status</div>
                    <div className="flex items-center gap-2.5">
                      <Award className={`w-6 h-6 ${loyalty.currentTier.accentTextClass}`} />
                      <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                        {loyalty.currentTier.name} Tier
                      </h2>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {loyalty.currentTier.summary}
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-4 sm:gap-6 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-200 dark:border-slate-800">
                    <div>
                      <div className="text-[11px] text-slate-500">Purchase Volume</div>
                      <div className="font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                        ${loyalty.totalPurchases.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Reward Points</div>
                      <div className="font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                        {loyalty.pointsEarned.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Referral Credit</div>
                      <div className="font-mono text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                        {loyalty.currentTier.referralBonusPercent}%
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-slate-600 dark:text-slate-300 font-medium">
                      {loyalty.nextTier
                        ? `Spend $${loyalty.amountToNextTier.toFixed(2)} more in verified account purchases to reach ${loyalty.nextTier.name} ($${loyalty.nextTier.minPurchaseUsd.toLocaleString()}+).`
                        : 'You have unlocked Platinum, the highest BlueWhale Markethub loyalty tier.'}
                    </span>
                    <span className="font-mono tabular-nums text-slate-500">
                      {loyalty.progressPercent}% complete
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${loyalty.currentTier.barFillClass}`}
                      style={{ width: `${loyalty.progressPercent}%` }}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Gift className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>Partner referral code:</span>
                    <code className="px-2.5 py-1 font-mono font-semibold text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded">
                      {referralCode}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText(referralCode);
                        setCopiedRef(true);
                        setTimeout(() => setCopiedRef(false), 1800);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-700 dark:text-slate-200"
                    >
                      {copiedRef ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedRef ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={onBrowseServices}
                    className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                  >
                    Browse Accounts to Level Up
                  </button>
                </div>
              </div>

              {/* All Loyalty Tiers Matrix */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {LOYALTY_TIERS.map((tier) => {
                  const isCurrent = tier.id === loyalty.currentTier.id;
                  const isUnlocked = loyalty.totalPurchases >= tier.minPurchaseUsd;
                  return (
                    <div
                      key={tier.id}
                      className={`p-5 rounded-xl bg-white dark:bg-slate-900 border flex flex-col justify-between gap-4 ${
                        isCurrent
                          ? 'border-blue-600 dark:border-blue-500'
                          : 'border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className={`font-display text-lg font-bold ${tier.accentTextClass}`}>
                            {tier.name}
                          </h3>
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            {isCurrent ? 'Current Tier' : isUnlocked ? 'Unlocked' : 'Locked'}
                          </span>
                        </div>

                        <div className="pb-3 border-b border-slate-200 dark:border-slate-800">
                          <div className="font-mono text-base font-bold tabular-nums text-slate-900 dark:text-white">
                            {tier.minPurchaseUsd === 0
                              ? '$0+ Volume'
                              : `$${tier.minPurchaseUsd.toLocaleString()}+ Volume`}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                            {tier.pointsMultiplier}x points · {tier.referralBonusPercent}% referral bonus
                          </div>
                        </div>

                        <ul className="space-y-2">
                          {tier.benefits.map((b) => (
                            <li
                              key={b}
                              className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed"
                            >
                              <CheckCircle2
                                className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
                                  isUnlocked
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-slate-400 dark:text-slate-600'
                                }`}
                              />
                              <span>{b}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] font-mono tabular-nums text-slate-500">
                        {isCurrent
                          ? 'Active on your account'
                          : isUnlocked
                          ? 'Threshold cleared'
                          : `$${Math.max(0, tier.minPurchaseUsd - loyalty.totalPurchases).toFixed(2)} more to unlock`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'support' && (
            <div className="space-y-6">
              {supportStatus && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200">
                  {supportStatus}
                </div>
              )}
              {supportErr && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
                  {supportErr}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* New Ticket / Live Chat Request */}
                <form
                  onSubmit={handleCreateTicket}
                  className="lg:col-span-5 p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3.5"
                >
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    Open Support Ticket or Live Chat
                  </h2>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Subject
                    </label>
                    <input
                      type="text"
                      required
                      value={ticketSubject}
                      onChange={(e) => setTicketSubject(e.target.value)}
                      placeholder="e.g., UPS Business Account provisioning"
                      className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Category
                      </label>
                      <select
                        value={ticketCategory}
                        onChange={(e) => setTicketCategory(e.target.value as SupportTicket['category'])}
                        className="w-full px-2.5 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
                      >
                        <option value="Account Provisioning">Account Provisioning</option>
                        <option value="Crypto Deposit">Crypto Deposit</option>
                        <option value="Order Support">Order Support</option>
                        <option value="Live Chat">Live Chat</option>
                        <option value="Technical">Technical</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Priority
                      </label>
                      <select
                        value={ticketPriority}
                        onChange={(e) => setTicketPriority(e.target.value as SupportTicket['priority'])}
                        className="w-full px-2.5 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
                      >
                        <option value="Normal">Normal</option>
                        <option value="High">High</option>
                        <option value="Urgent">Urgent</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Message
                    </label>
                    <textarea
                      rows={3}
                      required
                      value={ticketMessage}
                      onChange={(e) => setTicketMessage(e.target.value)}
                      placeholder="Describe your request..."
                      className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                  >
                    Submit Ticket / Start Chat
                  </button>
                </form>

                {/* Active Conversation Thread */}
                <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col min-h-[380px]">
                  <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                    {supportTickets.length > 0 ? (
                      <select
                        value={activeTicket?.id || ''}
                        onChange={(e) => setSelectedTicketId(e.target.value)}
                        className="text-sm font-semibold bg-transparent text-slate-900 dark:text-white focus:outline-none max-w-xs truncate"
                      >
                        {supportTickets.map((t) => (
                          <option key={t.id} value={t.id} className="bg-white dark:bg-slate-900">
                            {t.subject} ({t.status})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">
                        Live Chat & Ticket Thread
                      </span>
                    )}
                    {activeTicket && <StatusLabel status={activeTicket.status} />}
                  </div>

                  <div className="flex-1 p-4 space-y-3 overflow-y-auto max-h-[280px]">
                    {!activeTicket ? (
                      <div className="text-sm text-slate-500 text-center py-12">
                        Create a support ticket or live chat session on the left to connect with our team.
                      </div>
                    ) : ticketMessages.length === 0 ? (
                      <div className="text-xs text-slate-500">Loading messages...</div>
                    ) : (
                      ticketMessages.map((m) => (
                        <div
                          key={m.id}
                          className={`p-3 rounded-xl text-xs max-w-[85%] ${
                            m.senderRole === 'admin'
                              ? 'bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 mr-auto'
                              : 'bg-slate-100 dark:bg-slate-800 ml-auto'
                          }`}
                        >
                          <div className="font-semibold text-slate-900 dark:text-white mb-1">
                            {m.senderName} ({m.senderRole === 'admin' ? 'Support Desk' : 'You'})
                          </div>
                          <div className="text-slate-700 dark:text-slate-200 leading-relaxed">{m.body}</div>
                        </div>
                      ))
                    )}
                  </div>

                  {activeTicket && (
                    <form
                      onSubmit={handleSendReply}
                      className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2"
                    >
                      <input
                        type="text"
                        required
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Write a message..."
                        className="flex-1 px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
                      />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Send</span>
                      </button>
                    </form>
                  )}
                </div>
              </div>

              {/* Knowledge Base & Direct Email */}
              <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-blue-600" />
                    <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                      Knowledge Base
                    </h3>
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    Direct Support Email:{' '}
                    <a
                      href="mailto:Bluewhalemarkethub@gmail.com"
                      className="font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Bluewhalemarkethub@gmail.com
                    </a>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {KNOWLEDGE_BASE_ARTICLES.map((art) => (
                    <div
                      key={art.title}
                      className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                    >
                      <div className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                        {art.category}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                        {art.title}
                      </div>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        {art.summary}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <form
                  onSubmit={handleChangePassword}
                  className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4"
                >
                  <div className="flex items-center gap-2.5">
                    <KeyRound className="w-4 h-4 text-blue-600" />
                    <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                      Password & Credential Security
                    </h2>
                  </div>
                  {authMode === 'jwt' ? (
                    <>
                      <input
                        type="password"
                        required
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Current Password"
                        className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
                      />
                      <input
                        type="password"
                        required
                        minLength={8}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="New Password (min 8 chars)"
                        className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
                      />
                      <button
                        type="submit"
                        className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                      >
                        Update Password
                      </button>
                    </>
                  ) : (
                    <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
                      <p>
                        Your session uses Google OAuth encryption ({user.email}). Log a security reset notification below if needed.
                      </p>
                      <button
                        type="submit"
                        className="px-4 py-2 text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg"
                      >
                        Send Security Reset Notice
                      </button>
                    </div>
                  )}
                  {pwMsg && <p className="text-xs text-emerald-700 dark:text-emerald-400">{pwMsg}</p>}
                  {pwErr && <p className="text-xs text-rose-600 dark:text-rose-400">{pwErr}</p>}
                </form>

                <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <ShieldCheck className="w-4 h-4 text-blue-600" />
                      <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                        Two-Factor Authentication (2FA)
                      </h2>
                    </div>
                    <span className={`text-xs font-medium ${user.twoFactorEnabled ? 'text-emerald-600' : 'text-slate-500'}`}>
                      {user.twoFactorEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  {!user.twoFactorEnabled && !totpSetup && (
                    <button
                      type="button"
                      onClick={handleStart2faSetup}
                      className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                    >
                      Enable 2FA Authenticator
                    </button>
                  )}
                  {totpSetup && (
                    <form onSubmit={handleVerify2fa} className="space-y-3">
                      <div className="flex items-center gap-4">
                        <QrCodeCanvas value={totpSetup.otpauthUrl} size={110} label="2FA Setup QR" />
                        <code className="p-2 rounded bg-slate-100 dark:bg-slate-950 font-mono text-xs break-all">
                          {totpSetup.secret}
                        </code>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          required
                          maxLength={6}
                          value={totpCode}
                          onChange={(e) => setTotpCode(e.target.value)}
                          placeholder="6-digit code"
                          className="flex-1 px-3 py-2 text-sm font-mono bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
                        />
                        <button
                          type="submit"
                          className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                        >
                          Verify
                        </button>
                      </div>
                    </form>
                  )}
                  {user.twoFactorEnabled && !totpSetup && (
                    <button
                      type="button"
                      onClick={handleDisable2fa}
                      className="px-4 py-2 text-xs font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-lg"
                    >
                      Disable 2FA
                    </button>
                  )}
                  {totpMsg && <p className="text-xs text-emerald-700 dark:text-emerald-400">{totpMsg}</p>}
                  {totpErr && <p className="text-xs text-rose-600 dark:text-rose-400">{totpErr}</p>}
                </div>
              </div>

              {/* IP Logging & Session Tracking */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-slate-500" />
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    IP Logging & Session Tracking
                  </h2>
                </div>
                {loginLogs.length === 0 ? (
                  <div className="p-6 text-sm text-slate-500">No login activity recorded yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-500">
                        <tr>
                          <th className="px-5 py-3 font-medium">Timestamp</th>
                          <th className="px-5 py-3 font-medium">IP Address</th>
                          <th className="px-5 py-3 font-medium">Device</th>
                          <th className="px-5 py-3 font-medium">Method</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {loginLogs.slice(0, 12).map((log) => (
                          <tr key={log.id}>
                            <td className="px-5 py-3 text-xs font-mono tabular-nums text-slate-500">
                              {new Date(log.createdAt).toLocaleString()}
                            </td>
                            <td className="px-5 py-3 text-xs font-mono text-slate-900 dark:text-white">
                              {log.ipAddress}
                            </td>
                            <td className="px-5 py-3 text-xs text-slate-600 dark:text-slate-300">
                              {log.deviceLabel}
                            </td>
                            <td className="px-5 py-3 text-xs text-slate-600 dark:text-slate-300">
                              {log.authMethod}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'profile' && (
            <form
              onSubmit={handleSaveProfile}
              className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4"
            >
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Profile Settings
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    First Name
                  </label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Last Name
                  </label>
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    disabled
                    value={user.email}
                    className="w-full px-3 py-2 text-sm bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    required
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Country
                  </label>
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
                  >
                    {SUPPORTED_COUNTRIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Account Role &amp; Status
                  </label>
                  <div className="w-full px-3 py-2 text-sm bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 flex items-center justify-between">
                    <span className="font-mono font-semibold text-xs">{getDisplayRole(user.role)}</span>
                    <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                      {normalizeAccountStatus(user.status)}
                    </span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Registration Date / Last Login Date
                  </label>
                  <div className="w-full px-3 py-2 text-xs font-mono bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 space-y-0.5">
                    <div>Registered: {new Date(user.createdAt).toLocaleString()}</div>
                    <div>
                      Last Login:{' '}
                      {user.lastLoginAt
                        ? new Date(user.lastLoginAt).toLocaleString()
                        : 'Active session'}
                    </div>
                  </div>
                </div>
              </div>
              {profileMsg && <p className="text-xs text-emerald-700 dark:text-emerald-400">{profileMsg}</p>}
              {profileErr && <p className="text-xs text-rose-600 dark:text-rose-400">{profileErr}</p>}
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                Save Profile Settings
              </button>
            </form>
          )}
        </div>
      </div>

      <ReceiptPreviewModal
        deposit={previewDeposit}
        onClose={() => setPreviewDeposit(null)}
      />
    </section>
  );
}
