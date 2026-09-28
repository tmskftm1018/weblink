class InvalidProgressTransition(ValueError):
    pass


_ALLOWED_TRANSITIONS = {
    "NOT_STARTED": {"IN_PROGRESS", "COMPLETED"},
    "IN_PROGRESS": {"IN_PROGRESS", "COMPLETED"},
    "COMPLETED": {"COMPLETED"},
}


def transition_progress(current: str, target: str) -> str:
    if target not in _ALLOWED_TRANSITIONS.get(current, set()):
        raise InvalidProgressTransition(f"Cannot move learning progress from {current} to {target}")
    return target
