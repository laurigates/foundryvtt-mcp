"""Item Piles API integration. Transport and credentials belong to the host."""


class Adapter:
    async def execute(self, operation, arguments, context):
        if operation != "get_items":
            raise ValueError(f"Unsupported Item Piles operation: {operation}")
        return await context.invoke(operation, arguments)
