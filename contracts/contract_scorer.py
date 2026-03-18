# { "Depends": "py-genlayer:test" }
from genlayer import *
import typing


class ContractScorer(gl.Contract):
    last_score: str

    def __init__(self):
        self.last_score = ""

    @gl.public.write
    def score_contract(self, source_code: str) -> typing.Any:
        """
        Analyzes a GenLayer Intelligent Contract source code and scores it
        across three dimensions: overall, code quality, and security.
        Vulnerabilities are listed with severity levels (low, medium, critical).

        Args:
            source_code: The full source code of the contract to audit.

        Result is stored in last_score state variable.
        Call get_last_score() to read it after finalization.
        """

        def leader_fn():
            prompt = f"""You are an expert smart contract auditor specializing in GenLayer Intelligent Contracts written in Python.

Analyze the following contract source code and return a JSON object with exactly these keys:
- "overall": integer 0-100, the overall contract score
- "quality": integer 0-100, code quality score
- "security": integer 0-100, security score
- "vulnerabilities": a list of objects, each with "description" (string) and "severity" ("low", "medium", or "critical")

Example:
{{
  "overall": 60,
  "quality": 70,
  "security": 50,
  "vulnerabilities": [
    {{"description": "No access control on withdraw method", "severity": "critical"}},
    {{"description": "Missing type annotation on constructor", "severity": "low"}}
  ]
}}

Severity guide:
- critical: can lead to loss of funds, contract takeover, or irreversible state corruption
- medium: can cause unintended behavior, partial data manipulation, or denial of service
- low: minor issues unlikely to be exploited but representing bad practice

Code quality: evaluate readability, type annotations, GenLayer patterns, and error handling.
Security: evaluate for missing access control, unchecked inputs, unprotected write methods, and improper nondet handling.

CONTRACT SOURCE CODE:
---
{source_code}
---

Return ONLY the JSON object. No markdown, no explanation."""

            result = gl.nondet.exec_prompt(prompt, response_format='json')
            if not isinstance(result, dict):
                raise gl.UserError(f"LLM returned non-dict: {type(result)}")
            return result

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            data = leader_result.calldata
            if not isinstance(data, dict):
                return False
            for key in ("overall", "quality", "security"):
                if not isinstance(data.get(key), int) or not 0 <= data[key] <= 100:
                    return False
            if not isinstance(data.get("vulnerabilities"), list):
                return False
            for v in data["vulnerabilities"]:
                if not isinstance(v, dict):
                    return False
                if v.get("severity") not in ("low", "medium", "critical"):
                    return False
            return True

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        vulns = result.get("vulnerabilities", [])
        vuln_lines = "\n".join(
            f"  [{v['severity'].upper()}] {v['description']}"
            for v in vulns
        ) if vulns else "  None found"

        self.last_score = (
            f"Overall: {result['overall']} | "
            f"Quality: {result['quality']} | "
            f"Security: {result['security']}\n"
            f"Vulnerabilities:\n{vuln_lines}"
        )

    @gl.public.view
    def get_last_score(self) -> str:
        """Returns the most recent audit result stored in contract state."""
        return self.last_score