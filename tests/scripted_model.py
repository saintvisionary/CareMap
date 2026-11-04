"""A deterministic Strands Model for offline tests. Each call pops the next scripted turn.

A turn is either a string (final text) or a list of (tool_name, input_dict) tool calls.
Adapted from ../lumina-navigator/tests/scripted_model.py.
"""
import json
import uuid

from strands.models.model import Model


class ScriptedModel(Model):
    def __init__(self, turns):
        self.turns = list(turns)
        self.calls = 0

    def update_config(self, **kw):
        pass

    def get_config(self):
        return {}

    async def structured_output(self, *a, **kw):
        raise NotImplementedError

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        self.calls += 1
        turn = self.turns.pop(0)
        yield {"messageStart": {"role": "assistant"}}
        if isinstance(turn, str):
            yield {"contentBlockStart": {"start": {}}}
            yield {"contentBlockDelta": {"delta": {"text": turn}}}
            yield {"contentBlockStop": {}}
            yield {"messageStop": {"stopReason": "end_turn"}}
        else:
            for name, inp in turn:
                yield {"contentBlockStart": {"start": {"toolUse": {"toolUseId": uuid.uuid4().hex[:12], "name": name}}}}
                yield {"contentBlockDelta": {"delta": {"toolUse": {"input": json.dumps(inp)}}}}
                yield {"contentBlockStop": {}}
            yield {"messageStop": {"stopReason": "tool_use"}}
        yield {"metadata": {"usage": {"inputTokens": 1, "outputTokens": 1, "totalTokens": 2}, "metrics": {"latencyMs": 1}}}
