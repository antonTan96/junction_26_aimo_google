# MVP Requirements Document: AimoGate

**Product Name:** AimoGate (Zero-Trust B2B Trade & Governance Gateway)  
**Target Domain:** B2B Foodservice Wholesale (Valio Aimo Agentic Commerce)  
**Build Context:** 48-Hour Hackathon MVP (Team Size: 1)  
**Primary Tech Stack:** Python (FastAPI + MCP SDK), MariaDB, Next.js + Tailwind CSS, Verda AI Cloud (NVIDIA Nemotron), Hostinger  

---

## 1. Executive Summary & MVP Objective

### 1.1 Purpose
AimoGate is a wholesaler-owned protocol boundary and deterministic policy firewall that enables external autonomous purchasing agents (e.g., hotel chain procurement bots) to look up fixed contract pricing, verify cold-chain stock availability, lock quotes, and place orders with Valio Aimo—without exposing underlying ERP databases, internal margins, or unreleased product roadmaps.

### 1.2 Core Hackathon Scenario (North Star Demo)
A hotel chain's autonomous purchasing agent receives the request:
> *"I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability."*

The MVP must prove end-to-end execution of this workflow:
1. **Structured Discovery:** Agent queries available lactose-free milk SKUs, resolves packaging formats (e.g., `100 × 10L Bag-in-Box` vs. `1,000 × 1L cartons`), and retrieves fixed customer contract prices.
2. **Two-Phase Commitment:** Agent creates a 15-minute soft stock reservation (`lock_quote`) and submits an order (`commit_order`).
3. **Deterministic Governance & Human Sign-Off:** Because the €1,180.00 order exceeds the agent's €800.00 autonomous spend cap, AimoGate blocks auto-commit, holds the stock reservation in `PENDING_APPROVAL`, and routes a structured approval card to a human F&B manager for one-click sign-off.
4. **Zero-Trust Isolation:** Internal wholesale margins and unreleased Q4 roadmap SKUs stored in the database never appear in any external agent payload.

---

## 2. User Roles & Identity Principals

AimoGate enforces strict cryptographic separation between machine agents and human approvers.

| Principal Role | Token Claim (`principal_type`) | Allowed Scopes | Capabilities & Restrictions |
| :--- | :--- | :--- | :--- |
| **External Buyer Agent** | `agent` | `offers:read`, `quotes:lock`, `orders:submit` | Can search tenant-authorized catalog, lock quotes, and submit orders. **Blocked (`403`)** from calling `/approve` or reading internal cost/roadmap fields. |
| **Human F&B Manager** | `human` | `orders:approve`, `orders:reject`, `policies:update` | Authenticated via human web UI session. Sole principal authorized to approve/reject `PENDING_APPROVAL` orders and adjust spend thresholds. |
| **Valio Aimo Platform Admin** | `admin` | `catalog:inspect`, `demo:reset` | Used in the hackathon control plane to inspect raw DB records vs. redacted external payloads and reset demo state. |

---

## 3. Scope Definition (MoSCoW Prioritization)

### 3.1 Must Have (Core MVP — Hours 0–28)
* **M1 — Scoped Catalog & Unit-Normalized Lookup (`search_offers`):** REST + MCP tool returning active, tenant-authorized SKUs with contract pricing, pack-size conversion, and delivery-cutoff feasibility.
* **M2 — Zero-Trust Field Projection & Roadmap Shielding:** Server-side DTO serialization that physically strips internal margins, supplier costs, and `UNRELEASED` roadmap SKUs.
* **M3 — Two-Phase Fixed-Price Quote Lock (`lock_quote` & `commit_order`):** Atomic MariaDB row-level stock reservation (`15-minute TTL`) preventing price drift or overselling during human approval latency.
* **M4 — Deterministic Server-Side Policy Engine:** Rule evaluator checking spend caps, volume limits, and allowed categories before confirming any order.
* **M5 — Human-in-the-Loop (HITL) Approval Inbox:** Web UI allowing a human manager to review held orders, see the exact violated policy rule, and click **Approve** or **Reject**.
* **M6 — 3-Pane Hackathon Control Plane UI:** Split-screen interface displaying (1) Buyer Agent Execution Trace, (2) Zero-Trust Payload & Policy Firewall Inspector, and (3) Manager Approval Inbox & Confirmed Order Ledger.

### 3.2 Should Have (High-Impact Polish — Hours 28–34)
* **S1 — Live Verda / Nemotron LLM Agent Driver:** Uses Verda AI inference (NVIDIA Nemotron) to translate free-text buyer requests into structured MCP/REST tool calls, paired with an instant **Deterministic Replay** toggle for offline reliability.
* **S2 — Interactive Policy Threshold Slider:** Live slider allowing judges to change `max_auto_approve_eur` (e.g., €800 → €1,500) during the demo and observe immediate auto-approval behavior.
* **S3 — One-Click Demo Reset:** Endpoint (`POST /api/v1/demo/reset`) restoring initial warehouse stock, clearing test orders, and resetting policy rules in <100ms.

### 3.3 Explicit Exclusions (Out of Scope for 48 Hours)
* Live SAP/ERP connectors or EDIFACT/cXML message translators.
* Multi-round free-text price negotiation or dynamic spot bidding.
* Payment gateway / credit card / blockchain settlement integration.
* Full WebAuthn biometric passkey hardware ceremony (simulated via distinct `principal_type: "human"` vs. `"agent"` JWT enforcement in MVP).

---

## 4. Functional Requirements

### FR-1: Structured Offer Lookup & Pack-Size Resolution
* **Endpoint / Tool:** `POST /api/v1/tools/search_offers` (also exposed as MCP tool `search_offers`)
* **Inputs:**
  * `query` (string, e.g., `"lactose-free milk"`)
  * `attributes` (list of strings, e.g., `["lactose-free"]`)
  * `required_volume_litres` (float, optional, e.g., `1000.0`)
  * `deliver_by` (ISO-8601 datetime, e.g., `"2026-11-16T06:00:00Z"`)
* **System Behavior:**
  1. Extract `tenant_id` and `allowed_categories` from the caller's verified JWT.
  2. Query `products` joined with `tenant_contract_prices` and `warehouse_stock` where `is_active = TRUE` and `roadmap_status = 'LIVE'`.
  3. Compute `packs_required = ceil(required_volume_litres / pack_volume_litres)` and `total_contract_price_eur = packs_required * unit_contract_price_eur`.
  4. Check stock sufficiency (`available_packs >= packs_required`) and cold-chain cutoff lead time.
  5. Serialize through `PublicOfferDTO` (omitting `internal_cost_eur`, `margin_pct`, `total_warehouse_units`, and `roadmap_status`).

### FR-2: Two-Phase Fixed-Price Quote Locking
* **Endpoint / Tool:** `POST /api/v1/tools/lock_quote` (MCP tool `lock_quote`)
* **Inputs:** `sku` (string), `pack_quantity` (int), `deliver_by` (ISO-8601 datetime)
* **System Behavior:**
  1. Begin ACID transaction in MariaDB (`SELECT ... FOR UPDATE` on `warehouse_stock`).
  2. Verify `available_packs >= pack_quantity` and `deliver_by` satisfies lead time.
  3. Decrement `available_packs` and increment `reserved_packs`.
  4. Insert record into `quote_locks` with `status = 'LOCKED'`, fixed `locked_total_eur`, and `expires_at = NOW() + INTERVAL 15 MINUTE`.
  5. Return `quote_id`, `locked_total_eur`, `pack_quantity`, and `expires_at`.

### FR-3: Order Submission & Policy Firewall Evaluation
* **Endpoint / Tool:** `POST /api/v1/tools/commit_order` (MCP tool `commit_order`)
* **Inputs:** `quote_id` (string), `po_reference` (string, idempotency key)
* **System Behavior:**
  1. Verify idempotency: if `po_reference` already exists for `tenant_id`, return existing order state without duplicating.
  2. Validate `quote_id` belongs to `tenant_id`, has `status = 'LOCKED'`, and `expires_at > NOW()`.
  3. Fetch tenant rules from `tenant_policies` (`max_auto_approve_eur`, `max_auto_approve_litres`, `allowed_categories`).
  4. Evaluate deterministic rules:
     * **All Rules Pass:** Set order `status = 'CONFIRMED'`, convert `reserved_packs` into permanent deduction, log `AUTO_APPROVED` in `audit_logs`.
     * **Any Rule Fails:** Set order `status = 'PENDING_APPROVAL'`, record structured `violation_reasons` (e.g., `["Order total €1,180.00 exceeds autonomous limit of €800.00"]`), retain `quote_lock`, and publish to the Manager Approval Inbox.

### FR-4: Human Approval & Rejection Gate
* **Endpoints:** `POST /api/v1/orders/{order_id}/approve` and `POST /api/v1/orders/{order_id}/reject`
* **Authorization Guard:** Reject with `403 Forbidden` unless caller token has `principal_type == "human"` and scope `orders:approve`.
* **System Behavior:**
  * **On Approve:** Transition `orders.status` from `PENDING_APPROVAL` → `CONFIRMED`, finalize stock deduction, mark `quote_locks.status = 'CONSUMED'`, and append signed manager approval record to `audit_logs`.
  * **On Reject:** Transition `orders.status` → `REJECTED`, release `reserved_packs` back to `available_packs`, mark `quote_locks.status = 'RELEASED'`, and log rejection reason.

---

## 5. Non-Functional & Zero-Trust Security Requirements

* **NFR-1 (Zero Raw ERP Exposure):** All gateway queries must execute solely against the isolated `aimogate` MariaDB schema; no direct ERP credentials or internal network routes may exist in the gateway container.
* **NFR-2 (Anti-Hallucination Math):** Unit conversions (litres to wholesale cartons/bag-in-box) and price calculations must execute strictly in deterministic Python/SQL code, never by the LLM.
* **NFR-3 (Response Latency):** Deterministic API endpoints (`search_offers`, `lock_quote`, `commit_order`) must respond in **< 150ms**; full LLM-driven agent run must complete in **< 5 seconds**.
* **NFR-4 (Offline Demo Resilience):** The frontend must provide a toggle between **Live Verda LLM Mode** and **Local Deterministic Mode** so demonstrations succeed even without internet access.

---

## 6. Database Schema (MariaDB)

```sql
CREATE TABLE products (
    sku VARCHAR(32) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    category VARCHAR(64) NOT NULL,
    dietary_tags JSON NOT NULL,               -- e.g., ["lactose-free", "gluten-free"]
    pack_format VARCHAR(64) NOT NULL,         -- e.g., "10L Bag-in-Box", "12x1L Carton"
    pack_volume_litres DECIMAL(10,2) NOT NULL,
    min_lead_time_hours INT NOT NULL DEFAULT 24,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    -- Confidential internal columns (NEVER exposed to external agents)
    internal_cost_eur DECIMAL(10,2) NOT NULL,
    internal_margin_pct DECIMAL(5,2) NOT NULL,
    roadmap_status ENUM('LIVE', 'UNRELEASED') NOT NULL DEFAULT 'LIVE'
);

CREATE TABLE tenant_contract_prices (
    tenant_id VARCHAR(64) NOT NULL,
    sku VARCHAR(32) NOT NULL,
    contract_pack_price_eur DECIMAL(10,2) NOT NULL,
    PRIMARY KEY (tenant_id, sku),
    FOREIGN KEY (sku) REFERENCES products(sku)
);

CREATE TABLE warehouse_stock (
    sku VARCHAR(32) PRIMARY KEY,
    available_packs INT NOT NULL,
    reserved_packs INT NOT NULL DEFAULT 0,
    FOREIGN KEY (sku) REFERENCES products(sku)
);

CREATE TABLE tenant_policies (
    tenant_id VARCHAR(64) PRIMARY KEY,
    tenant_name VARCHAR(128) NOT NULL,
    max_auto_approve_eur DECIMAL(10,2) NOT NULL DEFAULT 800.00,
    max_auto_approve_litres DECIMAL(10,2) NOT NULL DEFAULT 600.00,
    allowed_categories JSON NOT NULL
);

CREATE TABLE quote_locks (
    quote_id VARCHAR(32) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    sku VARCHAR(32) NOT NULL,
    pack_quantity INT NOT NULL,
    total_litres DECIMAL(10,2) NOT NULL,
    locked_total_eur DECIMAL(10,2) NOT NULL,
    deliver_by DATETIME NOT NULL,
    status ENUM('LOCKED', 'CONSUMED', 'RELEASED', 'EXPIRED') NOT NULL DEFAULT 'LOCKED',
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
    order_id VARCHAR(32) PRIMARY KEY,
    quote_id VARCHAR(32) NOT NULL UNIQUE,
    tenant_id VARCHAR(64) NOT NULL,
    po_reference VARCHAR(64) NOT NULL,
    status ENUM('CONFIRMED', 'PENDING_APPROVAL', 'REJECTED') NOT NULL,
    total_eur DECIMAL(10,2) NOT NULL,
    violation_reasons JSON NULL,
    approved_by VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_tenant_po (tenant_id, po_reference)
);

CREATE TABLE audit_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    tenant_id VARCHAR(64) NOT NULL,
    actor_type ENUM('agent', 'human', 'system') NOT NULL,
    actor_id VARCHAR(128) NOT NULL,
    action VARCHAR(64) NOT NULL,
    payload_summary JSON NOT NULL
);
```

---

## 7. Seed Dataset & Acceptance Criteria

### 7.1 Required Demo Seed Records
* **Tenant:** `hotel_nordic_group` (*Nordic Crown Hotels*), `max_auto_approve_eur = 800.00`, `allowed_categories = ["dairy", "plant-based"]`.
* **SKUs:**
  1. `VA-LF-MILK-10L`: Valio Lactose-Free Semi-Skimmed Milk, `10L Bag-in-Box`, Contract Price `€11.80/pack` (`€1.18/L`), Stock `250 packs`, `roadmap_status = 'LIVE'`, `internal_margin_pct = 18.5%`.
  2. `VA-LF-MILK-12X1L`: Valio Lactose-Free Milk UHT, `12 × 1L Carton`, Contract Price `€15.48/pack` (`€1.29/L`), Stock `180 packs`, `roadmap_status = 'LIVE'`, `internal_margin_pct = 21.0%`.
  3. `VA-ROADMAP-Q4-PRO`: Valio Next-Gen Barista Protein Milk (Q4 Unreleased), `10L Bag-in-Box`, `roadmap_status = 'UNRELEASED'` (must never appear in agent search results).

### 7.2 MVP Definition of Done (Acceptance Checklist)
- [ ] **AC-1:** Querying `1,000L lactose-free milk by Monday` returns both `VA-LF-MILK-10L` (100 packs = €1,180.00) and `VA-LF-MILK-12X1L` (84 packs = 1,008L = €1,300.32), while completely hiding `VA-ROADMAP-Q4-PRO` and `internal_margin_pct`.
- [ ] **AC-2:** Submitting the €1,180.00 quote transitions order status to `PENDING_APPROVAL` and holds `100` reserved packs in MariaDB.
- [ ] **AC-3:** Attempting to call `POST /api/v1/orders/{id}/approve` using the `agent` JWT fails with `403 Forbidden`.
- [ ] **AC-4:** Clicking **Approve** in the Manager UI (authenticated as `human`) transitions the order to `CONFIRMED`, finalizes stock deduction, and writes an immutable entry to `audit_logs`.
- [ ] **AC-5:** Lowering the order quantity to `400L` (€472.00) or raising `max_auto_approve_eur` to `€1,500` causes the exact same agent workflow to result in immediate `CONFIRMED` (`AUTO_APPROVED`) status.