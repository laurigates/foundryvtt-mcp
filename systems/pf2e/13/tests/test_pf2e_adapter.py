import importlib.util
import json
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

    async def test_every_declared_operation_uses_only_its_bound_callback(self):
        manifest = json.loads((Path(__file__).resolve().parents[1] / "manifest.json").read_text())
        calls = []

        class Context:
            async def invoke(self, operation, arguments):
                calls.append((operation, arguments))
                return {"operation": operation}

        for operation in manifest["operations"]:
            result = await self.adapter.execute(operation["id"], {"actor_uuid": "Actor.example"}, Context())
            self.assertEqual(result, {"operation": operation["id"]})
        self.assertEqual(len(calls), len(manifest["operations"]))
        self.assertEqual(len({name for name, _ in calls}), len(manifest["operations"]))

    async def test_rejects_arbitrary_paths_and_non_object_arguments(self):
        for operation in ["Actor.update", "game.pf2e.Check.roll", None, [], "get_actor_data.__proto__"]:
            with self.assertRaises(ValueError):
                await self.adapter.execute(operation, {}, object())
        for arguments in [None, [], "{}", 1]:
            with self.assertRaises(ValueError):
                await self.adapter.execute("get_actor_data", arguments, object())

    async def test_instances_do_not_share_mutable_operation_state(self):
        self.assertIsInstance(self.adapter.operations, frozenset)
        original = self.adapter.operations
        self.adapter.operations = frozenset()
        await self.asyncSetUp()
        self.assertEqual(self.adapter.operations, original)


if __name__ == "__main__":
    unittest.main()
