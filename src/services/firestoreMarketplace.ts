import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  getAccountPriceUsd,
  SHIPPING_SERVICES,
  type AccountTier,
  type CryptoCurrencyCode,
  type ShippingServiceItem,
  type SupportedCountry,
} from '../data/shippingCatalog';
import type {
  DepositRecord,
  EmailNotification,
  LoginActivity,
  PriceAlert,
  ServicePriceOverride,
  ShippingOrder,
  SupportMessage,
  SupportTicket,
  UserAccount,
  WalletTransaction,
} from '../types/marketplace';

export function makeSafeId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`.slice(0, 120);
}

export function tsToIso(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

export async function ensureFirebaseUserProfile(params: {
  uid: string;
  email: string;
  fullName: string;
  username: string;
  country: string;
  phoneNumber: string;
  ipAddress: string;
  userAgent: string;
  deviceLabel: string;
}): Promise<UserAccount> {
  const userRef = doc(db, 'users', params.uid);
  const privateRef = doc(db, 'users', params.uid, 'private', 'info');

  try {
    const snap = await getDoc(userRef);
    const isAdminEmail = params.email.toLowerCase() === 'johnblessing9977@gmail.com';

    if (!snap.exists()) {
      const batch = writeBatch(db);
      const cleanName = params.fullName.trim().slice(0, 100) || 'BlueWhale Member';
      const cleanUsername =
        params.username.trim().replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 40) ||
        `bw_${params.uid.slice(0, 8)}`;

      batch.set(userRef, {
        uid: params.uid,
        fullName: cleanName,
        username: cleanUsername,
        country: params.country || 'United States',
        role: isAdminEmail ? 'admin' : 'customer',
        status: 'active',
        isVerified: isAdminEmail,
        walletBalance: 0,
        totalDeposits: 0,
        totalPurchases: 0,
        twoFactorEnabled: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(privateRef, {
        uid: params.uid,
        email: params.email.slice(0, 160),
        phoneNumber: (params.phoneNumber || '+1-555-0100').slice(0, 32),
        lastLoginIp: params.ipAddress.slice(0, 64),
        updatedAt: serverTimestamp(),
      });

      const notifId = makeSafeId('notif');
      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        userId: params.uid,
        recipientEmail: params.email.slice(0, 160),
        subject: 'Welcome to BlueWhale Markethub',
        body: `Welcome ${cleanName}! Your BlueWhale Markethub workspace is active for ${params.country || 'United States'}. You can fund your wallet via BTC, ETH, or USDT and purchase verified Personal, Business, and Corporate accounts worldwide.`,
        category: 'registration',
        read: false,
        createdAt: serverTimestamp(),
      });

      const logId = makeSafeId('log');
      batch.set(doc(db, 'loginLogs', logId), {
        id: logId,
        userId: params.uid,
        ipAddress: params.ipAddress.slice(0, 64),
        userAgent: params.userAgent.slice(0, 240),
        deviceLabel: params.deviceLabel.slice(0, 80),
        authMethod: 'Google OAuth',
        createdAt: serverTimestamp(),
      });

      await batch.commit();

      const fresh = await getDoc(userRef);
      const data = fresh.data()!;
      return {
        uid: data.uid,
        fullName: data.fullName,
        username: data.username,
        email: params.email,
        phoneNumber: params.phoneNumber || '+1-555-0100',
        country: data.country,
        role: data.role,
        status: data.status,
        isVerified: data.isVerified,
        walletBalance: Number(data.walletBalance || 0),
        totalDeposits: Number(data.totalDeposits || 0),
        totalPurchases: Number(data.totalPurchases || 0),
        twoFactorEnabled: Boolean(data.twoFactorEnabled),
        createdAt: tsToIso(data.createdAt),
        updatedAt: tsToIso(data.updatedAt),
      };
    }

    const data = snap.data();
    let email = params.email;
    let phoneNumber = params.phoneNumber || '+1-555-0100';
    try {
      const privSnap = await getDoc(privateRef);
      if (privSnap.exists()) {
        const privData = privSnap.data();
        email = privData.email || email;
        phoneNumber = privData.phoneNumber || phoneNumber;
        await updateDoc(privateRef, {
          lastLoginIp: params.ipAddress.slice(0, 64),
          updatedAt: serverTimestamp(),
        });
      }
    } catch {
      // Non-fatal
    }

    const logId = makeSafeId('log');
    await setDoc(doc(db, 'loginLogs', logId), {
      id: logId,
      userId: params.uid,
      ipAddress: params.ipAddress.slice(0, 64),
      userAgent: params.userAgent.slice(0, 240),
      deviceLabel: params.deviceLabel.slice(0, 80),
      authMethod: 'Google OAuth',
      createdAt: serverTimestamp(),
    });

    let resolvedRole = data.role;
    let resolvedVerified = Boolean(data.isVerified);
    if (isAdminEmail && (resolvedRole !== 'admin' || !resolvedVerified)) {
      await updateDoc(userRef, {
        role: 'admin',
        isVerified: true,
        updatedAt: serverTimestamp(),
      });
      resolvedRole = 'admin';
      resolvedVerified = true;
    }

    return {
      uid: data.uid,
      fullName: data.fullName,
      username: data.username,
      email,
      phoneNumber,
      country: data.country,
      role: resolvedRole,
      status: data.status,
      isVerified: resolvedVerified,
      walletBalance: Number(data.walletBalance || 0),
      totalDeposits: Number(data.totalDeposits || 0),
      totalPurchases: Number(data.totalPurchases || 0),
      twoFactorEnabled: Boolean(data.twoFactorEnabled),
      createdAt: tsToIso(data.createdAt),
      updatedAt: tsToIso(data.updatedAt),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${params.uid}`);
  }
}

export async function updateFirebaseProfile(
  uid: string,
  updates: {
    fullName: string;
    username: string;
    country: string;
    phoneNumber?: string;
    twoFactorEnabled: boolean;
  },
): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', uid), {
      fullName: updates.fullName.trim().slice(0, 100),
      username: updates.username.trim().slice(0, 40),
      country: updates.country.trim().slice(0, 64),
      twoFactorEnabled: updates.twoFactorEnabled,
      updatedAt: serverTimestamp(),
    });
    if (updates.phoneNumber) {
      batch.update(doc(db, 'users', uid, 'private', 'info'), {
        phoneNumber: updates.phoneNumber.trim().slice(0, 32),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }
}

const SAFE_RECEIPT_DATA_URL_RE =
  /^data:(image\/(jpeg|png|webp|gif)|application\/pdf);base64,[A-Za-z0-9+/=]+$/;

export async function submitFirebaseDeposit(params: {
  user: UserAccount;
  amount: number;
  currency: CryptoCurrencyCode;
  walletAddress: string;
  txHash: string;
  receiptDataUrl: string;
  receiptFileName: string;
}): Promise<string> {
  const cleanReceiptUrl = params.receiptDataUrl.trim();
  const cleanReceiptName = params.receiptFileName.trim().slice(0, 160);
  if (
    cleanReceiptUrl.length < 30 ||
    cleanReceiptUrl.length > 450000 ||
    !SAFE_RECEIPT_DATA_URL_RE.test(cleanReceiptUrl)
  ) {
    throw new Error('Please upload a valid payment receipt (JPG, PNG, WEBP, GIF, or PDF up to 320 KB).');
  }
  if (!cleanReceiptName) {
    throw new Error('Payment receipt file name is required.');
  }

  const depId = makeSafeId('dep');
  const txId = makeSafeId('tx');
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'deposits', depId), {
      id: depId,
      userId: params.user.uid,
      userEmail: params.user.email.slice(0, 160),
      username: params.user.username.slice(0, 40),
      amount: params.amount,
      currency: params.currency,
      walletAddress: params.walletAddress,
      txHash: params.txHash.trim().slice(0, 160),
      receiptDataUrl: cleanReceiptUrl,
      receiptFileName: cleanReceiptName,
      status: 'Pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'transactions', txId), {
      id: txId,
      userId: params.user.uid,
      type: 'deposit',
      amount: params.amount,
      direction: 'credit',
      referenceId: depId,
      description: `${params.currency} Deposit (${params.txHash.trim().slice(0, 12)}...)`,
      status: 'Pending',
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    return depId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `deposits/${depId}`);
  }
}

export async function purchaseFirebaseService(params: {
  user: UserAccount;
  service: ShippingServiceItem;
  accountType: AccountTier;
  country: SupportedCountry;
  recipientName: string;
  destinationCity: string;
}): Promise<{ orderId: string; trackingCode: string }> {
  const orderId = makeSafeId('ord');
  const txId = makeSafeId('tx');
  const notifId = makeSafeId('notif');
  const trackingCode = `BW-${params.service.providerId.toUpperCase().replace(/[^A-Z]/g, '')}-${params.accountType.slice(0, 3).toUpperCase()}-${Math.floor(100000 + Math.random() * 900000)}`;

  try {
    await runTransaction(db, async (transaction) => {
      const userRef = doc(db, 'users', params.user.uid);
      const pricingRef = doc(db, 'servicePricing', params.service.id);
      const [userSnap, pricingSnap] = await Promise.all([
        transaction.get(userRef),
        transaction.get(pricingRef),
      ]);
      if (!userSnap.exists()) {
        throw new Error('Account record not found.');
      }
      const userData = userSnap.data();
      if (userData.status === 'suspended') {
        throw new Error('Your account is currently suspended.');
      }
      const overrideData = pricingSnap.exists()
        ? {
            personalPrice: Number(pricingSnap.data().personalPrice),
            businessPrice: Number(pricingSnap.data().businessPrice),
            corporatePrice: Number(pricingSnap.data().corporatePrice),
          }
        : null;
      const unitPrice = getAccountPriceUsd(
        params.service,
        params.accountType,
        params.country,
        overrideData,
      );

      const currentBalance = Number(userData.walletBalance || 0);
      const currentPurchases = Number(userData.totalPurchases || 0);
      if (currentBalance < unitPrice) {
        throw new Error(
          `Insufficient wallet balance ($${currentBalance.toFixed(2)}). Required: $${unitPrice.toFixed(2)}.`,
        );
      }

      const newBalance = Number((currentBalance - unitPrice).toFixed(2));
      const newPurchases = Number((currentPurchases + unitPrice).toFixed(2));

      transaction.update(userRef, {
        walletBalance: newBalance,
        totalPurchases: newPurchases,
        updatedAt: serverTimestamp(),
      });

      transaction.set(doc(db, 'orders', orderId), {
        id: orderId,
        userId: params.user.uid,
        userEmail: params.user.email.slice(0, 160),
        username: params.user.username.slice(0, 40),
        providerId: params.service.providerId,
        providerName: params.service.providerName,
        serviceName: `${params.service.providerName} ${params.accountType} Account`,
        accountType: params.accountType,
        country: params.country,
        price: unitPrice,
        trackingCode,
        status: 'Processing',
        recipientName: (params.recipientName || params.user.fullName).slice(0, 100),
        destinationCity: (params.destinationCity || params.country).slice(0, 100),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      transaction.set(doc(db, 'transactions', txId), {
        id: txId,
        userId: params.user.uid,
        type: 'purchase',
        amount: unitPrice,
        direction: 'debit',
        referenceId: orderId,
        description: `${params.service.providerName} ${params.accountType} Account (${params.country})`,
        status: 'Completed',
        createdAt: serverTimestamp(),
      });

      transaction.set(doc(db, 'notifications', notifId), {
        id: notifId,
        userId: params.user.uid,
        recipientEmail: params.user.email.slice(0, 160),
        subject: 'Service Purchase Completed',
        body: `Your order for a verified ${params.service.providerName} ${params.accountType} Account ($${unitPrice.toFixed(2)}) in ${params.country} is confirmed. Activation Reference: ${trackingCode}.`,
        category: 'purchase',
        read: false,
        createdAt: serverTimestamp(),
      });
    });

    return { orderId, trackingCode };
  } catch (error) {
    if (error instanceof Error && (error.message.includes('Insufficient') || error.message.includes('suspended'))) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `orders/${orderId}`);
  }
}

export async function adminReviewFirebaseDeposit(params: {
  deposit: DepositRecord;
  decision: 'Approved' | 'Rejected';
  adminNote: string;
}): Promise<void> {
  try {
    const txSnap = await getDocs(
      query(collection(db, 'transactions'), where('referenceId', '==', params.deposit.id)),
    );

    await runTransaction(db, async (transaction) => {
      const depRef = doc(db, 'deposits', params.deposit.id);
      const depSnap = await transaction.get(depRef);
      if (!depSnap.exists() || depSnap.data().status !== 'Pending') {
        throw new Error('Deposit is no longer pending.');
      }

      const targetUserRef = doc(db, 'users', params.deposit.userId);
      const targetUserSnap = await transaction.get(targetUserRef);
      if (!targetUserSnap.exists()) {
        throw new Error('Target user account not found.');
      }

      transaction.update(depRef, {
        status: params.decision,
        adminNote: params.adminNote.slice(0, 300),
        updatedAt: serverTimestamp(),
      });

      txSnap.docs.forEach((txDoc) => {
        transaction.update(txDoc.ref, {
          status: params.decision === 'Approved' ? 'Completed' : 'Rejected',
        });
      });

      if (params.decision === 'Approved') {
        const userData = targetUserSnap.data();
        const approvedAmount = Number(depSnap.data().amount ?? params.deposit.amount);
        const newBal = Number((Number(userData.walletBalance || 0) + approvedAmount).toFixed(2));
        const newTotalDep = Number((Number(userData.totalDeposits || 0) + approvedAmount).toFixed(2));

        transaction.update(targetUserRef, {
          walletBalance: newBal,
          totalDeposits: newTotalDep,
          updatedAt: serverTimestamp(),
        });

        const notifId = makeSafeId('notif');
        transaction.set(doc(db, 'notifications', notifId), {
          id: notifId,
          userId: params.deposit.userId,
          recipientEmail: params.deposit.userEmail,
          subject: 'Deposit Successfully Added',
          body: `Your ${params.deposit.currency} deposit of $${approvedAmount.toFixed(2)} (Tx: ${params.deposit.txHash.slice(0, 14)}...) has been approved and added to your BlueWhale Markethub wallet.`,
          category: 'deposit',
          read: false,
          createdAt: serverTimestamp(),
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `deposits/${params.deposit.id}`);
  }
}

export async function adminUpdateFirebaseOrder(params: {
  order: ShippingOrder;
  action: 'Processing' | 'Completed' | 'Cancelled';
}): Promise<void> {
  try {
    await runTransaction(db, async (transaction) => {
      const orderRef = doc(db, 'orders', params.order.id);
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists() || !['Pending', 'Processing'].includes(orderSnap.data().status)) {
        throw new Error('Order is not in Pending or Processing state.');
      }

      if (params.action === 'Completed' || params.action === 'Processing') {
        transaction.update(orderRef, {
          status: params.action,
          updatedAt: serverTimestamp(),
        });
      } else {
        const userRef = doc(db, 'users', params.order.userId);
        const userSnap = await transaction.get(userRef);
        if (!userSnap.exists()) {
          throw new Error('Order owner not found.');
        }
        const currentBal = Number(userSnap.data().walletBalance || 0);
        transaction.update(orderRef, {
          status: 'Refunded',
          updatedAt: serverTimestamp(),
        });
        transaction.update(userRef, {
          walletBalance: Number((currentBal + params.order.price).toFixed(2)),
          updatedAt: serverTimestamp(),
        });
        const txId = makeSafeId('tx');
        transaction.set(doc(db, 'transactions', txId), {
          id: txId,
          userId: params.order.userId,
          type: 'refund',
          amount: params.order.price,
          direction: 'credit',
          referenceId: params.order.id,
          description: `Refund: ${params.order.serviceName}`,
          status: 'Refunded',
          createdAt: serverTimestamp(),
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `orders/${params.order.id}`);
  }
}

export async function adminUpdateFirebaseUser(
  uid: string,
  updates: { status?: 'active' | 'suspended'; isVerified?: boolean },
): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', uid), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function createFirebaseSupportTicket(params: {
  user: UserAccount;
  subject: string;
  category: SupportTicket['category'];
  priority: SupportTicket['priority'];
  message: string;
}): Promise<string> {
  const ticketId = makeSafeId('tkt');
  const msgId = makeSafeId('msg');
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'supportTickets', ticketId), {
      id: ticketId,
      userId: params.user.uid,
      userEmail: params.user.email.slice(0, 160),
      username: params.user.username.slice(0, 40),
      subject: params.subject.trim().slice(0, 160),
      category: params.category,
      priority: params.priority,
      status: 'Open',
      lastMessage: params.message.trim().slice(0, 600),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'supportTickets', ticketId, 'messages', msgId), {
      id: msgId,
      ticketId,
      ticketOwnerId: params.user.uid,
      senderId: params.user.uid,
      senderRole: 'customer',
      senderName: params.user.fullName.slice(0, 100),
      body: params.message.trim().slice(0, 1200),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    return ticketId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `supportTickets/${ticketId}`);
  }
}

export async function sendFirebaseSupportMessage(params: {
  ticket: SupportTicket;
  sender: UserAccount;
  body: string;
}): Promise<void> {
  const msgId = makeSafeId('msg');
  try {
    const batch = writeBatch(db);
    const isAdminReply = params.sender.role === 'admin' && params.ticket.userId !== params.sender.uid;
    batch.set(doc(db, 'supportTickets', params.ticket.id, 'messages', msgId), {
      id: msgId,
      ticketId: params.ticket.id,
      ticketOwnerId: params.ticket.userId,
      senderId: params.sender.uid,
      senderRole: isAdminReply ? 'admin' : 'customer',
      senderName: params.sender.fullName.slice(0, 100),
      body: params.body.trim().slice(0, 1200),
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, 'supportTickets', params.ticket.id), {
      status: isAdminReply ? 'Replied' : 'Open',
      lastMessage: params.body.trim().slice(0, 600),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `supportTickets/${params.ticket.id}/messages/${msgId}`);
  }
}

export async function adminUpdateFirebaseTicketStatus(
  ticketId: string,
  status: SupportTicket['status'],
): Promise<void> {
  try {
    await updateDoc(doc(db, 'supportTickets', ticketId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `supportTickets/${ticketId}`);
  }
}

export async function markFirebaseNotificationRead(notifId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'notifications', notifId), { read: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `notifications/${notifId}`);
  }
}

export async function logFirebaseResetEmailNotification(user: UserAccount): Promise<void> {
  const notifId = makeSafeId('notif');
  try {
    await setDoc(doc(db, 'notifications', notifId), {
      id: notifId,
      userId: user.uid,
      recipientEmail: user.email,
      subject: 'Reset Your Password',
      body: `Security confirmation for ${user.email}: your account uses Google Sign-In security or an encrypted credential token. Manage your authentication security settings inside the Dashboard Security tab.`,
      category: 'security',
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `notifications/${notifId}`);
  }
}

export function mapFirestoreDeposit(id: string, data: Record<string, unknown>): DepositRecord {
  return {
    id,
    userId: String(data.userId || ''),
    userEmail: String(data.userEmail || ''),
    username: String(data.username || ''),
    amount: Number(data.amount || 0),
    currency: (data.currency as CryptoCurrencyCode) || 'BTC',
    walletAddress: String(data.walletAddress || ''),
    txHash: String(data.txHash || ''),
    receiptDataUrl: data.receiptDataUrl ? String(data.receiptDataUrl) : undefined,
    receiptFileName: data.receiptFileName ? String(data.receiptFileName) : undefined,
    status: (data.status as DepositRecord['status']) || 'Pending',
    adminNote: data.adminNote ? String(data.adminNote) : undefined,
    createdAt: tsToIso(data.createdAt),
    updatedAt: tsToIso(data.updatedAt),
  };
}

export function mapFirestoreOrder(id: string, data: Record<string, unknown>): ShippingOrder {
  return {
    id,
    userId: String(data.userId || ''),
    userEmail: String(data.userEmail || ''),
    username: String(data.username || ''),
    providerId: String(data.providerId || ''),
    providerName: String(data.providerName || ''),
    serviceName: String(data.serviceName || ''),
    accountType: (data.accountType as ShippingOrder['accountType']) || 'Personal',
    country: String(data.country || ''),
    price: Number(data.price || 0),
    trackingCode: String(data.trackingCode || ''),
    status: (data.status as ShippingOrder['status']) || 'Processing',
    recipientName: data.recipientName ? String(data.recipientName) : undefined,
    destinationCity: data.destinationCity ? String(data.destinationCity) : undefined,
    createdAt: tsToIso(data.createdAt),
    updatedAt: tsToIso(data.updatedAt),
  };
}

export function mapFirestoreTransaction(id: string, data: Record<string, unknown>): WalletTransaction {
  return {
    id,
    userId: String(data.userId || ''),
    type: (data.type as WalletTransaction['type']) || 'purchase',
    amount: Number(data.amount || 0),
    direction: (data.direction as WalletTransaction['direction']) || 'debit',
    referenceId: String(data.referenceId || ''),
    description: String(data.description || ''),
    status: (data.status as WalletTransaction['status']) || 'Completed',
    createdAt: tsToIso(data.createdAt),
  };
}

export function mapFirestoreNotification(id: string, data: Record<string, unknown>): EmailNotification {
  return {
    id,
    userId: String(data.userId || ''),
    recipientEmail: String(data.recipientEmail || ''),
    subject: data.subject as EmailNotification['subject'],
    body: String(data.body || ''),
    category: (data.category as EmailNotification['category']) || 'registration',
    read: Boolean(data.read),
    createdAt: tsToIso(data.createdAt),
  };
}

export function mapFirestoreLoginLog(id: string, data: Record<string, unknown>): LoginActivity {
  return {
    id,
    userId: String(data.userId || ''),
    ipAddress: String(data.ipAddress || ''),
    userAgent: String(data.userAgent || ''),
    deviceLabel: String(data.deviceLabel || ''),
    authMethod: String(data.authMethod || ''),
    createdAt: tsToIso(data.createdAt),
  };
}

export function mapFirestoreSupportTicket(id: string, data: Record<string, unknown>): SupportTicket {
  return {
    id,
    userId: String(data.userId || ''),
    userEmail: String(data.userEmail || ''),
    username: String(data.username || ''),
    subject: String(data.subject || ''),
    category: (data.category as SupportTicket['category']) || 'Account Provisioning',
    priority: (data.priority as SupportTicket['priority']) || 'Normal',
    status: (data.status as SupportTicket['status']) || 'Open',
    lastMessage: String(data.lastMessage || ''),
    createdAt: tsToIso(data.createdAt),
    updatedAt: tsToIso(data.updatedAt),
  };
}

export function mapFirestoreSupportMessage(id: string, data: Record<string, unknown>): SupportMessage {
  return {
    id,
    ticketId: String(data.ticketId || ''),
    ticketOwnerId: String(data.ticketOwnerId || ''),
    senderId: String(data.senderId || ''),
    senderRole: (data.senderRole as SupportMessage['senderRole']) || 'customer',
    senderName: String(data.senderName || ''),
    body: String(data.body || ''),
    createdAt: tsToIso(data.createdAt),
  };
}

export async function createOrUpdateFirebasePriceAlert(params: {
  user: UserAccount;
  service: ShippingServiceItem;
  accountType: AccountTier;
  country: SupportedCountry;
  targetPrice: number;
  currentPrice: number;
  existingAlertId?: string;
}): Promise<string> {
  const cleanTarget = Number(params.targetPrice.toFixed(2));
  if (Number.isNaN(cleanTarget) || cleanTarget <= 100 || cleanTarget >= params.currentPrice) {
    throw new Error(
      `Target price must be above $100.00 and strictly below the current price ($${params.currentPrice.toFixed(2)}).`,
    );
  }

  const alertId = params.existingAlertId || makeSafeId('pa');
  try {
    if (params.existingAlertId) {
      await updateDoc(doc(db, 'priceAlerts', alertId), {
        accountType: params.accountType,
        country: params.country,
        targetPrice: cleanTarget,
        initialPrice: Number(params.currentPrice.toFixed(2)),
        status: 'Active',
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'priceAlerts', alertId), {
        id: alertId,
        userId: params.user.uid,
        userEmail: params.user.email.slice(0, 160),
        username: params.user.username.slice(0, 40),
        serviceId: params.service.id,
        providerName: params.service.providerName,
        serviceName: params.service.serviceName,
        accountType: params.accountType,
        country: params.country,
        targetPrice: cleanTarget,
        initialPrice: Number(params.currentPrice.toFixed(2)),
        status: 'Active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return alertId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `priceAlerts/${alertId}`);
  }
}

export async function cancelFirebasePriceAlert(alertId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'priceAlerts', alertId), {
      status: 'Cancelled',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `priceAlerts/${alertId}`);
  }
}

export async function deleteFirebasePriceAlert(alertId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'priceAlerts', alertId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `priceAlerts/${alertId}`);
  }
}

export async function triggerFirebasePriceAlert(params: {
  alert: PriceAlert;
  livePrice: number;
}): Promise<void> {
  if (params.alert.status !== 'Active' || params.livePrice >= params.alert.targetPrice) {
    return;
  }
  const notifId = makeSafeId('notif');
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'priceAlerts', params.alert.id), {
      status: 'Triggered',
      triggeredPrice: Number(params.livePrice.toFixed(2)),
      triggeredAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'notifications', notifId), {
      id: notifId,
      userId: params.alert.userId,
      recipientEmail: params.alert.userEmail.slice(0, 160),
      subject: 'Price Drop Alert Triggered',
      body: `Price Drop Alert: ${params.alert.providerName} ${params.alert.accountType} Account (${params.alert.country}) dropped to $${params.livePrice.toFixed(2)}, below your $${params.alert.targetPrice.toFixed(2)} threshold.`,
      category: 'price_alert',
      read: false,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `priceAlerts/${params.alert.id}`);
  }
}

export async function adminUpdateFirebaseServicePrice(params: {
  adminUid: string;
  serviceId: string;
  personalPrice: number;
  businessPrice: number;
  corporatePrice: number;
  resetToDefault?: boolean;
}): Promise<{ triggeredCount: number }> {
  const service = SHIPPING_SERVICES.find((s) => s.id === params.serviceId);
  if (!service) {
    throw new Error('Service not found.');
  }

  const pricingRef = doc(db, 'servicePricing', params.serviceId);
  try {
    let overrideForCalc: { personalPrice: number; businessPrice: number; corporatePrice: number } | null = null;
    if (params.resetToDefault) {
      await deleteDoc(pricingRef);
    } else {
      const cleanPersonal = Math.max(100, Number(params.personalPrice.toFixed(2)));
      const cleanBusiness = Math.max(100, Number(params.businessPrice.toFixed(2)));
      const cleanCorporate = Math.max(100, Number(params.corporatePrice.toFixed(2)));
      overrideForCalc = {
        personalPrice: cleanPersonal,
        businessPrice: cleanBusiness,
        corporatePrice: cleanCorporate,
      };
      await setDoc(pricingRef, {
        serviceId: params.serviceId,
        personalPrice: cleanPersonal,
        businessPrice: cleanBusiness,
        corporatePrice: cleanCorporate,
        isPublic: true,
        updatedBy: params.adminUid,
        updatedAt: serverTimestamp(),
      });
    }

    const alertsSnap = await getDocs(
      query(
        collection(db, 'priceAlerts'),
        where('serviceId', '==', params.serviceId),
        where('status', '==', 'Active'),
      ),
    );

    const batch = writeBatch(db);
    let triggeredCount = 0;
    alertsSnap.docs.forEach((alertDoc) => {
      const alertData = mapFirestorePriceAlert(
        alertDoc.id,
        alertDoc.data() as Record<string, unknown>,
      );
      const livePrice = getAccountPriceUsd(
        service,
        alertData.accountType,
        alertData.country,
        overrideForCalc,
      );
      if (livePrice < alertData.targetPrice) {
        triggeredCount += 1;
        batch.update(alertDoc.ref, {
          status: 'Triggered',
          triggeredPrice: livePrice,
          triggeredAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        const notifId = makeSafeId('notif');
        batch.set(doc(db, 'notifications', notifId), {
          id: notifId,
          userId: alertData.userId,
          recipientEmail: alertData.userEmail.slice(0, 160),
          subject: 'Price Drop Alert Triggered',
          body: `Price Drop Alert: ${alertData.providerName} ${alertData.accountType} Account (${alertData.country}) dropped to $${livePrice.toFixed(2)}, below your $${alertData.targetPrice.toFixed(2)} threshold.`,
          category: 'price_alert',
          read: false,
          createdAt: serverTimestamp(),
        });
      }
    });

    if (triggeredCount > 0) {
      await batch.commit();
    }

    return { triggeredCount };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `servicePricing/${params.serviceId}`);
  }
}

export function mapFirestoreServicePriceOverride(
  id: string,
  data: Record<string, unknown>,
): ServicePriceOverride {
  return {
    serviceId: String(data.serviceId || id),
    personalPrice: Number(data.personalPrice || 100),
    businessPrice: Number(data.businessPrice || 100),
    corporatePrice: Number(data.corporatePrice || 100),
    isPublic: Boolean(data.isPublic ?? true),
    updatedBy: data.updatedBy ? String(data.updatedBy) : undefined,
    updatedAt: tsToIso(data.updatedAt),
  };
}

export function mapFirestorePriceAlert(
  id: string,
  data: Record<string, unknown>,
): PriceAlert {
  return {
    id,
    userId: String(data.userId || ''),
    userEmail: String(data.userEmail || ''),
    username: String(data.username || ''),
    serviceId: String(data.serviceId || ''),
    providerName: String(data.providerName || ''),
    serviceName: String(data.serviceName || ''),
    accountType: (data.accountType as AccountTier) || 'Personal',
    country: (data.country as SupportedCountry) || 'United States',
    targetPrice: Number(data.targetPrice || 100),
    initialPrice: Number(data.initialPrice || 100),
    triggeredPrice:
      typeof data.triggeredPrice === 'number' ? Number(data.triggeredPrice) : undefined,
    status: (data.status as PriceAlert['status']) || 'Active',
    createdAt: tsToIso(data.createdAt),
    updatedAt: tsToIso(data.updatedAt),
    triggeredAt: data.triggeredAt ? tsToIso(data.triggeredAt) : undefined,
  };
}
