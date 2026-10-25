from pathlib import Path
import hashlib
import pytest

pytest_plugins = ["gltest.direct"]
SDK_RELEASE = "v0.2.16"
SDK_SHA256 = "4f0b358ec98ec148be9b95cdfb0f0e1a6cbe64da0194fdfac3fffc6f5d1d93e2"


@pytest.fixture(scope="session")
def verified_sdk():
    from gltest.direct.sdk_loader import download_artifacts
    tarball = download_artifacts(SDK_RELEASE)
    assert hashlib.sha256(tarball.read_bytes()).hexdigest() == SDK_SHA256
    return SDK_RELEASE


@pytest.fixture(autouse=True)
def pinned_sdk_paths(verified_sdk):
    # Load the pinned SDK before account fixtures construct ABI Address values.
    # Do not follow GitHub /latest: GenVM 0.3 renamed the universal artifact.
    from gltest.direct.sdk_loader import setup_sdk_paths
    setup_sdk_paths(Path("contracts/genlayer/permission_interpreter.py"), version=verified_sdk)


@pytest.fixture
def direct_deploy(direct_deploy, verified_sdk):
    # Extend the plugin fixture so every deployment uses the same verified SDK,
    # even on machines that also cache newer SDK releases.
    def deploy(contract_path, *args, **kwargs):
        kwargs["sdk_version"] = verified_sdk
        return direct_deploy(contract_path, *args, **kwargs)
    return deploy
