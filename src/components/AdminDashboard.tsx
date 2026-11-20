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
} from 'lucide-react';
import {
  SHIPPING_SERVICES,
  type BaseTierPriceOverride,
} from '../data/shippingCatalog';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { mapFirestoreSupportMessage } from '../services/firestoreMarketplace';
import { ReceiptPreviewModal } from './ReceiptPreviewModal';
import type {
  AuthMode,
  DepositRecord,
  LoginActivity,
  PriceAlert,
  ShippingOrder,
  SupportMessage,
  SupportTicket,
  UserAccount,
} from '../types/marketplace';

type AdminTab = 'analytics' | 'deposits' | 'orders' | 'pricing' | 'users' | 'support';

interface AdminDashboardProps {
  authMode: AuthMode;
  users: UserAccount[];
  deposits: DepositRecord[];
  orders: ShippingOrder[];
  supportTickets: SupportTicket[];
  supportMessages: SupportMessage[];
  loginLogs: LoginActivity[];
  priceOverrides: Record<string, BaseTierPriceOverride>;
  priceAlerts: PriceAlert[];
  onReviewDeposit: (deposit: DepositRecord, decision: 'Approved' | 'Rejected', note: string) => Promise<void>;
  onUpdateOrderStatus: (order: ShippingOrder, action: 'Processing' | 'Completed' | 'Cancelled') => Promise<void>;
  onUpdateUser: (uid: string, updates: { status?: 'active' | 'suspended'; isVerified?: boolean }) => Promise<void>;
  onReplyTicket: (ticket: SupportTicket, body: string) => Promise<void>;
  onUpdateTicketStatus: (ticketId: string, status: SupportTicket['status']) => Promise<void>;
  onUpdateServicePrice: (payload: {
    serviceId: string;
    personalPrice: number;
    businessPrice: number;
    corporatePrice: number;
    resetToDefault?: boolean;
  }) => Promise<{ triggeredCount: number }>;
}

export function AdminDashboard({
  authMode,
  users,
  deposits,
  orders,
  supportTickets,
  supportMessages,
  loginLogs,
  priceOverrides,
  priceAlerts,
  onReviewDeposit,
  onUpdateOrderStatus,
  onUpdateUser,
  onReplyTicket,
  onUpdateTicketStatus,
  onUpdateServicePrice,
}: AdminDashboardProps) {
  const [tab, setTab] = useState<AdminTab>('analytics');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(supportTickets[0]?.id || null);
  const [ticketMsgs, setTicketMsgs] = useState<SupportMessage[]>([]);
  const [replyText, setReplyText] = useState('');
  const [previewDeposit, setPreviewDeposit] = useState<DepositRecord | null>(null);
  const [priceDrafts, setPriceDrafts] = useState<
    Record<string, { personal: string; business: string; corporate: string }>
  >({});

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
  const totalDepositVolume = approvedDeposits.reduce((sum, d) => sum + d.amount, 0);
  const totalRevenue = orders
    .filter((o) => o.status === 'Pending' || o.status === 'Processing' || o.status === 'Completed')
    .reduce((sum, o) => sum + o.price, 0);

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
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Operations, Compliance & Live Support Control
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
                id: 'deposits',
                label: `Deposits (${pendingDeposits.length})`,
                icon: <Coins className="w-3.5 h-3.5" />,
              },
              { id: 'orders', label: `Orders (${orders.length})`, icon: <Package className="w-3.5 h-3.5" /> },
              {
                id: 'pricing',
                label: `Pricing & Alerts (${priceAlerts.filter((a) => a.status === 'Active').length})`,
                icon: <Tag className="w-3.5 h-3.5" />,
              },
              { id: 'users', label: `Users (${users.length})`, icon: <Users className="w-3.5 h-3.5" /> },
              {
                id: 'support',
                label: `Support (${openTickets.length})`,
                icon: <MessageSquare className="w-3.5 h-3.5" />,
              },
            ] as { id: AdminTab; label: string; icon: React.ReactNode }[]
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
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
                {pendingDeposits.length + openTickets.length}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {pendingDeposits.length} deposits · {openTickets.length} open tickets
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
                {pendingDeposits.length === 0 && loginLogs.length === 0 && (
                  <p className="text-slate-500">All queues clear. Activity logs update on user events.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'deposits' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Deposit Management Queue
            </h2>
          </div>
          {deposits.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No crypto deposits submitted yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Member</th>
                    <th className="px-5 py-3 font-medium">Network</th>
                    <th className="px-5 py-3 font-medium">Transaction Hash</th>
                    <th className="px-5 py-3 font-medium">Receipt</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium text-right">Amount</th>
                    <th className="px-5 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {deposits.map((dep) => (
                    <tr key={dep.id}>
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-slate-900 dark:text-white">@{dep.username}</div>
                        <div className="text-xs text-slate-500">{dep.userEmail}</div>
                      </td>
                      <td className="px-5 py-3.5 text-xs font-medium">{dep.currency.replace('_', ' ')}</td>
                      <td className="px-5 py-3.5 font-mono text-xs max-w-[200px] truncate">{dep.txHash}</td>
                      <td className="px-5 py-3.5 text-xs">
                        {dep.receiptDataUrl ? (
                          <button
                            type="button"
                            onClick={() => setPreviewDeposit(dep)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded-md"
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
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Approved
                          </span>
                        )}
                        {dep.status === 'Rejected' && (
                          <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400">
                            <X className="w-3.5 h-3.5" /> Rejected
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 font-mono tabular-nums text-right font-semibold">
                        ${dep.amount.toFixed(2)}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {dep.status === 'Pending' ? (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              disabled={busyId === dep.id}
                              onClick={() =>
                                runAction(
                                  dep.id,
                                  () => onReviewDeposit(dep, 'Approved', 'Receipt & payment confirmed manually'),
                                  `Approved $${dep.amount.toFixed(2)} deposit and credited @${dep.username}'s wallet.`,
                                )
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md"
                            >
                              <Check className="w-3.5 h-3.5" /> Approve
                            </button>
                            <button
                              type="button"
                              disabled={busyId === dep.id}
                              onClick={() =>
                                runAction(
                                  dep.id,
                                  () => onReviewDeposit(dep, 'Rejected', 'Receipt or transaction hash not confirmed'),
                                  `Rejected deposit ${dep.id}.`,
                                )
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-md"
                            >
                              <X className="w-3.5 h-3.5" /> Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">Reviewed</span>
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
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              User Management
            </h2>
          </div>
          {users.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No users registered yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">User</th>
                    <th className="px-5 py-3 font-medium">Country</th>
                    <th className="px-5 py-3 font-medium">Verification</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium text-right">Balance</th>
                    <th className="px-5 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {users.map((u) => (
                    <tr key={u.uid}>
                      <td className="px-5 py-3.5">
                        <div className="font-medium">
                          {u.fullName} <span className="text-xs text-slate-500">@{u.username}</span>
                        </div>
                        <div className="text-xs text-slate-500">{u.email || u.uid}</div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-600 dark:text-slate-300">{u.country}</td>
                      <td className="px-5 py-3.5 text-xs font-medium">
                        {u.isVerified ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                            <ShieldCheck className="w-3.5 h-3.5" /> Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                            <ShieldAlert className="w-3.5 h-3.5" /> Unverified
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-xs font-medium capitalize">
                        <span className={u.status === 'active' ? 'text-slate-900 dark:text-white' : 'text-rose-600'}>
                          {u.status === 'suspended' ? 'Banned / Suspended' : 'Active'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-mono tabular-nums text-right">
                        ${u.walletBalance.toFixed(2)}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busyId === u.uid}
                            onClick={() =>
                              runAction(
                                u.uid,
                                () => onUpdateUser(u.uid, { isVerified: !u.isVerified }),
                                `${u.isVerified ? 'Unverified' : 'Verified'} @${u.username}.`,
                              )
                            }
                            className="px-2.5 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 rounded-md"
                          >
                            {u.isVerified ? 'Revoke Verify' : 'Verify User'}
                          </button>
                          {u.role !== 'admin' && (
                            <button
                              type="button"
                              disabled={busyId === u.uid}
                              onClick={() =>
                                runAction(
                                  u.uid,
                                  () =>
                                    onUpdateUser(u.uid, {
                                      status: u.status === 'active' ? 'suspended' : 'active',
                                    }),
                                  `${u.status === 'active' ? 'Banned' : 'Unbanned'} @${u.username}.`,
                                )
                              }
                              className="px-2.5 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-md"
                            >
                              {u.status === 'active' ? 'Ban User' : 'Unban User'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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

      <ReceiptPreviewModal
        deposit={previewDeposit}
        isAdmin
        busy={Boolean(previewDeposit && busyId === previewDeposit.id)}
        onClose={() => setPreviewDeposit(null)}
        onAdminReview={async (dep, decision, note) => {
          await runAction(
            dep.id,
            () => onReviewDeposit(dep, decision, note),
            decision === 'Approved'
              ? `Approved $${dep.amount.toFixed(2)} deposit and credited @${dep.username}'s wallet.`
              : `Rejected deposit ${dep.id}.`,
          );
        }}
      />
    </section>
  );
}
