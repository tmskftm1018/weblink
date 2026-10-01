"""Ephemeral project change signals for connected collaborators."""

import asyncio
from collections import defaultdict
from uuid import UUID

from anyio import from_thread
from fastapi import WebSocket


class ProjectEventHub:
    def __init__(self) -> None:
        self._subscribers: dict[UUID, dict[WebSocket, str]] = defaultdict(dict)
        self._lock = asyncio.Lock()

    async def connect(self, project_id: UUID, websocket: WebSocket, user_id: str) -> None:
        async with self._lock:
            self._subscribers[project_id][websocket] = user_id
        await self.publish_presence(project_id)

    async def disconnect(self, project_id: UUID, websocket: WebSocket) -> None:
        changed = False
        async with self._lock:
            subscribers = self._subscribers.get(project_id)
            if subscribers is None:
                return
            changed = subscribers.pop(websocket, None) is not None
            if not subscribers:
                self._subscribers.pop(project_id, None)
        if changed:
            await self.publish_presence(project_id)

    async def publish(self, project_id: UUID, area: str) -> None:
        failed = await self._send_to_project(project_id, {"type": "project.changed", "area": area})
        if failed:
            await self.publish_presence(project_id)

    async def publish_presence(self, project_id: UUID) -> None:
        async with self._lock:
            subscribers = dict(self._subscribers.get(project_id, {}))
        if not subscribers:
            return
        payload = {"type": "project.presence", "user_ids": sorted(set(subscribers.values()))}
        await self._send_to_project(project_id, payload)

    async def _send_to_project(self, project_id: UUID, payload: dict[str, object]) -> bool:
        async with self._lock:
            subscribers = tuple(self._subscribers.get(project_id, {}))
        if not subscribers:
            return False
        results = await asyncio.gather(
            *(websocket.send_json(payload) for websocket in subscribers),
            return_exceptions=True,
        )
        failed = [socket for socket, result in zip(subscribers, results) if isinstance(result, BaseException)]
        if failed:
            async with self._lock:
                current = self._subscribers.get(project_id)
                if current is not None:
                    for websocket in failed:
                        current.pop(websocket, None)
                    if not current:
                        self._subscribers.pop(project_id, None)
        return bool(failed)


project_event_hub = ProjectEventHub()


def notify_project_change(project_id: UUID, area: str) -> None:
    """Publish from a synchronous FastAPI worker thread without blocking the API."""
    try:
        from_thread.run(project_event_hub.publish, project_id, area)
    except RuntimeError:
        # Direct service invocations outside an ASGI worker have no event loop to notify.
        return
