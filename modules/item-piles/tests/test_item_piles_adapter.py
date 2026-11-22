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
        self.manifest = json.loads(path.with_name("manifest.json").read_text(encoding="utf-8"))

    async def test_dispatches_arguments_through_the_context(self):
        calls = []

        class Context:
            async def invoke(self, operation, arguments):
                calls.append((operation, arguments))
                return {"verified": True}

        result = await self.adapter.execute("get_items", {"actor_uuid": "Actor.same"}, Context())
        self.assertEqual(result, {"verified": True})
        self.assertEqual(calls, [("get_items", {"actor_uuid": "Actor.same"})])

    async def test_rejects_unknown_operations(self):
        with self.assertRaises(ValueError):
            await self.adapter.execute("unknown", {}, object())

    async def test_dispatches_every_declared_operation_without_changing_arguments(self):
        for entry in self.manifest["operations"]:
            with self.subTest(operation=entry["id"]):
                calls = []
                arguments = {"fixture": {"unchanged": True}}
                expected = {"operation": entry["id"], "verified": True}

                class Context:
                    async def invoke(self, operation, values):
                        calls.append((operation, values))
                        return expected

                result = await self.adapter.execute(entry["id"], arguments, Context())
                self.assertIs(result, expected)
                self.assertEqual(len(calls), 1)
                self.assertEqual(calls[0][0], entry["id"])
                self.assertIs(calls[0][1], arguments)

    async def test_rejects_invalid_operation_and_argument_types_before_invocation(self):
        for operation in (None, [], {"method": "transferItems"}):
            with self.subTest(operation=operation), self.assertRaises(ValueError):
                await self.adapter.execute(operation, {}, object())
        for arguments in (None, [], "return game.itempiles.API"):
            with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                await self.adapter.execute("get_items", arguments, object())

    async def test_preserves_provider_failure_without_retrying(self):
        calls = []
        failure = RuntimeError("outcome_unknown")

        class Context:
            async def invoke(self, operation, arguments):
                calls.append(operation)
                raise failure

        with self.assertRaises(RuntimeError) as caught:
            await self.adapter.execute("get_items", {"actor_uuid": "Actor.same"}, Context())
        self.assertIs(caught.exception, failure)
        self.assertEqual(calls, ["get_items"])


if __name__ == "__main__":
    unittest.main()
