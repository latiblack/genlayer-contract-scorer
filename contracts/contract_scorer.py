# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from dataclasses import dataclass
import json


GENLAYER_SDK_CONTEXT = """
GenLayer SDK Reference (use this to evaluate the contract under audit):

IMPORTS & CONTRACT STRUCTURE:
- `from genlayer import *` imports gl, u256, Address, TreeMap, DynArray, allow_storage
- Contract class must inherit from `gl.Contract`
- State fields declared as class-level type annotations only (not in __init__)
- `__init__` takes no parameters

TYPES:
- `u256`, `i256`, `u32`, `i32` for integers (plain `int` is forbidden in storage)
- `Address` for wallet addresses
- `DynArray[T]` instead of `list[T]` for persistent storage
- `TreeMap[K, V]` instead of `dict[K, V]` for persistent storage
- `@allow_storage` + `@dataclass` required for custom types used in storage

METHOD DECORATORS:
- `@gl.public.write` for state-changing methods
- `@gl.public.view` for read-only methods

NON-DETERMINISTIC / CONSENSUS:
- `gl.nondet.exec_prompt(task)` calls an LLM — must be inside a nondet block
- `gl.eq_principle.strict_eq(fn)` — byte-perfect match, only for deterministic outputs
- `gl.eq_principle.prompt_comparative(fn, principle)` — LLM judge compares outputs
- `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)` — manual control; validator receives
  gl.vm.Return, gl.vm.UserError, or gl.vm.VMError — always check type before .calldata

STORAGE RULES:
- Storage objects cannot be accessed inside nondet blocks
- Method arguments and local variables are safe to close over in nondet functions

SENDER:
- `gl.message.sender_address` — deterministic, safe anywhere

COMMON MISTAKES:
- Using strict_eq on LLM-generated text -> consensus always fails
- Calling exec_prompt outside a nondet wrapper -> VM error
- Using `list` or `dict` in storage -> use DynArray and TreeMap
- Not using @allow_storage on dataclasses used in storage
- Reading self.* inside nondet closures -> VM error
- Storing all results in a single global field -> no per-user history
"""


@allow_storage
@dataclass
class AuditResult:
    """Structured audit result stored per user per request."""
    overall: u256
    quality: u256
    security: u256
    summary: str
    vulnerabilities: str


class ContractScorer(gl.Contract):
    """Audits GenLayer Intelligent Contracts using on-chain LLM consensus."""

    audits: TreeMap[Address, DynArray[AuditResult]]

    def __init__(self):
        pass

    @gl.public.write
    def score_contract(self, source_code: str) -> u256:
        """
        Submit a contract for auditing. Returns the request ID
        (index into the caller's audit array).
        """
        if not source_code or len(source_code.strip()) == 0:
            raise Exception("Source code cannot be empty")

        sender = gl.message.sender_address

        # Leader runs the LLM once and produces the full audit result.
        # Validators do NOT re-run the LLM — they only check that the
        # leader's output has the correct structure and value ranges.
        # This is why the old contract reached consensus instantly:
        # structure validation is deterministic across all validators.
        def leader_fn() -> str:
            prompt = f"""You are an expert auditor for GenLayer Intelligent Contracts.

{GENLAYER_SDK_CONTEXT}

Audit the following GenLayer contract for code quality and security:

```python
{source_code}
```

Rate each dimension from 0 to 100:
- overall: weighted average of quality and security
- quality: readability, correct SDK usage, type annotations, error handling
- security: access control, input validation, overflow risks, consensus misuse

Return ONLY this JSON, nothing else. No markdown, no code fences:
{{
  "overall": <integer 0-100>,
  "quality": <integer 0-100>,
  "security": <integer 0-100>,
  "summary": "<one sentence assessment>",
  "vulnerabilities": [
    {{"severity": "critical|medium|low", "description": "issue description"}}
  ]
}}
If no vulnerabilities, use: "vulnerabilities": []"""

            raw = gl.nondet.exec_prompt(prompt)
            raw = raw.replace("```json", "").replace("```", "").strip()
            return raw

        # Validators only verify structure — no LLM re-run, no variance, instant consensus.
        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            raw = leader_result.calldata
            if not raw or not raw.strip():
                return False
            try:
                data = json.loads(raw)
            except Exception:
                return False
            if not isinstance(data, dict):
                return False
            # Check numeric scores exist and are in range
            for key in ("overall", "quality", "security"):
                val = data.get(key)
                if not isinstance(val, int) or not (0 <= val <= 100):
                    return False
            # Check summary is a non-empty string
            if not isinstance(data.get("summary"), str) or not data["summary"].strip():
                return False
            # Check vulnerabilities list structure
            if not isinstance(data.get("vulnerabilities"), list):
                return False
            for v in data["vulnerabilities"]:
                if not isinstance(v, dict):
                    return False
                if v.get("severity") not in ("low", "medium", "critical"):
                    return False
                if not isinstance(v.get("description"), str):
                    return False
            return True

        raw_result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        if not raw_result or not raw_result.strip():
            raise Exception("LLM returned empty response")
        data = json.loads(raw_result)

        audit = AuditResult(
            overall=u256(int(data["overall"])),
            quality=u256(int(data["quality"])),
            security=u256(int(data["security"])),
            summary=str(data["summary"]),
            vulnerabilities=json.dumps(data.get("vulnerabilities", [])),
        )

        if sender not in self.audits:
            self.audits[sender] = []
        self.audits[sender].append(audit)

        return u256(len(self.audits[sender]) - 1)

    @gl.public.view
    def get_audit(self, requester: Address, request_id: u256) -> dict:
        """Get a specific audit result by user address and request index."""
        if requester not in self.audits:
            raise Exception("No audits found for this address")
        idx = int(request_id)
        if idx < 0 or idx >= len(self.audits[requester]):
            raise Exception("Invalid request ID")
        audit = self.audits[requester][idx]
        return {
            "overall": int(audit.overall),
            "quality": int(audit.quality),
            "security": int(audit.security),
            "summary": audit.summary,
            "vulnerabilities": audit.vulnerabilities,
        }

    @gl.public.view
    def get_latest_audit(self, requester: Address) -> dict:
        """Get the most recent audit for a given user."""
        if requester not in self.audits:
            raise Exception("No audits found for this address")
        audit = self.audits[requester][-1]
        return {
            "overall": int(audit.overall),
            "quality": int(audit.quality),
            "security": int(audit.security),
            "summary": audit.summary,
            "vulnerabilities": audit.vulnerabilities,
        }

    @gl.public.view
    def get_my_audits(self) -> dict:
        """Get all audit results for the caller."""
        sender = gl.message.sender_address
        if sender not in self.audits:
            return {"audits": [], "count": 0}
        results = []
        for i, audit in enumerate(self.audits[sender]):
            results.append({
                "id": i,
                "overall": int(audit.overall),
                "quality": int(audit.quality),
                "security": int(audit.security),
                "summary": audit.summary,
                "vulnerabilities": audit.vulnerabilities,
            })
        return {"audits": results, "count": len(results)}

    @gl.public.view
    def get_audit_count(self, requester: Address) -> u256:
        """Get the number of audits for a given user."""
        if requester not in self.audits:
            return u256(0)
        return u256(len(self.audits[requester]))
