import React, { useRef, useState } from 'react';
import {
  X,
  Copy,
  Check,
  ShieldAlert,
  ArrowRight,
  Wallet,
  Upload,
  FileText,
  Trash2,
  BookOpen,
} from 'lucide-react';
import { CRYPTO_WALLETS, type CryptoCurrencyCode } from '../data/shippingCatalog';
import { apiRequest } from '../lib/apiClient';
import { QrCodeCanvas } from './QrCodeCanvas';
import { mapCurrencyCodeToAssetTab, type InstructionAssetTab } from './PaymentInstructionsModal';

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenInstructions?: (asset: InstructionAssetTab) => void;
  onSubmitDeposit: (payload: {
    amount: number;
    currency: CryptoCurrencyCode;
    walletAddress: string;
    txHash: string;
    receiptDataUrl: string;
    receiptFileName: string;
  }) => Promise<void>;
}

const MAX_RECEIPT_DATA_URL_CHARS = 450000;

async function processReceiptFile(
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
    throw new Error('Unsupported file format. Upload a PNG, JPG, WEBP, GIF screenshot or a PDF receipt.');
  }

  const cleanName = file.name.trim().slice(0, 160) || 'payment-receipt';

  if (file.type === 'application/pdf') {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read the selected PDF file.'));
      reader.readAsDataURL(file);
    });
    if (dataUrl.length > MAX_RECEIPT_DATA_URL_CHARS) {
      throw new Error(
        'PDF receipt exceeds the 320 KB limit. Please compress the PDF or upload a screenshot image instead.',
      );
    }
    return { dataUrl, fileName: cleanName };
  }

  // Compress/resize raster image cleanly via offscreen canvas so high-res screenshots fit safely
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Invalid image file. Please select a valid receipt screenshot.'));
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
      if (!ctx) throw new Error('Image processing is unavailable in this browser.');
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
      throw new Error('Receipt image is too large even after compression. Please upload a smaller screenshot.');
    }
    return { dataUrl, fileName: cleanName };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function DepositModal({
  isOpen,
  onClose,
  onOpenInstructions,
  onSubmitDeposit,
}: DepositModalProps) {
  const [selectedCode, setSelectedCode] = useState<CryptoCurrencyCode>('BTC');
  const [amountInput, setAmountInput] = useState<string>('250');
  const [txHash, setTxHash] = useState<string>('');
  const [receiptDataUrl, setReceiptDataUrl] = useState<string>('');
  const [receiptFileName, setReceiptFileName] = useState<string>('');
  const [processingReceipt, setProcessingReceipt] = useState(false);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const activeWallet = CRYPTO_WALLETS.find((w) => w.code === selectedCode) || CRYPTO_WALLETS[0];
  const numericAmount = Number(amountInput);
  const isAmountValid = !Number.isNaN(numericAmount) && numericAmount >= 100;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(activeWallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked
    }
  }

  async function handleFileSelected(file: File | null | undefined) {
    if (!file) return;
    setError('');
    setSuccessMsg('');
    setProcessingReceipt(true);
    try {
      const processed = await processReceiptFile(file);
      setReceiptDataUrl(processed.dataUrl);
      setReceiptFileName(processed.fileName);
    } catch (err) {
      setReceiptDataUrl('');
      setReceiptFileName('');
      setError(err instanceof Error ? err.message : 'Unable to process payment receipt.');
    } finally {
      setProcessingReceipt(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  function clearReceipt() {
    setReceiptDataUrl('');
    setReceiptFileName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!isAmountValid) {
      setError('Minimum deposit amount is $100.00 USD.');
      return;
    }
    if (txHash.trim().length < 10) {
      setError('Please enter a valid blockchain transaction hash (minimum 10 characters).');
      return;
    }
    if (!receiptDataUrl || !receiptFileName) {
      setError('Please upload your payment receipt screenshot or PDF before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      // Anti-fraud pre-screen check on Express backend
      await apiRequest('/api/security/antifraud-check', {
        method: 'POST',
        body: {
          action: 'deposit',
          amount: numericAmount,
          txHash: txHash.trim(),
        },
      });

      await onSubmitDeposit({
        amount: numericAmount,
        currency: activeWallet.code,
        walletAddress: activeWallet.address,
        txHash: txHash.trim(),
        receiptDataUrl,
        receiptFileName,
      });

      setSuccessMsg(
        `Deposit of $${numericAmount.toFixed(2)} (${activeWallet.name}) and payment receipt submitted with status Pending. Your wallet balance updates once an administrator manually confirms and approves the payment.`,
      );
      setTxHash('');
      clearReceipt();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit deposit.');
    } finally {
      setSubmitting(false);
    }
  }

  const approxSizeKb = receiptDataUrl ? Math.max(1, Math.round((receiptDataUrl.length * 0.75) / 1024)) : 0;
  const isPdfReceipt = receiptDataUrl.startsWith('data:application/pdf');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deposit-modal-title"
    >
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 my-8">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close deposit modal"
          className="absolute top-5 right-5 p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 flex items-center justify-center">
            <Wallet className="w-5 h-5" />
          </div>
          <div>
            <h2 id="deposit-modal-title" className="font-display text-xl font-bold text-slate-900 dark:text-white">
              Deposit Funds via Cryptocurrency
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Minimum Deposit: $100.00 · Maximum Deposit: Unlimited
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          {/* Step 1: Select Crypto */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                1. Select Cryptocurrency Network
              </label>
              {onOpenInstructions && (
                <button
                  type="button"
                  onClick={() => onOpenInstructions(mapCurrencyCodeToAssetTab(selectedCode))}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>New to crypto? Step-by-step payment guide</span>
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {CRYPTO_WALLETS.map((w) => {
                const active = w.code === selectedCode;
                return (
                  <button
                    key={w.code}
                    type="button"
                    onClick={() => {
                      setSelectedCode(w.code);
                      setError('');
                    }}
                    className={`px-3 py-2.5 rounded-lg border text-left transition-colors ${
                      active
                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-semibold whitespace-nowrap">{w.name}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {w.symbol}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2: Deposit Amount */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              2. Deposit Amount (USD Equivalent)
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono text-slate-500">
                $
              </span>
              <input
                type="number"
                min={100}
                step="0.01"
                required
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className="w-full pl-8 pr-16 py-2.5 text-sm font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                USD
              </span>
            </div>
            {!isAmountValid && amountInput !== '' && (
              <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" />
                Minimum deposit is $100.00 USD.
              </p>
            )}
          </div>

          {/* Step 3: Address + QR */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-5 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 items-center">
            <div className="space-y-3 min-w-0">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Send <span className="font-semibold text-slate-900 dark:text-white">${isAmountValid ? numericAmount.toFixed(2) : '100.00'}</span> via{' '}
                <span className="font-semibold text-slate-900 dark:text-white">{activeWallet.networkLabel}</span>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500 mb-1">
                  Destination Wallet Address
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 break-all">
                    {activeWallet.address}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors inline-flex items-center gap-1.5 shrink-0"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Required confirmations: <span className="font-mono tabular-nums">{activeWallet.confirmationsRequired}</span> · Credited to wallet after manual admin confirmation
              </div>
            </div>

            <div className="flex justify-center">
              <QrCodeCanvas
                value={activeWallet.address}
                size={140}
                label={`${activeWallet.name} Deposit QR`}
              />
            </div>
          </div>

          {/* Step 4: Transaction Hash */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              3. Submit Blockchain Transaction Hash (TxID)
            </label>
            <input
              type="text"
              required
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
              placeholder="Paste transaction hash after broadcasting transfer"
              className="w-full px-3.5 py-2.5 text-sm font-mono bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          {/* Step 5: Upload Payment Receipt */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                4. Upload Payment Receipt (Screenshot or PDF)
              </label>
              <span className="text-[11px] text-slate-500">Required for manual confirmation</span>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
              onChange={(e) => handleFileSelected(e.target.files?.[0])}
              className="sr-only"
              id="deposit-receipt-input"
            />

            {!receiptDataUrl ? (
              <label
                htmlFor="deposit-receipt-input"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void handleFileSelected(e.dataTransfer.files?.[0]);
                }}
                className="flex flex-col items-center justify-center gap-2 px-4 py-6 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:border-blue-500 dark:hover:border-blue-500 transition-colors cursor-pointer text-center"
              >
                <div className="w-9 h-9 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <Upload className="w-4 h-4" />
                </div>
                <div className="text-xs font-medium text-slate-800 dark:text-slate-200">
                  {processingReceipt
                    ? 'Processing payment receipt...'
                    : 'Click to upload or drag & drop your transfer receipt'}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Supports PNG, JPG, WEBP, GIF screenshots (auto-optimized) or PDF up to 320 KB
                </div>
              </label>
            ) : (
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  {isPdfReceipt ? (
                    <div className="w-14 h-14 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-blue-600 shrink-0">
                      <FileText className="w-6 h-6" />
                    </div>
                  ) : (
                    <img
                      src={receiptDataUrl}
                      alt="Uploaded payment receipt preview"
                      className="w-14 h-14 rounded-lg object-cover border border-slate-200 dark:border-slate-800 bg-white shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                      {receiptFileName}
                    </div>
                    <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                      Ready · ~{approxSizeKb} KB
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <label
                    htmlFor="deposit-receipt-input"
                    className="px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                  >
                    Replace
                  </label>
                  <button
                    type="button"
                    onClick={clearReceipt}
                    aria-label="Remove uploaded receipt"
                    className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-sm text-emerald-800 dark:text-emerald-200">
              {successMsg}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={submitting || processingReceipt || !isAmountValid || !receiptDataUrl}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors"
            >
              <span>{submitting ? 'Submitting...' : 'Submit Deposit & Receipt'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
