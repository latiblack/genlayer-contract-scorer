# { "Depends": "py-genlayer:test" }
import genlayer as gl
from genlayer.types import *
import json


@gl.allow_storage
class AuditResult:
	"""Structured audit result stored per-request."""
	overall: u8
	quality: u8
	security: u8
	summary: str
	timestamp: u256

	def __init__(self, overall: int, quality: int, security: int, summary: str):
		self.overall = u8(overall)
		self.quality = u8(quality)
		self.security = u8(security)
		self.summary = summary
		self.timestamp = u256(0)


class ContractScorer(gl.contract.Contract):
	"""
	An on-chain GenLayer Intelligent Contract that audits other
	GenLayer contracts using LLM consensus via the equivalence
	principle pattern.

	Audit results are stored per-user, per-request — not in a
	single global variable. Each call to score_contract() creates
	a new AuditResult entry keyed by caller address + request ID.
	"""

	audits: TreeMap[Address, DynArray[AuditResult]]
	audit_count: TreeMap[Address, u256]

	def __init__(self):
		pass

	# ── GenLayer SDK context for the auditor ─────────────────────────────
	# This gives the LLM clear context about GenLayer's SDK so it can
	# produce an appropriate, well-informed audit.

	GENLAYER_CONTEXT = """\
You are an expert smart contract auditor specializing in GenLayer
Intelligent Contracts written in Python.

## GenLayer SDK Reference (v0.3.0)

### Imports
  import genlayer as gl
  from genlayer.types import *

### Contract declaration
  class MyContract(gl.contract.Contract):
    ...

### Storage types
  - TreeMap[K, V]      — key-value mapping
  - DynArray[T]         — dynamic-length array
  - Array[T, N]         — fixed-length array

### Method decorators
  @gl.public.write      — writable method (costs gas, changes state)
  @gl.public.view       — read-only method (free, no state changes)

### Non-deterministic (LLM & web) operations
  - gl.nondet.exec_prompt(prompt, response_format='json')
      → sends a prompt to an LLM, returns structured output
  - gl.nondet.web.render(url, mode='text')
      → fetches and renders a web page

### Equivalence principles (for consensus validation)
  - gl.eq_principle.strict_eq(fn)
      → leader & validator must return identical results
  - gl.eq_principle.prompt_comparative(fn, principle)
      → validator uses NLP to assess if results are equivalent
      → principle: str describing what "equivalent" means
  - gl.eq_principle.prompt_non_comparative(fn, *, task, criteria)
      → for subjective tasks; validator checks integrity of process

### Error handling
  - raise gl.vm.UserError("message")  — user-caused error

### Events
  class MyEvent(gl.vm.Event):
    def __init__(self, field1: str, field2: u256, /): ...

### Contract interaction
  - proxy = gl.contract.get_at(address)
  - proxy.view().some_method()
  - proxy.emit().some_method()

### Message context
  - gl.message.sender_address  — caller's address
  - gl.message.value           — sent value

### VM tracing (debug)
  - gl.vm.trace("message")
  - gl.vm.trace_time_micro()

### Key patterns
  - Use @gl.allow_storage on dataclasses stored in contract state
  - Use TreeMap for mappings, DynArray for lists in storage
  - Write methods change state, view methods are free
  - Non-deterministic calls MUST use an equivalence principle
  - Always validate LLM output structure before storing

## Your Task

Analyze the following contract source code and return a JSON object
with exactly these keys:
- "overall": integer 0-100, the overall contract score
- "quality": integer 0-100, code quality score
- "security": integer 0-100, security score
- "summary": a concise 1-2 sentence overall assessment
- "vulnerabilities": a list of objects, each with:
    - "description" (string): what the issue is
    - "severity" ("low", "medium", or "critical"): impact level

### Scoring Guidelines

**Code Quality (0-100):**
- Uses current v0.3 imports (import genlayer as gl + from genlayer.types import *)
- Proper storage types (TreeMap, DynArray, @gl.allow_storage dataclasses)
- Type annotations on all methods and storage fields
- Correct decorator usage (@gl.public.write / @gl.public.view)
- Error handling with gl.vm.UserError instead of bare Exception
- Clean, readable code structure

**Security (0-100):**
- Access control on write methods (check gl.message.sender_address)
- Input validation on all public parameters
- No integer overflow/underflow risks
- Proper use of equivalence principles for nondet calls
- No unprotected state mutations

**Severity Guide:**
- critical: can lead to loss of funds, contract takeover, or
  irreversible state corruption
- medium: can cause unintended behavior, partial data manipulation,
  or denial of service
- low: minor issues unlikely to be exploited but representing bad
  practice

## CONTRACT SOURCE CODE
---
{source_code}
---

Return ONLY the JSON object. No markdown, no explanation."""

	# ── Equivalence principle for auditing ──────────────────────────────
	# prompt_comparative is the right choice here because LLM auditors
	# may produce slightly different wording but semantically equivalent
	# findings. The principle text tells validators what matters.

	AUDIT_PRINCIPLE = """\
The results are equivalent if they identify the same core
vulnerabilities and produce scores within ±10 points of each
other. Minor differences in vulnerability descriptions or
ordering are acceptable, but missing a critical vulnerability
that the other found (or vice versa) is NOT equivalent."""

	@gl.public.write
	def score_contract(self, source_code: str) -> u256:
		"""
		Audits a GenLayer Intelligent Contract and stores the result
		per-user. Returns the request ID (index into caller's audit
		history).
		"""
		sender = gl.message.sender_address

		def run_audit() -> dict:
			prompt = self.GENLAYER_CONTEXT.format(source_code=source_code)
			result = gl.nondet.exec_prompt(prompt, response_format='json')
			if not isinstance(result, dict):
				raise gl.vm.UserError("LLM returned non-dict result")
			# Validate required keys
			for key in ("overall", "quality", "security"):
				if key not in result or not isinstance(result[key], int):
					raise gl.vm.UserError(f"Missing or invalid '{key}' in audit result")
				if not 0 <= result[key] <= 100:
					raise gl.vm.UserError(f"{key} score out of range 0-100")
			if "vulnerabilities" not in result or not isinstance(result["vulnerabilities"], list):
				raise gl.vm.UserError("Missing or invalid 'vulnerabilities' in audit result")
			for v in result["vulnerabilities"]:
				if not isinstance(v, dict):
					raise gl.vm.UserError("Vulnerability entry is not a dict")
				if v.get("severity") not in ("low", "medium", "critical"):
					raise gl.vm.UserError(f"Invalid severity: {v.get('severity')}")
			return result

		result = gl.eq_principle.prompt_comparative(
			run_audit,
			self.AUDIT_PRINCIPLE,
		)

		# Build structured result
		summary = result.get("summary", "Audit completed.")
		vulns = result.get("vulnerabilities", [])
		vuln_lines = "\n".join(
			f"  [{v['severity'].upper()}] {v['description']}"
			for v in vulns
		) if vulns else "  None found"

		full_summary = (
			f"Overall: {result['overall']} | "
			f"Quality: {result['quality']} | "
			f"Security: {result['security']}\n"
			f"Summary: {summary}\n"
			f"Vulnerabilities:\n{vuln_lines}"
		)

		audit = AuditResult(
			overall=result["overall"],
			quality=result["quality"],
			security=result["security"],
			summary=full_summary,
		)

		# Store per-user
		if sender not in self.audits:
			self.audits[sender] = DynArray[AuditResult]()
		self.audits[sender].append(audit)

		# Track count
		current = self.audit_count.get(sender, u256(0))
		self.audit_count[sender] = current + 1

		return current  # request_id

	@gl.public.view
	def get_audit(self, requester: Address, request_id: u256) -> str:
		"""Returns a specific audit result by user + request index."""
		if requester not in self.audits:
			raise gl.vm.UserError("No audits found for this address")
		audits = self.audits[requester]
		idx = int(request_id)
		if idx < 0 or idx >= len(audits):
			raise gl.vm.UserError("Invalid request_id")
		return audits[idx].summary

	@gl.public.view
	def get_my_audits(self) -> str:
		"""Returns all audit results for the caller."""
		sender = gl.message.sender_address
		if sender not in self.audits:
			raise gl.vm.UserError("No audits found for caller")
		audits = self.audits[sender]
		results = []
		for i, a in enumerate(audits):
			results.append(f"--- Audit #{i} ---\n{a.summary}")
		return "\n\n".join(results)

	@gl.public.view
	def get_audit_count(self, requester: Address) -> u256:
		"""Returns the number of audits submitted by a user."""
		return self.audit_count.get(requester, u256(0))

	@gl.public.view
	def get_latest_audit(self, requester: Address) -> str:
		"""Returns the most recent audit for a given user."""
		count = int(self.audit_count.get(requester, u256(0)))
		if count == 0:
			raise gl.vm.UserError("No audits found for this address")
		return self.audits[requester][count - 1].summary
