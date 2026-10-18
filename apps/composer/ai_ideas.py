"""Post-idea generation with an optional OpenAI-compatible provider."""

import json

import httpx
from django.conf import settings


class IdeaProviderError(Exception):
    """The configured idea provider did not return a usable response."""


def prompt_starters(topic: str, audience: str = "", platform: str = "") -> list[dict[str, str]]:
    """Return deterministic prompts, explicitly used only when AI is unconfigured."""
    subject = topic.strip() or "your work"
    audience_phrase = f" for {audience.strip()}" if audience.strip() else ""
    platform_phrase = f" on {platform.strip()}" if platform.strip() else ""
    return [
        {
            "title": f"A practical tip about {subject}",
            "description": (
                f"Share one small, useful action someone can try today{audience_phrase}{platform_phrase}. "
                "Explain why it works and end with a question inviting readers to share their approach."
            ),
        },
        {
            "title": f"A common myth about {subject}",
            "description": (
                f"Name a belief people often have about {subject}, gently correct it with a concrete example, "
                "and invite your audience to add another misconception."
            ),
        },
        {
            "title": f"Behind the scenes: {subject}",
            "description": (
                f"Show one real step, decision, or lesson from your work with {subject}. "
                "Keep it specific and share what surprised you."
            ),
        },
        {
            "title": f"Ask your audience about {subject}",
            "description": (
                f"Ask {audience.strip() or 'your audience'} what their biggest challenge with {subject} is. "
                "Offer a few answer choices or a short prompt to make replying easy."
            ),
        },
    ]


def generate_ideas(*, topic: str, audience: str = "", platform: str = "") -> tuple[list[dict[str, str]], str]:
    """Return generated ideas and their source (``ai`` or ``starter-prompts``)."""
    api_key = getattr(settings, "POST_IDEAS_API_KEY", "").strip()
    if not api_key:
        return prompt_starters(topic, audience, platform), "starter-prompts"

    prompt = (
        "Create exactly 4 distinct, practical social-media post ideas. Return only a JSON object "
        'with an "ideas" array; each item must have a short "title" and a useful "description". '
        "Do not invent customer results, statistics, endorsements, or facts. The user will review "
        "and edit every idea before using it.\n"
        f"Topic: {topic}\nAudience: {audience or 'general audience'}\n"
        f"Platform: {platform or 'any social platform'}"
    )
    try:
        response = httpx.post(
            settings.POST_IDEAS_API_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": settings.POST_IDEAS_MODEL,
                "messages": [
                    {"role": "system", "content": "You are a concise social content brainstorm assistant."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.8,
                "response_format": {"type": "json_object"},
            },
            timeout=20,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        data = json.loads(content)
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
        raise IdeaProviderError("The AI provider is temporarily unavailable. Please try again.") from exc

    items = data.get("ideas") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise IdeaProviderError("The AI provider returned an unexpected response. Please try again.")

    ideas = []
    for item in items[:5]:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip()[:120]
        description = str(item.get("description", "")).strip()[:1200]
        if title and description:
            ideas.append({"title": title, "description": description})
    if not ideas:
        raise IdeaProviderError("The AI provider returned no usable ideas. Please try again.")
    return ideas, "ai"
