import React, { useRef, useState } from 'react';
import {
  ShieldAlert,
  Clock,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Upload,
  FileText,
  Trash2,
  BookOpen,
  Mail,
  LogOut,
  RefreshCw,
  ArrowRight,
  Lock,
} from 'lucide-react';
import { CRYPTO_WALLETS, type CryptoCurrencyCode } from '../data/shippingCatalog';
import {
  getPaymentStatus,
  getSimpleAccountStatus,
  hasDashboardAccess,
  normalizeAccountStatus,
  REGISTRATION_FEE_USD,
  SUPPORT_EMAIL,
  type AuthMode,
  type EmailNotification,
  type RegistrationPayment,
  type UserAccount,
} from '../types/marketplace';
import { QrCodeCanvas } from './QrCodeCanvas';
import { mapCurrencyCodeToAssetTab, type InstructionAssetTab } from './PaymentInstructionsModal';

interface RegistrationVerificationViewProps {
  user: UserAccount;
  authMode: AuthMode;
  latestPayment?: RegistrationPayment | null;
  notifications: EmailNotification[];
  verificationPreviewCode?: string;
  onSubmitPayment: (payload: {
    amount: number;
    currency: CryptoCurrencyCode;
    walletAddress: string;
    txId: string;
    receiptDataUrl: string;
    receiptFileName: string;
  }) => Promise<void>;
  onVerifyOptionalEmail?: (code: string) => Promise<void>;
  onRefreshStatus: () => Promise<void>;
  onOpenPaymentGuide: (asset: InstructionAssetTab) => void;
  onLogout: () => Promise<void>;
}

const MAX_RECEIPT_DATA_URL_CHARS = 450000;

export async function processRegistrationScreenshotFile(
  file: File,
): Promise<{ dataUrl: string; fileName: string }> {
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
  ];
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Unsupported format. Upload a PNG, JPG, WEBP, GIF screenshot or PDF.');
  }
  const cleanName = file.name.trim().slice(0, 160) || 'registration-payment';

  if (file.type === 'application/pdf') {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read the selected PDF file.'));
      reader.readAsDataURL(file);
    });
    if (dataUrl.length > MAX_RECEIPT_DATA_URL_CHARS) {
      throw new Error('PDF file exceeds 320 KB. Please upload a screenshot image instead.');
    }
    return { dataUrl, fileName: cleanName };
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Invalid image file. Please choose another screenshot.'));
      image.src = objectUrl;
    });

    const renderScaled = (maxEdge: number, quality: number): string => {
      const scale = Math.min(1, maxEdge / Math.max(img.width || 1, img.height || 1));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable in this browser.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      return canvas.toDataURL('image/jpeg', quality);
    };

    let dataUrl = renderScaled(1024, 0.78);
    if (dataUrl.length > MAX_RECEIPT_DATA_URL_CHARS) {
      dataUrl = renderScaled(768, 0.62);
    }
    if (dataUrl.length > MAX_RECEIPT_DATA_URL_CHARS) {
      throw new Error('Image is still too large after compression. Please use a smaller screenshot.');
    }
    return { dataUrl, fileName: cleanName };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function RegistrationVerificationView({
  user,
  authMode,
  latestPayment,
  notifications,
  verificationPreviewCode,
  onSubmitPayment,
  onVerifyOptionalEmail,
  onRefreshStatus,
  onOpenPaymentGuide,
  onLogout,
}: RegistrationVerificationViewProps) {
  const canonicalStatus = normalizeAccountStatus(user.status);
  const accountStatus = getSimpleAccountStatus(user);
  const paymentStatus = getPaymentStatus(user);
  const dashboardAccess = hasDashboardAccess(user);
  const paymentSubmitted =
    paymentStatus === 'pending_verification' ||
    (canonicalStatus === 'Pending Payment' && user.registrationPaymentStatus === 'Pending Review');

  const [selectedCrypto, setSelectedCrypto] = useState<CryptoCurrencyCode>(
    user.registrationCrypto || 'USDT_TRC20',
  );
  const [amountInput, setAmountInput] = useState<string>(
    String(user.registrationFeeAmount || REGISTRATION_FEE_USD),
  );
  const [txId, setTxId] = useState<string>('');
  const [receiptDataUrl, setReceiptDataUrl] = useState<string>('');
  const [receiptFileName, setReceiptFileName] = useState<string>('');
  const [processingFile, setProcessingFile] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showResubmitForm, setShowResubmitForm] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailVerifyMsg, setEmailVerifyMsg] = useState('');
  const [emailVerifyErr, setEmailVerifyErr] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeWallet =
    CRYPTO_WALLETS.find((w) => w.code === selectedCrypto) || CRYPTO_WALLETS[0];
  const numericAmount = Number(amountInput);
  const isAmountValid = !Number.isNaN(numericAmount) && numericAmount >= REGISTRATION_FEE_USD;
  const shouldShowForm =
    canonicalStatus !== 'Suspended' &&
    (canonicalStatus === 'Rejected' || !paymentSubmitted || showResubmitForm);

  async function handleCopyAddress() {
    try {
      await navigator.clipboard.writeText(activeWallet.address);
      setCopiedAddr(true);
      setTimeout(() => setCopiedAddr(false), 1800);
    } catch {
      // Clipboard blocked
    }
  }

  async function handleFileSelected(file: File | null | undefined) {
    if (!file) return;
    setError('');
    setProcessingFile(true);
    try {
      const processed = await processRegistrationScreenshotFile(file);
      setReceiptDataUrl(processed.dataUrl);
      setReceiptFileName(processed.fileName);
    } catch (err) {
      setReceiptDataUrl('');
      setReceiptFileName('');
      setError(err instanceof Error ? err.message : 'Unable to process payment screenshot.');
    } finally {
      setProcessingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleSubmitPaymentForm(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (!isAmountValid) {
      setError(`Minimum registration fee is $${REGISTRATION_FEE_USD.toFixed(2)} USD.`);
      return;
    }
    if (txId.trim().length < 8) {
      setError('Please enter a valid Transaction ID (TXID).');
      return;
    }
    if (!receiptDataUrl || !receiptFileName) {
      setError('Please upload a payment screenshot before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmitPayment({
        amount: numericAmount,
        currency: activeWallet.code,
        walletAddress: activeWallet.address,
        txId: txId.trim(),
        receiptDataUrl,
        receiptFileName,
      });
      setShowResubmitForm(false);
      setTxId('');
      setReceiptDataUrl('');
      setReceiptFileName('');
      setSuccessMsg(
        'Registration payment proof submitted. Your registration payment is currently awaiting administrator approval.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit registration payment.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOptionalEmailVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!onVerifyOptionalEmail || !emailCode.trim()) return;
    setEmailVerifyErr('');
    setEmailVerifyMsg('');
    try {
      await onVerifyOptionalEmail(emailCode.trim());
      setEmailVerifyMsg('Email address verified.');
      setEmailCode('');
    } catch (err) {
      setEmailVerifyErr(err instanceof Error ? err.message : 'Verification failed.');
    }
  }

  const submittedScreenshot =
    user.registrationReceiptDataUrl || latestPayment?.receiptDataUrl || '';
  const submittedTxId = user.registrationTxId || latestPayment?.txId || '';
  const submittedCrypto = user.registrationCrypto || latestPayment?.currency || selectedCrypto;
  const submittedAmount =
    user.registrationFeeAmount || latestPayment?.amount || REGISTRATION_FEE_USD;

  return (
    <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
      {/* Header Status Card */}
      <div className="p-6 sm:p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                canonicalStatus === 'Suspended'
                  ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400'
                  : canonicalStatus === 'Rejected'
                    ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400'
                    : 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400'
              }`}
            >
              {canonicalStatus === 'Suspended' || canonicalStatus === 'Rejected' ? (
                <XCircle className="w-6 h-6" />
              ) : (
                <Lock className="w-6 h-6" />
              )}
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Account Verification Gate · {user.fullName} (@{user.username})
              </div>
              <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
                {accountStatus === 'suspended'
                  ? 'Account Suspended'
                  : accountStatus === 'rejected'
                    ? 'Registration Not Approved'
                    : paymentStatus === 'verified' && accountStatus !== 'approved'
                      ? 'Payment Verified — Awaiting Account Approval'
                      : paymentSubmitted
                        ? 'Registration Payment Under Review'
                        : `Registration Fee: $${REGISTRATION_FEE_USD} USD`}
              </h1>
              <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">
                {accountStatus === 'suspended'
                  ? 'Your account has been suspended. Contact support.'
                  : accountStatus === 'rejected'
                    ? 'Your registration was not approved. Please contact support.'
                    : paymentStatus === 'pending_verification'
                      ? 'Your payment is under review. Dashboard access will be activated after payment verification.'
                      : paymentStatus === 'verified'
                        ? 'Your account is awaiting administrator approval.'
                        : 'Registration fee payment is required before account activation.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                try {
                  await onRefreshStatus();
                } finally {
                  setRefreshing(false);
                }
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Refresh Status</span>
            </button>
            <button
              type="button"
              onClick={() => void onLogout()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Log Out</span>
            </button>
          </div>
        </div>

        {/* Account Status Summary Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs">
          <div>
            <div className="text-slate-500">Account Status (account_status)</div>
            <div className="mt-0.5 font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
              {accountStatus === 'pending' && <Clock className="w-3.5 h-3.5 text-amber-600" />}
              {accountStatus === 'approved' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
              {(accountStatus === 'rejected' || accountStatus === 'suspended') && (
                <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
              )}
              <span>{accountStatus}</span>
            </div>
          </div>
          <div>
            <div className="text-slate-500">Payment Status (Registration Fee: ${REGISTRATION_FEE_USD} USD)</div>
            <div className="mt-0.5 font-semibold text-slate-900 dark:text-white">
              {paymentStatus}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Dashboard Access (dashboard_access)</div>
            <div className="mt-0.5 font-semibold text-amber-700 dark:text-amber-400">
              {dashboardAccess ? 'Unlocked' : 'Locked Until Both Approved & Verified'}
            </div>
          </div>
        </div>

        {canonicalStatus === 'Rejected' && (
          <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 space-y-1">
            <div className="text-xs font-semibold text-rose-800 dark:text-rose-200">
              Rejection Reason
            </div>
            <p className="text-sm text-rose-700 dark:text-rose-300">
              {user.rejectionReason ||
                'Your submitted registration payment could not be verified. Please verify your TXID and upload a clear payment screenshot below.'}
            </p>
          </div>
        )}

        {successMsg && (
          <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-sm text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}
      </div>

      {/* Pending Approval Summary Card */}
      {canonicalStatus === 'Pending Payment' && paymentSubmitted && !showResubmitForm && (
        <div className="p-6 sm:p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                Payment Verification Submitted
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Your registration payment is currently awaiting administrator approval. Once approved, your full member dashboard, marketplace, and transactions unlock automatically.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowResubmitForm(true)}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline shrink-0 self-start sm:self-center"
            >
              Update Payment Proof
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs">
            <div>
              <div className="text-slate-500">Cryptocurrency &amp; Amount</div>
              <div className="mt-1 font-mono font-semibold text-slate-900 dark:text-white">
                ${submittedAmount.toFixed(2)} USD ({submittedCrypto.replace('_', ' ')})
              </div>
            </div>
            <div className="md:col-span-2 min-w-0">
              <div className="text-slate-500">Submitted Transaction ID (TXID)</div>
              <div className="mt-1 font-mono text-slate-900 dark:text-slate-100 break-all">
                {submittedTxId}
              </div>
            </div>
          </div>

          {submittedScreenshot && !submittedScreenshot.startsWith('data:application/pdf') && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-500">Uploaded Payment Screenshot</div>
              <img
                src={submittedScreenshot}
                alt="Submitted registration payment proof"
                className="max-h-64 rounded-xl border border-slate-200 dark:border-slate-800 object-contain bg-slate-50 dark:bg-slate-950"
              />
            </div>
          )}
        </div>
      )}

      {/* Payment Instructions & Submission Form */}
      {shouldShowForm && (
        <form
          onSubmit={handleSubmitPaymentForm}
          className="p-6 sm:p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                Step-by-Step Registration Payment (Registration Fee: ${REGISTRATION_FEE_USD} USD)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Send the mandatory ${REGISTRATION_FEE_USD}.00 USD registration fee to the official BlueWhale Markethub address below, then upload your TXID and payment screenshot.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenPaymentGuide(mapCurrencyCodeToAssetTab(selectedCrypto))}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline shrink-0"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>How to Buy &amp; Send Crypto</span>
            </button>
          </div>

          {/* 1. Cryptocurrency selector */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
              1. Select Cryptocurrency Used
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {CRYPTO_WALLETS.map((w) => {
                const active = w.code === selectedCrypto;
                return (
                  <button
                    key={w.code}
                    type="button"
                    onClick={() => {
                      setSelectedCrypto(w.code);
                      setError('');
                    }}
                    className={`px-3 py-2.5 rounded-lg border text-left transition-colors ${
                      active
                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="text-xs font-semibold">{w.name}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {w.symbol}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Official Wallet Address & QR */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-5 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 items-center">
            <div className="space-y-3 min-w-0">
              <div className="text-xs text-slate-600 dark:text-slate-300">
                Send exactly <strong>${isAmountValid ? numericAmount.toFixed(2) : `${REGISTRATION_FEE_USD}.00`} USD</strong> equivalent via{' '}
                <strong>{activeWallet.networkLabel}</strong>:
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500 mb-1">
                  Official BlueWhale Registration Wallet Address
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 break-all">
                    {activeWallet.address}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyAddress}
                    className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg inline-flex items-center gap-1.5 shrink-0"
                  >
                    {copiedAddr ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedAddr ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
              <ol className="text-xs text-slate-500 dark:text-slate-400 space-y-1 list-decimal list-inside">
                <li>Copy the wallet address or scan the QR code from your crypto wallet/exchange.</li>
                <li>Transfer at least ${REGISTRATION_FEE_USD}.00 USD using the {activeWallet.networkLabel} network.</li>
                <li>Copy your blockchain Transaction ID (TXID) and upload a clear payment screenshot below.</li>
              </ol>
            </div>

            <div className="flex justify-center">
              <QrCodeCanvas
                value={activeWallet.address}
                size={136}
                label={`${activeWallet.name} Registration Fee`}
              />
            </div>
          </div>

          {/* 2. Payment Amount & TXID */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                2. Payment Amount (USD)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-500">
                  $
                </span>
                <input
                  type="number"
                  min={REGISTRATION_FEE_USD}
                  step="0.01"
                  required
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="w-full pl-7 pr-12 py-2.5 text-sm font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                  USD
                </span>
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                3. Transaction ID (TXID)
              </label>
              <input
                type="text"
                required
                minLength={8}
                value={txId}
                onChange={(e) => setTxId(e.target.value)}
                placeholder="Paste blockchain TXID / hash here"
                className="w-full px-3.5 py-2.5 text-sm font-mono bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              />
            </div>
          </div>

          {/* 4. Payment Screenshot */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                4. Payment Screenshot (Required)
              </label>
              <span className="text-[11px] text-slate-500">PNG, JPG, WEBP, GIF or PDF</span>
            </div>

            <input
              ref={fileInputRef}
              id="reg-payment-screenshot"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
              onChange={(e) => void handleFileSelected(e.target.files?.[0])}
              className="sr-only"
            />

            {!receiptDataUrl ? (
              <label
                htmlFor="reg-payment-screenshot"
                className="flex flex-col items-center justify-center gap-2 px-4 py-6 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:border-blue-500 cursor-pointer text-center"
              >
                <div className="w-9 h-9 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-blue-600">
                  <Upload className="w-4 h-4" />
                </div>
                <div className="text-xs font-medium text-slate-800 dark:text-slate-200">
                  {processingFile
                    ? 'Optimizing screenshot...'
                    : 'Click to upload your registration payment screenshot'}
                </div>
              </label>
            ) : (
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  {receiptDataUrl.startsWith('data:application/pdf') ? (
                    <div className="w-12 h-12 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-blue-600 shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                  ) : (
                    <img
                      src={receiptDataUrl}
                      alt="Registration screenshot preview"
                      className="w-12 h-12 rounded-lg object-cover border border-slate-200 dark:border-slate-800 bg-white shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                      {receiptFileName}
                    </div>
                    <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
                      Screenshot attached
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setReceiptDataUrl('');
                    setReceiptFileName('');
                  }}
                  className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            {showResubmitForm && (
              <button
                type="button"
                onClick={() => setShowResubmitForm(false)}
                className="px-4 py-2.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={submitting || processingFile || !isAmountValid || !receiptDataUrl}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg"
            >
              <span>{submitting ? 'Submitting Proof...' : 'Submit Registration Payment Proof'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>
      )}

      {/* Optional Email Verification + Recent Automated Email Notifications + Support Contact */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {authMode === 'jwt' && !user.isVerified && onVerifyOptionalEmail && (
          <form
            onSubmit={handleOptionalEmailVerify}
            className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3"
          >
            <div className="text-sm font-semibold text-slate-900 dark:text-white">
              Optional Email Verification
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Verify <strong>{user.email}</strong> (optional).
              {verificationPreviewCode && (
                <span className="block mt-1 font-mono text-blue-600 dark:text-blue-400">
                  Verification Code: <strong>{verificationPreviewCode}</strong>
                </span>
              )}
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                maxLength={6}
                value={emailCode}
                onChange={(e) => setEmailCode(e.target.value)}
                placeholder="6-digit code"
                className="flex-1 px-3 py-2 text-xs font-mono bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg"
              />
              <button
                type="submit"
                className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                Verify Email
              </button>
            </div>
            {emailVerifyMsg && <div className="text-xs text-emerald-600">{emailVerifyMsg}</div>}
            {emailVerifyErr && <div className="text-xs text-rose-600">{emailVerifyErr}</div>}
          </form>
        )}

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <Mail className="w-4 h-4 text-blue-600" />
            <span>Support &amp; Recent Email Dispatches</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Need assistance with your ${REGISTRATION_FEE_USD} registration verification? Contact our support team at{' '}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="font-semibold text-blue-600 dark:text-blue-400 hover:underline"
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
          {notifications.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800 max-h-40 overflow-y-auto">
              {notifications.slice(0, 3).map((n) => (
                <div key={n.id} className="text-xs p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950">
                  <div className="font-semibold text-slate-900 dark:text-white">{n.subject}</div>
                  <div className="text-slate-600 dark:text-slate-400 mt-0.5">{n.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
