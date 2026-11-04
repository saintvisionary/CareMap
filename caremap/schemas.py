"""Structured output shape for the Orchestrator agent (spec: "returns
reply + map commands as structured output")."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class MapCommand(BaseModel):
    type: Literal["flyTo", "highlight", "filter"]
    payload: dict = Field(default_factory=dict)


class OrchestratorOutput(BaseModel):
    reply: str
    map_commands: list[MapCommand] = Field(default_factory=list)
