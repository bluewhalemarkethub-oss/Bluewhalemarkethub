# BlueWhale Markethub — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Identity Integrity**: Every document in `/users/{userId}`, `/users/{userId}/private/{docId}`, `/registrationPayments/{paymentId}`, `/deposits/{depositId}`, `/orders/{orderId}`, `/transactions/{txId}`, `/notifications/{notifId}`, `/loginLogs/{logId}`, and `/priceAlerts/{alertId}` must bind its owner UID to `request.auth.uid` on create (except admin-authored credit/refund transactions or admin-dispatched notifications).
2. **Mandatory $5 Registration Fee & Status Gate**:
   - New non-admin users must register with initial `status == 'Pending Payment'` and cannot self-approve (`Approved`), self-set `approvedAt`, or edit `adminNotes` / `rejectionReason`.
   - `/registrationPayments/{paymentId}` requires `amount >= 5`, `status == 'Pending'`, a valid `txId`, and uploaded payment screenshot (`receiptDataUrl`). Only `isAdmin()` can transition a registration payment or user status to `'Approved'` or `'Rejected'`.
   - Any user whose `status` is `'Pending Payment'`, `'Rejected'`, or `'Suspended'` is blocked from creating deposits, orders, transactions, or price alerts.
3. **Minimum Deposit & Terminal State Locking**: All wallet deposits must have `amount >= 100`, initial `status == 'Pending'`, and once transitioned by an admin to `'Approved'` or `'Rejected'`, can never be altered.
4. **Wallet Balance Integrity**: Non-admin users can never increase their own `walletBalance`, `totalDeposits`, `role`, `status`, or `isVerified`. Users can only decrement `walletBalance` during a legitimate account service purchase (`walletBalance >= 0`).
5. **PII Isolation**: User email, phone number, and IP tracking data live in `/users/{userId}/private/info` and are strictly readable only by `isOwner(userId) || isAdmin()`.
6. **Query Enforcer**: All `allow list` rules evaluate `resource.data.userId == request.auth.uid || isAdmin()` without `get()`/`exists()` inside list blocks (and `/servicePricing` explicitly checks `resource.data.isPublic == true`).
7. **Admin Verified Email & Exclusive Email Mandate**: Admin privilege (`isAdmin()`) strictly requires `request.auth.token.email_verified == true && request.auth.token.email == 'johnblessing9977@gmail.com'`. No other user may access `/adminLogs`, approve/suspend accounts, or modify `/siteSettings` or `/servicePricing`.
8. **Price Alert & Pricing Integrity**: Only `isAdmin()` can write `/servicePricing/{serviceId}` (with prices `>= 100`). Customers can only create `Active` alerts bound to their own `uid` and cannot mark an alert `Triggered` unless `triggeredPrice < existing().targetPrice`.
9. **Immutable Admin Audit Logs & Login Tracking**: `/adminLogs/{logId}` is append-only (`update, delete: if false`) and readable/writable exclusively by `isAdmin()`. User `lastLoginAt` is recorded on every login.

## 2. The Adversarial Payload Matrix
1. **Unauthenticated Deposit Create**: `{ userId: "u1", amount: 500, status: "Pending" }` with `request.auth == null` -> `PERMISSION_DENIED`.
2. **Unverified Email Spoof Admin**: `request.auth.token.email == "johnblessing9977@gmail.com"`, `email_verified: false` -> `PERMISSION_DENIED`.
3. **Self-Assigned Admin Role or Approved Status on Signup**: `/users/u1` create with `{ role: "admin", status: "Approved", walletBalance: 99999 }` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection (Ghost Field)**: `/deposits/d1` create with `{ ..., isApprovedByBot: true }` -> `PERMISSION_DENIED`.
5. **Deposit Below Minimum ($100)**: `/deposits/d1` create with `{ amount: 50, status: "Pending" }` -> `PERMISSION_DENIED`.
6. **Deposit Status Shortcutting**: `/deposits/d1` create by customer with `{ amount: 250, status: "Approved" }` -> `PERMISSION_DENIED`.
7. **Terminal Deposit Tampering**: Update `/deposits/d1` where `existing.status == 'Approved'` -> `PERMISSION_DENIED`.
8. **Wallet Self-Inflation**: Non-admin updates `/users/u1` with `{ walletBalance: 50000 }` -> `PERMISSION_DENIED`.
9. **ID Poisoning Attack**: Create `/orders/<1500-char-invalid-id>` -> `PERMISSION_DENIED`.
10. **PII Cross-User Read**: User `u2` reads `/users/u1/private/info` -> `PERMISSION_DENIED`.
11. **Blanket List Scraping**: User `u2` queries `/orders` or `/registrationPayments` without `where('userId', '==', 'u2')` -> `PERMISSION_DENIED`.
12. **Timestamp Forgery**: Create `/orders/o1` with client-supplied past timestamp `createdAt != request.time` -> `PERMISSION_DENIED`.
13. **Non-Admin Service Price Manipulation**: Non-admin writes `/servicePricing/ups-verified-account` -> `PERMISSION_DENIED`.
14. **Forged Price Alert Trigger**: Triggering `/priceAlerts/pa_1` with `triggeredPrice >= existing().targetPrice` -> `PERMISSION_DENIED`.
15. **Pending Payment Order/Deposit Bypass**: User `u1` with `status: 'Pending Payment'` creates `/orders/ord_002` or `/deposits/dep_005` -> `PERMISSION_DENIED`.
16. **Registration Payment Below $5 or Self-Approval**: User `u1` creates `/registrationPayments/reg_1` with `{ amount: 2, status: "Approved" }` -> `PERMISSION_DENIED`.
