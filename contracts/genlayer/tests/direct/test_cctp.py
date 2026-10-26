"""Destination permissions are checked by both leader and independent validators."""
import json
import pytest
from datetime import datetime, timezone
from test_intentguard import NOW, policy, invoice, snapshots, request, canonical, digest, mock_models, call_review
SOURCE = "0xdec90b78111ba2fc6fc6d84d8b9ec159a2d4b9b3"
TOKENS = {1952: SOURCE, 84532: "0x036cbd53842c5426634e7929541ec2318f3dcf7e", 421614: "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d"}
DOMAINS = {1952: 37, 84532: 6, 421614: 3}
SETTLEMENT = {"asset": "USDC", "destinationChainIds": [1952, 84532, 421614]}

def setup(vm, deploy, operator, destination=84532, invoice_chain=None):
    vm.sender = operator
    vm.warp(datetime.fromtimestamp(NOW, timezone.utc).isoformat())
    c = deploy("contracts/genlayer/versions/purchase_reviewer_v3.py", operator, canonical(policy()), digest(policy()), 1952, SOURCE, canonical(SETTLEMENT))
    actual_chain = destination if invoice_chain is None else invoice_chain
    bundle = snapshots(invoice(chainId=actual_chain, token=TOKENS[actual_chain]))
    for item in bundle:
        vm.mock_web("^" + __import__("re").escape(item["url"]) + "$", {"status": 200, "body": item["content"]})
    mock_models(vm)
    req = request(bundle, token=SOURCE, chainId=1952, settlementHash=digest(SETTLEMENT), destinationChainId=destination, destinationToken=TOKENS[destination], destinationDomain=DOMAINS[destination])
    return c, bundle, req

@pytest.mark.parametrize("destination", [1952, 84532, 421614])
def test_native_usdc_destination_review_and_validator(direct_vm, direct_deploy, direct_alice, destination):
    c, bundle, req = setup(direct_vm, direct_deploy, direct_alice, destination)
    result = call_review(c, bundle, req)
    assert result["decision"] == "APPROVE"
    assert result["requestHash"] == digest(req)
    assert c.get_settlement_hash() == digest(SETTLEMENT)
    assert direct_vm.run_validator() is True

def test_source_invoice_cannot_authorize_destination_spend(direct_vm, direct_deploy, direct_alice):
    c, bundle, req = setup(direct_vm, direct_deploy, direct_alice, 84532, 1952)
    result = call_review(c, bundle, req)
    assert result["decision"] == "REJECT"
    assert direct_vm.run_validator() is True

@pytest.mark.parametrize("change", [
    {"settlementHash": "0x" + "0" * 64}, {"destinationChainId": 8453},
    {"destinationDomain": 3}, {"destinationToken": SOURCE},
])
def test_destination_commitment_tampering_fails_closed(direct_vm, direct_deploy, direct_alice, change):
    c, bundle, req = setup(direct_vm, direct_deploy, direct_alice)
    with direct_vm.expect_revert():
        call_review(c, bundle, {**req, **change})

@pytest.mark.parametrize("settlement", [
    {"asset": "USDT0", "destinationChainIds": [1952]},
    {"asset": "USDC", "destinationChainIds": [196]},
    {"asset": "USDC", "destinationChainIds": [84532, 1952]},
    {"asset": "USDC", "destinationChainIds": [1952, 1952]},
])
def test_invalid_immutable_settlement_cannot_deploy(direct_vm, direct_deploy, direct_alice, settlement):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert():
        direct_deploy("contracts/genlayer/versions/purchase_reviewer_v3.py", direct_alice, canonical(policy()), digest(policy()), 1952, SOURCE, canonical(settlement))
