import importlib.util
import unittest
from pathlib import Path


class AdapterTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        path = Path(__file__).resolve().parents[1] / "adapter.py"
        spec = importlib.util.spec_from_file_location("tested_adapter", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.adapter = module.Adapter()

    async def test_dispatches_arguments_through_the_context(self):
        calls = []

        class Context:
            async def invoke(self, operation, arguments):
                calls.append((operation, arguments))
                return {"verified": True}

        result = await self.adapter.execute("get_actor_data", {"actor_uuid": "Actor.same"}, Context())
        self.assertEqual(result, {"verified": True})
        self.assertEqual(calls, [("get_actor_data", {"actor_uuid": "Actor.same"})])

    async def test_rejects_unknown_operations(self):
        with self.assertRaises(ValueError):
            await self.adapter.execute("unknown", {}, object())


if __name__ == "__main__":
    unittest.main()
