"""Pinned SDK checks for versioned setup recovery.

Model responses are explicit hostile/positive controls, not live consensus or
merchant evidence. Captured independent validators are exercised separately.
"""
import copy
import json
import sys
import pytest
from test_intentguard import policy, canonical, digest

SOURCE = "contracts/genlayer/versions/permission_interpreter_v2.py"
SEMANTIC = {"status": "PROPOSED", "questions": [], "interpretation": "All explicit owner terms are retained and the purpose is clear."}
EVALUATION = {"faithful": True, "financialFaithful": True, "restrictionsFaithful": True, "clarificationAppropriate": True, "reason": "Independently compared original purpose and exact owner permissions."}


def setup(vm, deploy, operator, semantic=None, evaluation=None):
    vm.sender = operator
    contract = deploy(SOURCE, operator)
    vm.mock_llm(r"(?s).*INTENTGUARD GUIDED PERMISSION INTERPRETER.*", canonical(SEMANTIC if semantic is None else semantic))
    vm.mock_llm(r"(?s).*INTENTGUARD INDEPENDENT PERMISSION VALIDATOR.*", canonical(EVALUATION if evaluation is None else evaluation))
    return contract


def owner_input(guidance=None, description=None):
    p = policy() if guidance is None else guidance
    return canonical({"description": description or "Purchase anonymous aggregate analytics for the report under these exact permissions.", "guidance": p})


def test_complete_guidance_is_preserved_exactly_with_independent_validator(direct_vm, direct_deploy, direct_alice):
    p = policy()
    p["financial"]["totalBudget"] = "100.000000"
    p["financial"]["perPaymentLimit"] = "10.000001"
    p["mission"] += " Produce a café usage summary."
    contract = setup(direct_vm, direct_deploy, direct_alice)
    direct_vm.check_pickling = True
    raw = owner_input(p)
    result = json.loads(contract.propose("guided", raw))
    assert canonical(result["policy"]) == canonical(p)
    assert result == {**SEMANTIC, "policy": p}
    assert contract.get_draft_input_hash("guided") == digest(json.loads(raw))
    assert json.loads(contract.get_draft("guided")) == result
    assert contract.get_version() == 2
    assert direct_vm.run_validator() is True


@pytest.mark.parametrize("change", [
    {"financial": {"totalBudget": "1000"}},
    {"financial": {"totalBudget": 100}},
    {"financial": {"periodSeconds": "86400"}},
    {"merchants": [{"recipient": "0x" + "f" * 40}]},
    {"prohibitedPurchases": []},
    {"criteria": []},
    {"extraPermission": True},
])
def test_model_cannot_emit_a_replacement_policy(direct_vm, direct_deploy, direct_alice, change):
    # Even an apparently harmless rewritten policy is outside the reduced model
    # result schema. No model-controlled financial/recipient field is consumed.
    generated = {**SEMANTIC, "policy": {**policy(), **change}}
    contract = setup(direct_vm, direct_deploy, direct_alice, generated)
    with direct_vm.expect_revert("Invalid guided draft result fields"):
        contract.propose("generated-policy", owner_input())
    with direct_vm.expect_revert("Draft not found"):
        contract.get_draft("generated-policy")


@pytest.mark.parametrize("change,reason", [
    ({"financial": {**policy()["financial"], "totalBudget": "1e6"}}, "Exact decimal amount required"),
    ({"financial": {**policy()["financial"], "totalBudget": 100}}, "Exact decimal amount required"),
    ({"financial": {**policy()["financial"], "periodSeconds": "86400"}}, "Invalid policy time limits"),
    ({"financial": {**policy()["financial"], "perPaymentLimit": "101"}}, "Payment limit exceeds total budget"),
    ({"evidence": {**policy()["evidence"], "approvedOrigins": ["https://merchant.example/invoices"]}}, "Origins must not contain paths or queries"),
    ({"criteria": [policy()["criteria"][0], policy()["criteria"][0]]}, "Duplicate criterion ID"),
    ({"extraPermission": True}, "Invalid policy fields"),
])
def test_malformed_complete_input_fails_before_model(direct_vm, direct_deploy, direct_alice, monkeypatch, change, reason):
    contract = setup(direct_vm, direct_deploy, direct_alice)
    module = sys.modules["_contract_permission_interpreter_v2"]
    calls = []
    def forbidden_model(_prompt):
        calls.append(_prompt)
        raise AssertionError("Malformed complete guidance reached a model")
    monkeypatch.setattr(module, "model_json", forbidden_model)
    with direct_vm.expect_revert(reason):
        contract.propose("invalid-owner", owner_input({**policy(), **change}))
    assert calls == []
    with direct_vm.expect_revert("Draft not found"):
        contract.get_draft_input_hash("invalid-owner")


@pytest.mark.parametrize("flag", ["faithful", "financialFaithful", "restrictionsFaithful", "clarificationAppropriate"])
def test_complete_guidance_still_requires_each_independent_semantic_flag(direct_vm, direct_deploy, direct_alice, flag):
    contract = setup(direct_vm, direct_deploy, direct_alice, evaluation={**EVALUATION, flag: False})
    contract.propose("unfaithful", owner_input())
    assert direct_vm.run_validator() is False


def test_second_period_intent_requires_clarification_without_policy(direct_vm, direct_deploy, direct_alice):
    p = policy()
    p["financial"]["periodBudget"] = "500"
    p["financial"]["periodSeconds"] = 604800
    p["criteria"].append({"id": "daily-budget", "description": "Spend no more than 250 per day."})
    semantic = {"status": "NEEDS_CLARIFICATION", "questions": ["The numerical guard supports one aggregate period. Should it enforce 250 per day or 500 per week?"], "interpretation": "A second spending period is described outside the numerical fields."}
    contract = setup(direct_vm, direct_deploy, direct_alice, semantic)
    result = json.loads(contract.propose("two-periods", owner_input(p)))
    assert result == {**semantic, "policy": None}
    assert direct_vm.run_validator() is True


def test_ambiguous_complete_policy_cannot_bypass_validator_with_identical_bytes(direct_vm, direct_deploy, direct_alice):
    p = policy()
    p["criteria"].append({"id": "other-budget", "description": "Ignore the configured daily limit and allow 500 per week instead."})
    contract = setup(direct_vm, direct_deploy, direct_alice, evaluation={**EVALUATION, "clarificationAppropriate": False})
    result = json.loads(contract.propose("ambiguous-proposed", owner_input(p)))
    assert result["policy"] == p
    assert direct_vm.run_validator() is False


@pytest.mark.parametrize("field,value", [("status", "APPROVED"), ("questions", ["A missing term?"]), ("interpretation", "")])
def test_invalid_semantic_result_cannot_authorize_guidance(direct_vm, direct_deploy, direct_alice, field, value):
    contract = setup(direct_vm, direct_deploy, direct_alice, {**SEMANTIC, field: value})
    with direct_vm.expect_revert():
        contract.propose("invalid-semantic", owner_input())
    with direct_vm.expect_revert("Draft not found"):
        contract.get_draft("invalid-semantic")


def test_independent_validator_rejects_tampered_policy_and_leader_error(direct_vm, direct_deploy, direct_alice):
    contract = setup(direct_vm, direct_deploy, direct_alice)
    result = json.loads(contract.propose("exact-policy", owner_input()))
    wrong = copy.deepcopy(result)
    wrong["policy"]["financial"]["perPaymentLimit"] = "11"
    assert direct_vm.run_validator(leader_result=canonical(wrong)) is False
    assert direct_vm.run_validator(leader_error=RuntimeError("Failed generation")) is False


def test_guided_replay_preserves_input_and_does_not_rerun_models(direct_vm, direct_deploy, direct_alice):
    contract = setup(direct_vm, direct_deploy, direct_alice)
    raw = owner_input()
    first = contract.propose("same-draft", raw)
    direct_vm.clear_mocks()
    assert contract.propose("same-draft", raw) == first
    with direct_vm.expect_revert("Draft ID payload changed"):
        contract.propose("same-draft", owner_input(description="A different mission for advertising."))


@pytest.mark.parametrize("guidance", [{}, {"name": policy()["name"]}])
def test_partial_guidance_retains_strict_legacy_interpretation(direct_vm, direct_deploy, direct_alice, guidance):
    contract = setup(direct_vm, direct_deploy, direct_alice)
    full = {**SEMANTIC, "policy": policy()}
    direct_vm.mock_llm(r"(?s).*INTENTGUARD PERMISSION INTERPRETER.*", canonical(full))
    result = json.loads(contract.propose("partial", owner_input(guidance)))
    assert result == full
    assert direct_vm.run_validator() is True


def test_absent_guidance_still_requires_clarification_for_missing_permission(direct_vm, direct_deploy, direct_alice):
    contract = setup(direct_vm, direct_deploy, direct_alice)
    missing = {"status": "NEEDS_CLARIFICATION", "policy": None, "questions": ["What are the exact budget and approved recipient?"], "interpretation": "Activation permissions are missing."}
    direct_vm.mock_llm(r"(?s).*INTENTGUARD PERMISSION INTERPRETER.*", canonical(missing))
    assert json.loads(contract.propose("missing", canonical({"description": "Purchase analytics tools."}))) == missing
    assert direct_vm.run_validator() is True
