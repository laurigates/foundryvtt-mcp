"""Private JSONL worker. It never connects to Foundry or receives provider credentials.

Node owns routing, schema validation, fixed runtime bindings and the write gate.
One process hosts the system and module adapters for one target/session generation.
Python 3.10+ and the standard library are sufficient.
"""

from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import inspect
import json
import sys
from pathlib import Path
from typing import Any


PROTOCOL_VERSION = 1
MAX_LINE_BYTES = 8 * 1024 * 1024


class ProtocolError(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


class IntegrationContext:
    def __init__(
        self, worker: Worker, integration: str, operation: str, call_token: str
    ) -> None:
        self._worker = worker
        self._integration = integration
        self._operation = operation
        self._call_token = call_token
        self.target_id = worker.target_id
        self.generation = worker.generation

    async def invoke(self, operation: str, arguments: dict[str, Any]) -> Any:
        if operation != self._operation or not isinstance(arguments, dict):
            raise ProtocolError("invalid_binding", "Invalid adapter operation binding")
        return await self._worker.invoke(
            self._integration, operation, arguments, self._call_token
        )


class Worker:
    def __init__(self, output: Any) -> None:
        self.output = output
        self.target_id = ""
        self.generation = -1
        self.package_root: Path | None = None
        self.adapters: dict[str, Any] = {}
        self.pending: dict[str, asyncio.Future[Any]] = {}
        self.tasks: set[asyncio.Task[None]] = set()
        self.sequence = 0

    def emit(self, message: dict[str, Any]) -> None:
        line = json.dumps(message, allow_nan=False, separators=(",", ":"))
        if len(line.encode("utf-8")) > MAX_LINE_BYTES:
            raise ProtocolError("protocol_limit", "Worker response exceeds protocol limit")
        self.output.write(line + "\n")
        self.output.flush()

    async def invoke(
        self, integration: str, operation: str, arguments: dict[str, Any], call_token: str
    ) -> Any:
        self.sequence += 1
        request_id = f"python:{self.sequence}"
        future = asyncio.get_running_loop().create_future()
        self.pending[request_id] = future
        self.emit({
            "type": "request", "id": request_id,
            "generation": self.generation, "method": "invoke",
            "params": {
                "integration": integration, "operation": operation,
                "arguments": arguments, "callToken": call_token,
            },
        })
        try:
            return await future
        finally:
            self.pending.pop(request_id, None)

    def receive_response(self, message: dict[str, Any]) -> None:
        future = self.pending.get(message["id"])
        if future is None or future.done():
            raise ProtocolError("invalid_response", "Unrecognized provider response")
        error = message.get("error")
        if error:
            future.set_exception(ProtocolError(
                str(error.get("code", "provider_error")), str(error.get("message", "Provider failed"))
            ))
        else:
            future.set_result(message.get("result"))

    def handshake(self, params: dict[str, Any], generation: int) -> dict[str, Any]:
        if self.package_root is not None:
            raise ProtocolError("handshake_complete", "A worker belongs to exactly one session")
        if params.get("version") != PROTOCOL_VERSION:
            raise ProtocolError("protocol_version", "Unsupported worker protocol version")
        if not isinstance(params.get("targetId"), str) or not params["targetId"]:
            raise ProtocolError("invalid_target", "A target ID is required")
        self.target_id = params["targetId"]
        self.generation = generation
        self.package_root = Path(params["packageRoot"]).resolve(strict=True)
        return {"version": PROTOCOL_VERSION, "targetId": self.target_id}

    def load(self, params: dict[str, Any]) -> dict[str, bool]:
        if self.package_root is None:
            raise ProtocolError("handshake_required", "Handshake must precede adapter loading")
        key = params.get("integration")
        if not isinstance(key, str) or ":" not in key:
            raise ProtocolError("invalid_integration", "Integration identity is required")
        kind, integration_id = key.split(":", 1)
        if kind not in ("system", "module"):
            raise ProtocolError("invalid_integration", "Unknown integration family")
        family = self.package_root / ("systems" if kind == "system" else "modules")
        root = Path(params["root"]).resolve(strict=True)
        expected = (family / integration_id).resolve(strict=True)
        if root != expected or not root.is_relative_to(family.resolve()):
            raise ProtocolError("invalid_path", "Adapter directory does not match its identity")
        entrypoint = (root / params["entrypoint"]).resolve(strict=True)
        if not entrypoint.is_relative_to(root) or entrypoint.suffix != ".py":
            raise ProtocolError("invalid_path", "Adapter entrypoint escapes its integration directory")
        if key in self.adapters:
            raise ProtocolError("duplicate_adapter", "Adapter is already loaded")
        module_name = "foundry_adapter_" + hashlib.sha256(str(entrypoint).encode()).hexdigest()
        spec = importlib.util.spec_from_file_location(
            module_name, entrypoint, submodule_search_locations=[str(root)]
        )
        if spec is None or spec.loader is None:
            raise ProtocolError("load_failed", "Cannot load adapter entrypoint")
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        adapter_type = getattr(module, "Adapter", None)
        if not callable(adapter_type):
            raise ProtocolError("invalid_adapter", "The entrypoint must export an Adapter class")
        adapter = adapter_type()
        if not callable(getattr(adapter, "execute", None)):
            raise ProtocolError("invalid_adapter", "Adapter.execute is required")
        self.adapters[key] = adapter
        return {"loaded": True}

    async def dispatch(self, message: dict[str, Any]) -> None:
        response = {"type": "response", "id": message["id"], "generation": message["generation"]}
        try:
            params = message.get("params", {})
            if not isinstance(params, dict):
                raise ProtocolError("invalid_params", "Request parameters must be an object")
            method = message.get("method")
            if method == "handshake":
                result = self.handshake(params, message["generation"])
            elif self.package_root is None:
                raise ProtocolError("handshake_required", "Handshake is required")
            elif method == "load":
                result = self.load(params)
            elif method == "call":
                key = params.get("integration")
                adapter = self.adapters.get(key)
                if adapter is None:
                    raise ProtocolError("integration_unavailable", "Adapter is not loaded")
                operation = params.get("operation")
                arguments = params.get("arguments")
                call_token = params.get("callToken")
                if not isinstance(operation, str) or not isinstance(arguments, dict) or not isinstance(call_token, str):
                    raise ProtocolError("invalid_params", "Invalid integration invocation")
                context = IntegrationContext(self, key, operation, call_token)
                result = adapter.execute(operation, arguments, context)
                if inspect.isawaitable(result):
                    result = await result
            else:
                raise ProtocolError("unknown_method", f"Unknown worker method: {method}")
            response["result"] = result
            self.emit(response)
        except asyncio.CancelledError:
            return
        except Exception as error:
            response.pop("result", None)
            response["error"] = {
                "code": error.code if isinstance(error, ProtocolError) else "adapter_error",
                "message": str(error),
            }
            self.emit(response)

    async def run(self) -> None:
        try:
            while True:
                line = await asyncio.to_thread(sys.stdin.buffer.readline, MAX_LINE_BYTES + 1)
                if not line:
                    break
                if len(line) > MAX_LINE_BYTES or not line.endswith(b"\n"):
                    raise ProtocolError("protocol_limit", "Invalid or oversized JSONL message")
                message = json.loads(line)
                if not isinstance(message, dict) or not isinstance(message.get("id"), str) or not isinstance(message.get("generation"), int):
                    raise ProtocolError("invalid_message", "Invalid worker envelope")
                if self.package_root is not None and message["generation"] != self.generation:
                    raise ProtocolError("stale_session", "Message belongs to another generation")
                if message.get("type") == "response":
                    self.receive_response(message)
                elif message.get("type") == "request":
                    task = asyncio.create_task(self.dispatch(message))
                    self.tasks.add(task)
                    task.add_done_callback(self.tasks.discard)
                else:
                    raise ProtocolError("invalid_message", "Unknown message type")
        finally:
            for task in self.tasks:
                task.cancel()
            await asyncio.gather(*self.tasks, return_exceptions=True)
            for future in self.pending.values():
                if not future.done():
                    future.cancel()
            for adapter in self.adapters.values():
                close = getattr(adapter, "close", None)
                if callable(close):
                    result = close()
                    if inspect.isawaitable(result):
                        await result


def main() -> None:
    protocol_output = sys.stdout
    # Even accidental print() calls in an adapter become diagnostics, not protocol bytes.
    sys.stdout = sys.stderr
    try:
        asyncio.run(Worker(protocol_output).run())
    except Exception as error:
        print(f"Python integration worker failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
