"""Include the tests colocated with every distributed integration."""

import importlib.util
import unittest
from pathlib import Path


def load_tests(loader, tests, pattern):
    root = Path(__file__).resolve().parents[2]
    suite = unittest.TestSuite()
    for family in ("systems", "modules"):
        for path in sorted((root / family).glob("*/tests/test_*.py")):
            name = f"integration_test_{family}_{path.parent.parent.name.replace('-', '_')}_{path.stem}"
            spec = importlib.util.spec_from_file_location(name, path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            suite.addTests(loader.loadTestsFromModule(module))
    return suite
