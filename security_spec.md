# Security Specification: AimoGate Zero-Trust Firestore Rules

## 1. Architecture & Data Invariants
- **Server-Authoritative Gateway**: All reads and writes to AimoGate's operational collections (`/policies`, `/products`, `/contract_prices`, `/warehouse_stock`, `/quote_locks`, `/orders`, `/recurrent_grants`, `/scheduled_prompts`, `/audit_logs`, `/system_config`) execute exclusively through the Express/MCP gateway (`firebase-admin`) enforcing `agent` vs `human` vs `admin` principal scopes.
- **Zero-Trust Direct Client Isolation**: Direct browser/SDK access to operational collections is **strictly denied** so external buyer agents or unauthenticated clients can never inspect `/products` (`internal_cost_eur`, `internal_margin_pct`, `roadmap_status`) or mutate `/orders` or `/policies`.
- **Health Check Document**: Only `get` on `/test/connection` is permitted for client SDK connectivity verification (`getDocFromServer`).
- **Admin Bootstrapped Identity**: Platform admin access is verified solely via `/admins/$(request.auth.uid)` lookup or verified admin email (`devstar7631@gcplab.me` with `email_verified == true`), never client-supplied custom claims.

## 2. Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. Unauthenticated read on `/products/VA-LF-MILK-10L` (attempts to leak `internal_margin_pct`).
2. Unauthenticated list on `/orders` (attempts blanket order scraping).
3. Authenticated non-admin read on `/products/VA-ROADMAP-Q4-PRO` (attempts unreleased roadmap SKU leak).
4. Authenticated non-admin write on `/orders/ORD-123` setting `status: 'CONFIRMED'` (attempts self-approval bypass).
5. Authenticated non-admin update on `/policies/hotel_nordic_group` raising `max_auto_approve_eur` to `999999`.
6. Unverified email admin spoof (`email: 'devstar7631@gcplab.me'`, `email_verified: false`) writing to `/policies`.
7. Shadow update injecting ghost field `isAdmin: true` into `/admins/{uid}`.
8. Resource poisoning with a 1MB document ID on `/orders/{oversizedId}`.
9. Direct write/delete on `/audit_logs/{logId}` to tamper with audit trail.
10. Direct write on `/warehouse_stock/VA-LF-MILK-10L` setting `available_packs: 100000`.
11. Direct write on `/system_config/gateway` setting `killswitch_halted: false`.
12. Blanket list on `/test` collection (`allow list` denied; only single-doc `get` on `/test/connection` allowed).
