# NL → SQL examples

Use these as translation anchors. Every example targets the `employers`
view. When translating, **always use `SELECT *`** unless the user
explicitly names columns.

---

### 1. Self-insured employers in a state

> *"self-insured employers in California"*

```sql
SELECT *
FROM employers
WHERE funding_type = 'self-insured' AND state = 'CA'
LIMIT 100;
```

---

### 2. Self-insured + size threshold

> *"self-insured employers in CA with at least 500 employees"*

`participants` is the headcount proxy.

```sql
SELECT *
FROM employers
WHERE funding_type = 'self-insured'
  AND state = 'CA'
  AND participants >= 500
ORDER BY participants DESC
LIMIT 100;
```

---

### 3. All addressable self-funded leads (self-insured + partial)

> *"all employers that self-fund any part of their benefits in Texas"*

```sql
SELECT *
FROM employers
WHERE funding_type IN ('self-insured', 'partial')
  AND state = 'TX'
LIMIT 100;
```

---

### 4. Industry by NAICS prefix

> *"self-insured tech companies"*

Interpretation note: "tech" → NAICS `51` (information) and `54`
(professional/scientific/technical). State this assumption.

```sql
SELECT *
FROM employers
WHERE funding_type = 'self-insured'
  AND (business_code LIKE '51%' OR business_code LIKE '54%')
ORDER BY participants DESC
LIMIT 100;
```

---

### 5. High-confidence self-insured (stop-loss confirmed)

> *"partially insured employers with stop-loss in Texas"*

`has_stop_loss` from Schedule A confirms a self-funded medical plan.

```sql
SELECT *
FROM employers
WHERE funding_type IN ('self-insured', 'partial')
  AND has_stop_loss
  AND state = 'TX'
LIMIT 100;
```

---

### 6. Name search

> *"is Apple in here?"*

```sql
SELECT *
FROM employers
WHERE sponsor_name ILIKE '%apple%'
LIMIT 100;
```

---

### 7. Exclude benefit trusts / multiemployer funds

> *"self-insured single employers in NY, no trust funds"*

```sql
SELECT *
FROM employers
WHERE funding_type = 'self-insured'
  AND state = 'NY'
  AND sponsor_name NOT ILIKE '%trust%'
  AND sponsor_name NOT ILIKE '%board of trustees%'
  AND sponsor_name NOT ILIKE '%fund%'
LIMIT 100;
```

---

### 8. Size band

> *"mid-size self-insured employers, 200 to 1000 employees"*

```sql
SELECT *
FROM employers
WHERE funding_type = 'self-insured'
  AND participants BETWEEN 200 AND 1000
ORDER BY participants DESC
LIMIT 100;
```

---

### 9. No-limit export

> *"export every self-insured employer in CA, no limit"*

Drop `LIMIT` when the user says "all", "no limit", "export",
"everything", "every", "complete list".

```sql
SELECT *
FROM employers
WHERE funding_type = 'self-insured' AND state = 'CA';
```

---

### 10. User-specified columns (only time we deviate from `SELECT *`)

> *"just give me company name, phone, and signer for self-insured CA employers"*

```sql
SELECT sponsor_name, phone, signer_name
FROM employers
WHERE funding_type = 'self-insured' AND state = 'CA'
LIMIT 100;
```
