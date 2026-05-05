# GenLayer Contract Scorer

A GenLayer Intelligent Contract that audits other GenLayer contracts using LLM consensus via the **equivalence principle pattern**. It scores contracts across three dimensions — overall quality, code quality, and security — and returns a structured list of vulnerabilities with severity levels.

Built on [GenLayer](https://genlayer.com) using the **v0.3.0 SDK** and tested on [GenLayer Studio](https://studio.genlayer.com) (Testnet).

---

## What It Does

Pass any GenLayer Intelligent Contract source code as a string and the scorer will return:

- **Overall score** (0–100)
- **Code quality score** (0–100) — readability, type annotations, GenLayer v0.3 patterns, error handling
- **Security score** (0–100) — access control, input validation, underflow risks, nondet handling
- **Summary** — concise 1-2 sentence overall assessment
- **Vulnerabilities list** — each with a description and severity: `low`, `medium`, or `critical`

Results are stored **per-user, per-request** — not in a single global variable. Each caller gets their own audit history.

### Example Output

```
Overall: 35 | Quality: 60 | Security: 10
Summary: Contract has critical access control failures and integer underflow risk.
Vulnerabilities:
  [CRITICAL] Lack of access control on withdraw method: any user can withdraw funds and specify any recipient.
  [CRITICAL] Lack of access control on set_owner method: any user can take ownership of the contract.
  [CRITICAL] Integer underflow vulnerability: withdrawing an amount greater than the current balance will cause self.balance to underflow.
  [MEDIUM] The deposit method lacks verification that funds were actually transferred before updating the internal balance state.
```

---

## Key Changes from v0.1.x

This contract has been updated to follow GenLayer's **canonical v0.3.0 patterns**:

| Before (v0.1.x) | After (v0.3.0) |
|---|---|
| `from genlayer import *` | `import genlayer as gl` + `from genlayer.types import *` |
| `gl.Contract` | `gl.contract.Contract` |
| `gl.vm.run_nondet_unsafe(leader, validator)` | `gl.eq_principle.prompt_comparative(fn, principle)` |
| `gl.UserError` | `gl.vm.UserError` |
| Single `last_score: str` global | Per-user `TreeMap[Address, DynArray[AuditResult]]` |
| `get_last_score()` | `get_audit(addr, id)`, `get_latest_audit(addr)`, `get_my_audits()` |
| No SDK context in prompt | Full v0.3 SDK reference embedded in audit prompt |

---

## Contract API

### Write Methods

**`score_contract(source_code: str) -> u256`**
Submits a contract for audit. Returns the request ID (index into caller's audit history). The audit runs through LLM consensus using `gl.eq_principle.prompt_comparative`.

### View Methods

**`get_audit(requester: Address, request_id: u256) -> str`**
Returns a specific audit result by user address + request index.

**`get_latest_audit(requester: Address) -> str`**
Returns the most recent audit for a given user.

**`get_my_audits() -> str`**
Returns all audit results for the caller.

**`get_audit_count(requester: Address) -> u256`**
Returns the number of audits submitted by a user.

---

## How to Use

### Method 1: GenLayer Studio (Browser)

1. Open [GenLayer Studio](https://studio.genlayer.com)
1. Paste the contents of `contracts/contract_scorer.py` into the editor
1. Click **Deploy** — no constructor parameters needed
1. Wait for the deployment transaction to reach `ACCEPTED` status
1. Go to **Write Methods** → `score_contract`, paste the full source code of the contract you want to audit into the `source_code` field, and click **Execute**
1. Wait for the transaction to reach `ACCEPTED`, then go to **Read Methods** → `get_latest_audit` with your address to read the result

### Method 2: Web UI

A browser-based interface for submitting contracts and viewing structured audit results, including per-user audit history. Configuration is managed entirely through `.env` — no in-app setup required.

**Prerequisites**

- [Node.js](https://nodejs.org) v18 or later
- A deployed instance of `contracts/contract_scorer.py`
- A funded account with a private key

**1. Configure environment**

```bash
cp .env.example .env
```

Edit `.env` with your values:

```
PRIVATE_KEY=your_private_key_here
RPC_URL=http://localhost:8080
CONTRACT_ADDRESS=0x_your_deployed_contract_address
```

**2. Install dependencies and start**

```bash
cd app
npm install
npm start
```

The server starts at **http://localhost:3000**.

**3. Run an audit**

Paste the source code of any GenLayer Intelligent Contract into the editor (or click **Load example** to use the bundled `bank_vault.py`), then click **Score Contract**.

The log panel displays live transaction status as it progresses through consensus (`PENDING → PROPOSING → COMMITTING → REVEALING → ACCEPTED`). Once the transaction is accepted, the structured audit result renders automatically — overall score, code quality, security score, and a sorted vulnerability list.

**4. View audit history**

Click **View History** to see all past audits for your account.

---

## Testing

Use the provided `examples/bank_vault.py` as a test input. It is intentionally flawed with missing access controls, an integer underflow risk, and missing type annotations. A working scorer should flag at least 3 critical vulnerabilities and return a security score below 20.

---

## How It Works

The scorer uses GenLayer's **equivalence principle pattern** for consensus:

1. **Leader node** executes `gl.nondet.exec_prompt()` with the full GenLayer SDK context + contract source code, requesting structured JSON output
2. **Validator nodes** independently run the same prompt and use `gl.eq_principle.prompt_comparative()` with a custom principle that allows ±10 score tolerance and semantically equivalent vulnerability findings
3. Consensus is reached when validators agree the results are equivalent per the principle — not requiring byte-identical outputs
4. The structured result is stored as an `AuditResult` in the caller's per-user `DynArray`

This is the **canonical pattern** recommended by GenLayer for contracts that produce LLM-generated content, replacing the older `run_nondet_unsafe` approach.

---

## Key Concepts Demonstrated

- **Equivalence principle consensus** using `gl.eq_principle.prompt_comparative`
- **Per-user state storage** with `TreeMap[Address, DynArray[AuditResult]]`
- **v0.3.0 SDK imports** (`import genlayer as gl` + `from genlayer.types import *`)
- **@gl.allow_storage** dataclass for structured state
- **LLM calls inside Intelligent Contracts** using `gl.nondet.exec_prompt`
- **SDK-aware auditing** — the LLM receives full GenLayer API context for informed analysis
- **Proper error handling** with `gl.vm.UserError`
- **JSON response handling** with `response_format='json'`

---

## Built With

- [GenLayer](https://genlayer.com) — AI-native blockchain
- [GenLayer SDK v0.3.0](https://sdk.genlayer.com) — Python smart contract framework
- [GenLayer Studio](https://studio.genlayer.com) — browser-based IDE and testnet
- [genlayer-js](https://github.com/genlayerlabs/genlayer-js) — JavaScript SDK for contract interaction

---

## Author

Built by [Lati](https://github.com/latiblack) as a contribution to the [GenLayer](https://genlayer.com) ecosystem.

---

## License

MIT
