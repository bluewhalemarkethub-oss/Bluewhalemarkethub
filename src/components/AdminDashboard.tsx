import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import {
  Users,
  Coins,
  Package,
  BarChart3,
  MessageSquare,
  Check,
  X,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  Clock,
  RefreshCw,
  Send,
  Bell,
  FileText,
  Tag,
  BellRing,
  RotateCcw,
  Search,
  UserCheck,
  XCircle,
  Ban,
  Eye,
  ArrowUpRight,
  Sliders,
  History,
  Shield,
  Trash2,
} from 'lucide-react';
import {
  SHIPPING_SERVICES,
  type BaseTierPriceOverride,
} from '../data/shippingCatalog';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { mapFirestoreSupportMessage } from '../services/firestoreMarketplace';
import { ReceiptPreviewModal, type GenericReceiptPreview } from './ReceiptPreviewModal';
import {
  ADMIN_EMAIL,
  getDisplayRole,
  getSimpleAccountStatus,
  normalizeAccountStatus,
  SUPPORT_EMAIL,
  type AccountStatus,
  type AdminLogEntry,
  type AuthMode,
  type CanonicalAccountStatus,
  type DepositRecord,
  type LoginActivity,
  type PriceAlert,
  type RegistrationPayment,
  type ShippingOrder,
  type SupportMessage,
  type SupportTicket,
  type UserAccount,
  type WalletTransaction,
  type WebsiteSettings,
} from '../types/marketplace';

type AdminTab =
  | 'analytics'
  | 'registrations'
  | 'deposits'
  | 'orders'
  | 'transactions'
  | 'pricing'
  | 'users'
  | 'logs'
  | 'support'
  | 'settings';

interface AdminDashboardProps {
  authMode: AuthMode;
  users: UserAccount[];
  registrationPayments: RegistrationPayment[];
  deposits: DepositRecord[];
  orders: ShippingOrder[];
  transactions: WalletTransaction[];
  supportTickets: SupportTicket[];
  supportMessages: SupportMessage[];
  loginLogs: LoginActivity[];
  adminLogs: AdminLogEntry[];
  siteSettings: WebsiteSettings;
  priceOverrides: Record<string, BaseTierPriceOverride>;
  priceAlerts: PriceAlert[];
  onReviewRegistration: (payload: {
    user: UserAccount;
    paymentId?: string;
    decision: 'Approved' | 'Rejected' | 'Suspended';
    rejectionReason?: string;
    adminNotes?: string;
  }) => Promise<void>;
  onReviewDeposit: (
    deposit: DepositRecord,
    decision: 'Approved' | 'Rejected',
    note: string,
    rejectionReason?: string,
  ) => Promise<void>;
  onUpdateOrderStatus: (order: ShippingOrder, action: 'Processing' | 'Completed' | 'Cancelled') => Promise<void>;
  onUpdateUser: (
    uid: string,
    updates: {
      status?: AccountStatus;
      isVerified?: boolean;
      adminNotes?: string;
      rejectionReason?: string;
    },
  ) => Promise<void>;
  onDeleteUser: (user: UserAccount) => Promise<void>;
  onReplyTicket: (ticket: SupportTicket, body: string) => Promise<void>;
  onUpdateTicketStatus: (ticketId: string, status: SupportTicket['status']) => Promise<void>;
  onUpdateServicePrice: (payload: {
    serviceId: string;
    personalPrice: number;
    businessPrice: number;
    corporatePrice: number;
    resetToDefault?: boolean;
  }) => Promise<{ triggeredCount: number }>;
  onSaveSiteSettings: (settings: {
    registrationFeeUsd: number;
    minimumDepositUsd: number;
    supportEmail: string;
    marketplaceNotice: string;
    requireRegistrationApproval: boolean;
  }) => Promise<void>;
}

export function AdminDashboard({
  authMode,
  users,
  registrationPayments,
  deposits,
  orders,
  transactions,
  supportTickets,
  supportMessages,
  loginLogs,
  adminLogs,
  siteSettings,
  priceOverrides,
  priceAlerts,
  onReviewRegistration,
  onReviewDeposit,
  onUpdateOrderStatus,
  onUpdateUser,
  onDeleteUser,
  onReplyTicket,
  onUpdateTicketStatus,
  onUpdateServicePrice,
  onSaveSiteSettings,
}: AdminDashboardProps) {
  const [tab, setTab] = useState<AdminTab>('analytics');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(supportTickets[0]?.id || null);
  const [ticketMsgs, setTicketMsgs] = useState<SupportMessage[]>([]);
  const [replyText, setReplyText] = useState('');
  const [previewDeposit, setPreviewDeposit] = useState<DepositRecord | null>(null);
  const [previewGeneric, setPreviewGeneric] = useState<GenericReceiptPreview | null>(null);
  const [detailUserUid, setDetailUserUid] = useState<string | null>(null);
  const [confirmDeleteUid, setConfirmDeleteUid] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState<'All' | CanonicalAccountStatus>('All');
  const [regFilter, setRegFilter] = useState<'All' | 'Pending Review' | 'Unpaid' | 'Approved' | 'Rejected'>('All');
  const [depositFilter, setDepositFilter] = useState<'All' | 'Pending' | 'Approved' | 'Rejected'>('All');
  const [depositReasonDrafts, setDepositReasonDrafts] = useState<Record<string, string>>({});
  const [txFilter, setTxFilter] = useState<'all' | 'deposit' | 'purchase' | 'refund'>('all');
  const [txSearch, setTxSearch] = useState('');
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [rejectReasonDrafts, setRejectReasonDrafts] = useState<Record<string, string>>({});
  const [priceDrafts, setPriceDrafts] = useState<
    Record<string, { personal: string; business: string; corporate: string }>
  >({});
  const [settingsForm, setSettingsForm] = useState({
    registrationFeeUsd: String(siteSettings.registrationFeeUsd ?? 5),
    minimumDepositUsd: String(siteSettings.minimumDepositUsd ?? 100),
    supportEmail: siteSettings.supportEmail || SUPPORT_EMAIL,
    marketplaceNotice: siteSettings.marketplaceNotice || '',
    requireRegistrationApproval: siteSettings.requireRegistrationApproval ?? true,
  });

  useEffect(() => {
    setSettingsForm({
      registrationFeeUsd: String(siteSettings.registrationFeeUsd ?? 5),
      minimumDepositUsd: String(siteSettings.minimumDepositUsd ?? 100),
      supportEmail: siteSettings.supportEmail || SUPPORT_EMAIL,
      marketplaceNotice: siteSettings.marketplaceNotice || '',
      requireRegistrationApproval: siteSettings.requireRegistrationApproval ?? true,
    });
  }, [siteSettings]);

  useEffect(() => {
    const next: Record<string, { personal: string; business: string; corporate: string }> = {};
    for (const svc of SHIPPING_SERVICES) {
      const ov = priceOverrides[svc.id];
      next[svc.id] = {
        personal: String(ov ? ov.personalPrice : svc.tierPrices.Personal),
        business: String(ov ? ov.businessPrice : svc.tierPrices.Business),
        corporate: String(ov ? ov.corporatePrice : svc.tierPrices.Corporate),
      };
    }
    setPriceDrafts(next);
  }, [priceOverrides]);

  const activeTicket = supportTickets.find((t) => t.id === selectedTicketId) || supportTickets[0] || null;

  useEffect(() => {
    if (!activeTicket) {
      setTicketMsgs([]);
      return;
    }
    if (authMode === 'jwt') {
      setTicketMsgs(supportMessages.filter((m) => m.ticketId === activeTicket.id));
      return;
    }
    const q = query(
      collection(db, 'supportTickets', activeTicket.id, 'messages'),
      orderBy('createdAt', 'asc'),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setTicketMsgs(
          snap.docs.map((d) => mapFirestoreSupportMessage(d.id, d.data() as Record<string, unknown>)),
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `supportTickets/${activeTicket.id}/messages`),
    );
    return () => unsub();
  }, [activeTicket?.id, authMode, supportMessages]);

  const approvedDeposits = deposits.filter((d) => d.status === 'Approved');
  const pendingDeposits = deposits.filter((d) => d.status === 'Pending');
  const openTickets = supportTickets.filter((t) => t.status === 'Open');
  const memberUsers = users.filter((u) => u.role !== 'admin');
  const pendingRegReviewUsers = memberUsers.filter(
    (u) =>
      normalizeAccountStatus(u.status) === 'Pending Payment' &&
      u.registrationPaymentStatus === 'Pending Review',
  );
  const pendingPaymentUsers = memberUsers.filter(
    (u) => normalizeAccountStatus(u.status) === 'Pending Payment',
  );
  const totalDepositVolume = approvedDeposits.reduce((sum, d) => sum + d.amount, 0);
  const totalRevenue = orders
    .filter((o) => o.status === 'Pending' || o.status === 'Processing' || o.status === 'Completed')
    .reduce((sum, o) => sum + o.price, 0);

  const getUserLatestRegPayment = (u: UserAccount): RegistrationPayment | undefined =>
    registrationPayments.find((p) => p.id === u.registrationPaymentId) ||
    registrationPayments.find((p) => p.userId === u.uid);

  const normalizedQuery = userSearch.trim().toLowerCase();
  const matchesUserSearch = (u: UserAccount) => {
    if (!normalizedQuery) return true;
    const hay = [
      u.fullName,
      u.username,
      u.email,
      u.phoneNumber,
      u.country,
      u.registrationTxId || '',
      u.uid,
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(normalizedQuery);
  };

  const filteredUsers = users.filter((u) => {
    const canon = normalizeAccountStatus(u.status);
    if (userStatusFilter !== 'All' && canon !== userStatusFilter) return false;
    return matchesUserSearch(u);
  });

  const filteredRegistrationUsers = memberUsers
    .filter((u) => {
      const regState = u.registrationPaymentStatus || 'Unpaid';
      if (regFilter !== 'All' && regState !== regFilter) return false;
      return matchesUserSearch(u);
    })
    .sort((a, b) => {
      const rank = (u: UserAccount) => {
        if (u.registrationPaymentStatus === 'Pending Review' && normalizeAccountStatus(u.status) === 'Pending Payment') return 0;
        if (normalizeAccountStatus(u.status) === 'Pending Payment') return 1;
        if (normalizeAccountStatus(u.status) === 'Rejected') return 2;
        return 3;
      };
      return rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt);
    });

  const openScreenshotPreview = (u: UserAccount, pay?: RegistrationPayment) => {
    const receiptDataUrl = u.registrationReceiptDataUrl || pay?.receiptDataUrl;
    const receiptFileName = u.registrationReceiptFileName || pay?.receiptFileName;
    const txId = u.registrationTxId || pay?.txId || 'Not submitted';
    const currency = u.registrationCrypto || pay?.currency || 'USDT_TRC20';
    const amount = u.registrationFeeAmount || pay?.amount || 5;
    setPreviewDeposit(null);
    setPreviewGeneric({
      id: pay?.id || u.uid,
      title: `$${amount.toFixed(2)} USD Registration Fee (${currency.replace('_', ' ')})`,
      subtitle: `${u.fullName} (@${u.username}) · ${u.email || u.uid}`,
      amount,
      currency,
      txId,
      status: u.registrationPaymentStatus === 'Pending Review' ? 'Pending Review' : normalizeAccountStatus(u.status),
      receiptDataUrl,
      receiptFileName,
      adminNote: u.adminNotes,
    });
  };

  const countryMap = new Map<string, { orders: number; revenue: number; users: number }>();
  for (const ord of orders) {
    const entry = countryMap.get(ord.country) || { orders: 0, revenue: 0, users: 0 };
    entry.orders += 1;
    if (ord.status !== 'Refunded' && ord.status !== 'Cancelled') {
      entry.revenue += ord.price;
    }
    countryMap.set(ord.country, entry);
  }
  for (const u of users) {
    const entry = countryMap.get(u.country) || { orders: 0, revenue: 0, users: 0 };
    entry.users += 1;
    countryMap.set(u.country, entry);
  }
  const topCountries = Array.from(countryMap.entries())
    .map(([country, stats]) => ({ country, ...stats }))
    .sort((a, b) => b.revenue - a.revenue || b.users - a.users)
    .slice(0, 8);
  const maxCountryScore = Math.max(1, ...topCountries.map((c) => c.revenue + c.users * 10));

  async function runAction(id: string, fn: () => Promise<void>, successText: string) {
    setBusyId(id);
    setErrorMessage('');
    setStatusMessage('');
    try {
      await fn();
      setStatusMessage(successText);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Admin operation failed.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleTicketReplySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeTicket || !replyText.trim()) return;
    await runAction(
      activeTicket.id,
      async () => {
        await onReplyTicket(activeTicket, replyText);
        setReplyText('');
      },
      `Reply sent to @${activeTicket.username}.`,
    );
  }

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-400">
            <Shield className="w-3.5 h-3.5" />
            <span>Exclusive Administrator Portal · {ADMIN_EMAIL}</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
            BlueWhale Markethub Admin Dashboard
          </h1>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
          {(
            [
              { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-3.5 h-3.5" /> },
              {
                id: 'registrations',
                label: `Registrations (${pendingRegReviewUsers.length})`,
                icon: <UserCheck className="w-3.5 h-3.5" />,
              },
              {
                id: 'deposits',
                label: `Deposits (${pendingDeposits.length})`,
                icon: <Coins className="w-3.5 h-3.5" />,
              },
              { id: 'orders', label: `Orders (${orders.length})`, icon: <Package className="w-3.5 h-3.5" /> },
              {
                id: 'transactions',
                label: `Transactions (${transactions.length})`,
                icon: <ArrowUpRight className="w-3.5 h-3.5" />,
              },
              {
                id: 'pricing',
                label: `Pricing & Alerts (${priceAlerts.filter((a) => a.status === 'Active').length})`,
                icon: <Tag className="w-3.5 h-3.5" />,
              },
              { id: 'users', label: `Users (${users.length})`, icon: <Users className="w-3.5 h-3.5" /> },
              {
                id: 'logs',
                label: `Audit & Logins (${adminLogs.length})`,
                icon: <History className="w-3.5 h-3.5" />,
              },
              {
                id: 'support',
                label: `Support (${openTickets.length})`,
                icon: <MessageSquare className="w-3.5 h-3.5" />,
              },
              {
                id: 'settings',
                label: 'Settings',
                icon: <Sliders className="w-3.5 h-3.5" />,
              },
            ] as { id: AdminTab; label: string; icon: React.ReactNode }[]
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                tab === item.id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {statusMessage && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-sm text-emerald-800 dark:text-emerald-200">
          {statusMessage}
        </div>
      )}
      {errorMessage && (
        <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-sm text-rose-700 dark:text-rose-300">
          {errorMessage}
        </div>
      )}

      {tab === 'analytics' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="text-xs text-slate-500">Total Users</div>
              <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                {users.length}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {users.filter((u) => u.isVerified).length} verified accounts
              </div>
            </div>
            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="text-xs text-slate-500">Approved Deposits</div>
              <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                ${totalDepositVolume.toFixed(2)}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {approvedDeposits.length} approved · {pendingDeposits.length} pending
              </div>
            </div>
            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="text-xs text-slate-500">Revenue</div>
              <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                ${totalRevenue.toFixed(2)}
              </div>
              <div className="mt-1 text-xs text-slate-500">{orders.length} orders tracked</div>
            </div>
            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="text-xs text-slate-500">Admin Alerts</div>
              <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                {pendingRegReviewUsers.length + pendingDeposits.length + openTickets.length}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {pendingRegReviewUsers.length} $5 reg · {pendingDeposits.length} deposits · {openTickets.length} tickets
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Country Reports */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Country Reports
              </h2>
              {topCountries.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Country reports populate as members register and submit orders.
                </p>
              ) : (
                <div className="space-y-3.5">
                  {topCountries.map((row) => {
                    const pct = Math.min(100, Math.round(((row.revenue + row.users * 10) / maxCountryScore) * 100));
                    return (
                      <div key={row.country} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-900 dark:text-white">{row.country}</span>
                          <span className="font-mono tabular-nums text-slate-500">
                            {row.users} users · {row.orders} orders · ${row.revenue.toFixed(2)}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div className="h-full bg-blue-600 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Admin Notifications & User Activity Logs */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-blue-600" />
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Admin Notifications & User Activity Logs
                </h2>
              </div>
              <div className="space-y-2.5 text-xs">
                {pendingRegReviewUsers.slice(0, 3).map((u) => (
                  <div
                    key={u.uid}
                    className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 flex items-center justify-between gap-2"
                  >
                    <span>
                      $5 registration payment awaiting verification for <strong>{u.fullName}</strong> (@{u.username})
                    </span>
                    <button
                      type="button"
                      onClick={() => setTab('registrations')}
                      className="font-semibold text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                    >
                      Verify TXID
                    </button>
                  </div>
                ))}
                {pendingDeposits.slice(0, 3).map((d) => (
                  <div
                    key={d.id}
                    className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex items-center justify-between gap-2"
                  >
                    <span>
                      Pending {d.currency} deposit of <strong>${d.amount.toFixed(2)}</strong> from @{d.username}
                    </span>
                    <button
                      type="button"
                      onClick={() => setTab('deposits')}
                      className="font-semibold text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                    >
                      Review
                    </button>
                  </div>
                ))}
                {loginLogs.slice(0, 4).map((l) => (
                  <div
                    key={l.id}
                    className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2"
                  >
                    <span className="text-slate-700 dark:text-slate-300">
                      {l.deviceLabel} · <span className="font-mono">{l.ipAddress}</span>
                    </span>
                    <span className="font-mono text-slate-400">
                      {new Date(l.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
                {pendingRegReviewUsers.length === 0 && pendingDeposits.length === 0 && loginLogs.length === 0 && (
                  <p className="text-slate-500">All queues clear. Activity logs update on user events.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'registrations' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                $5 Registration Payment Verification Queue
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Inspect TXID &amp; uploaded screenshots before unlocking dashboard access. {pendingPaymentUsers.length} account(s) currently pending payment/review.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search user, email, TXID..."
                  className="pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
                />
              </div>
              <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
                {(['All', 'Pending Review', 'Unpaid', 'Approved', 'Rejected'] as const).map((statusKey) => (
                  <button
                    key={statusKey}
                    type="button"
                    onClick={() => setRegFilter(statusKey)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap ${
                      regFilter === statusKey
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {statusKey}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {filteredRegistrationUsers.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
              No registration submissions match the active filter.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredRegistrationUsers.map((u) => {
                const pay = getUserLatestRegPayment(u);
                const canonStatus = normalizeAccountStatus(u.status);
                const regPayStatus = u.registrationPaymentStatus || 'Unpaid';
                const hasScreenshot = Boolean(u.registrationReceiptDataUrl || pay?.receiptDataUrl);
                const txValue = u.registrationTxId || pay?.txId || '';
                const cryptoUsed = u.registrationCrypto || pay?.currency || 'USDT_TRC20';
                const feeAmount = u.registrationFeeAmount || pay?.amount || 5;
                const noteVal = noteDrafts[u.uid] ?? u.adminNotes ?? '';
                const reasonVal =
                  rejectReasonDrafts[u.uid] ??
                  u.rejectionReason ??
                  'Payment proof or TXID could not be verified. Please resubmit valid proof.';

                return (
                  <div
                    key={u.uid}
                    className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-display text-base font-bold text-slate-900 dark:text-white">
                            {u.fullName}
                          </span>
                          <span className="text-xs text-slate-500 font-mono">@{u.username}</span>
                          <span
                            className={`px-2 py-0.5 text-[11px] font-semibold rounded-md ${
                              canonStatus === 'Approved'
                                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                                : canonStatus === 'Rejected' || canonStatus === 'Suspended'
                                  ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                                  : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                            }`}
                          >
                            {canonStatus}
                          </span>
                          <span className="px-2 py-0.5 text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-md">
                            Fee: {regPayStatus}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span>{u.email || u.uid}</span>
                          <span>{u.phoneNumber || '—'}</span>
                          <span>{u.country}</span>
                          <span>Registered: {new Date(u.createdAt).toLocaleDateString()}</span>
                          {u.approvedAt && (
                            <span className="text-emerald-600 dark:text-emerald-400">
                              Approved: {new Date(u.approvedAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {hasScreenshot && (
                          <button
                            type="button"
                            onClick={() => openScreenshotPreview(u, pay)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 rounded-lg"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View Screenshot</span>
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busyId === u.uid}
                          onClick={() =>
                            runAction(
                              u.uid,
                              () =>
                                onReviewRegistration({
                                  user: u,
                                  paymentId: pay?.id || u.registrationPaymentId,
                                  decision: 'Approved',
                                  adminNotes: noteVal,
                                }),
                              `Approved @${u.username} and unlocked all website services.`,
                            )
                          }
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Approve Account</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyId === u.uid}
                          onClick={() =>
                            runAction(
                              u.uid,
                              () =>
                                onReviewRegistration({
                                  user: u,
                                  paymentId: pay?.id || u.registrationPaymentId,
                                  decision: 'Rejected',
                                  rejectionReason: reasonVal,
                                  adminNotes: noteVal,
                                }),
                              `Rejected registration payment for @${u.username}.`,
                            )
                          }
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 hover:bg-rose-100 disabled:opacity-50 rounded-lg"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Reject</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyId === u.uid}
                          onClick={() =>
                            runAction(
                              u.uid,
                              () =>
                                onReviewRegistration({
                                  user: u,
                                  paymentId: pay?.id || u.registrationPaymentId,
                                  decision: 'Suspended',
                                  adminNotes: noteVal,
                                }),
                              `Suspended @${u.username}.`,
                            )
                          }
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 disabled:opacity-50 rounded-lg"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>Suspend</span>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs">
                      <div>
                        <div className="text-slate-500">Cryptocurrency &amp; Amount</div>
                        <div className="mt-0.5 font-mono font-semibold text-slate-900 dark:text-white">
                          {txValue ? `$${feeAmount.toFixed(2)} USD (${cryptoUsed.replace('_', ' ')})` : 'Not submitted yet'}
                        </div>
                      </div>
                      <div className="md:col-span-2 min-w-0">
                        <div className="text-slate-500">Submitted Transaction ID (TXID)</div>
                        <div className="mt-0.5 font-mono text-slate-900 dark:text-slate-100 break-all">
                          {txValue || 'Awaiting user payment submission'}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="block text-slate-500 mb-1">Admin Notes (internal)</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={noteVal}
                            onChange={(e) =>
                              setNoteDrafts((prev) => ({ ...prev, [u.uid]: e.target.value }))
                            }
                            placeholder="Add verification note..."
                            className="flex-1 px-3 py-1.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
                          />
                          <button
                            type="button"
                            disabled={busyId === u.uid}
                            onClick={() =>
                              runAction(
                                u.uid,
                                () => onUpdateUser(u.uid, { adminNotes: noteVal }),
                                `Saved admin note for @${u.username}.`,
                              )
                            }
                            className="px-2.5 py-1.5 font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded-lg shrink-0"
                          >
                            Save Note
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-slate-500 mb-1">Rejection Reason (shown if rejected)</label>
                        <input
                          type="text"
                          value={reasonVal}
                          onChange={(e) =>
                            setRejectReasonDrafts((prev) => ({ ...prev, [u.uid]: e.target.value }))
                          }
                          placeholder="Reason sent to user on rejection..."
                          className="w-full px-3 py-1.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'deposits' && (() => {
        const filteredDeposits =
          depositFilter === 'All'
            ? deposits
            : deposits.filter((d) => d.status === depositFilter);
        const rejectedCount = deposits.filter((d) => d.status === 'Rejected').length;
        return (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Deposit Management Queue
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Review submitted receipts &amp; TXIDs before crediting funds to user wallets
                </p>
              </div>
              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
                {(
                  [
                    { id: 'All', label: `All (${deposits.length})` },
                    { id: 'Pending', label: `Pending (${pendingDeposits.length})` },
                    { id: 'Approved', label: `Approved (${approvedDeposits.length})` },
                    { id: 'Rejected', label: `Rejected (${rejectedCount})` },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setDepositFilter(item.id)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                      depositFilter === item.id
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            {filteredDeposits.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                {deposits.length === 0
                  ? 'No crypto deposits submitted yet.'
                  : `No ${depositFilter.toLowerCase()} deposits found.`}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">Submission Date</th>
                      <th className="px-5 py-3 font-medium">User</th>
                      <th className="px-5 py-3 font-medium">Network</th>
                      <th className="px-5 py-3 font-medium">TXID</th>
                      <th className="px-5 py-3 font-medium">Receipt</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3 font-medium text-right">Amount</th>
                      <th className="px-5 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {filteredDeposits.map((dep) => {
                      const hasReceipt = Boolean(dep.receiptUrl || dep.receiptDataUrl);
                      const draftReason = depositReasonDrafts[dep.id] ?? '';
                      return (
                        <tr key={dep.id}>
                          <td className="px-5 py-3.5 text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap">
                            {new Date(dep.createdAt).toLocaleString()}
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="font-medium text-slate-900 dark:text-white">
                              {dep.userName || `@${dep.username}`}
                            </div>
                            <div className="text-xs text-slate-500">
                              @{dep.username} · {dep.userEmail}
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-xs font-medium whitespace-nowrap">
                            {dep.currency.replace('_', ' ')}
                          </td>
                          <td className="px-5 py-3.5 font-mono text-xs max-w-[190px] truncate" title={dep.txHash}>
                            {dep.txHash}
                          </td>
                          <td className="px-5 py-3.5 text-xs">
                            {hasReceipt ? (
                              <button
                                type="button"
                                onClick={() => setPreviewDeposit(dep)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded-md whitespace-nowrap"
                              >
                                <FileText className="w-3.5 h-3.5" />
                                <span>View Receipt</span>
                              </button>
                            ) : (
                              <span className="text-slate-400">No file</span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-xs font-medium">
                            {dep.status === 'Pending' && (
                              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                                <Clock className="w-3.5 h-3.5" /> Pending
                              </span>
                            )}
                            {dep.status === 'Approved' && (
                              <div>
                                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                                  <CheckCircle2 className="w-3.5 h-3.5" /> Approved
                                </span>
                                {dep.approvedAt && (
                                  <div className="text-[11px] font-normal text-slate-500 mt-0.5">
                                    {new Date(dep.approvedAt).toLocaleDateString()}
                                  </div>
                                )}
                              </div>
                            )}
                            {dep.status === 'Rejected' && (
                              <div>
                                <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400">
                                  <X className="w-3.5 h-3.5" /> Rejected
                                </span>
                                {(dep.rejectionReason || dep.adminNote) && (
                                  <div className="text-[11px] font-normal text-rose-600 dark:text-rose-400 mt-0.5 max-w-[180px]">
                                    {dep.rejectionReason || dep.adminNote}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-3.5 font-mono tabular-nums text-right font-semibold whitespace-nowrap">
                            ${dep.amount.toFixed(2)}
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            {dep.status === 'Pending' ? (
                              <div className="flex flex-col items-end gap-2">
                                <input
                                  type="text"
                                  value={draftReason}
                                  onChange={(e) =>
                                    setDepositReasonDrafts((prev) => ({
                                      ...prev,
                                      [dep.id]: e.target.value,
                                    }))
                                  }
                                  placeholder="Note or rejection reason (optional)"
                                  className="w-52 px-2.5 py-1 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md"
                                />
                                <div className="inline-flex items-center gap-2">
                                  <button
                                    type="button"
                                    disabled={busyId === dep.id}
                                    onClick={() =>
                                      runAction(
                                        dep.id,
                                        () =>
                                          onReviewDeposit(
                                            dep,
                                            'Approved',
                                            draftReason.trim() || 'Receipt & payment confirmed manually',
                                          ),
                                        `Approved $${dep.amount.toFixed(2)} deposit and credited @${dep.username}'s wallet.`,
                                      )
                                    }
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md whitespace-nowrap"
                                  >
                                    <Check className="w-3.5 h-3.5" /> Approve Deposit
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busyId === dep.id}
                                    onClick={() => {
                                      const reason =
                                        draftReason.trim() ||
                                        'Receipt or transaction hash could not be verified.';
                                      void runAction(
                                        dep.id,
                                        () => onReviewDeposit(dep, 'Rejected', reason, reason),
                                        `Rejected deposit ${dep.id}.`,
                                      );
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-md whitespace-nowrap"
                                  >
                                    <X className="w-3.5 h-3.5" /> Reject Deposit
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">
                                {dep.reviewedBy ? `Reviewed` : 'Completed'}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      {tab === 'orders' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Account Order Management
            </h2>
          </div>
          {orders.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No account orders placed yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Customer</th>
                    <th className="px-5 py-3 font-medium">Account Package</th>
                    <th className="px-5 py-3 font-medium">Country</th>
                    <th className="px-5 py-3 font-medium">Activation Ref</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium text-right">Price</th>
                    <th className="px-5 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {orders.map((ord) => (
                    <tr key={ord.id}>
                      <td className="px-5 py-3.5">
                        <div className="font-medium">@{ord.username}</div>
                        <div className="text-xs text-slate-500">{ord.userEmail}</div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-slate-900 dark:text-white">{ord.serviceName}</div>
                        <div className="text-xs text-slate-500">{ord.accountType || 'Personal'} Tier</div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-600 dark:text-slate-300">{ord.country}</td>
                      <td className="px-5 py-3.5 font-mono text-xs">{ord.trackingCode}</td>
                      <td className="px-5 py-3.5 text-xs font-medium">
                        {(ord.status === 'Pending' || ord.status === 'Processing') && (
                          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                            <Clock className="w-3.5 h-3.5" /> {ord.status}
                          </span>
                        )}
                        {ord.status === 'Completed' && (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Completed
                          </span>
                        )}
                        {(ord.status === 'Refunded' || ord.status === 'Cancelled') && (
                          <span className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400">
                            <RefreshCw className="w-3.5 h-3.5" /> {ord.status}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 font-mono tabular-nums text-right font-semibold">
                        ${ord.price.toFixed(2)}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {ord.status === 'Pending' || ord.status === 'Processing' ? (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              disabled={busyId === ord.id}
                              onClick={() =>
                                runAction(
                                  ord.id,
                                  () => onUpdateOrderStatus(ord, 'Completed'),
                                  `Completed order ${ord.trackingCode}.`,
                                )
                              }
                              className="px-2.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md"
                            >
                              Complete
                            </button>
                            <button
                              type="button"
                              disabled={busyId === ord.id}
                              onClick={() =>
                                runAction(
                                  ord.id,
                                  () => onUpdateOrderStatus(ord, 'Cancelled'),
                                  `Cancelled order ${ord.trackingCode} and refunded $${ord.price.toFixed(2)}.`,
                                )
                              }
                              className="px-2.5 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-md"
                            >
                              Cancel & Refund
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">Finalized</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'transactions' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Platform-Wide Transaction Ledger ({transactions.length})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Complete deposit, service purchase, and refund history across all registered users.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={txSearch}
                  onChange={(e) => setTxSearch(e.target.value)}
                  placeholder="Search user, ref, description..."
                  className="pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
                />
              </div>
              <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
                {(['all', 'deposit', 'purchase', 'refund'] as const).map((tKey) => (
                  <button
                    key={tKey}
                    type="button"
                    onClick={() => setTxFilter(tKey)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md capitalize ${
                      txFilter === tKey
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {tKey}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {(() => {
            const q = txSearch.trim().toLowerCase();
            const userMap = new Map(users.map((u) => [u.uid, u]));
            const filteredTx = transactions.filter((tx) => {
              if (txFilter !== 'all' && tx.type !== txFilter) return false;
              if (!q) return true;
              const owner = userMap.get(tx.userId);
              const hay = [
                tx.id,
                tx.referenceId,
                tx.description,
                tx.status,
                owner?.email || '',
                owner?.username || '',
                owner?.fullName || '',
              ]
                .join(' ')
                .toLowerCase();
              return hay.includes(q);
            });
            if (filteredTx.length === 0) {
              return (
                <div className="p-8 text-center text-sm text-slate-500">
                  No transactions match the active filter.
                </div>
              );
            }
            return (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">Date</th>
                      <th className="px-5 py-3 font-medium">Member</th>
                      <th className="px-5 py-3 font-medium">Type</th>
                      <th className="px-5 py-3 font-medium">Description</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3 font-medium text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {filteredTx.map((tx) => {
                      const owner = userMap.get(tx.userId);
                      return (
                        <tr key={tx.id}>
                          <td className="px-5 py-3 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                            {new Date(tx.createdAt).toLocaleString()}
                          </td>
                          <td className="px-5 py-3">
                            <div className="font-medium text-slate-900 dark:text-white">
                              {owner ? `@${owner.username}` : tx.userId.slice(0, 12)}
                            </div>
                            {owner?.email && <div className="text-slate-500">{owner.email}</div>}
                          </td>
                          <td className="px-5 py-3 capitalize font-medium text-slate-700 dark:text-slate-300">
                            {tx.type}
                          </td>
                          <td className="px-5 py-3 text-slate-700 dark:text-slate-300">
                            <div>{tx.description}</div>
                            <div className="font-mono text-[11px] text-slate-400">Ref: {tx.referenceId}</div>
                          </td>
                          <td className="px-5 py-3 font-medium">
                            <span
                              className={
                                tx.status === 'Completed'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : tx.status === 'Pending'
                                    ? 'text-amber-700 dark:text-amber-400'
                                    : tx.status === 'Refunded'
                                      ? 'text-blue-700 dark:text-blue-400'
                                      : 'text-rose-700 dark:text-rose-400'
                              }
                            >
                              {tx.status}
                            </span>
                          </td>
                          <td className="px-5 py-3 font-mono tabular-nums text-right font-semibold">
                            <span
                              className={
                                tx.direction === 'credit'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-slate-900 dark:text-white'
                              }
                            >
                              {tx.direction === 'credit' ? '+' : '-'}${tx.amount.toFixed(2)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      )}

      {tab === 'pricing' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Dynamic Service Pricing &amp; Automatic Price-Drop Alert Dispatch
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Adjust Personal, Business, or Corporate base prices ($100+ minimum). Lowering a price automatically notifies users whose Alert Me threshold is crossed.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Service</th>
                    <th className="px-5 py-3 font-medium">Personal ($100+)</th>
                    <th className="px-5 py-3 font-medium">Business ($100+)</th>
                    <th className="px-5 py-3 font-medium">Corporate ($100+)</th>
                    <th className="px-5 py-3 font-medium">Active Alerts</th>
                    <th className="px-5 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {SHIPPING_SERVICES.map((svc) => {
                    const draft = priceDrafts[svc.id] || {
                      personal: String(svc.tierPrices.Personal),
                      business: String(svc.tierPrices.Business),
                      corporate: String(svc.tierPrices.Corporate),
                    };
                    const activeWatchCount = priceAlerts.filter(
                      (a) => a.serviceId === svc.id && a.status === 'Active',
                    ).length;
                    const hasOverride = Boolean(priceOverrides[svc.id]);
                    return (
                      <tr key={svc.id}>
                        <td className="px-5 py-3.5">
                          <div className="font-medium text-slate-900 dark:text-white">
                            {svc.providerName}
                          </div>
                          <div className="text-xs text-slate-500">{svc.serviceName}</div>
                        </td>
                        <td className="px-5 py-3.5">
                          <input
                            type="number"
                            min={100}
                            step="1"
                            value={draft.personal}
                            onChange={(e) =>
                              setPriceDrafts((prev) => ({
                                ...prev,
                                [svc.id]: { ...draft, personal: e.target.value },
                              }))
                            }
                            className="w-24 px-2.5 py-1.5 font-mono text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md"
                          />
                        </td>
                        <td className="px-5 py-3.5">
                          <input
                            type="number"
                            min={100}
                            step="1"
                            value={draft.business}
                            onChange={(e) =>
                              setPriceDrafts((prev) => ({
                                ...prev,
                                [svc.id]: { ...draft, business: e.target.value },
                              }))
                            }
                            className="w-24 px-2.5 py-1.5 font-mono text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md"
                          />
                        </td>
                        <td className="px-5 py-3.5">
                          <input
                            type="number"
                            min={100}
                            step="1"
                            value={draft.corporate}
                            onChange={(e) =>
                              setPriceDrafts((prev) => ({
                                ...prev,
                                [svc.id]: { ...draft, corporate: e.target.value },
                              }))
                            }
                            className="w-24 px-2.5 py-1.5 font-mono text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md"
                          />
                        </td>
                        <td className="px-5 py-3.5 text-xs font-mono tabular-nums">
                          {activeWatchCount > 0 ? (
                            <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 font-semibold">
                              <BellRing className="w-3.5 h-3.5" />
                              <span>{activeWatchCount} watching</span>
                            </span>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              disabled={busyId === svc.id}
                              onClick={() =>
                                runAction(
                                  svc.id,
                                  async () => {
                                    const res = await onUpdateServicePrice({
                                      serviceId: svc.id,
                                      personalPrice: Number(draft.personal),
                                      businessPrice: Number(draft.business),
                                      corporatePrice: Number(draft.corporate),
                                    });
                                    setStatusMessage(
                                      `Updated ${svc.providerName} pricing. ${res.triggeredCount} customer price alert${res.triggeredCount === 1 ? '' : 's'} triggered & notified.`,
                                    );
                                  },
                                  `Updated ${svc.providerName} pricing.`,
                                )
                              }
                              className="px-2.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
                            >
                              Save Prices
                            </button>
                            {hasOverride && (
                              <button
                                type="button"
                                disabled={busyId === svc.id}
                                onClick={() =>
                                  runAction(
                                    svc.id,
                                    async () => {
                                      await onUpdateServicePrice({
                                        serviceId: svc.id,
                                        personalPrice: svc.tierPrices.Personal,
                                        businessPrice: svc.tierPrices.Business,
                                        corporatePrice: svc.tierPrices.Corporate,
                                        resetToDefault: true,
                                      });
                                    },
                                    `Restored default catalog pricing for ${svc.providerName}.`,
                                  )
                                }
                                title="Restore catalog default"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-md cursor-pointer"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Reset</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Customer Price Alert Watchlist ({priceAlerts.length})
              </h3>
            </div>
            {priceAlerts.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">
                No customer price alerts created yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">Member</th>
                      <th className="px-5 py-3 font-medium">Service</th>
                      <th className="px-5 py-3 font-medium">Tier &amp; Country</th>
                      <th className="px-5 py-3 font-medium text-right">Target Threshold</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {priceAlerts.map((a) => (
                      <tr key={a.id}>
                        <td className="px-5 py-3 text-xs">
                          <div className="font-medium text-slate-900 dark:text-white">@{a.username}</div>
                          <div className="text-slate-500">{a.userEmail}</div>
                        </td>
                        <td className="px-5 py-3 text-xs font-medium">{a.serviceName}</td>
                        <td className="px-5 py-3 text-xs text-slate-600 dark:text-slate-300">
                          {a.accountType} · {a.country}
                        </td>
                        <td className="px-5 py-3 font-mono text-xs font-semibold tabular-nums text-right">
                          &lt; ${a.targetPrice.toFixed(2)}
                        </td>
                        <td className="px-5 py-3 text-xs font-medium">
                          {a.status === 'Triggered' ? (
                            <span className="text-emerald-700 dark:text-emerald-400">
                              Triggered (${(a.triggeredPrice || a.targetPrice).toFixed(2)})
                            </span>
                          ) : a.status === 'Active' ? (
                            <span className="text-blue-700 dark:text-blue-400">Active Watch</span>
                          ) : (
                            <span className="text-slate-500">Cancelled</span>
                          )}
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

      {tab === 'users' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Registered User Database ({filteredUsers.length} of {users.length})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Full member records including contact info, registration date, $5 fee TXID &amp; screenshot, approval date, and admin notes.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search name, email, phone, country..."
                  className="pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
                />
              </div>
              <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
                {(['All', 'Pending Payment', 'Approved', 'Rejected', 'Suspended'] as const).map(
                  (statusKey) => (
                    <button
                      key={statusKey}
                      type="button"
                      onClick={() => setUserStatusFilter(statusKey)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap ${
                        userStatusFilter === statusKey
                          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {statusKey}
                    </button>
                  ),
                )}
              </div>
            </div>
          </div>

          {filteredUsers.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No users match your search or status filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Member &amp; Contact</th>
                    <th className="px-4 py-3 font-medium">Country &amp; Dates</th>
                    <th className="px-4 py-3 font-medium">$5 Fee &amp; TXID</th>
                    <th className="px-4 py-3 font-medium">Account Status</th>
                    <th className="px-4 py-3 font-medium">Admin Notes</th>
                    <th className="px-4 py-3 font-medium text-right">Balance</th>
                    <th className="px-4 py-3 font-medium text-right">Controls</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filteredUsers.map((u) => {
                    const canon = normalizeAccountStatus(u.status);
                    const pay = getUserLatestRegPayment(u);
                    const hasShot = Boolean(u.registrationReceiptDataUrl || pay?.receiptDataUrl);
                    const txText = u.registrationTxId || pay?.txId || '';
                    const noteVal = noteDrafts[u.uid] ?? u.adminNotes ?? '';
                    const reasonVal =
                      rejectReasonDrafts[u.uid] ??
                      u.rejectionReason ??
                      'Payment verification could not be confirmed.';

                    return (
                      <tr key={u.uid} className="align-top">
                        <td className="px-4 py-3.5 space-y-0.5">
                          <div className="font-semibold text-sm text-slate-900 dark:text-white flex flex-wrap items-center gap-1.5">
                            <span>{u.fullName}</span>
                            <span className="text-xs font-normal text-slate-500">@{u.username}</span>
                            <span
                              className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${
                                u.role === 'admin'
                                  ? 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              {getDisplayRole(u.role)}
                            </span>
                          </div>
                          <div className="text-slate-600 dark:text-slate-300">{u.email || u.uid}</div>
                          <div className="text-slate-500 font-mono">{u.phoneNumber || '—'}</div>
                        </td>
                        <td className="px-4 py-3.5 space-y-1 text-slate-600 dark:text-slate-300">
                          <div className="font-medium text-slate-900 dark:text-white">{u.country}</div>
                          <div>Reg: {new Date(u.createdAt).toLocaleDateString()}</div>
                          <div>
                            Last Login:{' '}
                            {u.lastLoginAt
                              ? new Date(u.lastLoginAt).toLocaleString()
                              : 'Never recorded'}
                          </div>
                          {u.approvedAt && (
                            <div className="text-emerald-600 dark:text-emerald-400">
                              Approved: {new Date(u.approvedAt).toLocaleDateString()}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3.5 space-y-1.5 max-w-[200px]">
                          <div className="font-medium text-slate-900 dark:text-white">
                            {u.registrationPaymentStatus || 'Unpaid'}
                          </div>
                          {txText ? (
                            <div className="font-mono text-[11px] text-slate-500 truncate" title={txText}>
                              TXID: {txText}
                            </div>
                          ) : (
                            <div className="text-slate-400">No TXID yet</div>
                          )}
                          {hasShot && (
                            <button
                              type="button"
                              onClick={() => openScreenshotPreview(u, pay)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 rounded"
                            >
                              <Eye className="w-3 h-3" /> Screenshot
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3.5 space-y-1.5">
                          <span
                            className={`inline-block px-2 py-0.5 font-semibold rounded ${
                              canon === 'Approved'
                                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                                : canon === 'Rejected' || canon === 'Suspended'
                                  ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                                  : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                            }`}
                          >
                            {canon}
                          </span>
                          <div className="text-[11px] font-mono text-slate-500">
                            account_status: <strong className="text-slate-700 dark:text-slate-300">{getSimpleAccountStatus(u)}</strong>
                          </div>
                          <div>
                            {u.isVerified ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                                <ShieldCheck className="w-3.5 h-3.5" /> Email Verified
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-slate-500">
                                <ShieldAlert className="w-3.5 h-3.5" /> Pending Verification
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 min-w-[180px]">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={noteVal}
                              onChange={(e) =>
                                setNoteDrafts((prev) => ({ ...prev, [u.uid]: e.target.value }))
                              }
                              placeholder="Internal note..."
                              className="w-full px-2 py-1 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded"
                            />
                            <button
                              type="button"
                              disabled={busyId === u.uid}
                              onClick={() =>
                                runAction(
                                  u.uid,
                                  () => onUpdateUser(u.uid, { adminNotes: noteVal }),
                                  `Saved note for @${u.username}.`,
                                )
                              }
                              className="px-2 py-1 font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded shrink-0"
                            >
                              Save
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 font-mono tabular-nums text-right font-semibold">
                          ${u.walletBalance.toFixed(2)}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDeleteUid(null);
                                setDetailUserUid(u.uid);
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded"
                            >
                              <Eye className="w-3 h-3" />
                              <span>Details</span>
                            </button>
                            {u.role !== 'admin' ? (
                              <>
                                {canon !== 'Approved' && (
                                  <button
                                    type="button"
                                    disabled={busyId === u.uid}
                                    onClick={() =>
                                      runAction(
                                        u.uid,
                                        () =>
                                          onReviewRegistration({
                                            user: u,
                                            paymentId: pay?.id || u.registrationPaymentId,
                                            decision: 'Approved',
                                            adminNotes: noteVal,
                                          }),
                                        `Approved @${u.username} and enabled dashboard access.`,
                                      )
                                    }
                                    className="px-2 py-1 font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded"
                                  >
                                    Approve
                                  </button>
                                )}
                                {canon !== 'Rejected' && (
                                  <button
                                    type="button"
                                    disabled={busyId === u.uid}
                                    onClick={() =>
                                      runAction(
                                        u.uid,
                                        () =>
                                          onReviewRegistration({
                                            user: u,
                                            paymentId: pay?.id || u.registrationPaymentId,
                                            decision: 'Rejected',
                                            rejectionReason: reasonVal,
                                            adminNotes: noteVal,
                                          }),
                                        `Rejected @${u.username}.`,
                                      )
                                    }
                                    className="px-2 py-1 font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded"
                                  >
                                    Reject
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={busyId === u.uid}
                                  onClick={() =>
                                    runAction(
                                      u.uid,
                                      () =>
                                        onUpdateUser(u.uid, {
                                          status: canon === 'Suspended' ? 'Approved' : 'Suspended',
                                        }),
                                      `${canon === 'Suspended' ? 'Reactivated' : 'Suspended'} @${u.username}.`,
                                    )
                                  }
                                  className="px-2 py-1 font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded"
                                >
                                  {canon === 'Suspended' ? 'Reactivate' : 'Suspend'}
                                </button>
                                {confirmDeleteUid === u.uid ? (
                                  <>
                                    <button
                                      type="button"
                                      disabled={busyId === u.uid}
                                      onClick={() =>
                                        runAction(
                                          u.uid,
                                          async () => {
                                            await onDeleteUser(u);
                                            setConfirmDeleteUid(null);
                                            if (detailUserUid === u.uid) setDetailUserUid(null);
                                          },
                                          `Deleted user @${u.username}.`,
                                        )
                                      }
                                      className="px-2 py-1 font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded"
                                    >
                                      Confirm Delete
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteUid(null)}
                                      className="px-2 py-1 font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded"
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={busyId === u.uid}
                                    onClick={() => setConfirmDeleteUid(u.uid)}
                                    className="inline-flex items-center gap-1 px-2 py-1 font-medium text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    <span>Delete</span>
                                  </button>
                                )}
                              </>
                            ) : (
                              <span className="text-slate-400 self-center">Protected</span>
                            )}
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
      )}

      {tab === 'logs' && (
        <div className="space-y-6">
          {/* Admin Audit Trail (AdminLogs) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Administrator Audit Logs ({adminLogs.length})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Immutable log of account approvals, rejections, suspensions, status transitions, deposit/order reviews, settings changes, and security blocks.
              </p>
            </div>
            {adminLogs.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No administrator audit events recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">Timestamp</th>
                      <th className="px-5 py-3 font-medium">Action</th>
                      <th className="px-5 py-3 font-medium">Actor</th>
                      <th className="px-5 py-3 font-medium">Target User</th>
                      <th className="px-5 py-3 font-medium">Transition</th>
                      <th className="px-5 py-3 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {adminLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="px-5 py-3 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td className="px-5 py-3 font-mono font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                          {log.action}
                        </td>
                        <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                          {log.adminEmail}
                        </td>
                        <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                          {log.targetEmail || log.targetUsername || log.targetUserId || '—'}
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          {log.previousStatus || log.newStatus ? (
                            <span className="font-mono text-[11px] text-blue-700 dark:text-blue-300">
                              {log.previousStatus || '—'} → {log.newStatus || '—'}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-5 py-3 text-slate-700 dark:text-slate-300 max-w-md">
                          {log.details}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Complete User Login History (LoginHistory) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Complete User Login History ({loginLogs.length})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Recorded sign-in timestamps, IP addresses, device fingerprints, and authentication methods.
              </p>
            </div>
            {loginLogs.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No login history recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">Timestamp</th>
                      <th className="px-5 py-3 font-medium">User</th>
                      <th className="px-5 py-3 font-medium">IP Address</th>
                      <th className="px-5 py-3 font-medium">Device</th>
                      <th className="px-5 py-3 font-medium">Method</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {(() => {
                      const userMap = new Map(users.map((u) => [u.uid, u]));
                      return loginLogs.slice(0, 100).map((l) => {
                        const owner = userMap.get(l.userId);
                        return (
                          <tr key={l.id}>
                            <td className="px-5 py-3 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                              {new Date(l.createdAt).toLocaleString()}
                            </td>
                            <td className="px-5 py-3">
                              <div className="font-medium text-slate-900 dark:text-white">
                                {owner ? `${owner.fullName} (@${owner.username})` : l.userId}
                              </div>
                              {owner?.email && <div className="text-slate-500">{owner.email}</div>}
                            </td>
                            <td className="px-5 py-3 font-mono text-slate-700 dark:text-slate-300">
                              {l.ipAddress}
                            </td>
                            <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                              {l.deviceLabel}
                            </td>
                            <td className="px-5 py-3 font-medium text-slate-700 dark:text-slate-300">
                              {l.authMethod}
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'support' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Support Tickets & Live Chat Queue
              </h2>
            </div>
            {supportTickets.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">No support tickets yet.</div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {supportTickets.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTicketId(t.id)}
                    className={`w-full text-left p-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 ${
                      activeTicket?.id === t.id ? 'bg-blue-50/60 dark:bg-blue-950/30' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-900 dark:text-white truncate">{t.subject}</span>
                      <span className="text-slate-500">{t.status}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      @{t.username} · {t.category} · {t.priority}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col min-h-[380px]">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                {activeTicket ? `${activeTicket.subject} (@${activeTicket.username})` : 'Select a Ticket'}
              </div>
              {activeTicket && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      runAction(
                        activeTicket.id,
                        () => onUpdateTicketStatus(activeTicket.id, 'Resolved'),
                        'Ticket marked Resolved.',
                      )
                    }
                    className="px-2.5 py-1 text-xs font-medium bg-emerald-600 text-white rounded-md"
                  >
                    Resolve
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 p-4 space-y-3 overflow-y-auto max-h-[280px]">
              {!activeTicket ? (
                <div className="text-sm text-slate-500 text-center py-12">
                  Select a ticket from the queue to reply or control live chat.
                </div>
              ) : (
                ticketMsgs.map((m) => (
                  <div
                    key={m.id}
                    className={`p-3 rounded-xl text-xs max-w-[85%] ${
                      m.senderRole === 'admin'
                        ? 'bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 ml-auto'
                        : 'bg-slate-100 dark:bg-slate-800 mr-auto'
                    }`}
                  >
                    <div className="font-semibold mb-1">{m.senderName}</div>
                    <div>{m.body}</div>
                  </div>
                ))
              )}
            </div>

            {activeTicket && (
              <form
                onSubmit={handleTicketReplySubmit}
                className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2"
              >
                <input
                  type="text"
                  required
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Send support reply..."
                  className="flex-1 px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
                />
                <button
                  type="submit"
                  disabled={busyId === activeTicket.id}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Reply</span>
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runAction(
              'site-settings',
              () =>
                onSaveSiteSettings({
                  registrationFeeUsd: Number(settingsForm.registrationFeeUsd),
                  minimumDepositUsd: Number(settingsForm.minimumDepositUsd),
                  supportEmail: settingsForm.supportEmail,
                  marketplaceNotice: settingsForm.marketplaceNotice,
                  requireRegistrationApproval: settingsForm.requireRegistrationApproval,
                }),
              'Saved website settings and logged update to Admin Audit Logs.',
            );
          }}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5 max-w-3xl"
        >
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Website Settings &amp; Compliance Controls
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Configure support contact email, registration verification policy, minimum deposit threshold, and homepage announcement banner.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Registration Verification Fee (USD)
              </label>
              <input
                type="number"
                min={0}
                max={1000}
                step="0.5"
                required
                value={settingsForm.registrationFeeUsd}
                onChange={(e) =>
                  setSettingsForm((prev) => ({ ...prev, registrationFeeUsd: e.target.value }))
                }
                className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Minimum Wallet Deposit (USD)
              </label>
              <input
                type="number"
                min={10}
                max={10000}
                step="10"
                required
                value={settingsForm.minimumDepositUsd}
                onChange={(e) =>
                  setSettingsForm((prev) => ({ ...prev, minimumDepositUsd: e.target.value }))
                }
                className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Public Support Email
              </label>
              <input
                type="email"
                required
                value={settingsForm.supportEmail}
                onChange={(e) =>
                  setSettingsForm((prev) => ({ ...prev, supportEmail: e.target.value }))
                }
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Marketplace Top Announcement Banner
              </label>
              <input
                type="text"
                maxLength={300}
                value={settingsForm.marketplaceNotice}
                onChange={(e) =>
                  setSettingsForm((prev) => ({ ...prev, marketplaceNotice: e.target.value }))
                }
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
              />
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={settingsForm.requireRegistrationApproval}
              onChange={(e) =>
                setSettingsForm((prev) => ({
                  ...prev,
                  requireRegistrationApproval: e.target.checked,
                }))
              }
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            <span>
              Require mandatory administrator approval before newly registered users can access dashboard &amp; marketplace services
            </span>
          </label>

          <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
            <span className="text-xs text-slate-500">
              Last updated: {new Date(siteSettings.updatedAt).toLocaleString()}
            </span>
            <button
              type="submit"
              disabled={busyId === 'site-settings'}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg cursor-pointer"
            >
              {busyId === 'site-settings' ? 'Saving...' : 'Save Website Settings'}
            </button>
          </div>
        </form>
      )}

      <ReceiptPreviewModal
        deposit={previewDeposit}
        previewItem={previewDeposit ? null : previewGeneric}
        isAdmin
        busy={Boolean(previewDeposit && busyId === previewDeposit.id)}
        onClose={() => {
          setPreviewDeposit(null);
          setPreviewGeneric(null);
        }}
        onAdminReview={async (dep, decision, note, rejectionReason) => {
          await runAction(
            dep.id,
            () => onReviewDeposit(dep, decision, note, rejectionReason),
            decision === 'Approved'
              ? `Approved $${dep.amount.toFixed(2)} deposit and credited @${dep.username}'s wallet.`
              : `Rejected deposit ${dep.id}.`,
          );
        }}
      />

      {(() => {
        const detailUser = detailUserUid ? users.find((u) => u.uid === detailUserUid) || null : null;
        if (!detailUser) return null;
        const detailSimple = getSimpleAccountStatus(detailUser);
        const detailCanon = normalizeAccountStatus(detailUser.status);
        const detailPay = getUserLatestRegPayment(detailUser);
        const detailNote = noteDrafts[detailUser.uid] ?? detailUser.adminNotes ?? '';
        const detailReason =
          rejectReasonDrafts[detailUser.uid] ??
          detailUser.rejectionReason ??
          'Your registration was not approved. Please contact support.';
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-details-modal-title"
          >
            <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-7 my-8 space-y-5">
              <button
                type="button"
                onClick={() => {
                  setConfirmDeleteUid(null);
                  setDetailUserUid(null);
                }}
                aria-label="Close user details"
                className="absolute top-5 right-5 p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="pr-10">
                <div className="text-xs font-medium text-blue-600 dark:text-blue-400">
                  Registered User Details
                </div>
                <h3 id="user-details-modal-title" className="font-display text-xl font-bold text-slate-900 dark:text-white mt-0.5">
                  {detailUser.fullName} <span className="text-sm font-normal text-slate-500">(@{detailUser.username})</span>
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs">
                <div>
                  <div className="text-slate-500">Email Address</div>
                  <div className="mt-0.5 font-medium text-slate-900 dark:text-white break-all">{detailUser.email || detailUser.uid}</div>
                </div>
                <div>
                  <div className="text-slate-500">Phone &amp; Country</div>
                  <div className="mt-0.5 font-medium text-slate-900 dark:text-white">
                    {detailUser.phoneNumber || '—'} · {detailUser.country}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">account_status</div>
                  <div className="mt-0.5 font-mono font-semibold text-slate-900 dark:text-white">
                    {detailSimple} <span className="font-sans font-normal text-slate-500">({detailCanon})</span>
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Role &amp; Wallet Balance</div>
                  <div className="mt-0.5 font-mono font-semibold text-slate-900 dark:text-white">
                    {getDisplayRole(detailUser.role)} · ${detailUser.walletBalance.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Registration Date</div>
                  <div className="mt-0.5 text-slate-800 dark:text-slate-200">
                    {new Date(detailUser.createdAt).toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Last Login / Approved Date</div>
                  <div className="mt-0.5 text-slate-800 dark:text-slate-200">
                    {detailUser.lastLoginAt ? new Date(detailUser.lastLoginAt).toLocaleString() : 'Never'}
                    {detailUser.approvedAt ? ` · Approved ${new Date(detailUser.approvedAt).toLocaleDateString()}` : ''}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Total Deposits &amp; Purchases</div>
                  <div className="mt-0.5 font-mono text-slate-800 dark:text-slate-200">
                    ${detailUser.totalDeposits.toFixed(2)} deposited · ${detailUser.totalPurchases.toFixed(2)} spent
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">User ID</div>
                  <div className="mt-0.5 font-mono text-[11px] text-slate-600 dark:text-slate-400 break-all">
                    {detailUser.uid}
                  </div>
                </div>
              </div>

              {detailUser.role !== 'admin' && (
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block text-slate-500 mb-1">Admin Notes</label>
                    <input
                      type="text"
                      value={detailNote}
                      onChange={(e) =>
                        setNoteDrafts((prev) => ({ ...prev, [detailUser.uid]: e.target.value }))
                      }
                      placeholder="Internal note..."
                      className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-1">Rejection Reason (if rejecting)</label>
                    <input
                      type="text"
                      value={detailReason}
                      onChange={(e) =>
                        setRejectReasonDrafts((prev) => ({ ...prev, [detailUser.uid]: e.target.value }))
                      }
                      className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busyId === detailUser.uid}
                        onClick={() =>
                          runAction(
                            detailUser.uid,
                            () =>
                              onReviewRegistration({
                                user: detailUser,
                                paymentId: detailPay?.id || detailUser.registrationPaymentId,
                                decision: 'Approved',
                                adminNotes: detailNote,
                              }),
                            `Approved @${detailUser.username} and unlocked dashboard access.`,
                          )
                        }
                        className="inline-flex items-center gap-1 px-3 py-2 font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Approve User</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyId === detailUser.uid}
                        onClick={() =>
                          runAction(
                            detailUser.uid,
                            () =>
                              onReviewRegistration({
                                user: detailUser,
                                paymentId: detailPay?.id || detailUser.registrationPaymentId,
                                decision: 'Rejected',
                                rejectionReason: detailReason,
                                adminNotes: detailNote,
                              }),
                            `Rejected @${detailUser.username}.`,
                          )
                        }
                        className="inline-flex items-center gap-1 px-3 py-2 font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-lg"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Reject User</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyId === detailUser.uid}
                        onClick={() =>
                          runAction(
                            detailUser.uid,
                            () =>
                              onUpdateUser(detailUser.uid, {
                                status: detailSimple === 'suspended' ? 'Approved' : 'Suspended',
                                adminNotes: detailNote,
                              }),
                            `${detailSimple === 'suspended' ? 'Reactivated' : 'Suspended'} @${detailUser.username}.`,
                          )
                        }
                        className="inline-flex items-center gap-1 px-3 py-2 font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded-lg"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        <span>{detailSimple === 'suspended' ? 'Reactivate User' : 'Suspend User'}</span>
                      </button>
                    </div>

                    {confirmDeleteUid === detailUser.uid ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busyId === detailUser.uid}
                          onClick={() =>
                            runAction(
                              detailUser.uid,
                              async () => {
                                await onDeleteUser(detailUser);
                                setConfirmDeleteUid(null);
                                setDetailUserUid(null);
                              },
                              `Deleted user @${detailUser.username}.`,
                            )
                          }
                          className="px-3 py-2 font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg"
                        >
                          Confirm Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteUid(null)}
                          className="px-3 py-2 font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === detailUser.uid}
                        onClick={() => setConfirmDeleteUid(detailUser.uid)}
                        className="inline-flex items-center gap-1 px-3 py-2 font-medium text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete User</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </section>
  );
}
