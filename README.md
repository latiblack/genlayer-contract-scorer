# GenLayer Contract Scorer

A GenLayer Intelligent Contract that audits other GenLayer contracts using an LLM. It scores contracts across three dimensions — overall quality, code quality, and security — and returns a structured list of vulnerabilities with severity levels.

Built and tested on [GenLayer Studio](https://studio.genlayer.com) (Testnet).

-----

## What It Does

Pass any GenLayer Intelligent Contract source code as a string and the scorer will return:

- **Overall score** (0–100)
- **Code quality score** (0–100) — readability, type annotations, GenLayer patterns, error handling
- **Security score** (0–100) — access control, input validation, underflow risks, nondet handling
- **Vulnerabilities list** — each with a description and severity: `low`, `medium`, or `critical`

### Example Output

```
Overall: 35 | Quality: 60 | Security: 10
Vulnerabilities:
  [CRITICAL] Lack of access control on withdraw method: any user can withdraw funds and specify any recipient.
  [CRITICAL] Lack of access control on set_owner method: any user can take ownership of the contract.
  [CRITICAL] Integer underflow vulnerability: withdrawing an amount greater than the current balance will cause self.balance to underflow.
  [MEDIUM] The deposit method lacks verification that funds were actually transferred before updating the internal balance state.
```

-----

## How to Use

### Method 1: GenLayer Studio (Browser)

1. Open [GenLayer Studio](https://studio.genlayer.com)
1. Paste the contents of `contracts/contract_scorer.py` into the editor
1. Click **Deploy** — no constructor parameters needed
1. Wait for the deployment transaction to reach `ACCEPTED` status
1. Go to **Write Methods** → `score_contract`, paste the full source code of the contract you want to audit into the `source_code` field, and click **Execute**
1. Wait for the transaction to reach `ACCEPTED`, then go to **Read Methods** → `get_last_score` to read the result

### Method 2: Web UI

A browser-based interface for submitting contracts and viewing structured audit results. Configuration is managed entirely through `.env` — no in-app setup required.

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

To re-read the last result without re-submitting, click **Refresh result**.

-----

## Testing

Use the provided `examples/bank_vault.py` as a test input. It is intentionally flawed with missing access controls, an integer underflow risk, and missing type annotations. A working scorer should flag at least 3 critical vulnerabilities and return a security score below 20.

-----

## How It Works

The scorer uses GenLayer’s native LLM integration:

- `gl.nondet.exec_prompt()` with `response_format='json'` sends the contract code to an LLM for analysis
- `gl.vm.run_nondet_unsafe()` handles consensus — validators check that the returned JSON has the correct structure and valid score ranges rather than requiring byte-identical outputs
- The result is formatted and stored in the `last_score` state variable

This pattern — custom validator checking structure rather than exact match — is the correct approach for any GenLayer contract that returns LLM-generated content.

-----

## Key Concepts Demonstrated

- **LLM calls inside Intelligent Contracts** using `gl.nondet.exec_prompt`
- **Custom consensus validation** using `gl.vm.run_nondet_unsafe` with a structural validator
- **JSON response handling** with `response_format='json'`
- **State storage** of LLM outputs

-----

## Built With

- [GenLayer](https://genlayer.com) — AI-native blockchain
- [GenLayer Studio](https://studio.genlayer.com) — browser-based IDE and testnet

-----

## Author

Built by [Lati](https://github.com/latiblack) as a contribution to the [GenLayer](https://genlayer.com) ecosystem.

-----

## License

MIT