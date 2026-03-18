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
1. Wait for the deployment transaction to reach `FINALIZED` status
1. Go to **Write Methods** → `score_contract`, paste the full source code of the contract you want to audit into the `source_code` field, and click **Execute**
1. Wait for the transaction to reach `FINALIZED`, then go to **Read Methods** → `get_last_score` to read the result

### Method 2: Local Web UI

A local testing playground — paste any contract code, score it, and see the structured result right in the browser. Config lives in `.env`; no extra setup in the UI.

> **Why local only?** GenLayer Studio runs on `localhost` — it can't be reached by a deployed web app like Vercel. The UI must run on the same machine as your GenLayer node.

**1. Configure `.env`**

```bash
cp .env.example .env
```

Fill in your values:

```
PRIVATE_KEY=your_private_key_here
RPC_URL=http://localhost:8080
CONTRACT_ADDRESS=0x_your_deployed_contract_address
```

**2. Install and start**

```bash
cd app
npm install
npm start
```

Opens at **http://localhost:3000**

**3. Score a contract**

Paste source code (or click **Load example**) and hit **Score Contract**. Live CLI output streams in the terminal panel below the editor; the structured audit result appears when the transaction finalizes.

-----

### Method 3: GenLayer CLI (Terminal)

Requires [Node.js](https://nodejs.org) (v18+).

**1. Install the CLI**

```bash
npm install -g genlayer
```

Verify:

```bash
genlayer --version
```

**2. Clone this repo**

```bash
git clone https://github.com/latiblack/genlayer-contract-scorer.git
cd genlayer-contract-scorer
```

**3. Configure your environment**

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Then edit `.env`:

```
PRIVATE_KEY=your_private_key_here
RPC_URL=http://localhost:8080
CONTRACT_ADDRESS=0x_your_deployed_contract_address
```

**4. Deploy**

```bash
genlayer deploy --contract contracts/contract_scorer.py
```

You'll get back a contract address and transaction hash.

**5. Score a contract**

`score_contract` is a write method (it updates state), so use `genlayer write`.

**Bash / macOS / Linux:**
```bash
genlayer write <contract_address> score_contract --args "[\"$(cat examples/bank_vault.py)\"]"
```

**PowerShell (Windows):**
```powershell
genlayer write <contract_address> score_contract --args "[(Get-Content examples/bank_vault.py -Raw | ConvertTo-Json)]"
```

**6. Read the result**

`get_last_score` is a read-only view, so use `genlayer call`:

```bash
genlayer call <contract_address> get_last_score
```

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