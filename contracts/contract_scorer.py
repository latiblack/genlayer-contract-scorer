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

		def get_audit_result() -> str:
			task = f"""
You are an expert auditor for GenLayer Intelligent Contracts.

Audit the following GenLayer contract for code quality and security:

```python
{source_code}
```

Rate each dimension from 0 to 100:
- quality: readability, SDK usage, type annotations, error handling
- security: access control, input validation, overflow risks

Respond with ONLY this JSON format, nothing else:
{{
  "quality": <int 0-100>,
  "security": <int 0-100>,
  "summary": "<one sentence assessment>"
}}
No markdown, no code fences, no extra text. Just the JSON object."""
			result = gl.exec_prompt(task)
			result = result.replace("```json", "").replace("```", "")
			return json.dumps(json.loads(result), sort_keys=True)

		consensus_result = gl.eq_principle_strict_eq(get_audit_result)
		parsed = json.loads(consensus_result)

		quality = int(parsed.get("quality", 0))
		security = int(parsed.get("security", 0))
		overall = (quality + security) // 2
		summary = str(parsed.get("summary", ""))

		# Get detailed vulnerabilities separately (no strict consensus)
		def get_vulns() -> str:
			task = f"""
You are a security auditor. Analyze this GenLayer contract for vulnerabilities:

```python
{source_code}
```

List issues as JSON:
{{
  "vulnerabilities": [
    {{"severity": "critical|medium|low", "description": "issue"}}
  ]
}}
If no issues, return: {{"vulnerabilities": []}}
Only JSON, no markdown, no code fences."""
			result = gl.exec_prompt(task)
			result = result.replace("```json", "").replace("```", "")
			return json.dumps(json.loads(result), sort_keys=True)

		vulns = "[]"
		try:
			vulns_result = gl.eq_principle_prompt_comparative(
				get_vulns,
				"The same core vulnerability issues must be identified with matching severity levels. Wording may differ."
			)
			details = json.loads(vulns_result)
			vulns = json.dumps(details.get("vulnerabilities", []))
		except:
			vulns = "[]"

		# Build and store the audit result
		audit = AuditResult(
			overall=u256(overall),
			quality=u256(quality),
			security=u256(security),
			summary=summary,
			vulnerabilities=vulns,
		)

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
