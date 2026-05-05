# { "Depends": "py-genlayer:test" }
import json
from dataclasses import dataclass
from genlayer import *


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
		# Output is a simple 3-line string for easy strict_eq matching.
		# Complex details (summary, vulnerabilities) are fetched separately
		# via a second nondet call to avoid consensus failures.
		def run_audit() -> str:
			task = f"""
You are an expert auditor for GenLayer Intelligent Contracts.
You have deep knowledge of the GenLayer SDK (py-genlayer) and its canonical patterns.

=== GENLAYER SDK REFERENCE ===

Core imports:
  from genlayer import *

Contract class:
  class MyContract(gl.Contract):

Decorators:
  @gl.public.write  → modifies state, costs gas
  @gl.public.view   → read-only, free

Storage types:
  TreeMap[Key, Value], DynArray[Type], str, u256, bool, Address

Structured storage:
  @allow_storage
  @dataclass
  class MyData:
      field: type

LLM calls (nondeterministic):
  gl.nondet.exec_prompt(prompt)                        → raw text
  gl.nondet.exec_prompt(prompt, response_format="json") → parsed JSON

Equivalence principle:
  gl.eq_principle.strict_eq(leader_fn)                        → byte-identical match
  gl.eq_principle.prompt_comparative(leader_fn, principle)     → semantic comparison

Web access:
  gl.nondet.web.render(url, mode="text")

Context:
  gl.message.sender_address → caller address

Common issues to check:
  - Proper @gl.public.write vs @gl.public.view usage
  - Access control via gl.message.sender_address
  - Input validation before state mutations
  - Using gl.nondet (NOT deprecated run_nondet_unsafe)
  - @allow_storage + @dataclass on storage dataclasses
  - Type annotations on fields and method parameters

=== END SDK REFERENCE ===

Audit the following GenLayer Intelligent Contract:

```python
{source_code}
```

Score this contract on two dimensions (0-100 each):
- QUALITY: readability, proper SDK usage, type annotations, error handling, documentation
- SECURITY: access control, input validation, overflow/underflow, proper consensus usage

IMPORTANT: Respond with EXACTLY 3 lines, nothing else.
Line 1: the quality score as an integer (0-100)
Line 2: the security score as an integer (0-100)
Line 3: a one-line summary (max 200 chars)

Example response:
65
40
Missing access control and input validation with moderate code quality.

Do NOT include any other text, markdown, labels, or formatting.
Just 3 lines: quality, security, summary."""
			result = gl.nondet.exec_prompt(task)
			return result.strip()

		# --- Use prompt_comparative with a loose principle ---
		# Different LLMs will give different scores, so we use a wide
		# tolerance and focus on whether they agree on the general assessment.
		principle = """The two scores (quality and security) must each be within ±20 of each other.
The summary must convey the same overall assessment (both positive, both negative, or both mixed).
It is acceptable if the wording of the summary differs, as long as the sentiment is the same."""

		consensus_result = gl.eq_principle.prompt_comparative(run_audit, principle)
		lines = consensus_result.strip().split('\n')

		quality = int(lines[0].strip()) if len(lines) > 0 else 50
		security = int(lines[1].strip()) if len(lines) > 1 else 50
		overall = (quality + security) // 2
		summary = lines[2].strip() if len(lines) > 2 else "Audit completed"
		vulns = "[]"

		# --- Second nondet call: detailed vulnerability analysis ---
		# This is stored but NOT part of consensus — avoids disagreements.
		def run_details() -> str:
			task = f"""
You are a security auditor for GenLayer Intelligent Contracts.

Analyze the following contract for vulnerabilities and code quality issues.
List each issue with its severity (critical, medium, or low) and a brief description.

```python
{source_code}
```

Respond in this exact JSON format (no markdown, no code fences):
{{
  "vulnerabilities": [
    {{"severity": "critical", "description": "issue description"}},
    {{"severity": "medium", "description": "issue description"}},
    {{"severity": "low", "description": "issue description"}}
  ]
}}
If no vulnerabilities found, return: {{"vulnerabilities": []}}
Only output valid JSON, nothing else."""
			result = gl.nondet.exec_prompt(task, response_format="json")
			return json.dumps(result, sort_keys=True)

		details_result = gl.eq_principle.prompt_comparative(
			run_details,
			"The vulnerability lists must identify the same core issues. Severity levels should match. Wording may differ."
		)
		try:
			details = json.loads(details_result)
			vulns = json.dumps(details.get("vulnerabilities", []))
		except:
			vulns = "[]"

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
