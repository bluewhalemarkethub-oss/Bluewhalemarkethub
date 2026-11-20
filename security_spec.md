# BlueWhale Markethub — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Identity Integrity**: Every document in `/users/{userId}`, `/users/{userId}/private/{docId}`, `/deposits/{depositId}`, `/orders/{orderId}`, `/transactions/{txId}`, `/notifications/{notifId}`, `/loginLogs/{logId}`, and `/priceAlerts/{alertId}` must bind its owner UID to `request.auth.uid` on create (except admin-authored credit/refund transactions or admin-dispatched price alert notifications).
2. **Minimum Deposit & Terminal State Locking**: All deposits must have `amount >= 100`, initial `status == 'Pending'`, and once transitioned by an admin to `'Approved'` or `'Rejected'`, can never be altered.
3. **Wallet Balance Integrity**: Non-admin users can never increase their own `walletBalance`, `totalDeposits`, `role`, `status`, or `isVerified`. Users can only decrement `walletBalance` during a legitimate shipping service purchase (`walletBalance >= 0`).
4. **PII Isolation**: User email, phone number, and IP tracking data live in `/users/{userId}/private/info` and are strictly readable only by `isOwner(userId) || isAdmin()`.
5. **Query Enforcer**: All `allow list` rules evaluate `resource.data.userId == request.auth.uid || isAdmin()` without `get()`/`exists()` inside list blocks (and `/servicePricing` explicitly checks `resource.data.isPublic == true`).
6. **Verified Email Mandate**: All authenticated mutations require `request.auth.token.email_verified == true`.
7. **Price Alert & Pricing Integrity**: Only `isAdmin()` can write `/servicePricing/{serviceId}` (with prices `>= 100`). Customers can only create `Active` alerts bound to their own `uid` and cannot mark an alert `Triggered` unless `triggeredPrice < existing().targetPrice`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Deposit Create**: `{ userId: "u1", amount: 500, status: "Pending" }` with `request.auth == null` -> `PERMISSION_DENIED`.
2. **Unverified Email Spoof Admin**: `request.auth.token.email == "johnblessing9977@gmail.com"`, `email_verified: false` -> `PERMISSION_DENIED`.
3. **Self-Assigned Admin Role on Signup**: `/users/u1` create with `{ role: "admin", walletBalance: 99999 }` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection (Ghost Field)**: `/deposits/d1` create with `{ ..., isApprovedByBot: true }` -> `PERMISSION_DENIED`.
5. **Deposit Below Minimum ($100)**: `/deposits/d1` create with `{ amount: 50, status: "Pending" }` -> `PERMISSION_DENIED`.
6. **Deposit Status Shortcutting**: `/deposits/d1` create by customer with `{ amount: 250, status: "Approved" }` -> `PERMISSION_DENIED`.
7. **Terminal Deposit Tampering**: Update `/deposits/d1` where `existing.status == 'Approved'` -> `PERMISSION_DENIED`.
8. **Wallet Self-Inflation**: Non-admin updates `/users/u1` with `{ walletBalance: 50000 }` -> `PERMISSION_DENIED`.
9. **ID Poisoning Attack**: Create `/orders/<1500-char-invalid-id>` -> `PERMISSION_DENIED`.
10. **PII Cross-User Read**: User `u2` reads `/users/u1/private/info` -> `PERMISSION_DENIED`.
11. **Blanket List Scraping**: User `u2` queries `/orders` or `/priceAlerts` without `where('userId', '==', 'u2')` -> `PERMISSION_DENIED`.
12. **Timestamp Forgery**: Create `/orders/o1` with client-supplied past timestamp `createdAt != request.time` -> `PERMISSION_DENIED`.
13. **Non-Admin Service Price Manipulation**: Non-admin writes `/servicePricing/ups-verified-account` -> `PERMISSION_DENIED`.
14. **Forged Price Alert Trigger**: Triggering `/priceAlerts/pa_1` with `triggeredPrice >= existing().targetPrice` -> `PERMISSION_DENIED`.

