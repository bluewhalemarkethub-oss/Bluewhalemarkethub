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
import {
  ADMIN_EMAIL,
  getActivationBlockedMessage,
  getPaymentStatus,
  getSimpleAccountStatus,
  hasDashboardAccess,
  REGISTRATION_FEE_USD,
  SUPPORT_EMAIL,
  type AccountStatus,
  type AdminLogEntry,
  type DepositRecord,
  type EmailNotification,
  type LoginActivity,
  type PaymentStatus,
  type PriceAlert,
  type RegistrationPayment,
  type ServicePriceOverride,
  type ShippingOrder,
  type SimpleAccountStatus,
  type SupportMessage,
  type SupportTicket,
  type UserAccount,
  type WalletTransaction,
  type WebsiteSettings,
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

export function mapFirestoreUserAccount(
  data: Record<string, unknown>,
  privateData?: { email?: string; phoneNumber?: string } | null,
): UserAccount {
  const email = String(privateData?.email || data.email || '');
  const role = (data.role as UserAccount['role']) || 'customer';
  const status = (data.status as AccountStatus) || 'Pending Payment';
  const rawAccountStatus = data.account_status as SimpleAccountStatus | undefined;
  const rawPaymentStatus = data.payment_status as PaymentStatus | undefined;
  const registrationPaymentStatus =
    data.registrationPaymentStatus as UserAccount['registrationPaymentStatus'];
  const account_status = getSimpleAccountStatus({
    role,
    email,
    status,
    account_status: rawAccountStatus,
  });
  const payment_status = getPaymentStatus({
    role,
    email,
    status,
    account_status: rawAccountStatus,
    payment_status: rawPaymentStatus,
    registrationPaymentStatus,
  });
  const dashboard_access =
    typeof data.dashboard_access === 'boolean'
      ? data.dashboard_access && account_status === 'approved' && payment_status === 'verified'
      : hasDashboardAccess({
          role,
          email,
          status,
          account_status,
          payment_status,
          registrationPaymentStatus,
        });
  return {
    uid: String(data.uid || ''),
    fullName: String(data.fullName || ''),
    username: String(data.username || ''),
    email,
    phoneNumber: String(privateData?.phoneNumber || data.phoneNumber || ''),
    country: String(data.country || 'United States'),
    role,
    status,
    account_status,
    payment_status,
    dashboard_access,
    isVerified: Boolean(data.isVerified),
    walletBalance: Number(data.walletBalance || 0),
    totalDeposits: Number(data.totalDeposits || 0),
    totalPurchases: Number(data.totalPurchases || 0),
    twoFactorEnabled: Boolean(data.twoFactorEnabled),
    registrationPaymentStatus,
    registrationPaymentId: data.registrationPaymentId ? String(data.registrationPaymentId) : undefined,
    registrationTxId: data.registrationTxId ? String(data.registrationTxId) : undefined,
    registrationCrypto: data.registrationCrypto as UserAccount['registrationCrypto'],
    registrationFeeAmount:
      typeof data.registrationFeeAmount === 'number' ? Number(data.registrationFeeAmount) : undefined,
    registrationReceiptDataUrl: data.registrationReceiptDataUrl
      ? String(data.registrationReceiptDataUrl)
      : undefined,
    registrationReceiptFileName: data.registrationReceiptFileName
      ? String(data.registrationReceiptFileName)
      : undefined,
    registrationSubmittedAt: data.registrationSubmittedAt
      ? tsToIso(data.registrationSubmittedAt)
      : undefined,
    paymentVerifiedAt: data.paymentVerifiedAt ? tsToIso(data.paymentVerifiedAt) : undefined,
    approvedAt: data.approvedAt ? tsToIso(data.approvedAt) : undefined,
    rejectedAt: data.rejectedAt ? tsToIso(data.rejectedAt) : undefined,
    rejectionReason: data.rejectionReason ? String(data.rejectionReason) : undefined,
    adminNotes: data.adminNotes ? String(data.adminNotes) : undefined,
    lastLoginAt: data.lastLoginAt ? tsToIso(data.lastLoginAt) : undefined,
    createdAt: tsToIso(data.createdAt),
    updatedAt: tsToIso(data.updatedAt),
  };
}

export async function fetchFirebaseUserPrivateInfo(
  uid: string,
): Promise<{ email: string; phoneNumber: string } | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'private', 'info'));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      email: String(d.email || ''),
      phoneNumber: String(d.phoneNumber || ''),
    };
  } catch {
    return null;
  }
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
    const isAdminEmail = params.email.trim().toLowerCase() === ADMIN_EMAIL;

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
        status: isAdminEmail ? 'Approved' : 'Pending Payment',
        account_status: isAdminEmail ? 'approved' : 'pending',
        payment_status: isAdminEmail ? 'verified' : 'unpaid',
        dashboard_access: isAdminEmail,
        isVerified: isAdminEmail,
        walletBalance: 0,
        totalDeposits: 0,
        totalPurchases: 0,
        twoFactorEnabled: false,
        registrationPaymentStatus: isAdminEmail ? 'Approved' : 'Unpaid',
        lastLoginAt: serverTimestamp(),
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
        body: isAdminEmail
          ? `Welcome ${cleanName}! Your administrator workspace is active.`
          : `Welcome ${cleanName}! Your account has been submitted for review and approval by our administration team. You will be able to log in once your account has been approved.`,
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
      return mapFirestoreUserAccount(fresh.data()!, {
        email: params.email,
        phoneNumber: params.phoneNumber || '+1-555-0100',
      });
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

    const userUpdatePayload: Record<string, unknown> = {
      lastLoginAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (
      isAdminEmail &&
      (data.role !== 'admin' ||
        !data.isVerified ||
        data.status !== 'Approved' ||
        data.account_status !== 'approved' ||
        data.payment_status !== 'verified' ||
        data.dashboard_access !== true)
    ) {
      userUpdatePayload.role = 'admin';
      userUpdatePayload.status = 'Approved';
      userUpdatePayload.account_status = 'approved';
      userUpdatePayload.payment_status = 'verified';
      userUpdatePayload.dashboard_access = true;
      userUpdatePayload.isVerified = true;
      data.role = 'admin';
      data.status = 'Approved';
      data.account_status = 'approved';
      data.payment_status = 'verified';
      data.dashboard_access = true;
      data.isVerified = true;
    }
    await updateDoc(userRef, userUpdatePayload);
    data.lastLoginAt = new Date().toISOString();

    return mapFirestoreUserAccount(data, { email, phoneNumber });
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
const SAFE_RECEIPT_UPLOAD_URL_RE =
  /^\/api\/uploads\/receipts\/[a-zA-Z0-9_\-]+\.(png|jpg|jpeg|webp|gif|pdf)$/;

export async function submitFirebaseDeposit(params: {
  user: UserAccount;
  amount: number;
  currency: CryptoCurrencyCode;
  walletAddress: string;
  txHash: string;
  receiptUrl?: string;
  receiptDataUrl?: string;
  receiptFileName: string;
}): Promise<string> {
  const cleanStoredUrl = (params.receiptUrl || '').trim();
  const cleanDataUrl = (params.receiptDataUrl || '').trim();
  const cleanReceiptName = params.receiptFileName.trim().slice(0, 160);

  const hasValidStoredUrl = SAFE_RECEIPT_UPLOAD_URL_RE.test(cleanStoredUrl);
  const hasValidDataUrl =
    cleanDataUrl.length >= 30 &&
    cleanDataUrl.length <= 450000 &&
    SAFE_RECEIPT_DATA_URL_RE.test(cleanDataUrl);

  if (!hasValidStoredUrl && !hasValidDataUrl) {
    throw new Error('Please upload a valid payment receipt (JPG, PNG, WEBP, GIF, or PDF).');
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
      userName: (params.user.fullName || params.user.username).slice(0, 100),
      amount: Number(params.amount.toFixed(2)),
      currency: params.currency,
      walletAddress: params.walletAddress,
      txHash: params.txHash.trim().slice(0, 160),
      ...(hasValidStoredUrl ? { receiptUrl: cleanStoredUrl } : {}),
      ...(hasValidDataUrl ? { receiptDataUrl: cleanDataUrl } : {}),
      receiptFileName: cleanReceiptName,
      status: 'Pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'transactions', txId), {
      id: txId,
      userId: params.user.uid,
      type: 'deposit',
      amount: Number(params.amount.toFixed(2)),
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
      const mapped = mapFirestoreUserAccount(userData, { email: params.user.email });
      if (!hasDashboardAccess(mapped)) {
        throw new Error(
          getActivationBlockedMessage(mapped) ||
            'Your registration payment is currently awaiting administrator approval.',
        );
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
  rejectionReason?: string;
  adminUser?: { uid: string; email: string };
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

      const reasonText = (
        params.rejectionReason ||
        params.adminNote ||
        'Payment receipt or transaction hash could not be verified.'
      )
        .trim()
        .slice(0, 400);

      transaction.update(depRef, {
        status: params.decision,
        adminNote: (params.decision === 'Rejected' ? params.adminNote || reasonText : params.adminNote).slice(0, 300),
        ...(params.adminUser?.email ? { reviewedBy: params.adminUser.email.slice(0, 160) } : {}),
        ...(params.decision === 'Approved'
          ? { approvedAt: serverTimestamp() }
          : { rejectedAt: serverTimestamp(), rejectionReason: reasonText }),
        updatedAt: serverTimestamp(),
      });

      txSnap.docs.forEach((txDoc) => {
        transaction.update(txDoc.ref, {
          status: params.decision === 'Approved' ? 'Completed' : 'Rejected',
        });
      });

      const approvedAmount = Number(depSnap.data().amount ?? params.deposit.amount);
      if (params.decision === 'Approved') {
        const userData = targetUserSnap.data();
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
          body: `Your deposit has been approved and funds have been credited to your wallet. ($${approvedAmount.toFixed(2)} ${params.deposit.currency.replace('_', ' ')}, TXID: ${params.deposit.txHash.slice(0, 14)}...)`,
          category: 'deposit',
          read: false,
          createdAt: serverTimestamp(),
        });
      } else {
        const notifId = makeSafeId('notif');
        transaction.set(doc(db, 'notifications', notifId), {
          id: notifId,
          userId: params.deposit.userId,
          recipientEmail: params.deposit.userEmail,
          subject: 'Deposit Rejected',
          body: `Your deposit has been rejected. Please review the reason provided by support. Reason: ${reasonText}`,
          category: 'deposit',
          read: false,
          createdAt: serverTimestamp(),
        });
      }

      if (params.adminUser) {
        const adminLogId = makeSafeId('alog');
        transaction.set(doc(db, 'adminLogs', adminLogId), {
          id: adminLogId,
          adminUid: params.adminUser.uid,
          adminEmail: params.adminUser.email.slice(0, 160),
          action: params.decision === 'Approved' ? 'DEPOSIT_APPROVED' : 'DEPOSIT_REJECTED',
          targetUserId: params.deposit.userId,
          targetEmail: params.deposit.userEmail.slice(0, 160),
          targetUsername: params.deposit.username.slice(0, 64),
          previousStatus: 'Pending',
          newStatus: params.decision,
          details: `${params.decision} $${approvedAmount.toFixed(2)} ${params.deposit.currency} deposit (${params.deposit.txHash.slice(0, 16)}...)${params.decision === 'Rejected' ? ` — Reason: ${reasonText}` : ''}`,
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
  adminUser?: { uid: string; email: string };
}): Promise<void> {
  try {
    await runTransaction(db, async (transaction) => {
      const orderRef = doc(db, 'orders', params.order.id);
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists() || !['Pending', 'Processing'].includes(orderSnap.data().status)) {
        throw new Error('Order is not in Pending or Processing state.');
      }
      const prevStatus = String(orderSnap.data().status);

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

      if (params.adminUser) {
        const adminLogId = makeSafeId('alog');
        transaction.set(doc(db, 'adminLogs', adminLogId), {
          id: adminLogId,
          adminUid: params.adminUser.uid,
          adminEmail: params.adminUser.email.slice(0, 160),
          action: params.action === 'Cancelled' ? 'ORDER_REFUNDED' : 'ORDER_STATUS_UPDATED',
          targetUserId: params.order.userId,
          targetEmail: params.order.userEmail.slice(0, 160),
          targetUsername: params.order.username.slice(0, 64),
          previousStatus: prevStatus,
          newStatus: params.action === 'Cancelled' ? 'Refunded' : params.action,
          details: `Order ${params.order.trackingCode} (${params.order.serviceName}) set to ${params.action === 'Cancelled' ? 'Refunded' : params.action}`,
          createdAt: serverTimestamp(),
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `orders/${params.order.id}`);
  }
}

export async function submitFirebaseRegistrationPayment(params: {
  user: UserAccount;
  amount: number;
  currency: CryptoCurrencyCode;
  walletAddress: string;
  txId: string;
  receiptDataUrl: string;
  receiptFileName: string;
}): Promise<string> {
  const cleanAmount = Number(params.amount);
  const cleanTxId = params.txId.trim().slice(0, 160);
  const cleanReceiptUrl = params.receiptDataUrl.trim();
  const cleanReceiptName = params.receiptFileName.trim().slice(0, 160);

  if (Number.isNaN(cleanAmount) || cleanAmount < REGISTRATION_FEE_USD) {
    throw new Error(`Minimum registration payment is $${REGISTRATION_FEE_USD.toFixed(2)} USD.`);
  }
  if (cleanTxId.length < 8) {
    throw new Error('Please enter a valid Transaction ID (TXID).');
  }
  if (
    cleanReceiptUrl.length < 30 ||
    cleanReceiptUrl.length > 450000 ||
    !SAFE_RECEIPT_DATA_URL_RE.test(cleanReceiptUrl)
  ) {
    throw new Error('Please upload a valid payment screenshot (JPG, PNG, WEBP, GIF, or PDF up to 320 KB).');
  }
  if (!cleanReceiptName) {
    throw new Error('Payment screenshot filename is required.');
  }

  const paymentId = makeSafeId('regpay');
  const notifId = makeSafeId('notif');
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'registrationPayments', paymentId), {
      id: paymentId,
      userId: params.user.uid,
      userEmail: params.user.email.slice(0, 160),
      username: params.user.username.slice(0, 40),
      fullName: params.user.fullName.slice(0, 100),
      amount: cleanAmount,
      currency: params.currency,
      walletAddress: params.walletAddress,
      txId: cleanTxId,
      receiptDataUrl: cleanReceiptUrl,
      receiptFileName: cleanReceiptName,
      status: 'Pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.update(doc(db, 'users', params.user.uid), {
      payment_status: 'pending_verification',
      registrationPaymentStatus: 'Pending Review',
      registrationPaymentId: paymentId,
      registrationTxId: cleanTxId,
      registrationCrypto: params.currency,
      registrationFeeAmount: cleanAmount,
      registrationReceiptDataUrl: cleanReceiptUrl,
      registrationReceiptFileName: cleanReceiptName,
      registrationSubmittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'notifications', notifId), {
      id: notifId,
      userId: params.user.uid,
      recipientEmail: params.user.email.slice(0, 160),
      subject: 'Registration Payment Submitted',
      body: `We received your $${cleanAmount.toFixed(2)} ${params.currency} registration payment (TXID: ${cleanTxId}). Your registration payment is currently awaiting administrator approval.`,
      category: 'registration_payment',
      read: false,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    return paymentId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `registrationPayments/${paymentId}`);
  }
}

export async function adminApproveFirebaseUser(params: {
  userId: string;
  userEmail: string;
  fullName: string;
  username?: string;
  adminNotes?: string;
  adminUser?: { uid: string; email: string };
}): Promise<{ fullyActivated: boolean }> {
  let fullyActivated = false;
  try {
    await runTransaction(db, async (transaction) => {
      const userRef = doc(db, 'users', params.userId);
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists()) {
        throw new Error('User record not found.');
      }
      const userData = userSnap.data();
      const prevAccountStatus = getSimpleAccountStatus({
        role: userData.role as UserAccount['role'],
        email: params.userEmail,
        status: userData.status as AccountStatus,
        account_status: userData.account_status as SimpleAccountStatus | undefined,
      });
      const currentPaymentStatus = getPaymentStatus({
        role: userData.role as UserAccount['role'],
        email: params.userEmail,
        status: userData.status as AccountStatus,
        account_status: userData.account_status as SimpleAccountStatus | undefined,
        payment_status: userData.payment_status as PaymentStatus | undefined,
        registrationPaymentStatus: userData.registrationPaymentStatus as UserAccount['registrationPaymentStatus'],
      });

      fullyActivated = currentPaymentStatus === 'verified';
      const userUpdates: Record<string, unknown> = {
        account_status: 'approved',
        payment_status: currentPaymentStatus,
        dashboard_access: fullyActivated,
        status: fullyActivated ? 'Approved' : 'Pending Payment',
        isVerified: fullyActivated,
        approvedAt: serverTimestamp(),
        rejectionReason: '',
        updatedAt: serverTimestamp(),
      };
      if (typeof params.adminNotes === 'string') {
        userUpdates.adminNotes = params.adminNotes.trim().slice(0, 1000);
      }
      transaction.update(userRef, userUpdates);

      const notifId = makeSafeId('notif');
      transaction.set(doc(db, 'notifications', notifId), {
        id: notifId,
        userId: params.userId,
        recipientEmail: (params.userEmail || 'member@bluewhalemarkethub.com').slice(0, 160),
        subject: fullyActivated ? 'Account Approved & Activated' : 'Account Profile Approved',
        body: fullyActivated
          ? 'Congratulations! Your account has been approved and your registration payment is verified. You may now log in and access your dashboard.'
          : 'Your account profile has been approved. Dashboard access will unlock automatically once your $10 USD registration payment is verified.',
        category: 'registration_payment',
        read: false,
        createdAt: serverTimestamp(),
      });

      if (params.adminUser) {
        const adminLogId = makeSafeId('alog');
        transaction.set(doc(db, 'adminLogs', adminLogId), {
          id: adminLogId,
          adminUid: params.adminUser.uid,
          adminEmail: params.adminUser.email.slice(0, 160),
          action: fullyActivated ? 'ACCOUNT_APPROVED_AND_ACTIVATED' : 'USER_APPROVED',
          targetUserId: params.userId,
          targetEmail: (params.userEmail || 'unknown').slice(0, 160),
          ...(params.username ? { targetUsername: params.username.slice(0, 64) } : {}),
          previousStatus: prevAccountStatus,
          newStatus: 'approved',
          details: `Approved user ${params.fullName} (${params.userEmail || params.userId}) — payment_status=${currentPaymentStatus}, dashboard_access=${fullyActivated}`,
          createdAt: serverTimestamp(),
        });
      }
    });
    return { fullyActivated };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${params.userId}`);
  }
}

export async function adminVerifyFirebasePayment(params: {
  userId: string;
  userEmail: string;
  fullName: string;
  username?: string;
  paymentId?: string;
  adminNotes?: string;
  adminUser?: { uid: string; email: string };
}): Promise<{ fullyActivated: boolean }> {
  let fullyActivated = false;
  try {
    await runTransaction(db, async (transaction) => {
      const userRef = doc(db, 'users', params.userId);
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists()) {
        throw new Error('User record not found.');
      }
      const userData = userSnap.data();
      const currentAccountStatus = getSimpleAccountStatus({
        role: userData.role as UserAccount['role'],
        email: params.userEmail,
        status: userData.status as AccountStatus,
        account_status: userData.account_status as SimpleAccountStatus | undefined,
      });
      const prevPaymentStatus = getPaymentStatus({
        role: userData.role as UserAccount['role'],
        email: params.userEmail,
        status: userData.status as AccountStatus,
        account_status: userData.account_status as SimpleAccountStatus | undefined,
        payment_status: userData.payment_status as PaymentStatus | undefined,
        registrationPaymentStatus: userData.registrationPaymentStatus as UserAccount['registrationPaymentStatus'],
      });

      const resolvedPayId = params.paymentId || (userData.registrationPaymentId ? String(userData.registrationPaymentId) : undefined);
      const payRef = resolvedPayId ? doc(db, 'registrationPayments', resolvedPayId) : null;
      const paySnap = payRef ? await transaction.get(payRef) : null;

      fullyActivated = currentAccountStatus === 'approved';
      const userUpdates: Record<string, unknown> = {
        account_status: currentAccountStatus,
        payment_status: 'verified',
        registrationPaymentStatus: 'Approved',
        paymentVerifiedAt: serverTimestamp(),
        dashboard_access: fullyActivated,
        status: fullyActivated
          ? 'Approved'
          : currentAccountStatus === 'rejected'
            ? 'Rejected'
            : currentAccountStatus === 'suspended'
              ? 'Suspended'
              : 'Pending Payment',
        isVerified: fullyActivated,
        updatedAt: serverTimestamp(),
      };
      if (typeof params.adminNotes === 'string') {
        userUpdates.adminNotes = params.adminNotes.trim().slice(0, 1000);
      }
      transaction.update(userRef, userUpdates);

      if (payRef && paySnap && paySnap.exists() && paySnap.data().status === 'Pending') {
        transaction.update(payRef, {
          status: 'Approved',
          reviewedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          ...(params.adminNotes ? { adminNote: params.adminNotes.trim().slice(0, 500) } : {}),
        });
      }

      const notifId = makeSafeId('notif');
      transaction.set(doc(db, 'notifications', notifId), {
        id: notifId,
        userId: params.userId,
        recipientEmail: (params.userEmail || 'member@bluewhalemarkethub.com').slice(0, 160),
        subject: fullyActivated ? 'Account Approved & Activated' : 'Registration Payment Verified',
        body: fullyActivated
          ? 'Congratulations! Your registration payment has been verified and your account is approved. You may now log in and access your dashboard.'
          : 'Your $10 USD registration payment has been verified. Your account is now awaiting administrator approval before dashboard access unlocks.',
        category: 'registration_payment',
        read: false,
        createdAt: serverTimestamp(),
      });

      if (params.adminUser) {
        const adminLogId = makeSafeId('alog');
        transaction.set(doc(db, 'adminLogs', adminLogId), {
          id: adminLogId,
          adminUid: params.adminUser.uid,
          adminEmail: params.adminUser.email.slice(0, 160),
          action: fullyActivated ? 'PAYMENT_VERIFIED_AND_ACTIVATED' : 'PAYMENT_VERIFIED',
          targetUserId: params.userId,
          targetEmail: (params.userEmail || 'unknown').slice(0, 160),
          ...(params.username ? { targetUsername: params.username.slice(0, 64) } : {}),
          previousStatus: prevPaymentStatus,
          newStatus: 'verified',
          details: `Verified registration payment for ${params.fullName} (${params.userEmail || params.userId}) — account_status=${currentAccountStatus}, dashboard_access=${fullyActivated}`,
          createdAt: serverTimestamp(),
        });
      }
    });
    return { fullyActivated };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${params.userId}`);
  }
}

export async function adminRejectFirebasePayment(params: {
  userId: string;
  userEmail: string;
  fullName: string;
  username?: string;
  paymentId?: string;
  rejectionReason?: string;
  adminNotes?: string;
  adminUser?: { uid: string; email: string };
}): Promise<void> {
  try {
    await runTransaction(db, async (transaction) => {
      const userRef = doc(db, 'users', params.userId);
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists()) {
        throw new Error('User record not found.');
      }
      const userData = userSnap.data();
      const currentAccountStatus = getSimpleAccountStatus({
        role: userData.role as UserAccount['role'],
        email: params.userEmail,
        status: userData.status as AccountStatus,
        account_status: userData.account_status as SimpleAccountStatus | undefined,
      });
      const reason = (
        params.rejectionReason ||
        'Registration payment receipt or TXID could not be verified. Please submit new payment proof.'
      )
        .trim()
        .slice(0, 500);

      const resolvedPayId = params.paymentId || (userData.registrationPaymentId ? String(userData.registrationPaymentId) : undefined);
      const payRef = resolvedPayId ? doc(db, 'registrationPayments', resolvedPayId) : null;
      const paySnap = payRef ? await transaction.get(payRef) : null;

      const userUpdates: Record<string, unknown> = {
        payment_status: 'rejected',
        registrationPaymentStatus: 'Rejected',
        dashboard_access: false,
        isVerified: false,
        rejectionReason: reason,
        status:
          currentAccountStatus === 'rejected'
            ? 'Rejected'
            : currentAccountStatus === 'suspended'
              ? 'Suspended'
              : 'Pending Payment',
        updatedAt: serverTimestamp(),
      };
      if (typeof params.adminNotes === 'string') {
        userUpdates.adminNotes = params.adminNotes.trim().slice(0, 1000);
      }
      transaction.update(userRef, userUpdates);

      if (payRef && paySnap && paySnap.exists() && paySnap.data().status === 'Pending') {
        transaction.update(payRef, {
          status: 'Rejected',
          rejectionReason: reason,
          reviewedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          ...(params.adminNotes ? { adminNote: params.adminNotes.trim().slice(0, 500) } : {}),
        });
      }

      const notifId = makeSafeId('notif');
      transaction.set(doc(db, 'notifications', notifId), {
        id: notifId,
        userId: params.userId,
        recipientEmail: (params.userEmail || 'member@bluewhalemarkethub.com').slice(0, 160),
        subject: 'Registration Payment Rejected',
        body: `Your registration payment was rejected. Reason: ${reason}`,
        category: 'registration_payment',
        read: false,
        createdAt: serverTimestamp(),
      });

      if (params.adminUser) {
        const adminLogId = makeSafeId('alog');
        transaction.set(doc(db, 'adminLogs', adminLogId), {
          id: adminLogId,
          adminUid: params.adminUser.uid,
          adminEmail: params.adminUser.email.slice(0, 160),
          action: 'PAYMENT_REJECTED',
          targetUserId: params.userId,
          targetEmail: (params.userEmail || 'unknown').slice(0, 160),
          ...(params.username ? { targetUsername: params.username.slice(0, 64) } : {}),
          newStatus: 'rejected',
          details: `Rejected registration payment for ${params.fullName}: ${reason}`,
          createdAt: serverTimestamp(),
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${params.userId}`);
  }
}

export async function adminReviewFirebaseRegistration(params: {
  userId: string;
  userEmail: string;
  fullName: string;
  username?: string;
  previousStatus?: string;
  paymentId?: string;
  decision: 'Approved' | 'Rejected' | 'Suspended';
  rejectionReason?: string;
  adminNotes?: string;
  adminUser?: { uid: string; email: string };
}): Promise<void> {
  if (params.decision === 'Approved') {
    await adminApproveFirebaseUser({
      userId: params.userId,
      userEmail: params.userEmail,
      fullName: params.fullName,
      username: params.username,
      adminNotes: params.adminNotes,
      adminUser: params.adminUser,
    });
    return;
  }

  try {
    const batch = writeBatch(db);
    const userRef = doc(db, 'users', params.userId);
    const simpleDecision = getSimpleAccountStatus(params.decision);
    const userUpdates: Record<string, unknown> = {
      status: params.decision,
      account_status: simpleDecision,
      dashboard_access: false,
      isVerified: false,
      updatedAt: serverTimestamp(),
    };
    if (typeof params.adminNotes === 'string') {
      userUpdates.adminNotes = params.adminNotes.trim().slice(0, 1000);
    }

    if (params.decision === 'Rejected') {
      userUpdates.rejectedAt = serverTimestamp();
      userUpdates.rejectionReason = (params.rejectionReason || 'Your registration was not approved. Please contact support.').trim().slice(0, 500);
    }

    batch.update(userRef, userUpdates);

    const notifId = makeSafeId('notif');
    if (params.decision === 'Rejected') {
      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        userId: params.userId,
        recipientEmail: (params.userEmail || 'member@bluewhalemarkethub.com').slice(0, 160),
        subject: 'Registration Payment Rejected',
        body: `Your registration was not approved. Please contact support. Reason: ${(params.rejectionReason || 'Verification failed.').trim()}`,
        category: 'registration_payment',
        read: false,
        createdAt: serverTimestamp(),
      });
    } else if (params.decision === 'Suspended') {
      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        userId: params.userId,
        recipientEmail: (params.userEmail || 'member@bluewhalemarkethub.com').slice(0, 160),
        subject: 'Account Suspended',
        body: `Your account has been suspended. Contact support at ${SUPPORT_EMAIL}.`,
        category: 'security',
        read: false,
        createdAt: serverTimestamp(),
      });
    }

    if (params.adminUser) {
      const adminLogId = makeSafeId('alog');
      const actionMap = {
        Rejected: 'ACCOUNT_REJECTED',
        Suspended: 'ACCOUNT_SUSPENDED',
      } as const;
      batch.set(doc(db, 'adminLogs', adminLogId), {
        id: adminLogId,
        adminUid: params.adminUser.uid,
        adminEmail: params.adminUser.email.slice(0, 160),
        action: actionMap[params.decision],
        targetUserId: params.userId,
        targetEmail: (params.userEmail || 'unknown').slice(0, 160),
        ...(params.username ? { targetUsername: params.username.slice(0, 64) } : {}),
        ...(params.previousStatus ? { previousStatus: params.previousStatus.slice(0, 64) } : {}),
        newStatus: params.decision,
        details: `${params.decision} registration for ${params.fullName} (${params.userEmail || params.userId})`,
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${params.userId}`);
  }
}

export function mapFirestoreRegistrationPayment(
  id: string,
  data: Record<string, unknown>,
): RegistrationPayment {
  return {
    id,
    userId: String(data.userId || ''),
    userEmail: String(data.userEmail || ''),
    username: String(data.username || ''),
    fullName: String(data.fullName || ''),
    amount: Number(data.amount || 0),
    currency: (data.currency as CryptoCurrencyCode) || 'BTC',
    walletAddress: String(data.walletAddress || ''),
    txId: String(data.txId || ''),
    receiptDataUrl: String(data.receiptDataUrl || ''),
    receiptFileName: String(data.receiptFileName || ''),
    status: (data.status as RegistrationPayment['status']) || 'Pending',
    rejectionReason: data.rejectionReason ? String(data.rejectionReason) : undefined,
    adminNote: data.adminNote ? String(data.adminNote) : undefined,
    createdAt: tsToIso(data.createdAt),
    updatedAt: tsToIso(data.updatedAt),
    reviewedAt: data.reviewedAt ? tsToIso(data.reviewedAt) : undefined,
  };
}

export async function adminUpdateFirebaseUser(
  uid: string,
  updates: {
    status?: AccountStatus;
    payment_status?: PaymentStatus;
    isVerified?: boolean;
    adminNotes?: string;
    rejectionReason?: string;
  },
  context?: {
    targetUser?: UserAccount;
    adminUser?: { uid: string; email: string };
  },
): Promise<void> {
  try {
    const batch = writeBatch(db);
    const currentAccountStatus = updates.status
      ? getSimpleAccountStatus(updates.status)
      : context?.targetUser
        ? getSimpleAccountStatus(context.targetUser)
        : 'pending';
    const currentPaymentStatus = updates.payment_status
      ? updates.payment_status
      : context?.targetUser
        ? getPaymentStatus(context.targetUser)
        : 'unpaid';
    const nextDashboardAccess = currentAccountStatus === 'approved' && currentPaymentStatus === 'verified';

    const cleanUpdates: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
      account_status: currentAccountStatus,
      payment_status: currentPaymentStatus,
      dashboard_access: nextDashboardAccess,
    };

    if (updates.status !== undefined) {
      cleanUpdates.status = nextDashboardAccess
        ? 'Approved'
        : currentAccountStatus === 'rejected'
          ? 'Rejected'
          : currentAccountStatus === 'suspended'
            ? 'Suspended'
            : 'Pending Payment';
      cleanUpdates.isVerified = nextDashboardAccess;
      if (currentAccountStatus === 'approved') {
        cleanUpdates.approvedAt = serverTimestamp();
        cleanUpdates.rejectionReason = '';
      } else if (currentAccountStatus === 'rejected') {
        cleanUpdates.rejectedAt = serverTimestamp();
      }
    }
    if (updates.payment_status !== undefined) {
      cleanUpdates.registrationPaymentStatus =
        currentPaymentStatus === 'verified'
          ? 'Approved'
          : currentPaymentStatus === 'pending_verification'
            ? 'Pending Review'
            : currentPaymentStatus === 'rejected'
              ? 'Rejected'
              : 'Unpaid';
      if (currentPaymentStatus === 'verified') {
        cleanUpdates.paymentVerifiedAt = serverTimestamp();
      }
      cleanUpdates.status = nextDashboardAccess
        ? 'Approved'
        : currentAccountStatus === 'rejected'
          ? 'Rejected'
          : currentAccountStatus === 'suspended'
            ? 'Suspended'
            : 'Pending Payment';
      cleanUpdates.isVerified = nextDashboardAccess;
    }
    if (updates.isVerified !== undefined && !nextDashboardAccess) cleanUpdates.isVerified = updates.isVerified;
    if (updates.adminNotes !== undefined) cleanUpdates.adminNotes = updates.adminNotes.slice(0, 1000);
    if (updates.rejectionReason !== undefined) cleanUpdates.rejectionReason = updates.rejectionReason.slice(0, 500);
    batch.update(doc(db, 'users', uid), cleanUpdates);

    const targetEmail = context?.targetUser?.email || '';
    if (currentAccountStatus === 'suspended' && context?.targetUser?.account_status !== 'suspended') {
      const notifId = makeSafeId('notif');
      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        userId: uid,
        recipientEmail: (targetEmail || 'member@bluewhalemarkethub.com').slice(0, 160),
        subject: 'Account Suspended',
        body: `Your account has been suspended. Contact support at ${SUPPORT_EMAIL}.`,
        category: 'security',
        read: false,
        createdAt: serverTimestamp(),
      });
    } else if (nextDashboardAccess && !context?.targetUser?.dashboard_access) {
      const notifId = makeSafeId('notif');
      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        userId: uid,
        recipientEmail: (targetEmail || 'member@bluewhalemarkethub.com').slice(0, 160),
        subject: 'Account Approved & Activated',
        body: 'Congratulations! Your account has been approved and your registration payment is verified. You may now log in and access your dashboard.',
        category: 'registration_payment',
        read: false,
        createdAt: serverTimestamp(),
      });
    }

    if (context?.adminUser) {
      const adminLogId = makeSafeId('alog');
      const actionLabel =
        currentAccountStatus === 'suspended'
          ? 'ACCOUNT_SUSPENDED'
          : nextDashboardAccess
            ? 'ACCOUNT_APPROVED_AND_ACTIVATED'
            : currentAccountStatus === 'rejected'
              ? 'ACCOUNT_REJECTED'
              : 'USER_UPDATED';
      batch.set(doc(db, 'adminLogs', adminLogId), {
        id: adminLogId,
        adminUid: context.adminUser.uid,
        adminEmail: context.adminUser.email.slice(0, 160),
        action: actionLabel,
        targetUserId: uid,
        ...(targetEmail ? { targetEmail: targetEmail.slice(0, 160) } : {}),
        ...(context.targetUser?.username ? { targetUsername: context.targetUser.username.slice(0, 64) } : {}),
        ...(context.targetUser?.status ? { previousStatus: String(context.targetUser.status).slice(0, 64) } : {}),
        newStatus: String(cleanUpdates.status || currentAccountStatus).slice(0, 64),
        details: `Updated ${targetEmail || uid}: account_status=${currentAccountStatus}, payment_status=${currentPaymentStatus}, dashboard_access=${nextDashboardAccess}`,
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function adminDeleteFirebaseUser(
  uid: string,
  context?: {
    targetUser?: UserAccount;
    adminUser?: { uid: string; email: string };
  },
): Promise<void> {
  if (context?.targetUser?.email.trim().toLowerCase() === ADMIN_EMAIL || uid === context?.adminUser?.uid) {
    throw new Error('Cannot delete the exclusive administrator account.');
  }
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'users', uid, 'private', 'info'));
    batch.delete(doc(db, 'users', uid));

    if (context?.adminUser) {
      const adminLogId = makeSafeId('alog');
      const targetEmail = context?.targetUser?.email || '';
      batch.set(doc(db, 'adminLogs', adminLogId), {
        id: adminLogId,
        adminUid: context.adminUser.uid,
        adminEmail: context.adminUser.email.slice(0, 160),
        action: 'USER_DELETED',
        targetUserId: uid,
        ...(targetEmail ? { targetEmail: targetEmail.slice(0, 160) } : {}),
        ...(context.targetUser?.username ? { targetUsername: context.targetUser.username.slice(0, 64) } : {}),
        ...(context.targetUser?.status ? { previousStatus: String(context.targetUser.status).slice(0, 64) } : {}),
        newStatus: 'Deleted',
        details: `Deleted registered user ${context.targetUser?.fullName || uid} (${targetEmail || uid})`,
        createdAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/${uid}`);
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
  adminUser?: { uid: string; email: string },
): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'supportTickets', ticketId), {
      status,
      updatedAt: serverTimestamp(),
    });
    if (adminUser) {
      const adminLogId = makeSafeId('alog');
      batch.set(doc(db, 'adminLogs', adminLogId), {
        id: adminLogId,
        adminUid: adminUser.uid,
        adminEmail: adminUser.email.slice(0, 160),
        action: 'TICKET_STATUS_UPDATED',
        newStatus: status,
        details: `Updated support ticket ${ticketId} status to ${status}`,
        createdAt: serverTimestamp(),
      });
    }
    await batch.commit();
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
    userName: data.userName ? String(data.userName) : undefined,
    amount: Number(data.amount || 0),
    currency: (data.currency as CryptoCurrencyCode) || 'BTC',
    walletAddress: String(data.walletAddress || ''),
    txHash: String(data.txHash || ''),
    receiptUrl: data.receiptUrl ? String(data.receiptUrl) : undefined,
    receiptDataUrl: data.receiptDataUrl ? String(data.receiptDataUrl) : undefined,
    receiptFileName: data.receiptFileName ? String(data.receiptFileName) : undefined,
    status: (data.status as DepositRecord['status']) || 'Pending',
    adminNote: data.adminNote ? String(data.adminNote) : undefined,
    rejectionReason: data.rejectionReason ? String(data.rejectionReason) : undefined,
    reviewedBy: data.reviewedBy ? String(data.reviewedBy) : undefined,
    approvedAt: data.approvedAt ? tsToIso(data.approvedAt) : undefined,
    rejectedAt: data.rejectedAt ? tsToIso(data.rejectedAt) : undefined,
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
  adminEmail?: string;
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

    const adminLogId = makeSafeId('alog');
    batch.set(doc(db, 'adminLogs', adminLogId), {
      id: adminLogId,
      adminUid: params.adminUid,
      adminEmail: (params.adminEmail || ADMIN_EMAIL).slice(0, 160),
      action: params.resetToDefault ? 'PRICING_RESET' : 'PRICING_UPDATED',
      details: params.resetToDefault
        ? `Restored default catalog pricing for ${service.providerName}`
        : `Updated ${service.providerName} pricing (Personal $${params.personalPrice.toFixed(0)}, Business $${params.businessPrice.toFixed(0)}, Corporate $${params.corporatePrice.toFixed(0)})`,
      createdAt: serverTimestamp(),
    });

    await batch.commit();

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

export function mapFirestoreAdminLog(
  id: string,
  data: Record<string, unknown>,
): AdminLogEntry {
  return {
    id,
    adminUid: String(data.adminUid || ''),
    adminEmail: String(data.adminEmail || ''),
    action: String(data.action || ''),
    targetUserId: data.targetUserId ? String(data.targetUserId) : undefined,
    targetEmail: data.targetEmail ? String(data.targetEmail) : undefined,
    targetUsername: data.targetUsername ? String(data.targetUsername) : undefined,
    previousStatus: data.previousStatus ? String(data.previousStatus) : undefined,
    newStatus: data.newStatus ? String(data.newStatus) : undefined,
    details: String(data.details || ''),
    createdAt: tsToIso(data.createdAt),
  };
}

export function mapFirestoreWebsiteSettings(
  id: string,
  data: Record<string, unknown>,
): WebsiteSettings {
  return {
    id: String(data.id || id),
    registrationFeeUsd: Number(data.registrationFeeUsd ?? REGISTRATION_FEE_USD),
    minimumDepositUsd: Number(data.minimumDepositUsd ?? 100),
    supportEmail: String(data.supportEmail || SUPPORT_EMAIL),
    marketplaceNotice: String(data.marketplaceNotice || ''),
    requireRegistrationApproval: Boolean(data.requireRegistrationApproval ?? true),
    updatedBy: String(data.updatedBy || ''),
    updatedAt: tsToIso(data.updatedAt),
  };
}

export async function saveFirebaseWebsiteSettings(params: {
  adminUser: { uid: string; email: string };
  registrationFeeUsd: number;
  minimumDepositUsd: number;
  supportEmail: string;
  marketplaceNotice: string;
  requireRegistrationApproval: boolean;
}): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'siteSettings', 'global'), {
      id: 'global',
      registrationFeeUsd: Number(params.registrationFeeUsd),
      minimumDepositUsd: Number(params.minimumDepositUsd),
      supportEmail: params.supportEmail.trim().slice(0, 160),
      marketplaceNotice: params.marketplaceNotice.trim().slice(0, 300),
      requireRegistrationApproval: Boolean(params.requireRegistrationApproval),
      updatedBy: params.adminUser.uid,
      updatedAt: serverTimestamp(),
    });
    const adminLogId = makeSafeId('alog');
    batch.set(doc(db, 'adminLogs', adminLogId), {
      id: adminLogId,
      adminUid: params.adminUser.uid,
      adminEmail: params.adminUser.email.slice(0, 160),
      action: 'SITE_SETTINGS_UPDATED',
      details: `Updated website settings (Reg fee $${params.registrationFeeUsd}, Min deposit $${params.minimumDepositUsd}, Support ${params.supportEmail})`,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'siteSettings/global');
  }
}
