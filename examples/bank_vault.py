# { "Depends": "py-genlayer:test" }
from genlayer import *


class BankVault(gl.Contract):
	"""
	Example contract used to test the ContractScorer.
	This contract is intentionally flawed to demonstrate
	what the scorer catches.

	Known issues (for reference):
	- No access control on withdraw() — anyone can drain funds
	- No access control on set_owner() — anyone can take ownership
	- Integer underflow risk on self.balance -= amount
	- deposit() does not verify actual fund transfer
	- Missing type annotations on __init__ and view method returns
	"""
	balance: u256
	owner: str
	withdrawals: u256

	def __init__(self, owner: str):
		self.balance = u256(0)
		self.owner = owner
		self.withdrawals = u256(0)

	@gl.public.write
	def deposit(self, amount: u256) -> None:
		self.balance += amount

	@gl.public.write
	def withdraw(self, amount: u256, recipient: str) -> None:
		self.balance -= amount
		self.withdrawals += amount

	@gl.public.write
	def set_owner(self, new_owner: str) -> None:
		self.owner = new_owner

	@gl.public.view
	def get_balance(self) -> u256:
		return self.balance

	@gl.public.view
	def get_owner(self) -> str:
		return self.owner
