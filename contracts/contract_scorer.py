# { "Depends": "py-genlayer:test" }
from genlayer import *

import json


@allow_storage
@dataclass
class AuditResult:
	"""Structured audit result stored per-request."""
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

		# --- Leader function: runs the LLM audit ---
		def run_audit() -> str:
			task = f"""
You are an expert auditor for GenLayer Intelligent Contracts.
You have deep knowledge of the GenLayer SDK (py-genlayer) and its canonical patterns.

=== GENLAYER SDK REFERENCE (v0.3.0) ===

Core imports (always used in contracts):
  from genlayer import *

Contract class:
  class MyContract(gl.Contract):
      field_name: type

Constructor:
  def __init__(self, arg: type):
      self.field_name = value

Decorators:
  @gl.public.write   → write method (modifies state, costs gas)
  @gl.public.view    → read-only method (free, no state changes)

Dataclass for structured storage:
  @allow_storage
  @dataclass
  class MyData:
      field: type

Common storage types:
  TreeMap[Key, Value]       → mapping/dict
  DynArray[ItemType]        → dynamic array/list
  str, int, u256, bool      → primitives
  Address                   → blockchain address

Equivalence principle (canonical consensus pattern):
  def leader_fn() -> str:
      result = gl.nondet.exec_prompt(prompt, response_format="json")
      return json.dumps(result, sort_keys=True)

  consensus = gl.eq_principle.strict_eq(leader_fn)
  # — OR —
  consensus = gl.eq_principle.prompt_comparative(leader_fn, "comparison principle text")

  strict_eq: validators must produce byte-identical output
  prompt_comparative: validators compare semantically using the given principle

LLM calls inside nondet:
  gl.nondet.exec_prompt(prompt)                 → raw text response
  gl.nondet.exec_prompt(prompt, response_format="json")  → parsed JSON

Web access (inside nondet):
  gl.nondet.web.render(url, mode="text")  → fetch webpage

Message context:
  gl.message.sender_address  → address of the caller

Error handling:
  raise Exception("reason")   → revert the transaction

Common patterns to check for:
  - Proper use of @gl.public.write vs @gl.public.view
  - Access control via gl.message.sender_address
  - Input validation before state mutations
  - Proper use of gl.eq_principle for nondeterministic operations
  - Using gl.nondet.exec_prompt (NOT run_nondet_unsafe which is deprecated)
  - JSON response handling with response_format="json"
  - Type annotations on contract fields and method parameters
  - @allow_storage on dataclasses used in contract storage

=== END SDK REFERENCE ===

Now audit the following GenLayer Intelligent Contract:

```python
{source_code}
```

Analyze this contract for:
1. CODE QUALITY (0-100): readability, proper GenLayer SDK usage (v0.3 patterns),
   type annotations, error handling, documentation
2. SECURITY (0-100): access control, input validation, underflow/overflow risks,
   proper use of equivalence principle, reentrancy concerns

Respond ONLY with valid JSON in this exact format (no markdown, no code fences):
{{
  "quality_score": <int 0-100>,
  "security_score": <int 0-100>,
  "summary": "<1-2 sentence overall assessment>",
  "vulnerabilities": [
    {{
      "severity": "<critical|medium|low>",
      "description": "<clear description of the issue>"
    }}
  ]
}}
It is mandatory that you respond only using the JSON format above,
nothing else. Don't include any other words or characters,
your output must be only JSON without any formatting prefix or suffix.
This result should be perfectly parseable by a JSON parser without errors.
"""
			result = gl.nondet.exec_prompt(task, response_format="json")
			return json.dumps(result, sort_keys=True)

		# --- Equivalence principle: validators compare semantically ---
		principle = """The quality_score and security_score values must be within ±10 of each other.
Vulnerability lists must be semantically equivalent — same issues identified,
though wording may differ. The summary should convey the same overall assessment."""

		consensus_result = gl.eq_principle.prompt_comparative(run_audit, principle)
		parsed = json.loads(consensus_result)

		quality = int(parsed.get("quality_score", 0))
		security = int(parsed.get("security_score", 0))
		overall = (quality + security) // 2
		summary = str(parsed.get("summary", ""))
		vulns = json.dumps(parsed.get("vulnerabilities", []))

		# Build the audit result
		audit = AuditResult(
			overall=u256(overall),
			quality=u256(quality),
			security=u256(security),
			summary=summary,
			vulnerabilities=vulns,
		)

		# Append to this user's audit history
		if sender not in self.audits:
			self.audits[sender] = []
		self.audits[sender].append(audit)

		request_id = len(self.audits[sender]) - 1
		return u256(request_id)

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
