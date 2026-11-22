"""Include the tests colocated with every distributed integration."""

import importlib.util
import hashlib
import unittest
from pathlib import Path


def load_tests(loader, tests, pattern):
    root = Path(__file__).resolve().parents[2]
    suite = unittest.TestSuite()
    for family in ("systems", "modules"):
        for path in sorted((root / family).rglob("tests/test_*.py")):
            # Each version is an independent package. Include the entire relative
            # path in the module identity so equal filenames cannot shadow a sibling.
            if not (path.parent.parent / "manifest.json").is_file():
                continue
            identity = str(path.relative_to(root))
            name = "integration_test_" + hashlib.sha256(identity.encode()).hexdigest()
            spec = importlib.util.spec_from_file_location(name, path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            suite.addTests(loader.loadTestsFromModule(module))
    return suite
