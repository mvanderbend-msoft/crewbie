import html
import re


def fence(tag: str, text: str, **attributes: str) -> str:
    """Wrap untrusted tool output in a named tag the instructions treat as data.

    Any copy of the tag inside the text is removed first, so a result cannot close the fence early.
    """
    cleaned = re.sub(rf"</?\s*{tag}\b[^>]*>", "", text, flags=re.IGNORECASE).strip()
    attrs = "".join(f' {name}="{html.escape(value, quote=True)}"' for name, value in attributes.items())
    return f"<{tag}{attrs}>\n{cleaned}\n</{tag}>"
