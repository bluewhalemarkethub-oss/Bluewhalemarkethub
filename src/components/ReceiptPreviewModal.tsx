import React from 'react';
import { X, Download, FileText, CheckCircle2, Clock, XCircle, Check } from 'lucide-react';
import type { DepositRecord } from '../types/marketplace';

export interface GenericReceiptPreview {
  id: string;
  title: string;
  subtitle: string;
  amount: number;
  currency: string;
  txId: string;
  status: string;
  receiptUrl?: string;
  receiptDataUrl?: string;
  receiptFileName?: string;
  adminNote?: string;
  rejectionReason?: string;
}

interface ReceiptPreviewModalProps {
  deposit?: DepositRecord | null;
  previewItem?: GenericReceiptPreview | null;
  onClose: () => void;
  isAdmin?: boolean;
  busy?: boolean;
  onAdminReview?: (
    deposit: DepositRecord,
    decision: 'Approved' | 'Rejected',
    note: string,
    rejectionReason?: string,
  ) => Promise<void>;
}

export function ReceiptPreviewModal({
  deposit = null,
  previewItem = null,
  onClose,
  isAdmin = false,
  busy = false,
  onAdminReview,
}: ReceiptPreviewModalProps) {
  const active: GenericReceiptPreview | null = deposit
    ? {
        id: deposit.id,
        title: `$${deposit.amount.toFixed(2)} USD (${deposit.currency.replace('_', ' ')})`,
        subtitle: `Deposit Receipt Verification · ${deposit.userName || `@${deposit.username}`}`,
        amount: deposit.amount,
        currency: deposit.currency,
        txId: deposit.txHash,
        status: deposit.status,
        receiptUrl: deposit.receiptUrl,
        receiptDataUrl: deposit.receiptDataUrl,
        receiptFileName: deposit.receiptFileName,
        adminNote: deposit.adminNote,
        rejectionReason: deposit.rejectionReason,
      }
    : previewItem;

  if (!active) return null;

  const receiptSrc = active.receiptUrl || active.receiptDataUrl || '';
  const isPdf =
    receiptSrc.startsWith('data:application/pdf') ||
    receiptSrc.toLowerCase().endsWith('.pdf') ||
    Boolean(active.receiptFileName?.toLowerCase().endsWith('.pdf'));
  const fileName = active.receiptFileName || `receipt-${active.id}.${isPdf ? 'pdf' : 'jpg'}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="receipt-modal-title"
    >
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5 my-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {active.subtitle}
            </div>
            <h2
              id="receipt-modal-title"
              className="font-display text-lg font-bold text-slate-900 dark:text-white mt-0.5"
            >
              {active.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close receipt preview"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs">
          <div>
            <div className="text-slate-500">Status</div>
            <div className="mt-0.5 font-semibold">
              {active.status === 'Approved' && (
                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Approved
                </span>
              )}
              {(active.status === 'Pending' || active.status === 'Pending Review') && (
                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                  <Clock className="w-3.5 h-3.5" /> Pending Confirmation
                </span>
              )}
              {active.status === 'Rejected' && (
                <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400">
                  <XCircle className="w-3.5 h-3.5" /> Rejected
                </span>
              )}
            </div>
          </div>
          <div className="sm:col-span-2 min-w-0">
            <div className="text-slate-500">Transaction ID (TXID)</div>
            <div className="mt-0.5 font-mono text-slate-900 dark:text-slate-100 break-all">
              {active.txId}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 overflow-hidden">
          {!receiptSrc ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No payment screenshot or PDF attached to this record.
            </div>
          ) : isPdf ? (
            <div className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
                <span className="inline-flex items-center gap-1.5 font-medium truncate">
                  <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                  <span className="truncate">{fileName}</span>
                </span>
                <a
                  href={receiptSrc}
                  download={fileName}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download PDF</span>
                </a>
              </div>
              <object
                data={receiptSrc}
                type="application/pdf"
                className="w-full h-[380px] rounded-lg border border-slate-200 dark:border-slate-800 bg-white"
              >
                <div className="p-8 text-center text-xs text-slate-500">
                  PDF preview unavailable in this browser. Use the Download PDF button above to inspect the receipt.
                </div>
              </object>
            </div>
          ) : (
            <div className="p-3 flex flex-col items-center gap-3">
              <img
                src={receiptSrc}
                alt={`Payment screenshot ${fileName}`}
                className="max-h-[420px] w-auto object-contain rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
              />
              <div className="w-full flex items-center justify-between gap-2 px-1 text-xs text-slate-500">
                <span className="truncate font-mono">{fileName}</span>
                <a
                  href={receiptSrc}
                  download={fileName}
                  className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </a>
              </div>
            </div>
          )}
        </div>

        {active.rejectionReason && (
          <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
            <span className="font-semibold">Rejection Reason:</span> {active.rejectionReason}
          </div>
        )}

        {active.adminNote && (
          <div className="p-3 rounded-lg bg-slate-100 dark:bg-slate-800/60 text-xs text-slate-700 dark:text-slate-300">
            <span className="font-semibold">Admin Note:</span> {active.adminNote}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
          {deposit && isAdmin && deposit.status === 'Pending' && onAdminReview && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const reason = 'Receipt or transaction hash could not be verified.';
                  await onAdminReview(deposit, 'Rejected', reason, reason);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-950 rounded-lg disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" />
                <span>Reject Deposit</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  await onAdminReview(deposit, 'Approved', 'Receipt & on-chain transfer verified manually');
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Approve Deposit (+${deposit.amount.toFixed(2)})</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
