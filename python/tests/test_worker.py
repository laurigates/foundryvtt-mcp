"""Exercise the real worker protocol without Foundry or third-party dependencies."""

import json
import selectors
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[2]
WORKER = PACKAGE_ROOT / "python/foundry_mcp_modules/worker.py"


class WorkerProtocolTests(unittest.TestCase):
    def setUp(self):
        self.cwd = tempfile.TemporaryDirectory()
        self.process = subprocess.Popen(
            [sys.executable, "-I", "-B", "-u", str(WORKER)],
            cwd=self.cwd.name, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, bufsize=1,
        )

    def tearDown(self):
        self.process.terminate()
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=3)
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            stream.close()
        self.cwd.cleanup()

    def send(self, message):
        self.process.stdin.write(json.dumps(message) + "\n")
        self.process.stdin.flush()

    def receive(self):
        with selectors.DefaultSelector() as selector:
            selector.register(self.process.stdout, selectors.EVENT_READ)
            self.assertTrue(selector.select(timeout=3), "Worker did not respond")
        line = self.process.stdout.readline()
        self.assertTrue(line, "Worker closed its protocol pipe")
        return json.loads(line)

    def request(self, request_id, method, params, generation=7):
        self.send({"type": "request", "id": request_id, "method": method,
                   "params": params, "generation": generation})

    def handshake(self, package_root=PACKAGE_ROOT):
        self.package_root = Path(package_root)
        self.request("h", "handshake", {
            "version": 1, "targetId": "alpha", "packageRoot": str(self.package_root),
        })
        self.assertEqual(self.receive()["result"], {"version": 1, "targetId": "alpha"})

    def load(self, kind, identifier, foundry_generation=14):
        root = self.package_root / ("systems" if kind == "system" else "modules") / identifier
        params = {
            "integration": f"{kind}:{identifier}",
            "root": str(root / str(foundry_generation) if foundry_generation is not None else root),
            "entrypoint": "adapter.py",
        }
        if foundry_generation is not None:
            params["foundryGeneration"] = foundry_generation
        self.request("load", "load", params)
        self.assertEqual(self.receive()["result"], {"loaded": True})

    def fixture_adapter(self, relative, source=None):
        root = Path(self.cwd.name) / "fixture-packages" / relative
        root.mkdir(parents=True, exist_ok=True)
        (root / "adapter.py").write_text(source or (
            "class Adapter:\n"
            "    async def execute(self, operation, arguments, context):\n"
            "        return await context.invoke(operation, arguments)\n"
        ), encoding="utf-8")
        return root

    def test_loads_hyphenated_id_from_an_unrelated_working_directory(self):
        self.handshake()
        self.load("module", "item-piles")

    def test_item_piles_read_and_write_keep_operation_arguments_and_call_token(self):
        self.handshake()
        self.load("module", "item-piles")
        for operation, arguments, result in (
            ("get_items", {"actor_uuid": "Actor.one"}, []),
            ("transfer_items", {"source_uuid": "Actor.one", "target_uuid": "Actor.two",
                                "items": [{"item_id": "potion", "quantity": 2}]}, []),
        ):
            with self.subTest(operation=operation):
                self.request(operation, "call", {
                    "integration": "module:item-piles", "operation": operation,
                    "arguments": arguments, "callToken": "token-" + operation,
                })
                callback = self.receive()
                self.assertEqual(callback["method"], "invoke")
                self.assertEqual(callback["params"], {
                    "integration": "module:item-piles", "operation": operation,
                    "arguments": arguments, "callToken": "token-" + operation,
                })
                self.send({"type": "response", "id": callback["id"], "generation": 7, "result": result})
                self.assertEqual(self.receive()["result"], result)

    def test_item_piles_preserves_uncertain_mutation_without_another_callback(self):
        self.handshake()
        self.load("module", "item-piles")
        self.request("trade", "call", {
            "integration": "module:item-piles", "operation": "trade_items",
            "arguments": {"seller_uuid": "Actor.one", "buyer_uuid": "Actor.two",
                          "item_id": "potion", "quantity": 1}, "callToken": "trade-token",
        })
        callback = self.receive()
        self.assertEqual(callback["method"], "invoke")
        self.send({"type": "response", "id": callback["id"], "generation": 7,
                   "error": {"code": "outcome_unknown", "message": "Remote result was lost"}})
        response = self.receive()
        self.assertEqual(response["type"], "response")
        self.assertEqual(response["id"], "trade")
        self.assertEqual(response["error"]["code"], "outcome_unknown")

    def test_both_systems_keep_read_write_arguments_and_call_tokens(self):
        self.handshake()
        for identifier, condition_key in (("dnd5e", "condition"), ("pf2e", "condition_slug")):
            self.load("system", identifier)
            for operation, arguments, result in (
                ("get_actor_data", {"actor_uuid": "Actor.one"}, {"system": identifier}),
                ("set_condition", {"actor_uuid": "Actor.one", condition_key: "prone", "active": False},
                 {"actor_uuid": "Actor.one", "system": identifier}),
            ):
                with self.subTest(system=identifier, operation=operation):
                    token = f"{identifier}-{operation}"
                    self.request(token, "call", {
                        "integration": f"system:{identifier}", "operation": operation,
                        "arguments": arguments, "callToken": token,
                    })
                    callback = self.receive()
                    self.assertEqual(callback["method"], "invoke")
                    self.assertEqual(callback["params"], {
                        "integration": f"system:{identifier}", "operation": operation,
                        "arguments": arguments, "callToken": token,
                    })
                    self.send({"type": "response", "id": callback["id"], "generation": 7, "result": result})
                    self.assertEqual(self.receive()["result"], result)

    def test_system_mutations_preserve_uncertain_outcome_without_replay(self):
        self.handshake()
        for identifier, condition_key in (("dnd5e", "condition"), ("pf2e", "condition_slug")):
            with self.subTest(system=identifier):
                self.load("system", identifier)
                self.request(identifier, "call", {
                    "integration": f"system:{identifier}", "operation": "set_condition",
                    "arguments": {"actor_uuid": "Actor.one", condition_key: "prone", "active": True},
                    "callToken": identifier,
                })
                callback = self.receive()
                self.assertEqual(callback["method"], "invoke")
                self.send({"type": "response", "id": callback["id"], "generation": 7,
                           "error": {"code": "outcome_unknown", "message": "Runtime result was lost"}})
                response = self.receive()
                self.assertEqual(response["type"], "response")
                self.assertEqual(response["id"], identifier)
                self.assertEqual(response["error"]["code"], "outcome_unknown")

    def test_rejects_wrong_protocol_version(self):
        self.request("bad", "handshake", {"version": 999, "targetId": "alpha", "packageRoot": str(PACKAGE_ROOT)})
        self.assertEqual(self.receive()["error"]["code"], "protocol_version")

    def test_rejects_entrypoint_outside_its_package(self):
        self.handshake()
        self.request("bad", "load", {
            "integration": "system:dnd5e", "root": str(PACKAGE_ROOT / "systems/dnd5e/14"),
            "entrypoint": "../../../python/foundry_mcp_modules/worker.py", "foundryGeneration": 14,
        })
        self.assertEqual(self.receive()["error"]["code"], "invalid_path")

    def test_flat_package_without_generation_keeps_legacy_protocol(self):
        root = self.fixture_adapter("modules/legacy-example")
        self.handshake(root.parents[1])
        self.load("module", "legacy-example", foundry_generation=None)
        self.request("legacy", "call", {
            "integration": "module:legacy-example", "operation": "read",
            "arguments": {"value": 42}, "callToken": "legacy-token",
        })
        callback = self.receive()
        self.assertEqual(callback["params"]["callToken"], "legacy-token")
        self.send({"type": "response", "id": callback["id"], "generation": 7, "result": {"value": 42}})
        self.assertEqual(self.receive()["result"], {"value": 42})

    def test_only_selected_generation_is_imported(self):
        root = self.fixture_adapter("systems/example/13")
        self.fixture_adapter("systems/example/14", "raise RuntimeError('Unselected generation imported')\n")
        self.handshake(root.parents[2])
        self.load("system", "example", foundry_generation=13)

    def test_rejects_loading_second_generation_of_same_identity(self):
        root = self.fixture_adapter("systems/example/13")
        other = self.fixture_adapter("systems/example/14")
        self.handshake(root.parents[2])
        self.load("system", "example", foundry_generation=13)
        self.request("duplicate", "load", {
            "integration": "system:example", "root": str(other),
            "entrypoint": "adapter.py", "foundryGeneration": 14,
        })
        self.assertEqual(self.receive()["error"]["code"], "duplicate_adapter")

    def test_rejects_generation_mismatch_and_missing_generation(self):
        root = self.fixture_adapter("systems/example/13")
        other = self.fixture_adapter("systems/example/14")
        self.handshake(root.parents[2])
        for params in (
            {"root": str(root), "foundryGeneration": 14},
            {"root": str(other), "foundryGeneration": 13},
            {"root": str(root)},
            {"root": str(root.parent), "foundryGeneration": 13},
        ):
            with self.subTest(params=params):
                self.request("mismatch", "load", {
                    "integration": "system:example", "entrypoint": "adapter.py", **params,
                })
                self.assertEqual(self.receive()["error"]["code"], "invalid_path")

    def test_rejects_invalid_generation_values(self):
        root = self.fixture_adapter("systems/example/13")
        self.handshake(root.parents[2])
        for value in (None, True, False, 12, 0, -13, 13.0, "13", 9007199254740992):
            with self.subTest(value=value):
                self.request("invalid-generation", "load", {
                    "integration": "system:example", "entrypoint": "adapter.py",
                    "root": str(root), "foundryGeneration": value,
                })
                self.assertEqual(self.receive()["error"]["code"], "invalid_foundry_generation")

    def test_rejects_identity_traversal_and_invalid_identifiers(self):
        root = self.fixture_adapter("systems/example/13")
        self.handshake(root.parents[2])
        for identifier in ("../example", "example/13", "example:13", "", ".example", "example\\13"):
            with self.subTest(identifier=identifier):
                self.request("invalid-identity", "load", {
                    "integration": "system:" + identifier, "entrypoint": "adapter.py",
                    "root": str(root), "foundryGeneration": 13,
                })
                self.assertEqual(self.receive()["error"]["code"], "invalid_integration")

    def test_rejects_sibling_entrypoint_and_symlink_aliases(self):
        root = self.fixture_adapter("systems/example/13")
        sibling = self.fixture_adapter("systems/example/14")
        identity_alias = root.parents[1] / "alias"
        identity_alias.symlink_to(root.parent, target_is_directory=True)
        generation_alias = root.parent / "15"
        generation_alias.symlink_to(root, target_is_directory=True)
        (root / "external.py").symlink_to(sibling / "adapter.py")
        self.handshake(root.parents[2])
        for params in (
            {"integration": "system:example", "root": str(root), "foundryGeneration": 13,
             "entrypoint": "../14/adapter.py"},
            {"integration": "system:example", "root": str(root), "foundryGeneration": 13,
             "entrypoint": "external.py"},
            {"integration": "system:alias", "root": str(identity_alias / "13"), "foundryGeneration": 13,
             "entrypoint": "adapter.py"},
            {"integration": "system:example", "root": str(generation_alias), "foundryGeneration": 15,
             "entrypoint": "adapter.py"},
        ):
            with self.subTest(params=params):
                self.request("alias", "load", params)
                self.assertEqual(self.receive()["error"]["code"], "invalid_path")

    def test_correlates_concurrent_provider_callbacks(self):
        self.handshake()
        self.load("system", "dnd5e")
        for request_id in ("first", "second"):
            self.request(request_id, "call", {
                "integration": "system:dnd5e", "operation": "get_actor_data",
                "arguments": {"actor_uuid": request_id}, "callToken": request_id,
            })
        callbacks = [self.receive(), self.receive()]
        self.assertEqual({message["type"] for message in callbacks}, {"request"})
        for callback in reversed(callbacks):
            self.send({"type": "response", "id": callback["id"], "generation": 7,
                       "result": {"source": callback["params"]["arguments"]["actor_uuid"]}})
        results = [self.receive(), self.receive()]
        self.assertEqual({message["id"]: message["result"]["source"] for message in results},
                         {"first": "first", "second": "second"})

    def test_rejects_stale_generation(self):
        self.handshake()
        self.request("stale", "load", {}, generation=8)
        self.assertNotEqual(self.process.wait(timeout=3), 0)
        self.assertIn("another generation", self.process.stderr.read())


if __name__ == "__main__":
    unittest.main()
