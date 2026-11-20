import type { ShippingOrder, WalletTransaction } from '../types/marketplace';

function triggerDownload(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadOrderInvoice(order: ShippingOrder) {
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Invoice ${order.trackingCode}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;color:#0f172a;line-height:1.5}
.hdr{display:flex;justify-content:space-between;border-bottom:2px solid #1d4ed8;padding-bottom:16px;margin-bottom:24px}
.tbl{width:100%;border-collapse:collapse;margin-top:24px}.tbl th,.tbl td{border-bottom:1px solid #e2e8f0;padding:10px;text-align:left}</style>
</head>
<body>
  <div class="hdr">
    <div><h1 style="margin:0;font-size:20px">BlueWhale Markethub</h1><div>Official Verified Account Invoice</div></div>
    <div style="text-align:right"><strong>Activation Ref:</strong> ${order.trackingCode}<br/><strong>Date:</strong> ${new Date(order.createdAt).toLocaleString()}</div>
  </div>
  <p><strong>Billed To:</strong> @${order.username} (${order.userEmail})<br/>
  <strong>Account Holder / Entity:</strong> ${order.recipientName || order.username} · ${order.destinationCity || order.country}</p>
  <table class="tbl">
    <thead><tr><th>Provider</th><th>Account Package</th><th>Tier</th><th>Country</th><th>Status</th><th>Amount (USD)</th></tr></thead>
    <tbody><tr><td>${order.providerName}</td><td>${order.serviceName}</td><td>${order.accountType || 'Personal'}</td><td>${order.country}</td><td>${order.status}</td><td>$${order.price.toFixed(2)}</td></tr></tbody>
  </table>
  <p style="margin-top:24px;font-size:12px;color:#475569">BlueWhale Markethub provides verified Personal, Business, and Corporate accounts for organizations worldwide.</p>
</body></html>`;
  triggerDownload(`BlueWhale-Invoice-${order.trackingCode}.html`, html);
}

export function downloadTransactionReceipt(tx: WalletTransaction, username: string) {
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Receipt ${tx.id}</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;color:#0f172a;line-height:1.5}
.box{border:1px solid #cbd5e1;border-radius:10px;padding:24px}</style>
</head>
<body>
  <div class="box">
    <h1 style="margin-top:0;font-size:18px;color:#1d4ed8">BlueWhale Markethub — Wallet Transaction Receipt</h1>
    <p><strong>Transaction ID:</strong> ${tx.id}<br/>
    <strong>Reference:</strong> ${tx.referenceId}<br/>
    <strong>Account:</strong> @${username}<br/>
    <strong>Date:</strong> ${new Date(tx.createdAt).toLocaleString()}<br/>
    <strong>Type:</strong> ${tx.type.toUpperCase()} (${tx.direction})<br/>
    <strong>Description:</strong> ${tx.description}<br/>
    <strong>Status:</strong> ${tx.status}<br/>
    <strong>Amount:</strong> ${tx.direction === 'credit' ? '+' : '-'}$${tx.amount.toFixed(2)} USD</p>
  </div>
</body></html>`;
  triggerDownload(`BlueWhale-Receipt-${tx.id}.html`, html);
}
