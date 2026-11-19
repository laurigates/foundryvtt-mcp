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

    def handshake(self):
        self.request("h", "handshake", {
            "version": 1, "targetId": "alpha", "packageRoot": str(PACKAGE_ROOT),
        })
        self.assertEqual(self.receive()["result"], {"version": 1, "targetId": "alpha"})

    def load(self, kind, identifier):
        self.request("load", "load", {
            "integration": f"{kind}:{identifier}",
            "root": str(PACKAGE_ROOT / ("systems" if kind == "system" else "modules") / identifier),
            "entrypoint": "adapter.py",
        })
        self.assertEqual(self.receive()["result"], {"loaded": True})

    def test_loads_hyphenated_id_from_an_unrelated_working_directory(self):
        self.handshake()
        self.load("module", "item-piles")

    def test_rejects_wrong_protocol_version(self):
        self.request("bad", "handshake", {"version": 999, "targetId": "alpha", "packageRoot": str(PACKAGE_ROOT)})
        self.assertEqual(self.receive()["error"]["code"], "protocol_version")

    def test_rejects_entrypoint_outside_its_package(self):
        self.handshake()
        self.request("bad", "load", {
            "integration": "system:dnd5e", "root": str(PACKAGE_ROOT / "systems/dnd5e"),
            "entrypoint": "../../python/foundry_mcp_modules/worker.py",
        })
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
