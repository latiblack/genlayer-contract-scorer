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

### Method 2: GenLayer CLI (Terminal)

Requires [Node.js](https://nodejs.org) and [Docker](https://www.docker.com).

```bash
# Install the CLI
npm install -g genlayer

# Select the testnet
genlayer network testnet-bradbury

# Deploy the scorer
genlayer deploy --contract contracts/contract_scorer.py
```

Once deployed, use the returned contract address to interact:

```bash
# Score a contract (write method)
genlayer write <contract-address> score_contract --args '["<source_code_string>"]'

# Read the audit result (read method)
genlayer call <contract-address> get_last_score
```

> Tip: you can pass the contents of a file as the source code argument using command substitution:
> ```bash
> genlayer write <contract-address> score_contract --args "[\"$(cat examples/bank_vault.py)\"]"
> ```

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