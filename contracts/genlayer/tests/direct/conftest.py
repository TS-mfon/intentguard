from pathlib import Path
import pytest

pytest_plugins = ["gltest.direct"]


@pytest.fixture(autouse=True)
def pinned_sdk_paths():
    # Load the pinned SDK before account fixtures construct ABI Address values.
    # The runner evicts SDK paths between tests, so initialize for every case.
    from gltest.direct.sdk_loader import setup_sdk_paths
    setup_sdk_paths(Path("contracts/genlayer/permission_interpreter.py"))
